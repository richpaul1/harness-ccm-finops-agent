/**
 * Voice-comment parser for narrated video render.
 *
 * Authors embed narration as HTML comments alongside the content they
 * narrate, e.g.
 *
 *     ## Use case 1 — Cost visibility
 *
 *     <!-- voice:
 *     This is where every customer journey starts: visibility…
 *     -->
 *
 *     **What it does.** …
 *
 * Properties:
 *   - HTML comments survive `markdown-it` rendering verbatim (we set
 *     `html: true`), so they end up inside the rendered HTML body and Paged.js
 *     paginates them along with the surrounding content.
 *   - The video render walks every `.pagedjs_page`, collects the comment
 *     nodes inside it, parses the ones that match the `voice:` marker, and
 *     concatenates them as the slide's narration.
 *   - Optional inline metadata: `<!-- voice voice="alloy" rate=1.05: ... -->`
 *     A leading `key=value` (or `key="value"`) sequence ahead of the colon is
 *     parsed into per-slide TTS overrides.
 */

export interface ParsedVoiceComment {
  text: string;
  voice?: string;
  rate?: number;
}

const PREFIX = /^\s*voice\b/;
const KV_PATTERN = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;

/**
 * Parse a single HTML-comment payload (the bit BETWEEN `<!--` and `-->`).
 * Returns null if the comment isn't a voice comment.
 */
export function parseVoiceComment(commentBody: string): ParsedVoiceComment | null {
  if (!PREFIX.test(commentBody)) return null;

  // Strip the leading `voice` keyword.
  let rest = commentBody.replace(/^\s*voice\s*/, "");

  // Optional kv-pairs before the `:` separator (or just the `:`).
  // The narration text starts after the FIRST `:` that isn't inside a
  // double-quoted value.
  let voice: string | undefined;
  let rate: number | undefined;
  const colonIdx = findUnquotedColon(rest);
  if (colonIdx === -1) return null; // Marker present but no narration body.

  const meta = rest.slice(0, colonIdx).trim();
  const text = rest
    .slice(colonIdx + 1)
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  if (meta) {
    KV_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = KV_PATTERN.exec(meta))) {
      const key = match[1]!.toLowerCase();
      const value = match[2] ?? match[3] ?? "";
      if (key === "voice") voice = value;
      else if (key === "rate") {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) rate = n;
      }
    }
  }

  return {
    text,
    ...(voice ? { voice } : {}),
    ...(typeof rate === "number" ? { rate } : {}),
  };
}

function findUnquotedColon(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) return i;
  }
  return -1;
}
