/**
 * Report Renderer — in-process Express routes that turn registered markdown
 * files into themed, paginated HTML documents (and on-demand PDF exports).
 *
 * The renderer is mounted **into the existing MCP HTTP app** in HTTP transport
 * mode so reports share the same host and port as the MCP endpoint. In stdio
 * transport mode there is no MCP HTTP app, so the renderer lazily spins up its
 * own dedicated Express listener on `HARNESS_REPORT_PORT`.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type Request, type Response } from "express";
import slugify from "slugify";
import { renderDocument, renderMarkdownString, warmPackPreprocessors } from "./render.js";
import { renderPdf } from "./pdf.js";
import { renderVideo } from "./video.js";
import { renderPptx } from "./pptx.js";
import { markdownToDocx } from "../utils/markdown-to-docx.js";
import { markdownToPptx } from "../utils/markdown-to-pptx.js";
import { resolveTtsProvider, type TtsProviderName } from "./tts/factory.js";
import {
  listThemes,
  resolveTheme,
  THEMES_DIR,
  PUBLIC_DIR,
  getPagedjsScript,
  type Theme,
} from "./themes.js";
import type { Config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("report-renderer");

// ─── Registry ────────────────────────────────────────────────────────────────
// In-memory map of registered reports. Re-registering the same content path
// returns the same ID (idempotent URLs).

export interface ReportEntry {
  id: string;
  contentPath: string;
  /**
   * Web root for this report. All `/reports/<id>/<path>` requests resolve to
   * `<baseDir>/<path>`, so any relative URL in the markdown (e.g.
   * `assets/chart.png`, `images/foo.svg`, `inline.png`) Just Works.
   * Defaults to `path.dirname(contentPath)`.
   */
  baseDir: string;
  label: string;
  registeredAt: number;
}

export interface RegisterReportOptions {
  contentPath: string;
  /** Override for the web root. Defaults to the markdown file's directory. */
  baseDir?: string;
  id?: string;
  label?: string;
}

const reports = new Map<string, ReportEntry>();

/**
 * Disk-persisted registry path. The renderer's `reports` map is in-memory by
 * default, which means every `nodemon` restart wiped the URL → markdown-path
 * mapping and forced the user to re-register. We mirror the map to a JSON
 * file on every mutation and restore it at module load so URLs survive
 * restarts.
 *
 * Location: `<cwd>/out/report-registry.json` (under our standard `out/` dir
 * so it's gitignored alongside generated PDFs/MP4s/PPTXs).
 */
const REGISTRY_PERSIST_PATH = path.resolve(process.cwd(), "out", "report-registry.json");

interface PersistedRegistry {
  version: 1;
  entries: ReportEntry[];
}

/**
 * Write the current `reports` map to disk. Called from `registerReport` and
 * `deleteReport`. Errors are logged and swallowed — a transient write failure
 * shouldn't crash the request, the in-memory state remains correct.
 */
function persistRegistry(): void {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_PERSIST_PATH), { recursive: true });
    const payload: PersistedRegistry = {
      version: 1,
      entries: Array.from(reports.values()),
    };
    fs.writeFileSync(REGISTRY_PERSIST_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    log.warn("Failed to persist report registry", { error: String(err) });
  }
}

/**
 * Restore the persisted registry at module load. Skips entries whose
 * `contentPath` no longer exists on disk (the markdown was moved or deleted
 * between server runs). Idempotent — calling multiple times is safe.
 */
function loadPersistedRegistry(): void {
  try {
    if (!fs.existsSync(REGISTRY_PERSIST_PATH)) return;
    const raw = fs.readFileSync(REGISTRY_PERSIST_PATH, "utf8");
    const data = JSON.parse(raw) as Partial<PersistedRegistry>;
    if (!data || data.version !== 1 || !Array.isArray(data.entries)) {
      log.warn("Persisted registry has unexpected shape, ignoring");
      return;
    }
    let restored = 0;
    let pruned = 0;
    for (const entry of data.entries) {
      if (!entry || typeof entry.id !== "string" || typeof entry.contentPath !== "string") {
        continue;
      }
      // Prune entries whose markdown file no longer exists — they'd just 404
      // on the asset serving path anyway.
      if (!fs.existsSync(entry.contentPath)) {
        pruned += 1;
        continue;
      }
      reports.set(entry.id, entry);
      restored += 1;
    }
    log.info("Report registry restored from disk", {
      path: REGISTRY_PERSIST_PATH,
      restored,
      pruned,
    });
    if (pruned > 0) persistRegistry(); // rewrite without the pruned entries
  } catch (err) {
    log.warn("Failed to load persisted report registry", { error: String(err) });
  }
}

