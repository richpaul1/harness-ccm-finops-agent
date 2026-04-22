/**
 * Convert Markdown to a native PowerPoint (.pptx) deck.
 *
 * Text, tables, and images are real OOXML objects — not page screenshots.
 * Chart PNGs embedded with ![alt](path) become actual slide images; all
 * other content (headings, paragraphs, bullets, tables, callouts, metrics)
 * is rendered as editable text and shapes.
 *
 * Slide splitting:
 *   - `---` (HR) starts a new slide.
 *   - `## Heading` (H2) starts a new slide and becomes the slide title.
 *   - `# Heading` (H1) starts a title/cover slide.
 *   Content before the first heading/HR lands on an intro slide.
 *
 * `:::` callout and `::: metrics` blocks use the same syntax as the HTML
 * renderer so one authoring vocabulary works for PDF, Word, and PowerPoint.
 */

import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { marked, type Token, type Tokens } from "marked";

// pptxgenjs@4 has a broken ESM build — use the CJS bundle via createRequire.
const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxGenJS = require_("pptxgenjs") as unknown as new () => any;

/* ------------------------------------------------------------------ */
/*  Color palette                                                     */
/* ------------------------------------------------------------------ */

const C = {
  bg:           "FFFFFF",
  title:        "0F1B2D",
  body:         "1F2937",
  muted:        "6B7280",
  accent:       "E89611",
  tableHead:    "1A2B45",
  tableHeadFg:  "FFFFFF",
  tableLine:    "D1D5DB",
  codeShade:    "F5F5F5",
  codeFg:       "374151",
  bqLine:       "D1D5DB",

  callout: {
    info:     { fill: "E8F1FB", accent: "3B82F6" },
    success:  { fill: "E6F4EA", accent: "16A34A" },
    warning:  { fill: "FDF6E3", accent: "D97706" },
    critical: { fill: "FCE8E8", accent: "DC2626" },
    risk:     { fill: "FCE8E8", accent: "DC2626" },
    action:   { fill: "EEE5F7", accent: "7C3AED" },
    quote:    { fill: "F5F5F5", accent: "6B7280" },
  } as Record<string, { fill: string; accent: string }>,

  metricTone: {
    success:  "16A34A",
    risk:     "DC2626",
    critical: "DC2626",
    warning:  "D97706",
    info:     "3B82F6",
    default:  "1F2937",
  } as Record<string, string>,

  calloutIcon: {
    info: "i", success: "\u2713", warning: "!", critical: "!", risk: "!",
    action: "\u2192", quote: "\u201C",
  } as Record<string, string>,
};

/* ------------------------------------------------------------------ */
/*  Layout (16:9, dimensions in inches)                               */
/* ------------------------------------------------------------------ */

const L = {
  w: 13.333,
  h: 7.5,
  mx: 0.45,      // side margin
  titleY: 0.28,  // title text box top
  titleH: 0.72,  // title text box height
  bodyY: 1.15,   // body content starts (below title)
  bottomY: 7.15, // content must stay above this
  get bodyW() { return this.w - 2 * this.mx; },
  get bodyMaxH() { return this.bottomY - this.bodyY; },
};

/* ------------------------------------------------------------------ */
/*  Inline token → pptxgenjs TextProps                                */
/* ------------------------------------------------------------------ */

interface Run { text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PptxRun = { text: string; options?: Record<string, any> };

function inlineToRuns(tokens: Token[] | undefined): Run[] {
  if (!tokens?.length) return [];
  const out: Run[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        out.push(...inlineToRuns((t as Tokens.Strong).tokens).map(r => ({ ...r, bold: true })));
        break;
      case "em":
        out.push(...inlineToRuns((t as Tokens.Em).tokens).map(r => ({ ...r, italic: true })));
        break;
      case "codespan":
        out.push({ text: (t as Tokens.Codespan).text, code: true });
        break;
      case "link": {
        const l = t as Tokens.Link;
        out.push(...inlineToRuns(l.tokens).map(r => ({ ...r, link: l.href })));
        break;
      }
      case "text": {
        const tt = t as Tokens.Text;
        if (tt.tokens?.length) out.push(...inlineToRuns(tt.tokens));
        else out.push({ text: tt.text });
        break;
      }
      case "br":
        out.push({ text: "\n" });
        break;
      default: {
        const anyText = (t as { text?: string }).text;
        if (typeof anyText === "string") out.push({ text: anyText });
      }
    }
  }
  return out;
}

