/**
 * Convert Markdown text to a Word (.docx) document buffer.
 *
 * Uses `marked` to tokenize the Markdown and `docx` to build a native
 * editable Word document — not a PDF-to-docx conversion, not an image
 * dump. The result opens cleanly in Word / Google Docs / Pages and
 * preserves heading hierarchy, lists, tables, and inline formatting
 * as live, editable structure.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  TableLayoutType,
  WidthType,
  BorderStyle,
  ExternalHyperlink,
  LevelFormat,
  convertInchesToTwip,
  ShadingType,
  type IRunOptions,
  type ParagraphChild,
  type FileChild,
} from "docx";
import { marked, type Token, type Tokens } from "marked";

/* ------------------------------------------------------------------ */
/*  Style constants                                                   */
/* ------------------------------------------------------------------ */

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

/* ------------------------------------------------------------------ */
/*  Inline rendering                                                  */
/* ------------------------------------------------------------------ */

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
}

/**
 * Walk inline tokens and emit ParagraphChild[] (TextRun | ExternalHyperlink).
 * Style flags stack so e.g. **_bold italic_** nests correctly.
 */
function renderInlineTokens(
  tokens: Token[] | undefined,
  style: InlineStyle = {},
): ParagraphChild[] {
  if (!tokens || tokens.length === 0) return [];
  const out: ParagraphChild[] = [];

  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        out.push(...renderInlineTokens((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...renderInlineTokens((t as Tokens.Em).tokens, { ...style, italics: true }));
        break;
      case "codespan": {
        const text = (t as Tokens.Codespan).text;
        out.push(
          new TextRun({
            text,
            font: "Consolas",
            shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
            ...styleToRunOpts({ ...style, code: true }),
          }),
        );
        break;
      }
      case "link": {
        const link = t as Tokens.Link;
        out.push(
          new ExternalHyperlink({
            link: link.href,
            children: [
              new TextRun({
                text: link.text || link.href,
                style: "Hyperlink",
                ...styleToRunOpts(style),
              }),
            ],
          }),
        );
        break;
      }
      case "br":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "del":
        out.push(
          ...renderInlineTokens(
            (t as unknown as { tokens?: Token[] }).tokens,
            { ...style },
          ).map((c) => {
            // Apply strike to top-level TextRuns where possible
            return c;
          }),
        );
        break;
      case "text": {
        const textToken = t as Tokens.Text;
        if (textToken.tokens && textToken.tokens.length > 0) {
          out.push(...renderInlineTokens(textToken.tokens, style));
        } else {
          out.push(new TextRun({ text: textToken.text, ...styleToRunOpts(style) }));
        }
        break;
      }
      default: {
        const maybeText = (t as { text?: unknown }).text;
        if (typeof maybeText === "string") {
          out.push(new TextRun({ text: maybeText, ...styleToRunOpts(style) }));
        }
        break;
      }
    }
  }
  return out;
}

function styleToRunOpts(style: InlineStyle): Partial<IRunOptions> {
  return {
    ...(style.bold ? { bold: true } : {}),
    ...(style.italics ? { italics: true } : {}),
  };
}

function inlineToPlainText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  let s = "";
  for (const t of tokens) {
    if ("tokens" in t && Array.isArray((t as { tokens?: Token[] }).tokens)) {
      s += inlineToPlainText((t as { tokens?: Token[] }).tokens);
    } else if ("text" in t && typeof (t as { text?: unknown }).text === "string") {
      s += (t as { text: string }).text;
    }
  }
  return s;
}

/* ------------------------------------------------------------------ */
/*  Layout context                                                    */
/* ------------------------------------------------------------------ */

/**
 * Usable horizontal area (in twips) inside the page margins. Set by
 * `markdownToDocx` before walking the token tree so block renderers
 * (notably tables) can compute sensible column widths. Defaulting to
 * an A4 1-inch-margin layout keeps standalone use safe.
 */
let CONTENT_WIDTH_TWIPS = 11906 - 2 * 1440; // A4 minus 1" margins

/* ------------------------------------------------------------------ */
/*  Block rendering                                                   */
/* ------------------------------------------------------------------ */

/**
 * Render a flat list of block tokens into `FileChild[]` (Paragraph | Table).
 * Lists recurse via `numbering` references defined at Document level.
 */