// Restore on module load so the first request after a server restart finds
// previously-registered reports. This runs ONCE per process.
loadPersistedRegistry();

/**
 * Most recent rendered MP4 path per (reportId, themeId). Populated by the
 * POST /reports/:id/video handler and consumed by GET /reports/:id/video.mp4
 * so a user can hit the download URL straight from a browser without any
 * round-trip through the MCP layer.
 */
const videoCache = new Map<string, string>();

/**
 * Most recent rendered PPTX path per (reportId, themeId). Same shape as
 * `videoCache` — POST /reports/:id/pptx renders the deck; GET /reports/:id/
 * slides.pptx streams the most recently rendered file so a user can grab it
 * from a browser without re-rendering.
 */
const pptxCache = new Map<string, string>();

function hashPath(p: string): string {
  return crypto.createHash("sha1").update(path.resolve(p)).digest("hex").slice(0, 10);
}

function deriveId(contentPath: string): string {
  const base = path.basename(contentPath).replace(/\.[^.]+$/, "");
  const slug = base.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return slug ? `${slug}-${hashPath(contentPath)}` : hashPath(contentPath);
}

export function registerReport(opts: RegisterReportOptions): ReportEntry {
  const abs = path.resolve(opts.contentPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Markdown file not found: ${abs}`);
  }
  if (!fs.statSync(abs).isFile()) {
    throw new Error(`Not a file: ${abs}`);
  }

  // Default web root = the markdown file's directory. Any relative URL inside
  // the markdown (assets/foo.png, images/x.svg, ./inline.png) resolves
  // directly against the filesystem — no copying, no extra mounts.
  let baseDir: string;
  if (opts.baseDir) {
    baseDir = path.resolve(opts.baseDir);
    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
      throw new Error(`base_dir does not exist or is not a directory: ${baseDir}`);
    }
  } else {
    baseDir = path.dirname(abs);
  }

  const id = opts.id || deriveId(abs);
  const entry: ReportEntry = {
    id,
    contentPath: abs,
    baseDir,
    label: opts.label || path.basename(abs),
    registeredAt: Date.now(),
  };
  reports.set(id, entry);
  persistRegistry();
  log.info("Report registered", { id, contentPath: abs, baseDir });
  return entry;
}

export function getReport(id: string): ReportEntry | undefined {
  return reports.get(id);
}

export function listReports(): ReportEntry[] {
  return Array.from(reports.values());
}

export function deleteReport(id: string): boolean {
  const removed = reports.delete(id);
  if (removed) persistRegistry();
  return removed;
}

// ─── Theme template loader (cached per theme dir + mtime) ────────────────────
import type { RenderedDoc } from "./render.js";

type RenderShellFn = (args: {
  meta: RenderedDoc["meta"];
  html: string;
  toc: RenderedDoc["toc"];
  mode: "web" | "print";
  liveReload?: boolean;
  theme: Theme;
  themes: Array<Omit<Theme, "dir">>;
}) => string;

async function loadTemplate(themeDir: string): Promise<RenderShellFn> {
  // Cache-bust on every load so theme edits during dev are picked up immediately.
  const mod = (await import(
    `file://${path.join(themeDir, "template.js")}?t=${Date.now()}`
  )) as { renderShell: RenderShellFn };
  return mod.renderShell;
}

function encodeDataAttr(s: string | undefined): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

async function renderReportToHtml(
  contentFile: string,
  req: Request,
  res: Response,
): Promise<void> {
  const doc = await renderDocument(contentFile);
  const themeId = (req.query.theme as string | undefined) || "harness";
  const theme = resolveTheme(themeId);
  const renderShell = await loadTemplate(theme.dir);
  const mode: "web" | "print" = req.query.mode === "print" ? "print" : "web";
  const themes = listThemes().map(({ dir: _dir, ...rest }) => rest);

  const html = renderShell({
    ...doc,
    mode,
    liveReload: false, // live-reload SSE removed — reports are static after render
    theme,
    themes,
  });
  // Build the footer-left string from author + classification so customer
  // themes can override the default "Harness CCM · Confidential" branding.
  const footerLeft = [doc.meta.author, doc.meta.classification]
    .filter(Boolean)
    .join(" · ");

  const withDataAttrs = html.replace(
    "<body",
    `<body data-doc-customer="${encodeDataAttr(doc.meta.customer)}" ` +
      `data-doc-title="${encodeDataAttr(doc.meta.title)}" ` +
      `data-doc-footer-left="${encodeDataAttr(footerLeft)}" ` +
      `data-theme="${theme.id}"`,
  );
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(withDataAttrs);
}

