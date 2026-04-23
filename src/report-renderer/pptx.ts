/**
 * PPTX export — drives a headless Chromium (Playwright) at the running report
 * server, captures one PNG per Paged.js page, and wraps the stack into an
 * image-per-slide `.pptx` via `pptxgenjs`.
 *
 * Segmentation mirrors `video.ts` exactly: each `.pagedjs_page` becomes one
 * slide, in document order. No Markdown heading heuristics, no `---` slide
 * breaks — whatever the theme's print CSS decides to paginate becomes the
 * deck. This keeps PPT, PDF, and video visually 1:1 with each other.
 *
 * Playwright + Chromium are opt-in (same as `pdf.ts` / `video.ts`). If they
 * aren't installed, the module throws a clear install hint.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createRequire } from "node:module";
import slugify from "slugify";
import { createLogger } from "../utils/logger.js";
import type { DocMeta } from "./render.js";

// pptxgenjs@4.0.1 ships a broken ESM build: `exports.import` points at
// `dist/pptxgen.es.js`, which uses ESM `import` syntax, *but* the package's
// own package.json has `"type": null` (CommonJS default) — so Node loads the
// .es.js file as CJS and crashes with `SyntaxError: Cannot use import
// statement outside a module`. The CJS build (`dist/pptxgen.cjs.js`) is
// fine, so we bypass the broken exports map by loading the package via
// `createRequire`. The TS declaration file is still picked up at compile
// time, so we cast to a plain constructor for runtime.
const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PptxGenJS = require_("pptxgenjs") as unknown as new () => /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ any;

const log = createLogger("pptx-render");

export interface PptxRenderOptions {
  baseUrl: string;
  meta: DocMeta;
  themeId?: string;
  /** URL path for this doc, e.g. "/reports/<id>/". Trailing slash matters. */
  docPath?: string;
  /** Output directory; defaults to `<cwd>/out`. */
  outDir?: string;
  /** Absolute output path; takes precedence over outDir + slug. */
  outFile?: string;
  /**
   * Output slide aspect.
   * - "16x9"  (default, 13.333 × 7.5 in) — modern widescreen
   * - "4x3"  (10 × 7.5 in)              — legacy projector aspect
   * - "A4"   (11.693 × 8.268 in)        — matches the PDF Paged.js layout
   *                                       closest and gives the least
   *                                       letterboxing on print-sized pages.
   */
  slideSize?: "16x9" | "4x3" | "A4";
}

export interface PptxRenderResult {
  outPath: string;
  fileName: string;
  slides: number;
}

/**
 * Capture every Paged.js page of the running print preview and pack it into
 * a single `.pptx` where slide N = page N as a full-bleed centered image.
 */
