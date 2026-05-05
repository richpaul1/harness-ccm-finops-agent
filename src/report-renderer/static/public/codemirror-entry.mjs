/**
 * CodeMirror bundle entry.
 *
 * esbuild bundles this file into `static/public/codemirror.bundle.js` at
 * build time. The bundle is served by the report renderer alongside
 * edit-panel.js so the live source editor never depends on a public CDN
 * (esm.sh, jsdelivr, etc.) — important for offline work, corporate
 * networks, and reliability.
 *
 * Re-exports the same module shapes edit-panel.js previously imported via
 * dynamic `import("https://esm.sh/...")` so the call site only changes its
 * URL, not its destructuring.
 *
 * The shape returned by loadCodeMirror() in edit-panel.js is:
 *   { view, state, lang, commands, language, autocomplete, search }
 *
 * We re-export each module as a namespace under its short name.
 */

import * as viewMod from "@codemirror/view";
import * as stateMod from "@codemirror/state";
import * as langMod from "@codemirror/lang-markdown";
import * as commandsMod from "@codemirror/commands";
import * as languageMod from "@codemirror/language";
import * as autocompleteMod from "@codemirror/autocomplete";
import * as searchMod from "@codemirror/search";
import * as tagsMod from "@lezer/highlight";
import TurndownService from "turndown";

export const view = viewMod;
export const state = stateMod;
export const lang = langMod;
export const commands = commandsMod;

// Turndown converts the HTML of an inline-edited block back to markdown
// so the live edit panel can persist text-only edits (paragraphs, headings,
// list items, blockquotes) without requiring the user to drop into the
// source editor. Configured with the markdown style choices that match the
// rest of the codebase (ATX headings with `#`, hyphen bullets, fenced
// code blocks).
export const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
});
// Strip the live-edit-panel's own decorations (pencil icons, contenteditable
// cursors) before converting — they shouldn't appear in the saved markdown.
turndown.remove(["script", "style"]);
turndown.addRule("strip-edit-icons", {
  filter: (node) => node.classList?.contains("edit-block-icon") ?? false,
  replacement: () => "",
});

// edit-panel.js reads syntax-highlight tags via `cm.language.tags.heading`,
// but @codemirror/language does NOT re-export the `tags` namespace from
// @lezer/highlight — we have to merge it onto the language namespace here so
// the call site (which expects `cm.language.tags.*`) Just Works without any
// changes to edit-panel.js.
export const language = { ...languageMod, tags: tagsMod.tags };

export const autocomplete = autocompleteMod;
export const search = searchMod;
