/**
 * Live source-edit panel.
 *
 * Self-injects:
 *   1. A floating "Edit Source" button (bottom-right) that toggles a slide-in
 *      panel containing a CodeMirror 6 markdown editor.
 *   2. Hover-revealed pencil icons next to every block-level element in the
 *      rendered HTML (anything tagged with `data-source-line` by the markdown
 *      pipeline). Click a pencil to jump the editor cursor to that source line.
 *   3. A global ⌘/Ctrl+E shortcut to toggle the editor.
 *   4. Live preview: every keystroke (debounced) re-renders the preview in
 *      place, no save required.
 *   5. Reverse cursor sync: as the editor cursor moves, scroll the preview to
 *      the matching block (with a brief highlight tint).
 *
 * The editor saves back to disk via POST `./source` on ⌘/Ctrl+S. External
 * edits trigger an automatic page reload via the SSE source-watch stream
 * (when the panel is closed) or a banner warning (when it's open).
 *
 * CodeMirror 6 is loaded lazily from esm.sh on first panel open.
 *
 * Endpoints (all relative to the current /reports/<id>/ URL):
 *   GET  ./source.md           Returns the raw file body. Mtime in X-Source-Mtime.
 *   POST ./source              JSON {markdown, expected_mtime?} → writes to disk.
 *   GET  ./source-watch        SSE: emits "change" events when file mtime moves.
 *   POST ./render-preview      JSON {markdown} → returns rendered doc-body HTML.
 */

// ─── Module-level UI state ───────────────────────────────────────────────────
let panel = null;
let button = null;
let cmView = null;
let cmModules = null;
let isOpen = false;
let isDirty = false;
let loadedMtime = null;
let pendingJumpLine = null;
let livePreviewTimer = null;
let cursorSyncTimer = null;
let suppressNextCursorSync = false;
let lastSyncedHighlightEl = null;
let reportsModalEl = null;
// When true, the next docChanged transaction in CodeMirror should NOT
// trigger a live-preview re-render. Set by inline-edit handlers because
// the rendered HTML is already up-to-date (the user typed into it
// directly) — re-rendering would just blow away their caret position.
let suppressNextPreview = false;
// Track the last mtime our own POST /source produced. SSE source-watch
// events whose mtime matches this are ignored — they're echoes of our
// own writes, not external edits.
let lastSelfSavedMtime = null;

// Tunables
const LIVE_PREVIEW_DEBOUNCE_MS = 250;
const CURSOR_SYNC_DEBOUNCE_MS = 80;