function runsToPptx(runs: Run[]): PptxRun[] {
  return runs.map(r => ({
    text: r.text,
    options: {
      ...(r.bold   ? { bold: true }   : {}),
      ...(r.italic ? { italic: true } : {}),
      ...(r.code   ? { fontFace: "Consolas", color: C.codeFg } : {}),
      ...(r.link   ? { hyperlink: { url: r.link } } : {}),
    },
  }));
}

function runsToPlain(runs: Run[]): string {
  return runs.map(r => r.text).join("");
}

/* ------------------------------------------------------------------ */
/*  Slide segmentation (line-level, fence & directive aware)          */
/* ------------------------------------------------------------------ */

interface SlideRaw {
  /** H1/H2 heading text, if this slide was triggered by one. */
  title: string | null;
  /** H1 triggers a cover layout; H2 a section layout. */
  isCover: boolean;
  /** Raw markdown body (no leading heading, no trailing `---`). */
  body: string;
}

function splitIntoSlides(markdown: string): SlideRaw[] {
  const lines = markdown.split(/\r?\n/);
  const slides: SlideRaw[] = [];
  let pendingTitle: string | null = null;
  let pendingCover = false;
  let bodyLines: string[] = [];
  let inFence = false;
  let inDirective = 0; // nesting depth for ::: blocks

  const flush = () => {
    const body = bodyLines.join("\n").trim();
    if (body.length > 0 || pendingTitle !== null) {
      slides.push({ title: pendingTitle, isCover: pendingCover, body });
    }
    bodyLines = [];
    pendingTitle = null;
    pendingCover = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track fenced code blocks.
    if (!inFence && /^(`{3,}|~{3,})/.test(line)) { inFence = true; bodyLines.push(line); continue; }
    if (inFence && /^(`{3,}|~{3,})/.test(line))  { inFence = false; bodyLines.push(line); continue; }
    if (inFence) { bodyLines.push(line); continue; }

    // Track ::: directive blocks.
    if (/^[ \t]*:::[ \t]*\w/.test(line))  { inDirective++; bodyLines.push(line); continue; }
    if (/^[ \t]*:::[ \t]*$/.test(line))   { inDirective = Math.max(0, inDirective - 1); bodyLines.push(line); continue; }
    if (inDirective > 0) { bodyLines.push(line); continue; }

    // HR → slide break.
    if (/^---+$/.test(line.trim())) {
      flush();
      continue;
    }

    // H1 → cover slide.
    const h1 = line.match(/^#[ \t]+(.+)$/);
    if (h1) {
      flush();
      pendingTitle = h1[1]!.trim();
      pendingCover = true;
      continue;
    }

    // H2 → section slide.
    const h2 = line.match(/^##[ \t]+(.+)$/);
    if (h2) {
      flush();
      pendingTitle = h2[1]!.trim();
      pendingCover = false;
      continue;
    }

    bodyLines.push(line);
  }
  flush();
  return slides;
}

/* ------------------------------------------------------------------ */
/*  Callout / metrics segmentation (mirrors markdown-to-docx.ts)     */
/* ------------------------------------------------------------------ */

const CALLOUT_TYPES = new Set([
  "info", "success", "warning", "critical", "risk", "action", "quote",
]);

interface MdSeg       { kind: "md";      text: string; }
interface CalloutSeg  { kind: "callout"; type: string; title: string; body: string; }
interface MetricsSeg  { kind: "metrics"; body: string; }
type ContentSeg = MdSeg | CalloutSeg | MetricsSeg;

function segmentBody(source: string): ContentSeg[] {
  const lines = source.split(/\r?\n/);
  const out: ContentSeg[] = [];
  let buf: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let i = 0;

  const flushBuf = () => {
    if (buf.length) { out.push({ kind: "md", text: buf.join("\n") }); buf = []; }
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // Fence tracking.
    const fm = line.match(/^(`{3,}|~{3,})/);
    if (fm) {
      const m = fm[1]!.slice(0, 3);
      if (!inFence) { inFence = true; fenceMarker = m; }
      else if (line.startsWith(fenceMarker)) { inFence = false; fenceMarker = ""; }
      buf.push(line); i++; continue;
    }
    if (inFence) { buf.push(line); i++; continue; }

    // ::: opener
    const opener = line.match(/^[ \t]*:::[ \t]*(\w+)(?:[ \t]+(.*))?$/);
    if (opener) {
      const type = opener[1]!.toLowerCase();
      const titleText = (opener[2] ?? "").trim();
      if (type === "metrics" || CALLOUT_TYPES.has(type)) {
        // Scan for matching closer.
        let j = i + 1;
        let nestedFence = false;
        let nestedMarker = "";
        while (j < lines.length) {
          const L2 = lines[j]!;
          const nfm = L2.match(/^(`{3,}|~{3,})/);
          if (nfm) {
            const m2 = nfm[1]!.slice(0, 3);
            if (!nestedFence) { nestedFence = true; nestedMarker = m2; }
            else if (L2.startsWith(nestedMarker)) { nestedFence = false; nestedMarker = ""; }
          }
          if (!nestedFence && /^[ \t]*:::[ \t]*$/.test(L2)) break;
          j++;
        }
        if (j < lines.length) {
          flushBuf();
          const body = lines.slice(i + 1, j).join("\n");
          if (type === "metrics") out.push({ kind: "metrics", body });
          else out.push({ kind: "callout", type, title: titleText, body });
          i = j + 1;
          continue;
        }
      }
    }

    buf.push(line);
    i++;
  }
  flushBuf();
  return out;
}

