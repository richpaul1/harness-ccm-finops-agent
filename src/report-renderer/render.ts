/**
 * Markdown → HTML pipeline for the report renderer.
 *
 * Builds a markdown-it instance with our plugin set (anchors, attrs, deflists,
 * footnotes, task lists, callouts) and turns a markdown source file (with YAML
 * frontmatter) into a structured `RenderedDoc` that themes can shell-wrap.
 */
import * as fs from "node:fs";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItAttrs from "markdown-it-attrs";
import markdownItDeflist from "markdown-it-deflist";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import slugify from "slugify";
import { calloutsPlugin } from "./plugins/callouts.js";
import { preprocessCalloutSyntax } from "./plugins/callout-normalize.js";
import { preprocessMetricCards } from "./plugins/metric-cards.js";
import { preprocessVoiceComments } from "./plugins/voice-narration.js";
import { loadPackPreprocessors } from "./packs/index.js";

export interface DocMeta {
  title: string;
  subtitle: string;
  customer: string;
  customerLogo?: string;
  date: string;
  classification: string;
  author: string;
  docType: string;
  [key: string]: unknown;
}

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

export interface RenderedDoc {
  meta: DocMeta;
  html: string;
  toc: TocEntry[];
  sourcePath: string;
}

// CSS selectors cannot start with a digit (unescaped), so `## 1. Foo` slugged
// as `1-foo` becomes an invalid `querySelector('#1-foo')` — Paged.js and our
// TOC scroll-spy both call querySelector on heading ids, so a bare numeric
// prefix throws and breaks pagination. Prepend `sec-` to keep ids stable-ish
// while guaranteeing validity.
function safeHeadingSlug(raw: string): string {
  const base = slugify(raw, { lower: true, strict: true });
  if (!base) return "section";
  return /^[0-9]/.test(base) ? `sec-${base}` : base;
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .use(markdownItAnchor, {
    slugify: safeHeadingSlug,
  })
  .use(markdownItAttrs)
  .use(markdownItDeflist)
  .use(markdownItFootnote)
  .use(markdownItTaskLists, { enabled: true })
  .use(calloutsPlugin);

/**
 * Source-line attribution.
 *
 * Walk every block-level token after parsing and tag its opening element with
 * `data-source-line="N"` (1-indexed line in the original markdown). The live
 * source-edit panel uses this on the client to:
 *
 *   - render hover-revealed pencil icons next to each block, so users can
 *     click on a paragraph in the rendered HTML and jump straight to that
 *     line in the editor.
 *   - keep the editor cursor in sync with the visible region.
 *
 * We tag both block-opener tokens (paragraph_open, heading_open, etc.) and
 * leaf block tokens that have no _open form (`fence`, `code_block`, `hr`,
 * `html_block`, `math_block`). Inline tokens are skipped — they don't have
 * a useful `.map`.
 *
 * Note: tokens emitted by our pre-processed custom blocks (the YAML-payload
 * preprocessors in `report-packs/<id>/blocks/`) come through as `html_block`
 * tokens whose `.map` covers the *original* `:::` block lines, so a click on
 * any part of a Coles bucket grid OR portfolio detail still jumps to the
 * `:::` opener line. That's a happy accident that makes pack-authored blocks
 * editable too.
 */
md.core.ruler.push("source_line_annotation", (state) => {
  for (const token of state.tokens) {
    if (!token.map) continue;
    // `nesting === 1` covers all _open block tokens (paragraph, heading,
    // list, list_item, blockquote, table, thead, tbody, tr, etc.).
    // The leaf types listed below are block-level but have no _open form.
    const isBlockOpener = token.nesting === 1;
    const isBlockLeaf =
      token.type === "fence" ||
      token.type === "code_block" ||
      token.type === "hr" ||
      token.type === "html_block" ||
      token.type === "math_block";
    if (!isBlockOpener && !isBlockLeaf) continue;
    // 1-indexed start line. `data-source-end-line` is the last line OCCUPIED
    // by the block (not the exclusive end), so a single-line paragraph has
    // start === end. The live-edit panel uses this range to know exactly
    // which source lines to replace when an inline edit is saved.
    const startLine = token.map[0] + 1;
    const endLine = Math.max(startLine, token.map[1]); // map[1] is exclusive
    token.attrSet("data-source-line", String(startLine));
    token.attrSet("data-source-end-line", String(endLine));
  }
});

/**
 * For `html_block` tokens (which is how preprocessor-emitted HTML — including
 * Acme pack `::: portfolio_bucket_grid` and `::: portfolio_detail` outputs —
 * arrives at the renderer), the default markdown-it rule just emits the raw
 * content verbatim, so any `attrSet('data-source-line', …)` call we made on
 * the token in the core ruler above is silently lost. Override the renderer
 * to inject `data-source-line="N"` into the first opening tag of the content
 * so pack-emitted blocks get pencil icons too.
 */
const FIRST_OPEN_TAG_RE = /^(\s*<[a-zA-Z][a-zA-Z0-9-]*\b)([^>]*?)(\s*\/?>)/;

md.renderer.rules.html_block = (tokens, idx) => {
  const token = tokens[idx]!;
  if (!token.map) return token.content;
  const startLine = token.map[0] + 1;
  const endLine = Math.max(startLine, token.map[1]);
  // If the user already put data-source-line on the tag, leave it alone.
  if (/data-source-line=/.test(token.content.slice(0, 200))) return token.content;
  return token.content.replace(FIRST_OPEN_TAG_RE, (_match, open, attrs, close) => {
    return `${open}${attrs} data-source-line="${startLine}" data-source-end-line="${endLine}"${close}`;
  });
};

const defaultImageRenderer =
  md.renderer.rules.image ??
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx]!;
  const alt = token.content || "";
  const html = defaultImageRenderer(tokens, idx, options, env, self);
  if (!alt) return html;
  return `<figure class="figure">${html}<figcaption>${md.utils.escapeHtml(
    alt,
  )}</figcaption></figure>`;
};