// ─── Express mounter ─────────────────────────────────────────────────────────
// dotfiles: "allow" — repo may live under ~/.cursor/worktrees/… etc.
const STATIC_OPTS = { maxAge: 0, dotfiles: "allow" as const };

/**
 * Public/_report assets (edit-panel.js, edit-panel.css, theme-switch.js,
 * export-menu.js) need an aggressive no-cache policy so dev iteration is
 * smooth — without this, a hot-reloaded server still serves a 304 and the
 * browser keeps using the previous JS. We're localhost-only so the cost of
 * disabling caching here is zero.
 */
const PUBLIC_STATIC_OPTS = {
  maxAge: 0,
  dotfiles: "allow" as const,
  setHeaders: (res: import("express").Response) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  },
};

export interface MountOptions {
  /** Mount prefix; defaults to `""` (root). */
  prefix?: string;
  /** Override the public base URL used in PDF export (host + port + prefix). */
  publicBaseUrl?: string;
}

/**
 * Mount the report-renderer routes onto an existing Express app. The MCP HTTP
 * server calls this at startup so reports live under the same host:port as the
 * MCP endpoint.
 *
 * Routes are registered on a dedicated `express.Router({ strict: true })` so
 * `/reports/:id` and `/reports/:id/` are distinct endpoints. The no-slash form
 * issues a 301 to the trailing-slash form so relative image URLs inside the
 * markdown resolve correctly.
 */