/* ------------------------------------------------------------------ */
/*  Metric card YAML-lite parser (mirrors markdown-to-docx.ts)       */
/* ------------------------------------------------------------------ */

interface MetricCard { label?: string; value?: string; trend?: string; tone?: string; }

function parseMetricCards(body: string): MetricCard[] {
  const cards: MetricCard[] = [];
  let cur: MetricCard | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const start = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    const cont  = line.match(/^\s{2,}(\w+)\s*:\s*(.*)$/);
    if (start) {
      if (cur) cards.push(cur);
      cur = {};
      (cur as Record<string, string>)[start[1]!] = start[2]!;
    } else if (cont && cur) {
      (cur as Record<string, string>)[cont[1]!] = cont[2]!;
    }
  }
  if (cur) cards.push(cur);
  return cards;
}

/* ------------------------------------------------------------------ */
/*  Slide-level rendering                                             */
/* ------------------------------------------------------------------ */

interface Ctx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slide: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pptx: any;          // reference to the deck so image slides can be created
  cursor: number;     // current Y (inches)
  assetsDir: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function remaining(ctx: Ctx): number {
  return L.bottomY - ctx.cursor;
}

function addRichText(
  ctx: Ctx,
  runs: PptxRun[],
  opts: {
    fontSize?: number;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    spaceBefore?: number;
    spaceAfter?: number;
    estimatedLines?: number;
    indent?: number;
  } = {},
): void {
  const {
    fontSize = 13,
    color = C.body,
    bold = false,
    italic = false,
    spaceBefore = 0,
    spaceAfter = 0.1,
    estimatedLines = 1,
    indent = 0,
  } = opts;

  ctx.cursor += spaceBefore;
  const avail = remaining(ctx);
  if (avail < 0.15) return;

  const lineH = fontSize * 1.5 / 72;
  const h = Math.min(estimatedLines * lineH + 0.05, avail);

  ctx.slide.addText(runs, {
    x: L.mx + indent,
    y: ctx.cursor,
    w: L.bodyW - indent,
    h,
    fontSize,
    color,
    bold,
    italic,
    valign: "top",
    autoFit: true,
    margin: 0,
  });
  ctx.cursor += h + spaceAfter;
}

// ── Block renderers ──────────────────────────────────────────────────────────