export async function renderPptx(opts: PptxRenderOptions): Promise<PptxRenderResult> {
  const themeId = opts.themeId ?? "harness";
  const docPath = opts.docPath ?? "/";
  const slideSize = opts.slideSize ?? "16x9";

  // ── Output path ──────────────────────────────────────────────────────────
  let outPath: string;
  if (opts.outFile) {
    outPath = path.resolve(opts.outFile);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
  } else {
    const outDir = opts.outDir ?? path.resolve(process.cwd(), "out");
    await fs.mkdir(outDir, { recursive: true });
    const slug = slugify(`${opts.meta.customer || "report"}-${opts.meta.title}`, {
      lower: true,
      strict: true,
    });
    const date = opts.meta.date || new Date().toISOString().slice(0, 10);
    outPath = path.join(outDir, `${slug}-${themeId}-${date}.pptx`);
  }

  // Scratch dir keeps capture PNGs isolated per render.
  const workDir = `${outPath.replace(/\.pptx$/, "")}.work`;
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });

  // ── Capture Paged.js pages as PNGs ───────────────────────────────────────
  const captures = await capturePagedPngs({
    baseUrl: opts.baseUrl,
    docPath,
    themeId,
    workDir,
  });
  if (captures.length === 0) {
    throw new Error("PPTX render produced zero pages; the print view returned no `.pagedjs_page` elements");
  }

  // ── Build the pptx ───────────────────────────────────────────────────────
  const pptx = new PptxGenJS();
  pptx.author = "Harness CCM FinOps";
  pptx.company = opts.meta.customer || "Harness";
  pptx.title = opts.meta.title || "Harness Report";
  pptx.subject = opts.meta.subtitle || "";

  // Slide dimensions (inches). Pick the layout that lines up best with the
  // source page aspect so the content fills the slide with minimal padding.
  const layouts: Record<NonNullable<PptxRenderOptions["slideSize"]>, { w: number; h: number; name: string }> = {
    "16x9": { w: 13.333, h: 7.5, name: "LAYOUT_WIDE" },
    "4x3": { w: 10, h: 7.5, name: "LAYOUT_4x3" },
    A4: { w: 11.693, h: 8.268, name: "HARNESS_A4" },
  };
  const layout = layouts[slideSize];
  if (slideSize === "A4") {
    // Custom layout — pptxgenjs ships 16:9 / 4:3 / 16:10, but Paged.js emits
    // A4 by default so a dedicated A4 slide layout gets the closest match.
    pptx.defineLayout({ name: layout.name, width: layout.w, height: layout.h });
  }
  pptx.layout = layout.name;

  for (const cap of captures) {
    const slide = pptx.addSlide();
    // Full-bleed image, centered. We preserve aspect ratio via `sizing.contain`
    // so the capture is letterboxed rather than squashed.
    slide.background = { color: "FFFFFF" };
    slide.addImage({
      path: cap.pngFile,
      x: 0,
      y: 0,
      w: layout.w,
      h: layout.h,
      sizing: { type: "contain", w: layout.w, h: layout.h },
    });
  }

  // `write({ outputType: 'nodebuffer' })` is the Node-safe path. `writeFile`
  // also works but we want an explicit buffer so the HTTP handler can send
  // it inline as well as to disk.
  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  await fs.writeFile(outPath, buffer);

  log.info("PPTX rendered", {
    outPath,
    slides: captures.length,
    bytes: buffer.length,
  });

  return {
    outPath,
    fileName: path.basename(outPath),
    slides: captures.length,
  };
}

// ─── Playwright capture ──────────────────────────────────────────────────────
// Same shape as video.ts's `capturePagedScenes` but stripped of audio/narration
// handling — PPTX slides are stills.

interface CapturedPage {
  pageIndex: number;
  pngFile: string;
}

interface CaptureOptions {
  baseUrl: string;
  docPath: string;
  themeId: string;
  workDir: string;
}

async function capturePagedPngs(opts: CaptureOptions): Promise<CapturedPage[]> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "PPTX export requires Playwright. Install with: pnpm add playwright && npx playwright install chromium",
    );
  }

  const browser = await chromium.launch();
  try {
    // Use a high-DPR viewport so PNGs are crisp when scaled up to slide size.
    // The actual viewport width/height don't matter much — we screenshot each
    // `.pagedjs_page` at its natural CSS box.
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });

    const docPath = opts.docPath.endsWith("/") ? opts.docPath : `${opts.docPath}/`;
    const url = `${opts.baseUrl}${docPath}?mode=print&theme=${encodeURIComponent(opts.themeId)}`;
    log.info("Navigating", { url });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__PAGED_READY__ === true,
      null,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(400);

    // Expand the Paged.js container so every page is reachable and strip the
    // page drop-shadow / margin so the screenshot is a clean rectangle ready
    // to drop into a slide without a visible seam.
    await page.addStyleTag({
      content: `
        html, body, .pagedjs_pages { height: auto !important; overflow: visible !important; }
        .pagedjs_page { box-shadow: none !important; margin: 0 !important; }
      `,
    });
    await page.waitForTimeout(200);

    const pageHandles = await page.$$(".pagedjs_page");
    log.info("Paginated", { pages: pageHandles.length });

    const out: CapturedPage[] = [];
    for (let i = 0; i < pageHandles.length; i++) {
      const handle = pageHandles[i]!;
      const pngFile = path.join(opts.workDir, `slide-${String(i + 1).padStart(3, "0")}.png`);
      await handle.screenshot({ path: pngFile, type: "png" });
      out.push({ pageIndex: i, pngFile });
    }
    return out;
  } finally {
    await browser.close();
  }
}