function install() {
  panel = createPanel();
  document.body.appendChild(panel);

  // Restore the persisted sidebar collapsed state BEFORE wiring up icons so
  // the visual state matches the active button on first paint.
  if (localStorage.getItem("sidebarCollapsed") === "1") {
    document.body.classList.add("sidebar-collapsed");
  }

  // Restore the panel width that was last chosen via the resize handle
  // (if any). Falls back to the CSS default of 50vw.
  restorePanelWidth();

  // Prefer in-sidebar controls when the active theme has a sidebar (every
  // built-in theme except print). Fall back to a floating bottom-right
  // button for sidebar-less themes / future minimal layouts.
  const sidebar = document.querySelector(".app-sidebar");
  if (sidebar) {
    button = injectSidebarTools(sidebar);
    injectSidebarExpand(sidebar);
  } else {
    button = createFloatingButton();
    button.addEventListener("click", () => (isOpen ? closePanel() : void openPanel()));
    document.body.appendChild(button);
  }

  panel.querySelector('[data-edit-action="save"]').addEventListener("click", () => void save());
  panel.querySelector('[data-edit-action="cancel"]').addEventListener("click", closePanel);
  panel.querySelector('[data-edit-action="close"]').addEventListener("click", closePanel);

  // Global keyboard shortcuts
  //   ⌘/Ctrl+E       toggle the source editor panel
  //   ⌘/Ctrl+\       toggle sidebar collapse (matches VS Code)
  //   ⌘/Ctrl+P       open the reports list modal (matches VS Code "go to file")
  //   Esc            close the reports modal if open
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === "e") {
      e.preventDefault();
      if (isOpen) closePanel();
      else void openPanel();
    } else if ((e.metaKey || e.ctrlKey) && (key === "\\" || e.key === "\\")) {
      e.preventDefault();
      toggleSidebarCollapse();
    } else if ((e.metaKey || e.ctrlKey) && key === "p" && !e.shiftKey) {
      // Avoid hijacking the user's browser print dialog (which uses Cmd+P).
      // We require the focus NOT be in the editor for this to fire — when
      // the editor is focused CodeMirror's own keymap takes priority and
      // we leave Cmd+P alone (most users won't need to switch reports
      // while typing). Outside the editor it's safe.
      if (cmView && cmView.hasFocus) return;
      e.preventDefault();
      openReportsModal();
    } else if (e.key === "Escape" && reportsModalEl?.classList.contains("reports-modal-open")) {
      e.preventDefault();
      closeReportsModal();
    }
  });

  // Warn before navigating away with unsaved changes
  window.addEventListener("beforeunload", (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  injectPencilIcons();
  enableInlineEditing();
  subscribeSourceWatch();
}

// ─── Sidebar tool icons + collapse toggle ────────────────────────────────────
//
// We inject a small toolbar at the bottom of the active theme's sidebar
// containing two icons: Edit (toggles the source-edit panel) and Collapse
// (hides the sidebar to give the report full available width). The collapsed
// state is persisted across page loads via localStorage.
//
// Returns the Edit button so the rest of the file can flag it active/inactive
// the same way it would the floating button.
function injectSidebarTools(sidebar) {
  const tools = document.createElement("div");
  tools.className = "sidebar-tools";
  tools.innerHTML = `
    <button class="sidebar-tool-icon" type="button" data-tool="reports"
            title="All registered reports (${reportsShortcutLabel()})" aria-label="All reports">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="13" y2="17"/>
      </svg>
    </button>
    <button class="sidebar-tool-icon" type="button" data-tool="edit"
            title="Edit source (${shortcutLabel()})" aria-label="Edit source">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>
    </button>
    <button class="sidebar-tool-icon" type="button" data-tool="collapse"
            title="Collapse sidebar (${collapseShortcutLabel()})" aria-label="Collapse sidebar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M9 3v18"/>
        <path d="M16 9l-3 3 3 3"/>
      </svg>
    </button>
  `;
  sidebar.appendChild(tools);
  const editBtn = tools.querySelector('[data-tool="edit"]');
  editBtn.addEventListener("click", () => (isOpen ? closePanel() : void openPanel()));
  tools.querySelector('[data-tool="collapse"]').addEventListener("click", toggleSidebarCollapse);
  tools.querySelector('[data-tool="reports"]').addEventListener("click", openReportsModal);
  return editBtn;
}

/**
 * Inject the expand button at the top of the sidebar. Hidden by CSS unless
 * `body.sidebar-collapsed` is set — when the sidebar is collapsed to a thin
 * strip, this is the only control visible inside it.
 */
function injectSidebarExpand(sidebar) {
  const expand = document.createElement("button");
  expand.className = "sidebar-expand";
  expand.type = "button";
  expand.title = `Expand sidebar (${collapseShortcutLabel()})`;
  expand.setAttribute("aria-label", "Expand sidebar");
  expand.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M9 3v18"/>
      <path d="M13 9l3 3-3 3"/>
    </svg>
  `;
  expand.addEventListener("click", toggleSidebarCollapse);
  sidebar.insertBefore(expand, sidebar.firstChild);
}

function toggleSidebarCollapse() {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  try {
    localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
  } catch {
    // localStorage may be disabled in some contexts; fail silently
  }
}

function collapseShortcutLabel() {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return isMac ? "⌘\\" : "Ctrl+\\";
}

function reportsShortcutLabel() {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return isMac ? "⌘P" : "Ctrl+P";
}

// ─── Reports list modal ──────────────────────────────────────────────────────
//
// A centered overlay that lists every report registered with the renderer,
// sorted newest-first. Click a row to navigate. The current report (derived
// from window.location.pathname) is highlighted and not clickable. Lazy-built
// on first open so the DOM stays clean for sessions that never use it.
function getCurrentReportId() {
  const m = location.pathname.match(/\/reports\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : null;
}

function ensureReportsModal() {
  if (reportsModalEl) return reportsModalEl;
  const el = document.createElement("div");
  el.className = "reports-modal";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "All registered reports");
  el.innerHTML = `
    <div class="reports-modal-backdrop" data-reports-action="close"></div>
    <div class="reports-modal-card">
      <header class="reports-modal-head">
        <div class="reports-modal-title">Registered reports</div>
        <button class="reports-modal-close" type="button" data-reports-action="close" aria-label="Close">×</button>
      </header>
      <div class="reports-modal-body">
        <div class="reports-modal-loading">Loading…</div>
      </div>
      <footer class="reports-modal-foot">
        <span class="reports-modal-hint">Esc to close · ${reportsShortcutLabel()} to reopen</span>
      </footer>
    </div>
  `;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    const action = e.target?.closest?.("[data-reports-action]")?.dataset?.reportsAction;
    if (action === "close") closeReportsModal();
  });
  reportsModalEl = el;
  return el;
}

async function openReportsModal() {
  const el = ensureReportsModal();
  el.classList.add("reports-modal-open");
  document.body.classList.add("reports-modal-active");
  const body = el.querySelector(".reports-modal-body");
  body.innerHTML = '<div class="reports-modal-loading">Loading…</div>';

  try {
    const res = await fetch("/_report/reports.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderReportsList(body, data.reports || []);
  } catch (err) {
    body.innerHTML =
      `<div class="reports-modal-error">Failed to load reports: ${escapeHtml(String(err.message || err))}</div>`;
  }
}

function closeReportsModal() {
  if (!reportsModalEl) return;
  reportsModalEl.classList.remove("reports-modal-open");
  document.body.classList.remove("reports-modal-active");
}

function renderReportsList(host, reports) {
  if (!reports.length) {
    host.innerHTML = `
      <div class="reports-modal-empty">
        <p>No reports are registered yet.</p>
        <p class="reports-modal-empty-hint">Use the <code>harness_ccm_finops_report_render</code> MCP tool to register a markdown file.</p>
      </div>
    `;
    return;
  }
  const currentId = getCurrentReportId();
  const items = reports.map((r) => {
    const isActive = r.id === currentId;
    const when = formatRelative(r.registeredAt);
    const url = r.url || `/reports/${encodeURIComponent(r.id)}/`;
    // Preserve the active theme query string so navigating to another report
    // doesn't drop back to the default theme.
    const themeQs = new URLSearchParams(location.search).get("theme");
    const href = themeQs ? `${url}?theme=${encodeURIComponent(themeQs)}` : url;
    return `
      <a class="reports-modal-item ${isActive ? "reports-modal-item-active" : ""}"
         href="${escapeAttr(href)}"
         ${isActive ? 'aria-current="page"' : ""}>
        <div class="reports-modal-item-title">${escapeHtml(r.label || r.id)}</div>
        <div class="reports-modal-item-sub">
          <span class="reports-modal-item-file">${escapeHtml(r.fileName || "")}</span>
          <span class="reports-modal-item-when">${escapeHtml(when)}</span>
        </div>
        ${isActive ? '<span class="reports-modal-item-badge">Current</span>' : ""}
      </a>
    `;
  }).join("");
  host.innerHTML = `<div class="reports-modal-list">${items}</div>`;
}

function formatRelative(ts) {
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s);
}

// ─── Status display ──────────────────────────────────────────────────────────
function setStatus(msg, tone) {
  const status = panel.querySelector(".edit-panel-status");
  status.textContent = msg;
  status.className = "edit-panel-status";
  if (tone) status.classList.add(`edit-panel-status-${tone}`);
}

// ─── CodeMirror lazy-loader ──────────────────────────────────────────────────
//
// We bundle CodeMirror 6 ourselves and serve it from /_report/public/
// codemirror.bundle.js (built by `npm run build:codemirror` via esbuild).
// This used to load each module from esm.sh, which broke whenever the user
// was offline / behind a corporate firewall / esm.sh had a hiccup. Bundling
// locally is ~250KB cached forever after the first hit and removes a hard
// dependency on a public CDN.
//
// The bundle re-exports the modules under the same shape edit-panel.js
// expects: { view, state, lang, commands, language, autocomplete, search }
// (plus `language.tags` merged in from @lezer/highlight). See
// `codemirror-entry.mjs` for the exact surface.
let cmLoaderPromise = null;
function loadCodeMirror() {
  if (cmLoaderPromise) return cmLoaderPromise;
  cmLoaderPromise = import("/_report/public/codemirror.bundle.js");
  return cmLoaderPromise;
}

// ─── Theme-aware CodeMirror palette ──────────────────────────────────────────
//
// Themes can override these CSS custom properties (see edit-panel.css for the
// neutral defaults). We read computed values from <body> at editor-create time
// so each theme gets its own editor look without hard-coding.
function getEditorPalette() {
  const cs = getComputedStyle(document.body);
  const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    bg:           v("--editor-bg",            "#ffffff"),
    fg:           v("--editor-fg",            "#1a1a1a"),
    accent:       v("--editor-accent",        "#0f766e"),
    gutterBg:     v("--editor-gutter-bg",     "#f5f5f5"),
    gutterFg:     v("--editor-gutter-fg",     "#8a8a8a"),
    activeLineBg: v("--editor-active-line-bg","rgba(15,118,110,0.06)"),
    selectionBg:  v("--editor-selection-bg",  "rgba(15,118,110,0.18)"),
    keyword:      v("--editor-keyword",       "#0f766e"),
    string:       v("--editor-string",        "#9a3412"),
    comment:      v("--editor-comment",       "#8a8a8a"),
    heading:      v("--editor-heading",       "#1a1a1a"),
  };
}

async function ensureEditor(source) {
  if (cmView) {
    cmView.dispatch({
      changes: { from: 0, to: cmView.state.doc.length, insert: source },
    });
    return;
  }
  setStatus("Loading editor…");
  const cm = await loadCodeMirror();
  cmModules = cm;
  const host = panel.querySelector(".edit-panel-editor");
  host.innerHTML = "";

  const palette = getEditorPalette();
  const editorTheme = cm.view.EditorView.theme(
    {
      "&": { height: "100%", fontSize: "13px", color: palette.fg, backgroundColor: palette.bg },
      ".cm-scroller": {
        fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
        lineHeight: "1.55",
      },
      ".cm-content": { padding: "12px 0", caretColor: palette.accent },
      ".cm-gutters": {
        background: palette.gutterBg,
        color: palette.gutterFg,
        border: "0",
        borderRight: "1px solid #e5e5e5",
      },
      ".cm-activeLineGutter": { background: palette.gutterBg, color: palette.fg, fontWeight: "600" },
      ".cm-activeLine": { background: palette.activeLineBg },
      ".cm-cursor": { borderLeftColor: palette.accent, borderLeftWidth: "2px" },
      "&.cm-focused .cm-selectionBackground, ::selection": { background: palette.selectionBg },
      ".cm-line.cm-jumped-line": {
        background: "rgba(255,210,0,0.35)",
        transition: "background 1.6s ease-out",
      },
      ".cm-searchMatch": { background: "rgba(255,210,0,0.30)" },
    },
    { dark: false },
  );

  // Markdown syntax highlighting via @lezer/highlight tags. We pull tags from
  // @codemirror/language and create a highlight style that consumes the theme
  // palette colours. Each tag is mapped to one of accent/string/comment/...
  const highlight = cm.language.HighlightStyle.define([
    { tag: cm.language.tags.heading,        color: palette.heading, fontWeight: "700" },
    { tag: cm.language.tags.heading1,       color: palette.heading, fontWeight: "800", fontSize: "1.05em" },
    { tag: cm.language.tags.heading2,       color: palette.heading, fontWeight: "700" },
    { tag: cm.language.tags.heading3,       color: palette.heading, fontWeight: "700" },
    { tag: cm.language.tags.strong,         fontWeight: "700" },
    { tag: cm.language.tags.emphasis,       fontStyle: "italic" },
    { tag: cm.language.tags.link,           color: palette.accent, textDecoration: "underline" },
    { tag: cm.language.tags.url,            color: palette.accent },
    { tag: cm.language.tags.monospace,      fontFamily: '"JetBrains Mono", monospace', color: palette.string },
    { tag: cm.language.tags.processingInstruction, color: palette.comment },
    { tag: cm.language.tags.comment,        color: palette.comment, fontStyle: "italic" },
    { tag: cm.language.tags.string,         color: palette.string },
    { tag: cm.language.tags.keyword,        color: palette.keyword, fontWeight: "600" },
    { tag: cm.language.tags.list,           color: palette.accent },
    { tag: cm.language.tags.quote,          color: palette.comment, fontStyle: "italic" },
  ]);

  const startState = cm.state.EditorState.create({
    doc: source,
    extensions: [
      cm.view.lineNumbers(),
      cm.view.highlightActiveLineGutter(),
      cm.view.highlightActiveLine(),
      cm.view.highlightSpecialChars(),
      cm.commands.history(),
      cm.language.foldGutter(),
      cm.view.drawSelection(),
      cm.view.dropCursor(),
      cm.state.EditorState.allowMultipleSelections.of(true),
      cm.language.indentOnInput(),
      cm.language.syntaxHighlighting(highlight),
      cm.language.bracketMatching(),
      cm.autocomplete.closeBrackets(),
      cm.autocomplete.autocompletion(),
      cm.search.highlightSelectionMatches(),
      cm.view.keymap.of([
        ...cm.autocomplete.closeBracketsKeymap,
        ...cm.commands.defaultKeymap,
        ...cm.search.searchKeymap,
        ...cm.commands.historyKeymap,
        ...cm.language.foldKeymap,
        ...cm.autocomplete.completionKeymap,
        { key: "Mod-s", preventDefault: true, run: () => { void save(); return true; } },
        { key: "Escape", run: () => { closePanel(); return true; } },
      ]),
      cm.lang.markdown({ codeLanguages: [] }),
      cm.view.EditorView.lineWrapping,
      editorTheme,
      cm.view.EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          isDirty = true;
          setStatus("Unsaved changes — click Save to Disk to persist", "warn");
          // Inline-edit dispatches set suppressNextPreview because the
          // rendered HTML is ALREADY showing the new text (the user typed
          // into it). Re-rendering would replace the .doc-body innerHTML
          // and lose the caret. Source-editor edits don't suppress, so
          // typing in CodeMirror re-renders the preview as before.
          if (suppressNextPreview) {
            suppressNextPreview = false;
          } else {
            scheduleLivePreview();
          }
        }
        if (update.selectionSet || update.docChanged) {
          scheduleCursorSync();
        }
      }),
    ],
  });
  cmView = new cm.view.EditorView({ state: startState, parent: host });

  // Apply any pending jump-to-line that arrived before the editor was ready
  if (pendingJumpLine != null) {
    const line = pendingJumpLine;
    pendingJumpLine = null;
    setTimeout(() => jumpToLineInEditor(line), 30);
  } else {
    setTimeout(() => cmView.focus(), 30);
  }
}

// ─── Open / close ────────────────────────────────────────────────────────────
async function openPanel(jumpLine) {
  if (jumpLine != null) pendingJumpLine = jumpLine;
  if (isOpen) {
    if (jumpLine != null) jumpToLineInEditor(jumpLine);
    return;
  }
  panel.classList.add("edit-panel-open");
  // Both classes are applied so both the floating button and the sidebar
  // tool icon styles can target their own active state without coupling.
  button.classList.add("edit-button-active", "sidebar-tool-active");
  document.body.classList.add("edit-panel-active");
  isOpen = true;
  setStatus("Loading source…");

  try {
    const res = await fetch("./source.md", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    loadedMtime = parseFloat(res.headers.get("X-Source-Mtime") || "0") || null;
    isDirty = false;
    await ensureEditor(body);
    setStatus(`Loaded · ${body.length.toLocaleString()} bytes`);
  } catch (err) {
    setStatus(`Load failed: ${err.message || err}`, "error");
  }
}

function closePanel() {
  if (!isOpen) return;
  if (isDirty && !confirm("You have unsaved changes. Discard them and reload from disk?")) return;
  panel.classList.remove("edit-panel-open");
  button.classList.remove("edit-button-active", "sidebar-tool-active");
  document.body.classList.remove("edit-panel-active");
  isOpen = false;
  if (isDirty) {
    // Reload to discard preview-only edits and restore on-disk source rendering
    location.reload();
    return;
  }
}

// ─── Jump cursor to a specific line ──────────────────────────────────────────
function jumpToLineInEditor(line) {
  if (!cmView || !cmModules) {
    pendingJumpLine = line;
    return;
  }
  const doc = cmView.state.doc;
  const targetLine = Math.max(1, Math.min(line, doc.lines));
  const lineInfo = doc.line(targetLine);
  // Suppress the cursor-sync handler that would otherwise fire from this
  // dispatch and try to scroll the preview back to where it already is.
  suppressNextCursorSync = true;
  cmView.dispatch({
    selection: { anchor: lineInfo.from, head: lineInfo.from },
    effects: cmModules.view.EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
  });
  cmView.focus();

  setTimeout(() => {
    const target = cmView.dom.querySelector(".cm-activeLine");
    if (!target) return;
    target.classList.add("cm-jumped-line");
    setTimeout(() => target.classList.remove("cm-jumped-line"), 1600);
  }, 80);
}

// ─── Live preview (debounced) ────────────────────────────────────────────────
function scheduleLivePreview() {
  if (livePreviewTimer) clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(updateLivePreview, LIVE_PREVIEW_DEBOUNCE_MS);
}

let livePreviewInflight = false;
let livePreviewQueued = false;

async function updateLivePreview() {
  if (!cmView) return;
  // Coalesce: if a request is in flight, queue one re-fire when it settles.
  if (livePreviewInflight) {
    livePreviewQueued = true;
    return;
  }
  livePreviewInflight = true;
  try {
    const markdown = cmView.state.doc.toString();
    const res = await fetch("./render-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    swapPreviewBody(data.html);
  } catch (err) {
    console.warn("Live preview render failed:", err);
  } finally {
    livePreviewInflight = false;
    if (livePreviewQueued) {
      livePreviewQueued = false;
      // Schedule the queued render so we don't recurse unbounded.
      scheduleLivePreview();
    }
  }
}

/**
 * Swap the rendered preview body in place while preserving scroll position
 * (anchored to the topmost visible block-with-source-line, so edits up the
 * page don't jolt the user). After the swap, re-inject the pencil icons
 * because innerHTML replacement nukes them.
 */
function swapPreviewBody(newHtml) {
  const docBody = document.querySelector(".doc-body");
  if (!docBody) return;

  // Anchor: which top-visible source-line element should we keep at this
  // viewport offset? Walk source-line elements top-down, find the first
  // whose bounding-rect bottom is past the top edge.
  const anchor = findScrollAnchor();
  docBody.innerHTML = newHtml;
  injectPencilIcons();
  enableInlineEditing();

  if (anchor) {
    const newAnchor = docBody.querySelector(`[data-source-line="${anchor.sourceLine}"]`);
    if (newAnchor) {
      const rect = newAnchor.getBoundingClientRect();
      const desiredTop = anchor.viewportOffset;
      window.scrollBy({ top: rect.top - desiredTop, behavior: "auto" });
    }
  }
}

function findScrollAnchor() {
  const candidates = document.querySelectorAll(".doc-body [data-source-line]");
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0) {
      return { sourceLine: el.dataset.sourceLine, viewportOffset: rect.top };
    }
  }
  return null;
}

// ─── Reverse cursor sync (editor → preview) ──────────────────────────────────
function scheduleCursorSync() {
  if (suppressNextCursorSync) {
    suppressNextCursorSync = false;
    return;
  }
  if (cursorSyncTimer) clearTimeout(cursorSyncTimer);
  cursorSyncTimer = setTimeout(syncPreviewToCursor, CURSOR_SYNC_DEBOUNCE_MS);
}

function syncPreviewToCursor() {
  if (!cmView) return;
  const cursorPos = cmView.state.selection.main.head;
  const cursorLine = cmView.state.doc.lineAt(cursorPos).number;

  // Find the largest source-line ≤ cursorLine. Markdown blocks span ranges,
  // but only their starting line is annotated, so we want the closest one
  // at-or-before the cursor.
  const candidates = document.querySelectorAll(".doc-body [data-source-line]");
  let target = null;
  for (const el of candidates) {
    const elLine = parseInt(el.dataset.sourceLine, 10);
    if (elLine <= cursorLine) {
      target = el;
    } else {
      break;
    }
  }
  if (!target) return;

  // Don't scroll if the target is already comfortably visible.
  const rect = target.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const safeTop = viewportH * 0.15;
  const safeBottom = viewportH * 0.75;
  if (rect.top < safeTop || rect.top > safeBottom) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Brief highlight tint so the user sees the link
  if (lastSyncedHighlightEl && lastSyncedHighlightEl !== target) {
    lastSyncedHighlightEl.classList.remove("edit-block-cursor-target");
  }
  target.classList.add("edit-block-cursor-target");
  lastSyncedHighlightEl = target;
  clearTimeout(syncPreviewToCursor._fadeTimer);
  syncPreviewToCursor._fadeTimer = setTimeout(() => {
    target.classList.remove("edit-block-cursor-target");
    if (lastSyncedHighlightEl === target) lastSyncedHighlightEl = null;
  }, 1500);
}

// ─── Save (POST) ─────────────────────────────────────────────────────────────
async function save() {
  if (!isOpen || !cmView) return;
  const markdown = cmView.state.doc.toString();
  const saveBtn = panel.querySelector('[data-edit-action="save"]');
  const cancelBtn = panel.querySelector('[data-edit-action="cancel"]');
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  setStatus("Saving…");

  try {
    const res = await fetch("./source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown,
        ...(loadedMtime ? { expected_mtime: loadedMtime } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const force = confirm(
        "The source file was modified externally since you opened it. " +
          "Overwrite the external changes with your edits?",
      );
      if (force) {
        const force_res = await fetch("./source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown }),
        });
        if (!force_res.ok) {
          const ferr = await force_res.json().catch(() => ({}));
          throw new Error(ferr.error || `HTTP ${force_res.status}`);
        }
        isDirty = false;
        loadedMtime = await refreshMtimeFromHeaders();
        if (loadedMtime) lastSelfSavedMtime = loadedMtime;
        setStatus("Saved (overwrote external changes).", "success");
        return;
      }
      setStatus("Save cancelled — external changes preserved.", "warn");
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    isDirty = false;
    if (typeof data.mtime === "number") {
      loadedMtime = data.mtime;
      lastSelfSavedMtime = data.mtime;
    }
    setStatus("Saved to disk", "success");
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  } catch (err) {
    setStatus(`Save failed: ${err.message || err}`, "error");
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

async function refreshMtimeFromHeaders() {
  try {
    const head = await fetch("./source.md", { method: "HEAD", cache: "no-store" });
    return parseFloat(head.headers.get("X-Source-Mtime") || "0") || null;
  } catch {
    return null;
  }
}

// ─── Pencil icons on every block ─────────────────────────────────────────────
//
// Walk every element with `data-source-line`, attach a hover-revealed pencil.
// Idempotent — re-run after live-preview swaps replace the doc-body innerHTML.
function injectPencilIcons() {
  const targets = document.querySelectorAll(".doc-body [data-source-line]");
  for (const el of targets) {
    if (el.classList.contains("edit-block-target")) continue;
    el.classList.add("edit-block-target");

    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "edit-block-icon";
    icon.setAttribute("aria-label", "Edit this block in source");
    icon.title = `Edit at line ${el.dataset.sourceLine} (${shortcutLabel()})`;
    icon.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    icon.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const line = parseInt(el.dataset.sourceLine, 10);
      void openPanel(line);
    });
    el.appendChild(icon);
  }
}

function shortcutLabel() {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return isMac ? "⌘E" : "Ctrl+E";
}

// ─── Inline editing — type directly into the rendered HTML ───────────────────
//
// "Safe" block types (paragraphs, headings, list items, blockquote contents)
// can be edited directly in the rendered preview. On change we Turndown the
// edited HTML back to markdown and replace just that block's source line range
// in the underlying file.
//
// "Unsafe" block types — anything inside a custom container (.portfolio-detail,
// .portfolio-bucket-grid), tables, code blocks, callouts, anything emitted by
// a preprocessor (html_block) — are left alone. The pencil icon still works
// for those: click it to open the source editor for the full block.
//
// The source-line range comes from the data-source-line / data-source-end-line
// attributes attached server-side. Without `data-source-end-line` we fall back
// to assuming a single-line block.

// Block-level markdown elements safe for inline editing (the source line
// range maps cleanly to a single CommonMark block).
const INLINE_EDITABLE_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"]);

// Containers whose contents are NEVER inline-editable. These are either
// preprocessor output (html_block) or markdown structures whose source
// representation isn't a flat text run (tables, code, fences).
const NEVER_EDITABLE_INSIDE = new Set([
  "table", "thead", "tbody", "tr", "td", "th",
  "pre", "code",
]);
// CSS-class-based exclusions: pack-emitted custom blocks and renderer
// preprocessor blocks that have YAML/structured source we can't round-trip.
const NEVER_EDITABLE_CLASSES = [
  "portfolio-bucket-grid",
  "portfolio-detail",
  "metric-grid",
  "metric-card",
  "callout",
  "voice-narration",
  "cover-page",
  "toc-page",
  "edit-panel",
];

function isEditableBlock(el) {
  if (!el || !el.tagName) return false;
  if (!INLINE_EDITABLE_TAGS.has(el.tagName.toLowerCase())) return false;
  if (!el.dataset.sourceLine) return false;
  // Walk up the ancestor chain — if any ancestor is a never-editable
  // container, the block is off-limits.
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    if (NEVER_EDITABLE_INSIDE.has(p.tagName.toLowerCase())) return false;
    for (const cls of NEVER_EDITABLE_CLASSES) {
      if (p.classList && p.classList.contains(cls)) return false;
    }
  }
  return true;
}

let inlineSaveTimer = null;
let inlineSaveInflight = false;
let inlineSaveQueued = false;
let inlineEditingActiveEl = null;

function enableInlineEditing() {
  const targets = document.querySelectorAll(".doc-body [data-source-line]");
  for (const el of targets) {
    if (!isEditableBlock(el)) continue;
    if (el.dataset.inlineEditWired === "1") continue;
    el.dataset.inlineEditWired = "1";
    el.contentEditable = "true";
    el.classList.add("inline-editable");

    el.addEventListener("focus", () => {
      inlineEditingActiveEl = el;
      el.classList.add("inline-editable-focus");
    });
    el.addEventListener("blur", () => {
      el.classList.remove("inline-editable-focus");
      if (inlineEditingActiveEl === el) inlineEditingActiveEl = null;
      // Force a final save on blur so a quick click-away doesn't lose edits.
      if (el.dataset.inlineDirty === "1") {
        scheduleInlineSave(el, /*flushNow=*/ true);
      }
    });
    el.addEventListener("input", () => {
      el.dataset.inlineDirty = "1";
      scheduleInlineSave(el);
    });
    // Paste-as-plaintext — keeps stray HTML formatting from sneaking into
    // the markdown via the Turndown roundtrip.
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    // Enter inside a heading: split out into a new paragraph would require
    // restructuring the source — disallow for v1, force a soft line break or
    // just blur to commit and let the user open the source editor.
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && /^h[1-6]$/.test(el.tagName.toLowerCase())) {
        e.preventDefault();
        el.blur();
      }
      // Esc to cancel: blur and let the next live-preview re-render restore
      // the on-disk content.
      if (e.key === "Escape") {
        e.preventDefault();
        el.dataset.inlineDirty = "0";
        el.blur();
        location.reload();
      }
    });
  }
}

const INLINE_SAVE_DEBOUNCE_MS = 600;

function scheduleInlineSave(el, flushNow = false) {
  if (inlineSaveTimer) clearTimeout(inlineSaveTimer);
  if (flushNow) {
    void persistInlineEdit(el);
    return;
  }
  inlineSaveTimer = setTimeout(() => persistInlineEdit(el), INLINE_SAVE_DEBOUNCE_MS);
}

async function persistInlineEdit(el) {
  if (!el || !el.dataset.sourceLine) return;
  if (inlineSaveInflight) {
    inlineSaveQueued = true;
    return;
  }
  inlineSaveInflight = true;
  try {
    // 1. Convert the edited block's HTML back to markdown via Turndown.
    //    Turndown is bundled with CodeMirror; lazy-load if not yet loaded.
    if (!cmModules) {
      cmModules = await loadCodeMirror();
    }
    const turndown = cmModules?.turndown;
    if (!turndown) {
      console.warn("Turndown not available — inline edit cannot persist");
      return;
    }

    const startLine = parseInt(el.dataset.sourceLine, 10);
    const endLine = parseInt(el.dataset.sourceEndLine || el.dataset.sourceLine, 10);
    const cloned = el.cloneNode(true);
    cloned.querySelectorAll(".edit-block-icon").forEach((n) => n.remove());
    let newMarkdown = turndown.turndown(cloned.outerHTML).trim();
    // Turndown escapes characters with markdown meaning. For body text
    // these escapes are usually noise — undo the most common ones so the
    // saved markdown looks like what a human would write.
    newMarkdown = newMarkdown.replace(/\\([\]{}![<>])/g, "$1");
    newMarkdown = newMarkdown.replace(/\\(\[)/g, "$1");

    // 2. Make sure the CodeMirror buffer exists. If the editor panel
    //    isn't open yet, open it — that loads source.md from disk into
    //    the buffer and creates the editor instance.
    if (!cmView) {
      await openPanel();
    }
    if (!cmView) {
      // openPanel failed (e.g. source fetch error). Status bar will show
      // the error; bail out without losing the user's typing.
      return;
    }

    // 3. Compute character offsets for the block's source line range and
    //    dispatch a replace transaction into the buffer. suppressNextPreview
    //    tells the updateListener NOT to re-render the preview — the user
    //    typed into the rendered HTML directly, so it's already current.
    const doc = cmView.state.doc;
    const safeStart = Math.min(Math.max(1, startLine), doc.lines);
    const safeEnd = Math.min(Math.max(safeStart, endLine), doc.lines);
    const fromPos = doc.line(safeStart).from;
    const toPos = doc.line(safeEnd).to;

    suppressNextPreview = true;
    cmView.dispatch({
      changes: { from: fromPos, to: toPos, insert: newMarkdown },
    });

    // 4. The line range of the just-edited block may have changed (e.g.
    //    a 3-line wrapped paragraph collapsed to a single line). Update
    //    the block's own data-source-end-line, AND shift every subsequent
    //    block's data-source-line / data-source-end-line by the line
    //    delta so future inline edits target the correct range.
    const oldLineCount = endLine - startLine + 1;
    const newLineCount = newMarkdown.split("\n").length;
    const lineDelta = newLineCount - oldLineCount;
    const newEndLine = startLine + newLineCount - 1;
    el.dataset.sourceEndLine = String(newEndLine);
    if (lineDelta !== 0) {
      shiftSubsequentSourceLines(endLine, lineDelta);
    }

    // 5. Visual confirmation — quick green tint, dirty flag stays so the
    //    user knows there's something to save.
    el.dataset.inlineDirty = "0";
    el.classList.add("inline-editable-saved");
    setTimeout(() => el.classList.remove("inline-editable-saved"), 600);
  } catch (err) {
    console.warn("Inline save threw:", err);
    el.classList.add("inline-editable-error");
    setTimeout(() => el.classList.remove("inline-editable-error"), 1500);
  } finally {
    inlineSaveInflight = false;
    if (inlineSaveQueued) {
      inlineSaveQueued = false;
      scheduleInlineSave(el);
    }
  }
}

/**
 * Update data-source-line and data-source-end-line on every block whose
 * range starts AFTER `pivotEndLine`, shifting both attributes by `delta`
 * lines. Called after an inline edit changes the line count of the
 * edited block — without this, subsequent edits would target stale line
 * ranges in the CodeMirror buffer.
 */
function shiftSubsequentSourceLines(pivotEndLine, delta) {
  const all = document.querySelectorAll(".doc-body [data-source-line]");
  for (const node of all) {
    const start = parseInt(node.dataset.sourceLine, 10);
    if (Number.isFinite(start) && start > pivotEndLine) {
      node.dataset.sourceLine = String(start + delta);
      const end = parseInt(node.dataset.sourceEndLine || "", 10);
      if (Number.isFinite(end)) {
        node.dataset.sourceEndLine = String(end + delta);
      }
    }
  }
}

// ─── External edit detection (SSE) ──────────────────────────────────────────
function subscribeSourceWatch() {
  try {
    const sse = new EventSource("./source-watch");
    sse.addEventListener("change", (e) => {
      // Server includes the new mtime in the event payload. If it matches
      // (within 2ms) the mtime our own POST /source just produced, this
      // is just an echo of our own write — not an external edit — and we
      // should ignore it. Otherwise an external editor / agent re-render
      // touched the file and we need to reload (or warn if we have
      // unsaved buffer changes).
      let eventMtime = null;
      try {
        const data = JSON.parse(e.data || "{}");
        eventMtime = typeof data.mtime === "number" ? data.mtime : null;
      } catch {
        // ignore
      }
      if (
        lastSelfSavedMtime != null &&
        eventMtime != null &&
        Math.abs(eventMtime - lastSelfSavedMtime) < 2
      ) {
        return; // echo of our own save
      }
      if (isOpen) {
        setStatus("⚠ Source changed externally — saving will conflict.", "warn");
      } else {
        location.reload();
      }
    });
  } catch (err) {
    console.warn("source-watch SSE failed:", err);
  }
}

// ─── DOM builders ────────────────────────────────────────────────────────────
//
// The floating bottom-right button is a fallback for sidebar-less themes.
// When the active theme renders a sidebar, install() injects icons into it
// instead and never creates this floating button. See injectSidebarTools().
function createFloatingButton() {
  const btn = document.createElement("button");
  btn.className = "edit-button";
  btn.type = "button";
  btn.title = `Edit source markdown — ${shortcutLabel()}`;
  btn.setAttribute("aria-label", "Toggle source editor");
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>
    <span class="edit-button-label">Edit Source</span>
    <span class="edit-button-shortcut">${shortcutLabel()}</span>
  `;
  return btn;
}

function createPanel() {
  const el = document.createElement("aside");
  el.className = "edit-panel";
  el.setAttribute("aria-label", "Source editor");
  el.innerHTML = `
    <div class="edit-panel-resizer" role="separator" aria-orientation="vertical"
         aria-label="Resize source editor panel" tabindex="0"></div>
    <header class="edit-panel-head">
      <div class="edit-panel-title">Edit Source Markdown</div>
      <button class="edit-panel-close" type="button" data-edit-action="close" aria-label="Close editor">×</button>
    </header>
    <div class="edit-panel-status">Ready</div>
    <div class="edit-panel-editor">
      <div class="edit-panel-editor-placeholder">Loading…</div>
    </div>
    <footer class="edit-panel-foot">
      <span class="edit-panel-hint">⌘/Ctrl+S save · ⌘/Ctrl+E toggle · Esc close · ✎ icons jump from page</span>
      <div class="edit-panel-actions">
        <button class="edit-panel-btn edit-panel-btn-secondary" type="button" data-edit-action="cancel">Discard</button>
        <button class="edit-panel-btn edit-panel-btn-primary" type="button" data-edit-action="save">Save to Disk</button>
      </div>
    </footer>
  `;
  // Wire the drag handle. The handle is a child of the panel; mousedown
  // begins a drag, mousemove updates --edit-panel-width on body, mouseup
  // ends the drag and persists the chosen width.
  wireResizeHandle(el.querySelector(".edit-panel-resizer"));
  return el;
}

// ─── Resizable splitter ──────────────────────────────────────────────────────
//
// The panel width lives in the `--edit-panel-width` CSS variable on body.
// Both the panel and the doc-area's padding-right reference it, so dragging
// the handle reflows both. Width is clamped between 360px and (viewport - 200)
// to keep both panes usable, and persisted to localStorage so the chosen
// width survives reloads.
const PANEL_WIDTH_KEY = "editPanelWidthPx";
const PANEL_MIN_PX = 360;
function panelMaxPx() {
  return Math.max(PANEL_MIN_PX + 100, window.innerWidth - 200);
}

function setPanelWidth(px, persist) {
  const clamped = Math.min(panelMaxPx(), Math.max(PANEL_MIN_PX, Math.round(px)));
  document.body.style.setProperty("--edit-panel-width", `${clamped}px`);
  if (persist) {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    } catch {
      // localStorage may be disabled in some contexts
    }
  }
  return clamped;
}

