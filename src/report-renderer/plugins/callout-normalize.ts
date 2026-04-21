/**
 * Tolerance preprocessor for callout syntax.
 *
 * The canonical syntax (handled by `calloutsPlugin` via markdown-it-container)
 * is:
 *
 *     ::: info Optional title
 *     Body text on its own line(s).
 *     :::
 *
 * LLMs authoring reports frequently emit a slightly looser form that
 * markdown-it-container does NOT recognise, so it falls through as raw text:
 *
 *     :::callout info Read the trend. <body all on one line> :::   ← inline
 *     ::: callout info Title                                       ← block
 *     <body>
 *     :::
 *
 * Rather than re-train every model, we normalise these into the canonical
 * form here so the same callout vocabulary works regardless of how the
 * author spelled it. Any `:::` form that is NOT prefixed with `callout`
 * (e.g. `::: info`, `::: success`, `::: metrics`) is left untouched.
 *
 * Skips code fences and inline code spans via the shared protection helper —
 * an author demonstrating the pattern in a code block must see the raw text.
 */
import { transformOutsideCode } from "./protected-regions.js";

// Whitelist of callout types we know about. Anything else is left alone so
// a typo doesn't silently produce a "default" callout that looks wrong.
const KNOWN_TYPES = new Set([
  "critical",
  "risk",
  "warning",
  "success",
  "info",
  "action",
  "quote",
]);

// Inline single-line form:  :::callout <type> <body> :::
// Captures: indent, type, body text. The trailing `:::` must be on the same
// line — body cannot contain newlines (so the m flag's `.` semantics suffice
// without `s`). We require at least one space between type and body.
const INLINE_RE = /^([ \t]*):::[ \t]*callout[ \t]+(\w+)\b[ \t]+(.*?)[ \t]*:::[ \t]*$/gm;

// Block opener form:  :::callout <type> [optional title]
// We only rewrite the OPENING line — the matching `:::` closer is already
// canonical syntax. Captures: indent, type, optional trailing text.
const BLOCK_OPENER_RE = /^([ \t]*):::[ \t]*callout[ \t]+(\w+)\b([ \t]+.*)?$/gm;

export function preprocessCalloutSyntax(source: string): string {
  // Inline form first — it's a strict superset that would otherwise be
  // partially matched by the block-opener regex (the opener would strip
  // `callout` but leave the trailing `:::` confused on the same line).
  let out = transformOutsideCode(source, INLINE_RE, (match, indent: string, type: string, body: string) => {
    if (!KNOWN_TYPES.has(type.toLowerCase())) return match;
    // Emit canonical block form. Surrounding blank lines protect against
    // the opening `:::` being folded into the previous paragraph.
    return `\n\n${indent}::: ${type}\n${indent}${body}\n${indent}:::\n\n`;
  });

  out = transformOutsideCode(out, BLOCK_OPENER_RE, (match, indent: string, type: string, tail: string | undefined) => {
    if (!KNOWN_TYPES.has(type.toLowerCase())) return match;
    return `${indent}::: ${type}${tail ?? ""}`;
  });

  return out;
}