function renderHeading(ctx: Ctx, depth: number, tokens: Token[]): void {
  const runs = runsToPptx(inlineToRuns(tokens));
  const sizes: Record<number, number> = { 2: 22, 3: 17, 4: 15, 5: 13, 6: 12 };
  const fontSize = sizes[depth] ?? 13;
  const color = depth === 2 ? C.title : depth === 3 ? C.accent : C.body;
  const spaceBefore = depth <= 3 ? 0.15 : 0.08;
  const text = runsToPlain(inlineToRuns(tokens));
  const estimatedLines = Math.max(1, Math.ceil(text.length / 90));
  addRichText(ctx, runs, { fontSize, color, bold: true, spaceBefore, spaceAfter: 0.06, estimatedLines });
}

function renderParagraph(ctx: Ctx, tokens: Token[]): void {
  const runs = runsToPptx(inlineToRuns(tokens));
  const text = runsToPlain(inlineToRuns(tokens));
  const estimatedLines = Math.max(1, Math.ceil(text.length / 100));
  addRichText(ctx, runs, { fontSize: 13, estimatedLines });
}

function renderBlockquote(ctx: Ctx, tokens: Token[]): void {
  const avail = remaining(ctx);
  if (avail < 0.2) return;

  const allRuns: PptxRun[] = tokens.flatMap(t => {
    if (t.type === "paragraph") return runsToPptx(inlineToRuns((t as Tokens.Paragraph).tokens));
    return [{ text: (t as { text?: string }).text ?? "" }];
  });
  const text = allRuns.map(r => r.text).join("");
  const estimatedLines = Math.max(1, Math.ceil(text.length / 90));
  const lineH = 13 * 1.5 / 72;
  const h = Math.min(estimatedLines * lineH + 0.1, avail);

  // Left-accent bar.
  ctx.slide.addShape("rect", {
    x: L.mx, y: ctx.cursor, w: 0.06, h,
    fill: { color: C.bqLine }, line: { color: C.bqLine, width: 0 },
  });
  ctx.slide.addText(allRuns, {
    x: L.mx + 0.18, y: ctx.cursor, w: L.bodyW - 0.18, h,
    fontSize: 13, color: C.muted, italic: true, valign: "top", autoFit: true, margin: 0,
  });
  ctx.cursor += h + 0.12;
}

function renderList(ctx: Ctx, list: Tokens.List): void {
  if (!list.items.length) return;

  const bulletItems: PptxRun[] = [];
  for (const item of list.items) {
    const firstBlock = item.tokens?.[0];
    let itemTokens: Token[] = [];
    if (firstBlock?.type === "paragraph") itemTokens = (firstBlock as Tokens.Paragraph).tokens ?? [];
    else if (firstBlock?.type === "text")   itemTokens = (firstBlock as Tokens.Text).tokens ?? [firstBlock];

    const runs = runsToPptx(inlineToRuns(itemTokens));
    if (!runs.length) runs.push({ text: item.text ?? "" });

    // First run carries the bullet option.
    bulletItems.push({
      text: runs[0]!.text,
      options: {
        ...runs[0]!.options,
        bullet: list.ordered
          ? { type: "number", indent: 25 }
          : { indent: 25 },
        paraSpaceBefore: 4,
      },
    });
    // Remaining runs in the same item (inline formatting) are continuations.
    for (const r of runs.slice(1)) {
      bulletItems.push(r);
    }
  }

  const avail = remaining(ctx);
  const lineH = 13 * 1.5 / 72;
  const h = Math.min(list.items.length * lineH + 0.08, avail);
  if (h < 0.1) return;

  ctx.slide.addText(bulletItems, {
    x: L.mx,
    y: ctx.cursor,
    w: L.bodyW,
    h,
    fontSize: 13,
    color: C.body,
    valign: "top",
    autoFit: true,
    margin: 0,
  });
  ctx.cursor += h + 0.1;
}

function renderCode(ctx: Ctx, code: Tokens.Code): void {
  const avail = remaining(ctx);
  if (avail < 0.2) return;
  const lines = code.text.split("\n").length;
  const h = Math.min(lines * 0.22 + 0.12, 3.5, avail);

  ctx.slide.addShape("rect", {
    x: L.mx, y: ctx.cursor, w: L.bodyW, h,
    fill: { color: C.codeShade }, line: { color: C.tableLine, width: 1 },
  });
  ctx.slide.addText(code.text, {
    x: L.mx + 0.1, y: ctx.cursor + 0.04, w: L.bodyW - 0.2, h: h - 0.08,
    fontSize: 9, fontFace: "Consolas", color: C.codeFg, valign: "top", autoFit: true, margin: 0,
  });
  ctx.cursor += h + 0.12;
}

