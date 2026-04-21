/**
 * Voice-narration preprocessor.
 *
 * Authors embed narration alongside the content they want narrated using HTML
 * comments (because comments are invisible in the rendered HTML/PDF):
 *
 *     <!-- voice:
 *     This is the narration for this section.
 *     -->
 *
 * Optional inline metadata: `<!-- voice voice="nova" rate=1.05: ... -->`.
 *
 * Why this preprocessor exists: Paged.js strips DOM Comment nodes during
 * pagination (its chunker walks element clones, not the full node tree), so
 * the narrator can't just walk `Node.COMMENT_NODE`s out of `.pagedjs_page`.
 *
 * What it does: rewrite each voice comment into a hidden `<div>` that
 * survives Paged.js intact. The div is `hidden` so it never affects layout,
 * carries the narration as `data-text` so it's trivially extractable from
 * Playwright with one `page.evaluate`, and lives at the same source position
 * as the original comment so it ends up paginated onto the same slide.
 *
 *     <div class="voice-narration" hidden
 *          data-text="…"
 *          data-voice="nova"
 *          data-rate="1.05">…</div>
 *
 * The `data-text` attribute is the canonical source for the narrator. The
 * inner text is included for human inspection in DevTools.
 *
 * Transform is scoped OUTSIDE fenced code blocks and inline code spans so
 * authors can demonstrate the `<!-- voice: -->` pattern in their own
 * markdown without it being silently rewritten (see ./protected-regions.ts).
 */
import { transformOutsideCode } from "./protected-regions.js";

const VOICE_COMMENT_RE = /<!--\s*voice\b([^:\-]*?):([\s\S]*?)-->/g;
const KV_RE = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;

export function preprocessVoiceComments(source: string): string {
  return transformOutsideCode(source, VOICE_COMMENT_RE, (_match, meta: string, body: string) => {
    const text = body.replace(/\s+/g, " ").trim();
    if (!text) return ""; // Marker present, but no narration body — drop silently.

    const attrs: string[] = [];
    KV_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KV_RE.exec(meta))) {
      const key = m[1]!.toLowerCase();
      const value = m[2] ?? m[3] ?? "";
      if (!key || value === "") continue;
      // Whitelist what we forward into data-* so a typo in the comment can't
      // smuggle arbitrary attributes onto the rendered div.
      if (key === "voice" || key === "rate") {
        attrs.push(`data-${key}="${escapeAttr(value)}"`);
      }
    }

    // Wrap in blank lines so markdown-it treats this as an HTML block (so it
    // isn't accidentally folded into the prior paragraph and pushed off-page).
    return `\n\n<div class="voice-narration" hidden data-text="${escapeAttr(text)}"${
      attrs.length ? " " + attrs.join(" ") : ""
    }></div>\n\n`;
  });
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
