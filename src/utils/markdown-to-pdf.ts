/**
 * Convert Markdown text to a PDF buffer.
 *
 * Uses `marked` to tokenize the Markdown and `pdfkit` to render
 * a clean, readable PDF.  No headless browser required.
 */

import PDFDocument from "pdfkit";
import { marked, type Token, type Tokens } from "marked";

/* ------------------------------------------------------------------ */
/*  Style constants                                                   */
/* ------------------------------------------------------------------ */

const PAGE_MARGIN = 50;
const BODY_FONT_SIZE = 11;
const LINE_GAP = 4;

const HEADING_SIZES: Record<number, number> = {
  1: 26,
  2: 22,
  3: 18,
  4: 15,
  5: 13,
  6: 12,
};

const FONTS = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
  mono: "Courier",
} as const;

/* ------------------------------------------------------------------ */
/*  Inline text helpers                                                */
/* ------------------------------------------------------------------ */

/** Strip all markdown formatting and return plain text (fallback). */
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/**
 * Render inline tokens (bold, italic, code, links, plain text) into the
 * current text flow of the PDFDocument.
 */
function renderInlineTokens(
  doc: InstanceType<typeof PDFDocument>,
  tokens: Token[] | undefined,
  defaultFont: string,
  defaultSize: number,
): void {
  if (!tokens || tokens.length === 0) return;

  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        doc.font(FONTS.bold);
        renderInlineTokens(doc, (t as Tokens.Strong).tokens, FONTS.bold, defaultSize);
        doc.font(defaultFont);
        break;
      case "em":
        doc.font(FONTS.italic);
        renderInlineTokens(doc, (t as Tokens.Em).tokens, FONTS.italic, defaultSize);
        doc.font(defaultFont);
        break;
      case "codespan":
        doc
          .font(FONTS.mono)
          .fontSize(defaultSize - 1)
          .text((t as Tokens.Codespan).text, { continued: true });
        doc.font(defaultFont).fontSize(defaultSize);
        break;
      case "link": {
        const link = t as Tokens.Link;
        doc
          .fillColor("#1a73e8")
          .text(link.text, { continued: true, link: link.href, underline: true });
        doc.fillColor("#000000").text("", { continued: true, underline: false });
        break;
      }
      case "text": {
        const textToken = t as Tokens.Text;
        // Text tokens can themselves contain nested tokens (e.g. bold inside text)
        if (textToken.tokens && textToken.tokens.length > 0) {
          renderInlineTokens(doc, textToken.tokens, defaultFont, defaultSize);
        } else {
          doc.text(textToken.text, { continued: true });
        }
        break;
      }
      default:
        // For any unhandled inline token, just output raw text
        if ("text" in t && typeof (t as { text: unknown }).text === "string") {
          doc.text((t as { text: string }).text, { continued: true });
        }
        break;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Block-level rendering                                             */
/* ------------------------------------------------------------------ */

function renderTokens(
  doc: InstanceType<typeof PDFDocument>,
  tokens: Token[],
  indent: number = 0,
): void {
  for (const token of tokens) {
    const leftX = PAGE_MARGIN + indent;

    switch (token.type) {
      /* ----- Headings ----- */
      case "heading": {
        const h = token as Tokens.Heading;
        const size = HEADING_SIZES[h.depth] ?? BODY_FONT_SIZE;
        doc.moveDown(h.depth <= 2 ? 1.2 : 0.8);
        doc.font(FONTS.bold).fontSize(size);
        doc.text("", leftX); // reset x position
        renderInlineTokens(doc, h.tokens, FONTS.bold, size);
        doc.text(""); // end the line (continued: false)
        doc.font(FONTS.regular).fontSize(BODY_FONT_SIZE);
        doc.moveDown(0.3);
        break;
      }

      /* ----- Paragraph ----- */
      case "paragraph": {
        const p = token as Tokens.Paragraph;
        doc.font(FONTS.regular).fontSize(BODY_FONT_SIZE);
        doc.text("", leftX);
        renderInlineTokens(doc, p.tokens, FONTS.regular, BODY_FONT_SIZE);
        doc.text(""); // end line
        doc.moveDown(0.4);
        break;
      }

      /* ----- Code block ----- */
      case "code": {
        const c = token as Tokens.Code;
        doc.moveDown(0.3);
        // Light grey background
        const codeX = leftX;
        const codeWidth = doc.page.width - PAGE_MARGIN * 2 - indent;
        doc
          .font(FONTS.mono)
          .fontSize(BODY_FONT_SIZE - 1);
        const codeHeight = doc.heightOfString(c.text, {
          width: codeWidth - 16,
          lineGap: LINE_GAP,
        });
        doc
          .save()
          .roundedRect(codeX, doc.y, codeWidth, codeHeight + 16, 4)
          .fill("#f5f5f5")
          .restore();
        doc
          .fillColor("#333333")
          .text(c.text, codeX + 8, doc.y + 8, {
            width: codeWidth - 16,
            lineGap: LINE_GAP,
          });
        doc.fillColor("#000000");
        doc.font(FONTS.regular).fontSize(BODY_FONT_SIZE);
        doc.moveDown(0.6);
        break;
      }

      /* ----- Blockquote ----- */
      case "blockquote": {
        const bq = token as Tokens.Blockquote;
        const barX = leftX + 2;
        const startY = doc.y;
        // Render child tokens indented
        renderTokens(doc, bq.tokens, indent + 20);
        const endY = doc.y;
        // Draw left bar
        doc
          .save()
          .moveTo(barX, startY)
          .lineTo(barX, endY)
          .lineWidth(3)
          .strokeColor("#cccccc")
          .stroke()
          .restore();
        doc.moveDown(0.3);
        break;
      }

      /* ----- Lists ----- */
      case "list": {
        const list = token as Tokens.List;
        list.items.forEach((item, idx) => {
          const bullet = list.ordered ? `${Number(list.start ?? 1) + idx}. ` : "•  ";
          doc.font(FONTS.regular).fontSize(BODY_FONT_SIZE);
          doc.text(bullet, leftX, doc.y, { continued: true });
          if (item.tokens && item.tokens.length > 0) {
            const first = item.tokens[0];
            if (first && first.type === "text" && (first as Tokens.Text).tokens) {
              renderInlineTokens(doc, (first as Tokens.Text).tokens, FONTS.regular, BODY_FONT_SIZE);
            } else if (first && "text" in first) {
              doc.text((first as { text: string }).text, { continued: true });
            }
            doc.text(""); // end line
            // Render remaining nested tokens (sub-lists, etc.)
            if (item.tokens.length > 1) {
              renderTokens(doc, item.tokens.slice(1), indent + 20);
            }
          } else {
            doc.text(stripInline(item.text));
          }
          doc.moveDown(0.15);
        });
        doc.moveDown(0.3);
        break;
      }

      /* ----- Horizontal rule ----- */
      case "hr":
        doc.moveDown(0.5);
        doc
          .save()
          .moveTo(leftX, doc.y)
          .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
          .lineWidth(1)
          .strokeColor("#dddddd")
          .stroke()
          .restore();
        doc.moveDown(0.8);
        break;

      /* ----- Space / other ----- */
      case "space":
        doc.moveDown(0.3);
        break;

      default:
        // Fallback: render as plain text if the token has text
        if ("text" in token && typeof (token as { text: unknown }).text === "string") {
          doc.font(FONTS.regular).fontSize(BODY_FONT_SIZE);
          doc.text(stripInline((token as { text: string }).text), leftX);
          doc.moveDown(0.3);
        }
        break;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface MarkdownToPdfOptions {
  /** Optional document title shown in PDF metadata + as an h1 at the top. */
  title?: string;
  /** Page size. Default A4. */
  pageSize?: "A4" | "LETTER" | "LEGAL";
}

/**
 * Convert a Markdown string to a PDF Buffer.
 *
 * Returns a `Promise<Buffer>` containing the complete PDF bytes.
 */
export async function markdownToPdf(
  markdown: string,
  options: MarkdownToPdfOptions = {},
): Promise<Buffer> {
  const { title, pageSize = "A4" } = options;

  const doc = new PDFDocument({
    size: pageSize,
    margin: PAGE_MARGIN,
    info: {
      Title: title ?? "Markdown Document",
      Creator: "harness-mcp-server",
    },
    // Automatically add pages when content overflows
    autoFirstPage: true,
    bufferPages: true,
  });

  // Collect output into a buffer
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Optional title header
  if (title) {
    doc
      .font(FONTS.bold)
      .fontSize(28)
      .text(title, PAGE_MARGIN, PAGE_MARGIN)
      .moveDown(0.6);
    doc
      .save()
      .moveTo(PAGE_MARGIN, doc.y)
      .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
      .lineWidth(1)
      .strokeColor("#cccccc")
      .stroke()
      .restore();
    doc.moveDown(0.8);
    doc.font(FONTS.regular).fontSize(BODY_FONT_SIZE);
  }

  // Parse and render tokens
  const tokens = marked.lexer(markdown);
  renderTokens(doc, tokens);

  // Finalize
  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