function renderTable(ctx: Ctx, t: Tokens.Table): void {
  const avail = remaining(ctx);
  if (avail < 0.3) return;

  const colCount = t.header.length;
  const colW = Array<number>(colCount).fill(L.bodyW / colCount);
  const rowH = 0.3;

  const pptxRows: PptxRun[][] = [];

  // Header.
  pptxRows.push(
    t.header.map(cell => ({
      text: runsToPlain(inlineToRuns(cell.tokens)),
      options: {
        bold: true,
        color: C.tableHeadFg,
        fill: { color: C.tableHead },
        fontSize: 10,
        align: cell.align ?? "left",
      },
    })),
  );

  // Body.
  for (const row of t.rows) {
    pptxRows.push(
      row.map((cell, i) => ({
        text: runsToPlain(inlineToRuns(cell.tokens)),
        options: {
          fontSize: 10,
          color: C.body,
          align: cell.align ?? t.header[i]?.align ?? "left",
        },
      })),
    );
  }

  const totalH = rowH * pptxRows.length;
  const h = Math.min(totalH, avail);

  ctx.slide.addTable(pptxRows, {
    x: L.mx, y: ctx.cursor,
    w: L.bodyW,
    colW,
    rowH,
    border: { type: "solid", color: C.tableLine, pt: 0.5 },
    margin: [3, 5, 3, 5],
  });
  ctx.cursor += h + 0.15;
}