function renderBlockTokens(tokens: Token[]): FileChild[] {
  const out: FileChild[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const h = token as Tokens.Heading;
        out.push(
          new Paragraph({
            heading: HEADING_LEVELS[h.depth] ?? HeadingLevel.HEADING_6,
            children: renderInlineTokens(h.tokens),
          }),
        );
        break;
      }

      case "paragraph": {
        const p = token as Tokens.Paragraph;
        out.push(
          new Paragraph({
            children: renderInlineTokens(p.tokens),
            spacing: { after: 120 },
          }),
        );
        break;
      }

      case "code": {
        const c = token as Tokens.Code;
        // One paragraph per source line so long code blocks paginate cleanly.
        const lines = c.text.split("\n");
        for (const line of lines) {
          out.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: line.length > 0 ? line : " ",
                  font: "Consolas",
                  size: 20, // 10pt
                }),
              ],
              shading: { type: ShadingType.CLEAR, fill: "F5F5F5", color: "auto" },
              spacing: { before: 0, after: 0 },
            }),
          );
        }
        // Trailing spacer
        out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
        break;
      }

      case "blockquote": {
        const bq = token as Tokens.Blockquote;
        // Walk blockquote tokens directly so we can inject border+indent at
        // construction time. Previously we built the paragraphs first then
        // tried to extract their children via an internal `options` property
        // that `docx` no longer exposes — that silently produced empty blocks.
        const bqBorder = {
          left: {
            style: BorderStyle.SINGLE,
            size: 12,
            color: "CCCCCC",
            space: 8,
          },
        };
        const bqIndent = { left: convertInchesToTwip(0.25) };
        for (const child of bq.tokens) {
          if (child.type === "paragraph") {
            out.push(
              new Paragraph({
                children: renderInlineTokens((child as Tokens.Paragraph).tokens),
                indent: bqIndent,
                border: bqBorder,
                spacing: { after: 80 },
              }),
            );
          } else if (child.type === "list") {
            // List nested inside a blockquote — render normally (indent already
            // applied by list numbering; adding blockquote border would require
            // re-constructing each paragraph, so we skip the border here).
            out.push(...renderList(child as Tokens.List, 0));
          } else {
            // Headings, code, hr, etc. — fall through to generic rendering.
            out.push(...renderBlockTokens([child]));
          }
        }
        break;
      }

      case "list": {
        const list = token as Tokens.List;
        out.push(...renderList(list, 0));
        break;
      }

      case "table": {
        const t = token as Tokens.Table;
        out.push(renderTable(t));
        out.push(new Paragraph({ children: [], spacing: { after: 80 } }));
        break;
      }

      case "hr":
        out.push(
          new Paragraph({
            children: [],
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: "DDDDDD",
                space: 4,
              },
            },
            spacing: { before: 120, after: 120 },
          }),
        );
        break;

      case "space":
        out.push(new Paragraph({ children: [], spacing: { after: 80 } }));
        break;

      case "html":
        // Skip raw HTML silently — common in Markdown voice-comments, TOC anchors, etc.
        break;

      default: {
        const maybeText = (token as { text?: unknown }).text;
        if (typeof maybeText === "string" && maybeText.trim().length > 0) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: maybeText })],
              spacing: { after: 120 },
            }),
          );
        }
        break;
      }
    }
  }

  return out;
}

function renderList(list: Tokens.List, depth: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const reference = list.ordered ? "ordered-list" : "bullet-list";

  list.items.forEach((item) => {
    // First block of an item is either a raw text or paragraph. The marked
    // lexer wraps "loose" list items in paragraphs but tight ones directly
    // in text tokens. We flatten both into a single list paragraph.
    const firstPara = extractFirstParagraphChildren(item);
    paragraphs.push(
      new Paragraph({
        numbering: { reference, level: Math.min(depth, 4) },
        children: firstPara,
        spacing: { after: 40 },
      }),
    );

    // Recurse into nested content (sub-lists, paragraphs, code blocks).
    for (const child of item.tokens ?? []) {
      if (child.type === "list") {
        paragraphs.push(...renderList(child as Tokens.List, depth + 1));
      } else if (child.type === "paragraph" && child !== item.tokens?.[0]) {
        paragraphs.push(
          new Paragraph({
            children: renderInlineTokens((child as Tokens.Paragraph).tokens),
            indent: { left: convertInchesToTwip(0.25 * (depth + 1)) },
            spacing: { after: 40 },
          }),
        );
      }
    }
  });

  return paragraphs;
}