export function mountReportRoutes(app: Express, opts: MountOptions = {}): void {
  const prefix = opts.prefix?.replace(/\/+$/, "") ?? "";
  const router = express.Router({ strict: true });

  // Warm up pack preprocessors asynchronously at mount time so the first
  // rendered report doesn't stall on dynamic imports. Errors are logged but
  // not fatal — packs with bad preprocessors are skipped gracefully.
  void warmPackPreprocessors().catch((err) =>
    log.warn("Pack preprocessor warm-up failed", { error: String(err) }),
  );

  // Static assets — themes, public scripts, paged.js polyfill
  router.use("/_report/themes", express.static(THEMES_DIR, PUBLIC_STATIC_OPTS));
  router.use("/_report/public", express.static(PUBLIC_DIR, PUBLIC_STATIC_OPTS));
  router.use(
    "/_report/vendor/paged.polyfill.js",
    express.static(getPagedjsScript(), STATIC_OPTS),
  );
  router.use("/_report/vendor", express.static(path.dirname(getPagedjsScript()), STATIC_OPTS));

  // Health + theme metadata
  router.get("/_report/health", (_req, res) => {
    res.json({ ok: true, service: "report-renderer", reports: reports.size });
  });
  router.get("/_report/themes.json", (_req, res) => {
    res.json(listThemes().map(({ dir: _dir, ...rest }) => rest));
  });

  // Registered reports as JSON (for the in-sidebar reports modal). Fields
  // are kept narrow on purpose: the modal needs id / label / contentPath
  // (so we can show the basename as a subtitle) and registeredAt (so we
  // can sort newest-first). Anything more would just bloat the payload.
  router.get("/_report/reports.json", (_req, res) => {
    const items = listReports()
      .sort((a, b) => b.registeredAt - a.registeredAt)
      .map((r) => ({
        id: r.id,
        label: r.label,
        contentPath: r.contentPath,
        registeredAt: r.registeredAt,
        // Convenience filename for the modal subtitle line
        fileName: path.basename(r.contentPath),
        // Pre-built relative URL the modal can use as the link target
        url: `${prefix}/reports/${r.id}/`,
      }));
    res.json({ ok: true, count: items.length, reports: items });
  });

  // Helper — pull `id` out of req.params with the type narrowing TS demands
  const getParamId = (req: Request): string => {
    const id = (req.params as Record<string, string | undefined>).id;
    if (!id) throw new Error("Missing :id route param");
    return id;
  };

  // /reports/:id → 301 to trailing-slash form so relative URLs in markdown
  // resolve correctly against `<reports>/<id>/` (e.g. `assets/chart.png`
  // becomes `/reports/<id>/assets/chart.png`).
  router.get("/reports/:id", (req: Request, res: Response) => {
    const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(301, `${prefix}/reports/${getParamId(req)}/${q}`);
  });

  // /reports/:id/ — render the markdown. Must be registered BEFORE the splat
  // catch-all so the empty path lands on the renderer rather than a directory
  // listing attempt against baseDir.
  router.get("/reports/:id/", async (req: Request, res: Response) => {
    const id = getParamId(req);
    const entry = reports.get(id);
    if (!entry) {
      return res.status(404).send(
        `<pre>Report '${id}' not registered. ` +
          `Register via the harness_ccm_finops_report_render MCP tool. Ask for the report to rendered again.</pre>`,
      );
    }
    try {
      await renderReportToHtml(entry.contentPath, req, res);
    } catch (err) {
      log.error("Report render failed", { id, error: String(err) });
      res.status(500).send(`<pre>${String((err as Error).stack || err)}</pre>`);
    }
  });

  // Per-report PDF — register BEFORE the `/*splat` catch-all, otherwise the
  // splat matches "download" as a filename and returns 404 before these land.
  // The handlers themselves are defined further down (pdfHandler / reports map
  // are available at request time via closure).
  router.post("/reports/:id/pdf", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    void pdfHandler(req, res, entry.contentPath, "inline", `${prefix}/reports/${entry.id}/`);
  });
  router.get("/reports/:id/download", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    void pdfHandler(req, res, entry.contentPath, "download", `${prefix}/reports/${entry.id}/`);
  });

  // Per-report narrated video — same shape as the PDF endpoints, also
  // registered BEFORE the `/*splat` catch-all so the splat doesn't swallow
  // them. POST /video renders a fresh MP4 (synchronous; can take a minute);
  // GET /video.mp4 streams the most recently rendered file for that
  // (id, theme) pair so the user can hit it from a browser. The render
  // module writes the MP4 to <cwd>/out/ and we cache its path in memory by
  // (id, theme) so subsequent GETs Just Work without re-rendering.
  router.post("/reports/:id/video", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    void videoHandler(req, res, entry, `${prefix}/reports/${entry.id}/`);
  });
  router.get("/reports/:id/video.mp4", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    const themeId = (req.query.theme as string | undefined) || "harness";
    const cached = videoCache.get(`${entry.id}:${themeId}`);
    if (!cached || !fs.existsSync(cached)) {
      res.status(404).send(
        "No video has been rendered for this report yet. " +
          "POST to ./video first, or run the harness_ccm_finops_video_render MCP tool.",
      );
      return;
    }
    res.download(cached, path.basename(cached));
  });

  // Per-report PowerPoint export — mirrors the PDF endpoints exactly so the
  // sidebar's Export menu can fetch + download in one shot. The render is
  // synchronous (Playwright capture + pptxgenjs pack), typically 5-20s
  // depending on page count. Result is cached on disk by (id, theme) so a
  // subsequent browser GET just streams the pre-built file.
  router.post("/reports/:id/pptx", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    void pptxHandler(req, res, entry, "inline", `${prefix}/reports/${entry.id}/`);
  });
  router.get("/reports/:id/slides.pptx", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    const themeId = (req.query.theme as string | undefined) || "harness";
    const cached = pptxCache.get(`${entry.id}:${themeId}`);
    if (!cached || !fs.existsSync(cached)) {
      res.status(404).send(
        "No PPTX has been rendered for this report yet. " +
          "POST to ./pptx first, or run the harness_ccm_finops_pptx_render MCP tool.",
      );
      return;
    }
    res.download(cached, path.basename(cached));
  });

  // Per-report Word export. Unlike PDF/PPTX this is pure-JS (no Playwright),
  // so the handler runs straight off the markdown file in milliseconds and
  // there's no need for a "render-then-cache" split. Both routes do the same
  // work; GET exists so the file can be shared via a plain URL.
  router.post("/reports/:id/docx", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    void docxHandler(req, res, entry, "inline");
  });
  router.get("/reports/:id/report.docx", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    void docxHandler(req, res, entry, "download");
  });

  // ─── Live edit: source view + write-back + change-watch ────────────────────
  // GET /reports/:id/source.md  → returns the raw markdown file contents
  // POST /reports/:id/source    → writes JSON {markdown:string} back to disk
  // GET /reports/:id/source-watch → SSE stream of "change" events when the
  //                                 source file changes (external edits too)
  //
  // The renderer is localhost-only by design (MCP transport), so these write
  // endpoints are not gated behind auth. If the renderer is ever exposed to
  // the network, gate these behind an env flag before opening up.

  router.get("/reports/:id/source.md", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    try {
      const stat = fs.statSync(entry.contentPath);
      const body = fs.readFileSync(entry.contentPath, "utf8");
      res.set({
        "Content-Type": "text/markdown; charset=utf-8",
        // Surface the mtime so the editor can detect external concurrent edits.
        "X-Source-Mtime": String(stat.mtimeMs),
        "Cache-Control": "no-store",
      });
      res.send(body);
    } catch (err) {
      log.error("Source read failed", { id: entry.id, error: String(err) });
      res.status(500).send(String((err as Error).message || err));
    }
  });

  router.post("/reports/:id/source", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const markdown = body.markdown;
    if (typeof markdown !== "string") {
      res.status(400).json({ ok: false, error: "Body must be JSON {markdown: string}" });
      return;
    }
    // Optional optimistic-concurrency check: client sends the mtime they loaded
    // and we refuse to overwrite if the file changed underneath them.
    const expectedMtime =
      typeof body.expected_mtime === "number" ? body.expected_mtime : undefined;
    try {
      if (expectedMtime !== undefined) {
        const currentMtime = fs.statSync(entry.contentPath).mtimeMs;
        // Allow a 1ms slop window to deal with mtime resolution differences.
        if (Math.abs(currentMtime - expectedMtime) > 1) {
          res.status(409).json({
            ok: false,
            error: "Source file was modified externally since you loaded it.",
            current_mtime: currentMtime,
          });
          return;
        }
      }
      fs.writeFileSync(entry.contentPath, markdown, "utf8");
      const newMtime = fs.statSync(entry.contentPath).mtimeMs;
      log.info("Source written", { id: entry.id, bytes: markdown.length, mtime: newMtime });
      res.json({ ok: true, mtime: newMtime, bytes: markdown.length });
    } catch (err) {
      log.error("Source write failed", { id: entry.id, error: String(err) });
      res.status(500).json({ ok: false, error: String((err as Error).message || err) });
    }
  });

  // POST /reports/:id/render-preview — render arbitrary markdown through the
  // full pipeline and return just the doc-body HTML. Used by the live-edit
  // panel for keystroke-debounced live preview WITHOUT writing to disk —
  // the editor sends its current buffer and gets back the preview HTML to
  // swap into `.doc-body`. Cheap (~5–20ms server-side for typical reports).
  router.post("/reports/:id/render-preview", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    void (async () => {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        const markdown = body.markdown;
        if (typeof markdown !== "string") {
          res.status(400).json({ ok: false, error: "Body must be JSON {markdown: string}" });
          return;
        }
        const t0 = Date.now();
        const result = await renderMarkdownString(markdown);
        const elapsedMs = Date.now() - t0;
        res.json({ ok: true, html: result.html, elapsed_ms: elapsedMs });
      } catch (err) {
        log.error("Preview render failed", { id: entry.id, error: String(err) });
        res.status(500).json({ ok: false, error: String((err as Error).message || err) });
      }
    })();
  });

  // SSE: notify connected browsers when the source markdown file changes on
  // disk (external editor save, agent re-render, etc.). The browser's
  // edit-panel.js reloads the page on receipt so external edits don't get
  // silently shadowed by a stale view.
  router.get("/reports/:id/source-watch", (req, res) => {
    const entry = reports.get(getParamId(req));
    if (!entry) {
      res.status(404).send("Report not found");
      return;
    }
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
    });
    res.flushHeaders?.();
    res.write(`: connected ${new Date().toISOString()}\n\n`);

    let lastMtime = 0;
    try {
      lastMtime = fs.statSync(entry.contentPath).mtimeMs;
    } catch {
      // proceed; we'll learn the mtime on the first change event
    }

    // fs.watch is debounced naturally on macOS/Linux. We re-stat on each event
    // and only emit when mtime actually moved (avoids spurious "rename" events
    // editors fire when saving via temp-file swap).
    let watcher: fs.FSWatcher | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      watcher = fs.watch(entry.contentPath, () => {
        try {
          const currentMtime = fs.statSync(entry.contentPath).mtimeMs;
          if (currentMtime > lastMtime) {
            lastMtime = currentMtime;
            res.write(`event: change\ndata: ${JSON.stringify({ mtime: currentMtime })}\n\n`);
          }
        } catch {
          // file vanished mid-rename; rely on the next event
        }
      });
    } catch (err) {
      log.warn("fs.watch failed for source-watch", { id: entry.id, error: String(err) });
    }

    // Heartbeat every 30s to keep proxies / EventSource happy.
    heartbeat = setInterval(() => res.write(`: ping\n\n`), 30_000);

    req.on("close", () => {
      if (watcher) watcher.close();
      if (heartbeat) clearInterval(heartbeat);
    });
  });

  // /reports/:id/<anything> — serve any file under the report's baseDir. This
  // is what makes relative image URLs (`assets/chart.png`, `images/foo.svg`,
  // `inline.png`) resolve straight off disk — no copying, no separate mount.
  router.get("/reports/:id/*splat", (req: Request, res: Response) => {
    const entry = reports.get(getParamId(req));
    if (!entry) return res.status(404).send("Report not found");
    const splat = (req.params as { splat?: string | string[] }).splat;
    const rel = Array.isArray(splat) ? splat.join("/") : String(splat || "");
    const file = path.resolve(entry.baseDir, rel);
    if (!file.startsWith(entry.baseDir)) return res.sendStatus(400);
    // Don't serve the source markdown file itself — keeps frontmatter private.
    if (file === entry.contentPath) return res.sendStatus(404);
    res.sendFile(file, { dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) res.status(404).send("File not found");
    });
  });

  // Index page — list all registered reports
  router.get("/reports/", (_req, res) => {
    const rows = listReports()
      .map(
        (d) =>
          `<li><a href="${prefix}/reports/${d.id}/">${d.label}</a> ` +
          `<small>(${path.basename(d.contentPath)})</small></li>`,
      )
      .join("\n");
    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(
      `<!doctype html><html><head><title>Harness Reports</title>` +
        `<style>body{font-family:system-ui;padding:2rem;max-width:50rem;margin:auto}` +
        `h1{margin-bottom:1rem}li{margin:.5rem 0}</style></head>` +
        `<body><h1>Harness Reports</h1>` +
        (reports.size === 0
          ? `<p>No reports registered yet. Use the harness_ccm_finops_report_render tool to register one.</p>`
          : `<p>${reports.size} registered:</p><ul>${rows}</ul>`) +
        `</body></html>`,
    );
  });

  // Per-report PDF (download). The PDF endpoint asks Playwright to visit the
  // print preview using `publicBaseUrl` so the rendered URL is always the one
  // a real browser would see — important for asset resolution.
  const baseUrlGetter = (): string => opts.publicBaseUrl ?? "";

  async function videoHandler(
    req: Request,
    res: Response,
    entry: ReportEntry,
    docPath: string,
  ): Promise<void> {
    try {
      const baseUrl = baseUrlGetter();
      if (!baseUrl) {
        res.status(500).send("Video export not available — public base URL not configured");
        return;
      }
      const themeId = (req.query.theme as string | undefined) || "harness";
      // Body is optional; if present it carries the same overrides the MCP
      // tool exposes (voice, width/height/fps, min_dwell_ms). We type-narrow
      // each field defensively because the route is reachable from any HTTP
      // client, not just the MCP tool.
      const body = (req.body || {}) as Record<string, unknown>;
      // Allow the caller to pin a specific provider; otherwise resolve the
      // first one whose env vars are present. Audio is cached on disk by
      // default so re-renders only re-call TTS for changed narration.
      const providerName = isTtsProviderName(body.tts_provider) ? body.tts_provider : undefined;
      const tts = resolveTtsProvider({
        ...(providerName ? { providerName } : {}),
      });
      const doc = await renderDocument(entry.contentPath);
      const result = await renderVideo({
        baseUrl,
        meta: doc.meta,
        themeId,
        docPath,
        tts,
        ...(typeof body.voice === "string" ? { voice: body.voice } : {}),
        ...(typeof body.width === "number" ? { width: body.width } : {}),
        ...(typeof body.height === "number" ? { height: body.height } : {}),
        ...(typeof body.fps === "number" ? { fps: body.fps } : {}),
        ...(typeof body.min_dwell_ms === "number" ? { minDwellMs: body.min_dwell_ms } : {}),
        ...(body.transitions === "cut" || body.transitions === "xfade"
          ? { transitions: body.transitions }
          : {}),
        ...(typeof body.transition_ms === "number" ? { transitionMs: body.transition_ms } : {}),
        ...(typeof body.ken_burns === "boolean" ? { kenBurns: body.ken_burns } : {}),
        ...(typeof body.captions === "boolean" ? { captions: body.captions } : {}),
      });
      videoCache.set(`${entry.id}:${themeId}`, result.outPath);
      res.json({
        ok: true,
        out_path: result.outPath,
        file_name: result.fileName,
        manifest_path: result.manifestPath,
        download_url: `${baseUrl}/reports/${entry.id}/video.mp4?theme=${encodeURIComponent(themeId)}`,
        total_duration_ms: result.totalDurationMs,
        slides: result.slides.length,
        narrated_slides: result.slides.filter((s) => s.audioFile).length,
      });
    } catch (err) {
      log.error("Video export failed", { error: String((err as Error).message) });
      res.status(500).send(String((err as Error).stack || err));
    }
  }

  async function pptxHandler(
    req: Request,
    res: Response,
    entry: ReportEntry,
    sendMode: "inline" | "download",
    docPath: string,
  ): Promise<void> {
    try {
      const themeId = (req.query.theme as string | undefined) || "harness";
      const body = (req.body || {}) as Record<string, unknown>;
      const slideSize =
        body.slide_size === "16x9" || body.slide_size === "4x3"
          ? (body.slide_size as "16x9" | "4x3")
          : "16x9";

      const doc = await renderDocument(entry.contentPath);
      const raw = await fs.promises.readFile(entry.contentPath, "utf-8");
      // Strip YAML frontmatter — already parsed into doc.meta.
      const markdown = raw.replace(/^---\n[\s\S]*?\n---\n/, "");

      const buf = await markdownToPptx(markdown, {
        title: doc.meta.title,
        customer: doc.meta.customer,
        date: doc.meta.date,
        assetsDir: path.dirname(path.resolve(entry.contentPath)),
        slideSize,
      });

      const slug = slugify(`${doc.meta.customer || "report"}-${doc.meta.title}`, {
        lower: true,
        strict: true,
      });
      const date = doc.meta.date || new Date().toISOString().slice(0, 10);
      const fileName = `${slug}-${themeId}-${date}.pptx`;

      // Cache to disk (keeps the GET /slides.pptx download URL working).
      const outDir = path.resolve(process.cwd(), "out");
      await new Promise<void>((resolve, reject) =>
        fs.mkdir(outDir, { recursive: true }, err => (err ? reject(err) : resolve())),
      );
      const outPath = path.join(outDir, fileName);
      await new Promise<void>((resolve, reject) =>
        fs.writeFile(outPath, buf, err => (err ? reject(err) : resolve())),
      );
      pptxCache.set(`${entry.id}:${themeId}`, outPath);

      if (sendMode === "inline") {
        res.set({
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": String(buf.length),
        });
        res.send(buf);
      } else {
        res.download(outPath, fileName);
      }
    } catch (err) {
      log.error("PPTX export failed", { error: String((err as Error).message) });
      res.status(500).send(String((err as Error).stack || err));
    }
  }

  async function docxHandler(
    req: Request,
    res: Response,
    entry: ReportEntry,
    sendMode: "inline" | "download",
  ): Promise<void> {
    try {
      const themeId = (req.query.theme as string | undefined) || "harness";
      const doc = await renderDocument(entry.contentPath);
      // Strip YAML frontmatter — `renderDocument` already parsed it into
      // `doc.meta`; leaving the raw frontmatter in the body would produce a
      // leading code-block in the Word doc.
      const raw = await fs.promises.readFile(entry.contentPath, "utf-8");
      const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
      const buf = await markdownToDocx(body, { title: doc.meta.title });
      const slug = slugify(`${doc.meta.customer || "report"}-${doc.meta.title}`, {
        lower: true,
        strict: true,
      });
      const date = doc.meta.date || new Date().toISOString().slice(0, 10);
      const fileName = `${slug}-${themeId}-${date}.docx`;
      res.set({
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `${sendMode === "download" ? "attachment" : "attachment"}; filename="${fileName}"`,
        "Content-Length": String(buf.length),
      });
      res.send(buf);
    } catch (err) {
      log.error("DOCX export failed", { error: String((err as Error).message) });
      res.status(500).send(String((err as Error).stack || err));
    }
  }

  async function pdfHandler(
    req: Request,
    res: Response,
    contentFile: string,
    sendMode: "inline" | "download",
    docPath: string,
  ): Promise<void> {
    try {
      const doc = await renderDocument(contentFile);
      const themeId = (req.query.theme as string | undefined) || "harness";
      const theme = resolveTheme(themeId);
      const baseUrl = baseUrlGetter();
      if (!baseUrl) {
        res.status(500).send("PDF export not available — public base URL not configured");
        return;
      }
      const { outPath, fileName } = await renderPdf({
        baseUrl,
        meta: doc.meta,
        themeId: theme.id,
        docPath,
      });
      if (sendMode === "inline") {
        const buf = await fs.promises.readFile(outPath);
        res.set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": String(buf.length),
        });
        res.send(buf);
      } else {
        res.download(outPath, fileName);
      }
    } catch (err) {
      log.error("PDF export failed", { error: String((err as Error).message) });
      res.status(500).send(String((err as Error).stack || err));
    }
  }

  // Mount the strict router on the host app at the configured prefix
  app.use(prefix || "/", router);
}

