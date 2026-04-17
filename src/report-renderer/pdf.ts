/**
 * PDF export — drives a headless Chromium (Playwright) at the running report
 * server to convert a Paged.js print preview into a paginated PDF.
 *
 * Playwright + Chromium is an opt-in dependency. If `playwright` is missing
 * or Chromium has not been installed, this module throws a helpful error.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import slugify from "slugify";
import type { DocMeta } from "./render.js";

export interface PdfRenderOptions {
  baseUrl: string;
  meta: DocMeta;
  themeId?: string;
  outDir?: string;
  /** Absolute output path; takes precedence over outDir + slug. */
  outFile?: string;
  /** URL path for this doc, e.g. "/reports/<id>/". Trailing slash matters. */
  docPath?: string;
}

export interface PdfRenderResult {
  outPath: string;
  fileName: string;
}

export async function renderPdf(opts: PdfRenderOptions): Promise<PdfRenderResult> {
  const themeId = opts.themeId ?? "harness";
  const docPath = opts.docPath ?? "/";

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
    outPath = path.join(outDir, `${slug}-${themeId}-${date}.pdf`);
  }

  // Lazy import — Playwright + Chromium are heavy; only pulled in when a PDF
  // is actually requested. Surface a clear install hint if missing.
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "PDF export requires Playwright. Install with: pnpm add playwright && npx playwright install chromium",
    );
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });

    const normalizedDocPath = docPath.endsWith("/") ? docPath : `${docPath}/`;
    const url = `${opts.baseUrl}${normalizedDocPath}?mode=print&theme=${encodeURIComponent(themeId)}`;
    await page.goto(url, { waitUntil: "networkidle" });

    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__PAGED_READY__ === true,
      null,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(400);

    // Expose full Paged.js document height so Chromium paginates all pages.
    await page.addStyleTag({
      content: `html, body, .pagedjs_pages { height: auto !important; overflow: visible !important; }`,
    });
    await page.waitForTimeout(200);

    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await browser.close();
  }

  return { outPath, fileName: path.basename(outPath) };
}
