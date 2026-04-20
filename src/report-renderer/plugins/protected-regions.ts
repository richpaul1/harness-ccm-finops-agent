/**
 * Shared helper for source-level markdown preprocessors.
 *
 * Our `:::` callout/metric blocks and `<!-- voice: -->` narration comments
 * are rewritten by simple source-regex passes BEFORE markdown-it parses the
 * document. Those regexes must skip any occurrence that appears inside
 *
 *   ```lang\n…\n```   fenced code block (back-ticks)
 *   ~~~lang\n…\n~~~   fenced code block (tildes)
 *   `…`               inline code span (single line)
 *
 * otherwise an author who demonstrates the syntax by pasting it into a code
 * block gets their example silently rewritten into real DOM — and, worse,
 * the regex can consume the fence's closing delimiter and cascade the damage
 * into the rest of the document.
 *
 * `transformOutsideCode(source, pattern, fn)` runs the same replace logic as
 * `String.prototype.replace` but pre-partitions the source into "protected"
 * and "plain" regions and only applies the transform to plain regions.
 */

// Match anything we want to protect. Order matters: fences first so their
// bodies get swallowed before inline-span matching can look inside them.
const PROTECTED_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g;

/**
 * Replace every match of `pattern` inside `source`, but ONLY in regions
 * that are not part of a fenced code block or inline code span. Protected
 * regions are returned verbatim.
 *
 * The `pattern` must be a `/.../g` RegExp (global flag required — same
 * contract as `String.replace` with a callback).
 */
export function transformOutsideCode(
  source: string,
  pattern: RegExp,
  fn: (match: string, ...groups: string[]) => string,
): string {
  if (!pattern.global) {
    throw new Error("transformOutsideCode: pattern must be global (/.../g)");
  }

  let out = "";
  let cursor = 0;
  PROTECTED_RE.lastIndex = 0;
  let protMatch: RegExpExecArray | null;
  while ((protMatch = PROTECTED_RE.exec(source))) {
    // Plain text between previous protected region and this one — run the
    // transform here.
    const plain = source.slice(cursor, protMatch.index);
    out += plain.replace(pattern, fn as never);
    // Protected region — append verbatim.
    out += protMatch[0];
    cursor = protMatch.index + protMatch[0].length;
  }
  // Tail after the last protected region.
  out += source.slice(cursor).replace(pattern, fn as never);
  return out;
}