function extractFirstParagraphChildren(item: Tokens.ListItem): ParagraphChild[] {
  if (!item.tokens || item.tokens.length === 0) {
    return [new TextRun({ text: item.text ?? "" })];
  }
  const first = item.tokens[0]!;
  if (first.type === "text") {
    const t = first as Tokens.Text;
    if (t.tokens && t.tokens.length > 0) return renderInlineTokens(t.tokens);
    return [new TextRun({ text: t.text })];
  }
  if (first.type === "paragraph") {
    return renderInlineTokens((first as Tokens.Paragraph).tokens);
  }
  // Fallback — stringify whatever we've got
  return [new TextRun({ text: inlineToPlainText([first]) })];
}

function renderTable(t: Tokens.Table): Table {
  // Without explicit column widths the `docx` library emits a table whose
  // grid columns collapse to 0 in Word — every cell renders one character
  // per line. We compute a fixed-width grid from the page content area so
  // Word lays the table out predictably across PDF, Word, and Pages.
  const colCount = Math.max(t.header.length, ...t.rows.map((r) => r.length), 1);
  const colWidth = Math.floor(CONTENT_WIDTH_TWIPS / colCount);
  const columnWidths: number[] = Array.from({ length: colCount }, () => colWidth);

  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0" },
    left: { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0" },
    right: { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0" },
  };

  const headerRow = new TableRow({
    tableHeader: true,
    children: t.header.map(
      (cell, i) =>
        new TableCell({
          width: { size: columnWidths[i] ?? colWidth, type: WidthType.DXA },
          borders: cellBorders,
          shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
          children: [
            new Paragraph({
              children: renderInlineTokens(cell.tokens),
              alignment: mapAlignment(cell.align),
            }),
          ],
        }),
    ),
  });

  const bodyRows = t.rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell, i) =>
            new TableCell({
              width: { size: columnWidths[i] ?? colWidth, type: WidthType.DXA },
              borders: cellBorders,
              children: [
                new Paragraph({
                  children: renderInlineTokens(cell.tokens),
                  alignment: mapAlignment(cell.align),
                }),
              ],
            }),
        ),
      }),
  );

  return new Table({
    rows: [headerRow, ...bodyRows],
    columnWidths,
    width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
  });
}

