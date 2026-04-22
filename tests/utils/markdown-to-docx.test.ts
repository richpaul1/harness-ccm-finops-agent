import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { markdownToDocx } from "../../src/utils/markdown-to-docx.js";

/**
 * The docx library is pure JS and cheap to run, so unlike the pdfkit test
 * we exercise it end-to-end and verify the output is a real .docx
 * (ZIP / OOXML) file. A .docx is a ZIP archive with magic bytes `PK\x03\x04`.
 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * A .docx is a ZIP archive — raw bytes are compressed, so string-matching the
 * buffer directly won't work. Helper unzips the document.xml entry (which
 * holds the body copy) and returns its plain-text form.
 */
async function docxDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("word/document.xml missing from .docx output");
  return entry.async("string");
}

describe("markdownToDocx", () => {
  it("returns a non-empty Buffer", async () => {
    const buf = await markdownToDocx("# Hello\n\nWorld");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("produces a valid docx (ZIP) archive", async () => {
    const buf = await markdownToDocx("# Heading\n\nParagraph with **bold** text.");
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it("handles headings, lists, tables, and code blocks without throwing", async () => {
    const md = [
      "# Title",
      "",
      "## Subheading",
      "",
      "Some paragraph with *italic* and `inline code` and [a link](https://example.com).",
      "",
      "- bullet 1",
      "- bullet 2",
      "  - nested",
      "",
      "1. ordered one",
      "2. ordered two",
      "",
      "| col a | col b |",
      "|-------|-------|",
      "| 1     | 2     |",
      "| 3     | 4     |",
      "",
      "> A blockquote.",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "---",
      "",
      "End.",
    ].join("\n");

    const buf = await markdownToDocx(md, { title: "Full feature test" });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it("accepts different page sizes", async () => {
    const a4 = await markdownToDocx("body", { pageSize: "A4" });
    const letter = await markdownToDocx("body", { pageSize: "LETTER" });
    const legal = await markdownToDocx("body", { pageSize: "LEGAL" });
    for (const b of [a4, letter, legal]) {
      expect(Buffer.isBuffer(b)).toBe(true);
      expect(b.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
    }
  });

  it("renders empty body without error when only a title is given", async () => {
    const buf = await markdownToDocx("", { title: "Solo title" });
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
  });

  it("renders ::: TYPE callout blocks as styled tables", async () => {
    const md = [
      "Intro paragraph before.",
      "",
      "::: info Bottom line",
      "The perspective is the **business-mapping rollup** of the underlying BUs.",
      ":::",
      "",
      "::: success",
      "Math checks: $13,360 + $16,087 = $29,447.",
      ":::",
      "",
      "Outro paragraph after.",
    ].join("\n");
    const buf = await markdownToDocx(md, { title: "Callout test" });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
    const xml = await docxDocumentXml(buf);
    // Callout titles / body content should end up in the document part,
    // nested inside a `w:tbl` so they render as a styled banner rather than
    // as plain paragraph text.
    expect(xml).toContain("Bottom line");
    expect(xml).toContain("Math checks");
    expect(xml).toContain("<w:tbl>");
    expect(xml).not.toContain(":::");
  });

  it("renders ::: metrics grids as a row of cards", async () => {
    const md = [
      "::: metrics",
      "- label: Monthly spend",
      "  value: $29,447",
      "  tone: info",
      "- label: MoM trend",
      "  value: -20.53%",
      "  trend: contracting",
      "  tone: success",
      ":::",
    ].join("\n");
    const buf = await markdownToDocx(md, { title: "Metrics test" });
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
    const xml = await docxDocumentXml(buf);
    expect(xml).toContain("MONTHLY SPEND");
    expect(xml).toContain("$29,447");
    expect(xml).not.toContain(":::");
  });

  it("renders blockquotes with content (not empty)", async () => {
    const md = [
      "**Bottom line:** The perspective is the business-mapping rollup.",
      "",
      "> **Multifamily $13,360  +  Shareable Rentals $16,087  =  Shareable $29,447**",
      "",
      "The 25% goal is close.",
    ].join("\n");
    const buf = await markdownToDocx(md, { title: "Blockquote test" });
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
    const xml = await docxDocumentXml(buf);
    // The blockquote text must appear in the document body.
    expect(xml).toContain("$29,447");
    expect(xml).toContain("$13,360");
    expect(xml).toContain("25% goal");
  });

  it("leaves ::: blocks inside code fences untouched", async () => {
    const md = [
      "Example of the callout syntax:",
      "",
      "```md",
      "::: info Inside fence",
      "body",
      ":::",
      "```",
      "",
      "After.",
    ].join("\n");
    const buf = await markdownToDocx(md);
    expect(buf.subarray(0, 4).equals(ZIP_MAGIC)).toBe(true);
    // The `:::` lines should survive verbatim in the fenced code block.
    const xml = await docxDocumentXml(buf);
    expect(xml).toContain(":::");
  });
});
