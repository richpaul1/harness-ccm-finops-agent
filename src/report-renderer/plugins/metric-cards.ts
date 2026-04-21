/**
 * Metric card grid — pre-processed before markdown-it sees the source.
 *
 * Syntax:
 *
 *   ::: metrics
 *   - label: Monthly savings
 *     value: $166,312
 *     trend: $1.99M annualised
 *     tone: success
 *   - label: Open recs
 *     value: $92,833
 *     tone: risk
 *   :::
 *
 * Replaced inline with raw HTML, which markdown-it (configured with
 * `html: true`) passes through untouched.
 *
 * Transform is scoped OUTSIDE fenced code blocks and inline code spans so
 * authors can demonstrate the `::: metrics` pattern in their own markdown
 * without it being silently rewritten (see ./protected-regions.ts). The
 * protection is ESSENTIAL: the underlying regex is non-greedy and looks for
 * the next `:::` line; without scoping it would happily consume a fence's
 * closing ``` and cascade corruption through the rest of the document.
 */
import { transformOutsideCode } from "./protected-regions.js";

interface Card {
  label?: string;
  value?: string;
  trend?: string;
  tone?: string;
  [key: string]: string | undefined;
}

function escape(s: string | undefined): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseCards(body: string): Card[] {
  const lines = body.split(/\r?\n/);
  const cards: Card[] = [];
  let current: Card | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const startMatch = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)$/);
    const contMatch = line.match(/^\s{2,}(\w+)\s*:\s*(.*)$/);
    if (startMatch) {
      if (current) cards.push(current);
      current = {};
      current[startMatch[1]!] = startMatch[2];
    } else if (contMatch && current) {
      current[contMatch[1]!] = contMatch[2];
    }
  }
  if (current) cards.push(current);
  return cards;
}

function renderCards(cards: Card[]): string {
  const cardHtml = cards
    .map((c) => {
      const tone = (c.tone || "default").toLowerCase();
      const label = escape(c.label);
      const value = escape(c.value);
      const trend = c.trend ? escape(c.trend) : "";
      return (
        `<div class="metric-card metric-${tone}">\n` +
        `  <div class="metric-label">${label}</div>\n` +
        `  <div class="metric-value">${value}</div>\n` +
        (trend ? `  <div class="metric-trend">${trend}</div>\n` : "") +
        `</div>`
      );
    })
    .join("\n");

  return `\n<div class="metric-grid">\n${cardHtml}\n</div>\n`;
}

/**
 * Pre-process source markdown, replacing `::: metrics` blocks with inline HTML.
 * Returns the transformed markdown to feed into markdown-it.
 */
export function preprocessMetricCards(src: string): string {
  const regex = /^[ \t]*:::\s*metrics\s*\r?\n([\s\S]*?)^[ \t]*:::\s*$/gm;
  return transformOutsideCode(src, regex, (_match, body: string) => {
    const cards = parseCards(body);
    return renderCards(cards);
  });
}