function restorePanelWidth() {
  let px = null;
  try {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (stored) px = parseInt(stored, 10);
  } catch {
    // localStorage may be disabled
  }
  if (Number.isFinite(px)) setPanelWidth(px, /*persist=*/ false);
}

function wireResizeHandle(handle) {
  if (!handle) return;
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  function onMouseMove(e) {
    if (!dragging) return;
    // Distance moved LEFT = width grows. Panel sits flush right, so as the
    // cursor moves left, the panel should expand by the same amount.
    const delta = startX - e.clientX;
    setPanelWidth(startWidth + delta, /*persist=*/ false);
  }

  function onMouseUp(e) {
    if (!dragging) return;
    dragging = false;
    // Persist the final width to localStorage on mouseup
    const delta = startX - e.clientX;
    setPanelWidth(startWidth + delta, /*persist=*/ true);
    document.body.classList.remove("edit-panel-resizing");
    handle.classList.remove("edit-panel-resizer-active");
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    // Read the CURRENT computed width of the panel as the drag start width
    const panel = handle.closest(".edit-panel");
    startWidth = panel ? panel.getBoundingClientRect().width : 600;
    document.body.classList.add("edit-panel-resizing");
    handle.classList.add("edit-panel-resizer-active");
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });

  // Keyboard accessibility — Left/Right arrow when handle is focused
  // shifts the panel width by 24px, Shift+Arrow by 96px.
  handle.addEventListener("keydown", (e) => {
    const panel = handle.closest(".edit-panel");
    if (!panel) return;
    const current = panel.getBoundingClientRect().width;
    const step = e.shiftKey ? 96 : 24;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPanelWidth(current + step, true);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPanelWidth(current - step, true);
    }
  });
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
//
// Kicked off at the END of the module so every `let panel = ...`, `function
// shortcutLabel() {...}`, etc. declaration has been initialised before
// install() runs. (function declarations are hoisted, but `let`/`const` live
// in the temporal dead zone until their line — calling install() at the top
// of the file would TDZ-throw on the first `panel = createPanel()` assignment.)
if (document.documentElement.dataset.mode === "print") {
  // no-op in print mode (paged.js renders for PDF/PPTX/video capture)
} else {
  install();
}
