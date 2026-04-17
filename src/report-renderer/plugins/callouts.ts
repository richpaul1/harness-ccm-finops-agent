/**
 * markdown-it plugin: themed callouts.
 *
 * Syntax:
 *   ::: critical Some title
 *   Body text…
 *   :::
 *
 * Available types: critical, risk, warning, success, info, action, quote.
 */
import container from "markdown-it-container";
import type MarkdownIt from "markdown-it";

interface CalloutMeta {
  label: string;
  icon: string;
}

const TYPES: Record<string, CalloutMeta> = {
  critical: { label: "Critical", icon: "!" },
  risk:     { label: "Risk",     icon: "!" },
  warning:  { label: "Warning",  icon: "!" },
  success:  { label: "Success",  icon: "✓" },
  info:     { label: "Note",     icon: "i" },
  action:   { label: "Action",   icon: "→" },
  quote:    { label: "Quote",    icon: "\u201C" },
};

export function calloutsPlugin(md: MarkdownIt): void {
  for (const [type, meta] of Object.entries(TYPES)) {
    md.use(container, type, {
      render(tokens: ReturnType<MarkdownIt["parse"]>, idx: number): string {
        const token = tokens[idx]!;
        if (token.nesting === 1) {
          const info = token.info.trim().slice(type.length).trim();
          const title = md.utils.escapeHtml(info || meta.label);
          return (
            `<aside class="callout callout-${type}">` +
            `<div class="callout-head">` +
            `<span class="callout-icon" aria-hidden="true">${meta.icon}</span>` +
            `<span class="callout-title">${title}</span>` +
            `</div>` +
            `<div class="callout-body">`
          );
        }
        return `</div></aside>\n`;
      },
    });
  }
}