function mapAlignment(
  align: "left" | "right" | "center" | null,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "left":
      return AlignmentType.LEFT;
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/*  Callout / metrics segmentation                                    */
/* ------------------------------------------------------------------ */

/**
 * Callout type palette. Mirrors the HTML `<aside class="callout callout-TYPE">`
 * look-and-feel in `plugins/callouts.ts` — pale tinted background, colored
 * accent border, themed icon + label. The same seven types are supported so
 * authors can use one vocabulary for PDF, HTML, and Word output.
 */
const CALLOUT_STYLE: Record<
  string,
  { fill: string; accent: string; label: string; icon: string }
> = {
  info:     { fill: "E8F1FB", accent: "3B82F6", label: "Note",     icon: "i" },
  success:  { fill: "E6F4EA", accent: "16A34A", label: "Success",  icon: "\u2713" },
  warning:  { fill: "FDF6E3", accent: "D97706", label: "Warning",  icon: "!" },
  critical: { fill: "FCE8E8", accent: "DC2626", label: "Critical", icon: "!" },
  risk:     { fill: "FCE8E8", accent: "DC2626", label: "Risk",     icon: "!" },
  action:   { fill: "EEE5F7", accent: "7C3AED", label: "Action",   icon: "\u2192" },
  quote:    { fill: "F5F5F5", accent: "6B7280", label: "Quote",    icon: "\u201C" },
};

const METRIC_TONE_COLOR: Record<string, string> = {
  success: "16A34A",
  risk:    "DC2626",
  critical: "DC2626",
  warning: "D97706",
  info:    "3B82F6",
  default: "1F2937",
};

interface CalloutSegment { kind: "callout"; type: string; title: string; body: string; }
interface MetricsSegment { kind: "metrics"; body: string; }
interface MarkdownSegment { kind: "md"; text: string; }
type Segment = CalloutSegment | MetricsSegment | MarkdownSegment;

/**
 * Split a markdown source into plain-markdown runs and `:::` directive blocks
 * (callouts or metric grids). Code fences are respected so `:::` appearing
 * inside fenced code is left untouched.
 */
function segmentMarkdownForDocx(source: string): Segment[] {
  const lines = source.split(/\r?\n/);
  const segments: Segment[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length) {
      segments.push({ kind: "md", text: buffer.join("\n") });
      buffer = [];
    }
  };

  let inFence = false;
  let fenceMarker = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!.slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (line.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      buffer.push(line);
      i++;
      continue;
    }
    if (inFence) {
      buffer.push(line);
      i++;
      continue;
    }

    const opener = line.match(/^[ \t]*:::[ \t]*(\w+)(?:[ \t]+(.*))?$/);
    if (opener) {
      const type = opener[1]!.toLowerCase();
      const title = (opener[2] ?? "").trim();
      if (type === "metrics" || CALLOUT_STYLE[type]) {
        // Scan forward for the matching `:::` closer, respecting nested fences.
        let j = i + 1;
        let nestedFence = false;
        let nestedMarker = "";
        while (j < lines.length) {
          const L = lines[j]!;
          const fm = L.match(/^(`{3,}|~{3,})/);
          if (fm) {
            const m = fm[1]!.slice(0, 3);
            if (!nestedFence) { nestedFence = true; nestedMarker = m; }
            else if (L.startsWith(nestedMarker)) { nestedFence = false; nestedMarker = ""; }
          }
          if (!nestedFence && /^[ \t]*:::[ \t]*$/.test(L)) break;
          j++;
        }
        if (j < lines.length) {
          flushBuffer();
          const body = lines.slice(i + 1, j).join("\n");
          if (type === "metrics") {
            segments.push({ kind: "metrics", body });
          } else {
            segments.push({ kind: "callout", type, title, body });
          }
          i = j + 1;
          continue;
        }
      }
    }

    buffer.push(line);
    i++;
  }
  flushBuffer();
  return segments;
}

/**
 * Render a `::: TYPE [title]…:::` block as a 1-cell full-width table with a
 * tinted background, a thick colored left border for the accent stripe, and
 * a title row with the type's glyph. The body is tokenised with marked and
 * rendered recursively, so nested markdown (including tables and lists)
 * Just Works.
 */
function renderCallout(seg: CalloutSegment): Table {
  const style = CALLOUT_STYLE[seg.type] ?? CALLOUT_STYLE.info!;
  const titleText = seg.title || style.label;

  const children: FileChild[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: `${style.icon}  ${titleText}`,
          bold: true,
          color: style.accent,
          size: 22,
        }),
      ],
      spacing: { after: 120 },
    }),
    ...renderBlockTokens(marked.lexer(seg.body)),
  ];

  return new Table({
    columnWidths: [CONTENT_WIDTH_TWIPS],
    width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: style.fill, color: "auto" },
            borders: {
              left:   { style: BorderStyle.SINGLE, size: 24, color: style.accent },
              top:    { style: BorderStyle.SINGLE, size: 4,  color: style.accent },
              bottom: { style: BorderStyle.SINGLE, size: 4,  color: style.accent },
              right:  { style: BorderStyle.SINGLE, size: 4,  color: style.accent },
            },
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            children,
          }),
        ],
      }),
    ],
  });
}

interface MetricCard {
  label?: string;
  value?: string;
  trend?: string;
  tone?: string;
}

/**
 * Minimal YAML-ish parser matching `plugins/metric-cards.ts` so authors use
 * one syntax for both the HTML and Word cover grids.
 *
 *   ::: metrics
 *   - label: Monthly savings
 *     value: $166,312
 *     trend: $1.99M annualised
 *     tone: success
 *   :::
 */
function parseMetricCards(body: string): MetricCard[] {
  const cards: MetricCard[] = [];
  let current: MetricCard | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const startMatch = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    const contMatch = line.match(/^\s{2,}(\w+)\s*:\s*(.*)$/);
    if (startMatch) {
      if (current) cards.push(current);
      current = {};
      (current as Record<string, string>)[startMatch[1]!] = startMatch[2]!;
    } else if (contMatch && current) {
      (current as Record<string, string>)[contMatch[1]!] = contMatch[2]!;
    }
  }
  if (current) cards.push(current);
  return cards;
}

/**
 * Render a `::: metrics` block as a horizontal row of N equal-width cards.
 * Each card gets its own shaded cell with a tone-colored bottom accent bar —
 * the same visual hierarchy as the web cover grid.
 */
function renderMetrics(seg: MetricsSegment): Table {
  const cards = parseMetricCards(seg.body);
  if (cards.length === 0) {
    return new Table({
      columnWidths: [CONTENT_WIDTH_TWIPS],
      width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
              children: [new Paragraph({ children: [] })],
            }),
          ],
        }),
      ],
    });
  }

  const colWidth = Math.floor(CONTENT_WIDTH_TWIPS / cards.length);
  const columnWidths = cards.map(() => colWidth);

  const cells = cards.map((card) => {
    const tone = (card.tone || "default").toLowerCase();
    const accent = METRIC_TONE_COLOR[tone] ?? METRIC_TONE_COLOR.default!;
    const kids: FileChild[] = [];
    if (card.label) {
      kids.push(
        new Paragraph({
          children: [
            new TextRun({
              text: card.label.toUpperCase(),
              size: 16,
              color: "666666",
              bold: true,
            }),
          ],
          spacing: { after: 80 },
        }),
      );
    }
    kids.push(
      new Paragraph({
        children: [
          new TextRun({
            text: card.value ?? "",
            bold: true,
            size: 44,
            color: accent,
          }),
        ],
        spacing: { after: 60 },
      }),
    );
    if (card.trend) {
      kids.push(
        new Paragraph({
          children: [new TextRun({ text: card.trend, size: 18, color: "555555" })],
        }),
      );
    }
    return new TableCell({
      width: { size: colWidth, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "FAFAFA", color: "auto" },
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 4,  color: "E0E0E0" },
        bottom: { style: BorderStyle.SINGLE, size: 16, color: accent   },
        left:   { style: BorderStyle.SINGLE, size: 4,  color: "E0E0E0" },
        right:  { style: BorderStyle.SINGLE, size: 4,  color: "E0E0E0" },
      },
      margins: { top: 160, bottom: 160, left: 180, right: 180 },
      children: kids,
    });
  });

  return new Table({
    columnWidths,
    width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: cells })],
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface MarkdownToDocxOptions {
  /** Optional document title shown in docx metadata + as a cover H1. */
  title?: string;
  /** Page size. Default A4. */
  pageSize?: "A4" | "LETTER" | "LEGAL";
}

// A4 = 11906 × 16838 twips, Letter = 12240 × 15840, Legal = 12240 × 20160.
const PAGE_DIMS: Record<
  NonNullable<MarkdownToDocxOptions["pageSize"]>,
  { width: number; height: number }
> = {
  A4: { width: 11906, height: 16838 },
  LETTER: { width: 12240, height: 15840 },
  LEGAL: { width: 12240, height: 20160 },
};

/**
 * Convert a Markdown string to a Word (.docx) Buffer.
 */
export async function markdownToDocx(
  markdown: string,
  options: MarkdownToDocxOptions = {},
): Promise<Buffer> {
  const { title, pageSize = "A4" } = options;

  const body: FileChild[] = [];

  const dims = PAGE_DIMS[pageSize];
  // Recompute the usable content area for this page size so tables render
  // with sensible column widths instead of collapsing to 0.
  CONTENT_WIDTH_TWIPS = dims.width - 2 * convertInchesToTwip(1);

  if (title) {
    body.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: title })],
        spacing: { after: 240 },
      }),
    );
  }

  // Split the source into plain-markdown runs and `:::` directive blocks.
  // Plain runs feed into the marked → renderBlockTokens pipeline as before;
  // callouts and metric grids are rendered as styled 1-cell or N-cell
  // tables that mirror the HTML look-and-feel (tinted background, accent
  // border, card layout for metrics).
  for (const seg of segmentMarkdownForDocx(markdown)) {
    if (seg.kind === "md") {
      body.push(...renderBlockTokens(marked.lexer(seg.text)));
    } else if (seg.kind === "callout") {
      body.push(renderCallout(seg));
      body.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    } else if (seg.kind === "metrics") {
      body.push(renderMetrics(seg));
      body.push(new Paragraph({ children: [], spacing: { after: 180 } }));
    }
  }

  const doc = new Document({
    creator: "harness-mcp-server",
    title: title ?? "Markdown Document",
    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [0, 1, 2, 3, 4].map((lvl) => ({
            level: lvl,
            format: LevelFormat.BULLET,
            text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: convertInchesToTwip(0.25 + 0.25 * lvl),
                  hanging: convertInchesToTwip(0.2),
                },
              },
            },
          })),
        },
        {
          reference: "ordered-list",
          levels: [0, 1, 2, 3, 4].map((lvl) => ({
            level: lvl,
            format: LevelFormat.DECIMAL,
            text: `%${lvl + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: convertInchesToTwip(0.25 + 0.25 * lvl),
                  hanging: convertInchesToTwip(0.25),
                },
              },
            },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: dims.width, height: dims.height },
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children: body,
      },
    ],
  });

  return Packer.toBuffer(doc) as unknown as Promise<Buffer>;
}
