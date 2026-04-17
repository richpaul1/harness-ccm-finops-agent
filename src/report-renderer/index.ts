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
import { renderDocument } from "./render.js";
import { renderPdf } from "./pdf.js";
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
  return reports.delete(id);
}

// ─── Theme template loader (cached per theme dir + mtime) ────────────────────
type RenderShellFn = (args: {
  meta: ReturnType<typeof renderDocument>["meta"];
  html: string;
  toc: ReturnType<typeof renderDocument>["toc"];
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
  const doc = renderDocument(contentFile);
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
  const withDataAttrs = html.replace(
    "<body",
    `<body data-doc-customer="${encodeDataAttr(doc.meta.customer)}" ` +
      `data-doc-title="${encodeDataAttr(doc.meta.title)}" ` +
      `data-theme="${theme.id}"`,
  );
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(withDataAttrs);
}

// ─── Express mounter ─────────────────────────────────────────────────────────
// dotfiles: "allow" — repo may live under ~/.cursor/worktrees/… etc.
const STATIC_OPTS = { maxAge: 0, dotfiles: "allow" as const };

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

  // Static assets — themes, public scripts, paged.js polyfill
  router.use("/_report/themes", express.static(THEMES_DIR, STATIC_OPTS));
  router.use("/_report/public", express.static(PUBLIC_DIR, STATIC_OPTS));
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

  async function pdfHandler(
    req: Request,
    res: Response,
    contentFile: string,
    sendMode: "inline" | "download",
    docPath: string,
  ): Promise<void> {
    try {
      const doc = renderDocument(contentFile);
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

  // Mount the strict router on the host app at the configured prefix
  app.use(prefix || "/", router);
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