/** Narrow an arbitrary value to a known TTS provider name. */
function isTtsProviderName(v: unknown): v is TtsProviderName {
  return (
    v === "openai" ||
    v === "elevenlabs" ||
    v === "azure" ||
    v === "google" ||
    v === "local"
  );
}

// ─── Server URL coordination ────────────────────────────────────────────────
// In HTTP transport mode, src/index.ts mounts the report routes on the MCP
// Express app and records the base URL here so the MCP tool can return it.
// In stdio mode there is no MCP HTTP app, so the tool falls back to lazily
// starting a dedicated standalone Express listener.

let httpReportBaseUrl: string | undefined;

export function setHttpReportBaseUrl(url: string): void {
  httpReportBaseUrl = url;
  log.info("Report renderer mounted on MCP HTTP server", { url });
}

export async function getReportBaseUrl(config: Config): Promise<string> {
  if (httpReportBaseUrl) return httpReportBaseUrl;
  const server = await ensureStandaloneServer(config);
  return server.baseUrl;
}

// ─── Stdio mode: dedicated standalone listener ──────────────────────────────
// In stdio transport there's no MCP HTTP app to mount onto, so the renderer
// brings its own. Lazy-started on first tool invocation.

interface StandaloneServer {
  baseUrl: string;
  close: () => Promise<void>;
}

