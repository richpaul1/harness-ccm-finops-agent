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
import { preprocessMetricCards } from "./plugins/metric-cards.js";
import { preprocessVoiceComments } from "./plugins/voice-narration.js";

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

export function renderDocument(filePath: string): RenderedDoc {
  const raw = fs.readFileSync(filePath, "utf8");
  const { data: frontmatter, content } = matter(raw);
  const processed = preprocessVoiceComments(preprocessMetricCards(content));

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