export function buildToc(content: string): TocEntry[] {
  const toc: TocEntry[] = [];
  const lines = content.split(/\r?\n/);
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (!m) continue;
    const level = m[1]!.length;
    const text = m[2]!.replace(/\s*[#*`]+$/g, "").replace(/[*_`]/g, "").trim();
    if (!text) continue;
    toc.push({
      level,
      text,
      id: safeHeadingSlug(text),
    });
  }
  return toc;
}

/**
 * Pre-warm the pack preprocessor cache at server startup. This triggers the
 * first dynamic imports so the first `renderDocument()` call is not slow.
 * After warm-up, `loadPackPreprocessors()` uses mtime-based cache entries and
 * re-imports only changed files — so edits to pack block `.js` files take
 * effect on the next render without a server restart.
 */
export async function warmPackPreprocessors(): Promise<void> {
  await loadPackPreprocessors();
}

/**
 * Strip YAML frontmatter, but REPLACE the stripped region with the same
 * number of blank lines so downstream line numbers (used for the live-edit
 * panel's `data-source-line` annotations) remain absolute relative to the
 * on-disk file. Without this, every line below the frontmatter would be
 * shifted up by N (where N = frontmatter lines), and clicking a pencil
 * icon next to a paragraph would jump the editor cursor to the wrong line.
 */
function stripFrontmatterPreservingLines(raw: string): {
  frontmatter: Partial<DocMeta>;
  content: string;
} {
  const parsed = matter(raw);
  const frontmatter = parsed.data as Partial<DocMeta>;
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m) return { frontmatter, content: raw };
  const fmLineCount = m[0].split(/\r?\n/).length - 1;
  const padding = "\n".repeat(fmLineCount);
  return { frontmatter, content: padding + raw.slice(m[0].length) };
}

/**
 * Render an in-memory markdown string through the full pipeline (pack
 * preprocessors → callout normaliser → metric cards → voice → markdown-it).
 * Used by the live-edit panel to show preview HTML for unsaved changes
 * without a disk roundtrip. The returned `html` is the doc-body inner HTML
 * (no theme shell, no cover, no TOC).
 */
export async function renderMarkdownString(raw: string): Promise<{
  html: string;
  toc: TocEntry[];
  meta: Partial<DocMeta>;
}> {
  const { frontmatter, content } = stripFrontmatterPreservingLines(raw);
  let packProcessed = content;
  const packPreprocessors = await loadPackPreprocessors();
  for (const fn of packPreprocessors) {
    packProcessed = fn(packProcessed);
  }
  const processed = preprocessVoiceComments(
    preprocessMetricCards(preprocessCalloutSyntax(packProcessed)),
  );
  const html = md.render(processed);
  const toc = buildToc(content);
  return { html, toc, meta: frontmatter };
}

export async function renderDocument(filePath: string): Promise<RenderedDoc> {
  const raw = fs.readFileSync(filePath, "utf8");
  // Strip frontmatter while preserving line numbers — see comment on
  // stripFrontmatterPreservingLines() above for why.
  const { frontmatter, content } = stripFrontmatterPreservingLines(raw);

  // Apply pack preprocessors (loaded synchronously from the mtime-keyed cache;
  // the async warm already ran at startup so this is a cheap cache lookup).
  // We call loadPackPreprocessors() synchronously via a top-level-await shim:
  // since the MCP server is always async, we use the already-loaded cache here
  // and rely on warmPackPreprocessors() having been called at mount time.
  // Pack preprocessors whose .js files have changed since startup are picked up
  // on the next render via the mtime cache-buster in packs/index.ts.
  let packProcessed = content;
  const packPreprocessors = await loadPackPreprocessors();
  for (const fn of packPreprocessors) {
    packProcessed = fn(packProcessed);
  }

  const processed = preprocessVoiceComments(
    preprocessMetricCards(preprocessCalloutSyntax(packProcessed)),
  );

  const html = md.render(processed);
  const toc = buildToc(content);

  const firstH1 = toc.find((h) => h.level === 1);
  const fm = frontmatter as Partial<DocMeta>;
  const meta: DocMeta = {
    title: fm.title ?? firstH1?.text ?? "Untitled",
    subtitle: fm.subtitle ?? "",
    customer: fm.customer ?? "",
    customerLogo: fm.customerLogo ?? "",
    date: fm.date ?? new Date().toISOString().slice(0, 10),
    classification: fm.classification ?? "Confidential",
    author: fm.author ?? "Harness CCM",
    docType: fm.docType ?? "Business Value Review",
    ...fm,
  };

  return { meta, html, toc, sourcePath: filePath };
}