let standalone: StandaloneServer | undefined;
let standaloneStarting: Promise<StandaloneServer> | undefined;

export async function ensureStandaloneServer(config: Config): Promise<StandaloneServer> {
  if (standalone) return standalone;
  if (standaloneStarting) return standaloneStarting;

  standaloneStarting = new Promise<StandaloneServer>((resolve, reject) => {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "2mb" }));

    const port = config.HARNESS_REPORT_PORT;
    const httpServer = app.listen(port, "127.0.0.1", () => {
      const addr = httpServer.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      const baseUrl = `http://localhost:${boundPort}`;
      mountReportRoutes(app, { publicBaseUrl: baseUrl });
      log.info("Standalone report renderer listening", { url: baseUrl });

      standalone = {
        baseUrl,
        close: () =>
          new Promise<void>((r) => {
            httpServer.close(() => r());
          }),
      };
      resolve(standalone);
    });
    httpServer.on("error", (err) => {
      standaloneStarting = undefined;
      reject(err);
    });
  }).finally(() => {
    standaloneStarting = undefined;
  });

  return standaloneStarting;
}

export function getStandaloneServer(): StandaloneServer | undefined {
  return standalone;
}

// Best-effort shutdown for graceful process exit
const shutdownStandalone = (): void => {
  if (standalone) {
    log.info("Shutting down standalone report renderer");
    void standalone.close();
    standalone = undefined;
  }
};
process.once("SIGINT", shutdownStandalone);
process.once("SIGTERM", shutdownStandalone);
process.once("exit", shutdownStandalone);

// Re-exports for convenience
export { listThemes, resolveTheme } from "./themes.js";