async function renderImage(ctx: Ctx, src: string, alt: string): Promise<void> {
  // Images always go on their own dedicated slide so they fill as much space
  // as possible and stay fully resizable in PowerPoint without interfering
  // with the surrounding text content.

  // Resolve path / check existence first.
  let resolvedSrc: string | null = null;
  if (!src.startsWith("data:")) {
    resolvedSrc = path.isAbsolute(src) ? src : path.join(ctx.assetsDir, src);
    try {
      await fs.access(resolvedSrc);
    } catch {
      // File not found — inline italic placeholder on the current slide.
      addRichText(ctx, [{ text: `[Image: ${alt || src}]` }], {
        fontSize: 11, color: C.muted, italic: true,
      });
      return;
    }
  }

  // Read natural pixel dimensions for correct aspect-ratio placement.
  let naturalW = 1;
  let naturalH = 1;
  try {
    const { loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(resolvedSrc ?? src);
    naturalW = img.width  || 1;
    naturalH = img.height || 1;
  } catch {
    naturalW = 16; naturalH = 9; // fallback to widescreen ratio
  }

  // Build a dedicated image slide.
  const imgSlide = ctx.pptx.addSlide();
  imgSlide.background = { color: C.bg };

  // Reserve space for an optional caption at the bottom.
  const captionH = alt ? 0.4 : 0;
  const marginX = 0.3;
  const marginY = 0.3;
  const maxW = L.w - 2 * marginX;
  const maxH = L.h - 2 * marginY - captionH;

  // Scale to fit while preserving aspect ratio.
  // 192 DPI matches the @2x charts generated by ccm-chart-png.ts (1920×1080).
  const pxPerIn = 192;
  let displayW = naturalW / pxPerIn;
  let displayH = naturalH / pxPerIn;
  if (displayW > maxW) { displayH = displayH * (maxW / displayW); displayW = maxW; }
  if (displayH > maxH) { displayW = displayW * (maxH / displayH); displayH = maxH; }
  if (displayW < 0.5)  { displayW = maxW; displayH = maxH; }

  // Center the image on the slide.
  const imgX = (L.w - displayW) / 2;
  const imgY = marginY + (maxH - displayH) / 2;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imgOpts: Record<string, any> = { x: imgX, y: imgY, w: displayW, h: displayH };
  if (src.startsWith("data:")) imgOpts["data"] = src;
  else imgOpts["path"] = resolvedSrc!;

  imgSlide.addImage(imgOpts);

  // Optional caption below the image.
  if (alt) {
    imgSlide.addText(alt, {
      x: marginX,
      y: L.h - captionH - 0.05,
      w: maxW,
      h: captionH,
      fontSize: 11,
      color: C.muted,
      italic: true,
      align: "center",
      valign: "middle",
    });
  }

  // The image slide is self-contained — don't advance the parent slide cursor.
}

function renderCallout(ctx: Ctx, type: string, title: string, bodyText: string): void {
  const avail = remaining(ctx);
  if (avail < 0.3) return;

  const style = C.callout[type] ?? C.callout["info"]!;
  const icon  = C.calloutIcon[type] ?? "i";
  const label = title || (type.charAt(0).toUpperCase() + type.slice(1));

  const lines = Math.max(2, Math.ceil(bodyText.length / 90));
  const lineH = 13 * 1.5 / 72;
  const h = Math.min(0.42 + lines * lineH, avail);

  // Background + accent bar.
  ctx.slide.addShape("rect", {
    x: L.mx, y: ctx.cursor, w: L.bodyW, h,
    fill: { color: style.fill }, line: { color: style.accent, width: 0.75 },
  });
  ctx.slide.addShape("rect", {
    x: L.mx, y: ctx.cursor, w: 0.08, h,
    fill: { color: style.accent }, line: { color: style.accent, width: 0 },
  });

  // Title row.
  ctx.slide.addText(`${icon}  ${label}`, {
    x: L.mx + 0.16, y: ctx.cursor + 0.05, w: L.bodyW - 0.22, h: 0.3,
    fontSize: 11, color: style.accent, bold: true, valign: "top",
  });

  // Body.
  const bodyTokens = marked.lexer(bodyText);
  const bodyRuns: PptxRun[] = bodyTokens.flatMap(t => {
    if (t.type === "paragraph") return runsToPptx(inlineToRuns((t as Tokens.Paragraph).tokens));
    return [{ text: (t as { text?: string }).text ?? "" }];
  });
  if (bodyRuns.length && h > 0.42) {
    ctx.slide.addText(bodyRuns, {
      x: L.mx + 0.16, y: ctx.cursor + 0.37, w: L.bodyW - 0.22, h: h - 0.42,
      fontSize: 12, color: C.body, valign: "top", autoFit: true, margin: 0,
    });
  }

  ctx.cursor += h + 0.12;
}

function renderMetrics(ctx: Ctx, cards: MetricCard[]): void {
  if (!cards.length) return;
  const avail = remaining(ctx);
  const cardH = Math.min(1.75, avail);
  if (cardH < 0.5) return;

  const gap = 0.1;
  const cardW = (L.bodyW - (cards.length - 1) * gap) / cards.length;

  cards.forEach((card, i) => {
    const tone   = (card.tone ?? "default").toLowerCase();
    const accent = C.metricTone[tone] ?? C.metricTone["default"]!;
    const x = L.mx + i * (cardW + gap);

    ctx.slide.addShape("rect", {
      x, y: ctx.cursor, w: cardW, h: cardH,
      fill: { color: "FAFAFA" }, line: { color: "E0E0E0", width: 0.75 },
    });
    ctx.slide.addShape("rect", {
      x, y: ctx.cursor + cardH - 0.07, w: cardW, h: 0.07,
      fill: { color: accent }, line: { color: accent, width: 0 },
    });
    if (card.label) {
      ctx.slide.addText(card.label.toUpperCase(), {
        x: x + 0.12, y: ctx.cursor + 0.12, w: cardW - 0.24, h: 0.28,
        fontSize: 8, color: C.muted, bold: true, valign: "top",
      });
    }
    const valFontSize = card.value && card.value.length > 8 ? 22 : 28;
    ctx.slide.addText(card.value ?? "", {
      x: x + 0.1, y: ctx.cursor + 0.34, w: cardW - 0.2, h: 0.7,
      fontSize: valFontSize, color: accent, bold: true, valign: "top", autoFit: true,
    });
    if (card.trend) {
      ctx.slide.addText(card.trend, {
        x: x + 0.12, y: ctx.cursor + 1.08, w: cardW - 0.24, h: 0.4,
        fontSize: 9, color: C.muted, valign: "top",
      });
    }
  });

  ctx.cursor += cardH + 0.15;
}

// ── Block token dispatcher ───────────────────────────────────────────────────

async function renderTokensToSlide(ctx: Ctx, tokens: Token[]): Promise<void> {
  for (const token of tokens) {
    if (remaining(ctx) < 0.1) break;

    switch (token.type) {
      case "heading": {
        const h = token as Tokens.Heading;
        if (h.depth === 1) break; // H1 is the slide title — skip in body.
        renderHeading(ctx, h.depth, h.tokens ?? []);
        break;
      }
      case "paragraph": {
        const p = token as Tokens.Paragraph;
        // Image-only paragraph → actual image.
        if (p.tokens?.length === 1 && p.tokens[0]!.type === "image") {
          const img = p.tokens[0] as Tokens.Image;
          await renderImage(ctx, img.href, img.text || img.title || "");
        } else {
          renderParagraph(ctx, p.tokens ?? []);
        }
        break;
      }
      case "list":
        renderList(ctx, token as Tokens.List);
        break;
      case "table":
        renderTable(ctx, token as Tokens.Table);
        break;
      case "blockquote":
        renderBlockquote(ctx, (token as Tokens.Blockquote).tokens ?? []);
        break;
      case "code":
        renderCode(ctx, token as Tokens.Code);
        break;
      case "space":
        ctx.cursor += 0.08;
        break;
      case "hr":
        ctx.cursor += 0.15;
        break;
      case "html":
        // Raw HTML from callout preprocessor — silently skip.
        break;
      default:
        break;
    }
  }
}

// ── Per-slide render ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderSlide(pptx: any, slideRaw: SlideRaw, assetsDir: string): Promise<void> {
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };

  // Title bar.
  if (slideRaw.title) {
    const titleFontSize = slideRaw.isCover ? 32 : 24;
    // Amber accent strip below title.
    slide.addShape("rect", {
      x: L.mx, y: L.titleY + L.titleH + 0.04, w: 1.4, h: 0.045,
      fill: { color: C.accent }, line: { color: C.accent, width: 0 },
    });
    slide.addText(slideRaw.title, {
      x: L.mx, y: L.titleY, w: L.bodyW, h: L.titleH,
      fontSize: titleFontSize, color: C.title, bold: true, valign: "middle", autoFit: true,
    });
  }

  if (!slideRaw.body.trim()) return;

  const ctx: Ctx = {
    slide,
    pptx,
    cursor: slideRaw.title ? L.bodyY : L.titleY,
    assetsDir,
  };

  // Segment the body into md / callout / metrics chunks.
  const segs = segmentBody(slideRaw.body);
  for (const seg of segs) {
    if (remaining(ctx) < 0.1) break;
    if (seg.kind === "md") {
      await renderTokensToSlide(ctx, marked.lexer(seg.text));
    } else if (seg.kind === "callout") {
      renderCallout(ctx, seg.type, seg.title, seg.body);
    } else if (seg.kind === "metrics") {
      renderMetrics(ctx, parseMetricCards(seg.body));
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface MarkdownToPptxOptions {
  /** Document title (used in PPTX metadata). */
  title?: string;
  /** Customer / company name. */
  customer?: string;
  /** Date string. */
  date?: string;
  /**
   * Directory to resolve relative image paths against.
   * Defaults to `process.cwd()`.
   */
  assetsDir?: string;
  /** Slide aspect. Default "16x9". */
  slideSize?: "16x9" | "4x3";
}

export async function markdownToPptx(
  markdown: string,
  options: MarkdownToPptxOptions = {},
): Promise<Buffer> {
  const {
    title,
    customer,
    assetsDir = process.cwd(),
    slideSize = "16x9",
  } = options;

  const pptx = new PptxGenJS();
  pptx.author  = "Harness CCM FinOps";
  pptx.company = customer || "Harness";
  pptx.title   = title ?? "Harness Report";
  pptx.layout  = slideSize === "16x9" ? "LAYOUT_WIDE" : "LAYOUT_4x3";

  const slides = splitIntoSlides(markdown);

  // If there are no slides (empty doc), add a blank slide so the file is valid.
  if (slides.length === 0) {
    pptx.addSlide();
  } else {
    for (const slideRaw of slides) {
      await renderSlide(pptx, slideRaw, assetsDir);
    }
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
