function tocHtml(toc) {
  if (!toc.length) return "";
  const items = toc
    .filter((h) => h.level <= 2)
    .map(
      (h) =>
        `<li class="toc-l${h.level}"><a href="#${h.id}" data-id="${h.id}">${h.text}</a></li>`
    )
    .join("\n");
  return `<ol class="toc-list">${items}</ol>`;
}

function printTocHtml(toc) {
  if (!toc.length) return "";
  let h1Index = 0;
  const items = toc
    .filter((h) => h.level <= 2)
    .map((h) => {
      const num = h.level === 1
        ? `<span class="toc-num">${String(++h1Index).padStart(2, "0")}</span>`
        : `<span class="toc-num toc-num-sub"></span>`;
      return `<li class="toc-l${h.level}"><a href="#${h.id}">${num}<span class="toc-text">${h.text}</span><span class="toc-leader"></span></a></li>`;
    })
    .join("\n");
  return `<ol class="print-toc">${items}</ol>`;
}

function themeSwitcher(themes, active) {
  if (!themes || themes.length < 2) return "";
  const opts = themes
    .map(
      (t) =>
        `<option value="${t.id}" ${t.id === active ? "selected" : ""}>${t.name}</option>`
    )
    .join("");
  return `<label class="theme-switch">
    <span class="theme-switch-label">Theme</span>
    <select id="theme-select">${opts}</select>
  </label>`;
}

export function renderShell({
  meta,
  html,
  toc,
  mode = "web",
  liveReload = false,
  theme,
  themes = [],
}) {
  const isPrint = mode === "print";
  const title = `${meta.title} · ${meta.customer || meta.author}`;
  const themeBase = `/_report/themes/${theme.id}`;

  // Modern cover — editorial, asymmetric, bold monochrome with single accent
  const coverBlock = `
    <section class="cover-page" id="cover">
      <header class="cover-head">
        <div class="cover-wordmark">
          <div class="cover-logo">
            <span class="cover-logo-dot"></span>
            <span class="cover-logo-text">${theme.brand.wordmark}</span>
          </div>
          <span class="cover-sub">${theme.brand.sub}</span>
        </div>
        <span class="cover-classification">${meta.classification || ""}</span>
      </header>

      <div class="cover-stripe" aria-hidden="true"></div>

      <div class="cover-body">
        <div class="cover-eyebrow">
          <span class="cover-kicker">${meta.docType || ""}</span>
          <span class="cover-date">${meta.date || ""}</span>
        </div>
        <h1 class="cover-title">${meta.title}</h1>
        ${meta.subtitle ? `<p class="cover-subtitle">${meta.subtitle}</p>` : ""}
      </div>

      <footer class="cover-foot">
        <div class="cover-foot-row">
          <span class="cover-foot-label">Report</span>
          <span class="cover-foot-value">${meta.customer || ""}</span>
        </div>
        <div class="cover-foot-row">
          <span class="cover-foot-label">Author</span>
          <span class="cover-foot-value">${meta.author || ""}</span>
        </div>
      </footer>

      <div class="cover-grid-decor" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span><span></span>
      </div>
    </section>
  `;

  const tocBlock = `
    <section class="page-break-before toc-page" id="table-of-contents">
      <div class="page-kicker">Contents</div>
      <h1 class="page-title">Table of Contents</h1>
      ${printTocHtml(toc)}
    </section>
  `;

  const reloadScript = liveReload
    ? `<script>
        const es = new EventSource("/_reload");
        es.onmessage = (e) => { if (e.data === "reload") location.reload(); };
      </script>`
    : "";

  const appShellStart = isPrint
    ? `<main class="print-doc">`
    : `<div class="app-shell">
         <aside class="app-sidebar" aria-label="Table of contents">
           <div class="sidebar-brand">
             <div class="sidebar-logo">
               <span class="sidebar-logo-dot"></span>
               <span class="sidebar-logo-text">${theme.brand.wordmark}</span>
             </div>
             <span class="sidebar-sub">${theme.brand.sub}</span>
           </div>

           <div class="export-menu" id="export-menu">
             <button class="btn btn-icon btn-primary" data-export="pdf" title="Export PDF" aria-label="Export PDF">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m15 15-3 3-3-3"/></svg>
               <span class="btn-label">Export PDF</span>
             </button>
             <button class="btn btn-icon" data-export="pptx" title="Export PowerPoint" aria-label="Export PowerPoint">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="12" rx="1"/><path d="M12 15v4"/><path d="M8 21h8"/><path d="m7 10 3-3 3 3 4-5"/></svg>
               <span class="btn-label">Export PowerPoint</span>
             </button>
             <button class="btn btn-icon" data-export="docx" title="Export Word" aria-label="Export Word">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>
               <span class="btn-label">Export Word</span>
             </button>
           </div>

           <div class="sidebar-meta">
             <div class="sidebar-kicker">${meta.docType || ""}</div>
             <div class="sidebar-title">${meta.title}</div>
             <div class="sidebar-sub-meta">
               <span>${meta.customer || ""}</span>
               <span>·</span>
               <span>${meta.date || ""}</span>
             </div>
           </div>

           ${themeSwitcher(themes, theme.id)}

           <nav class="sidebar-toc">${tocHtml(toc)}</nav>
         </aside>
         <main class="app-main">
           <div class="doc-container">`;

  const appShellEnd = isPrint ? `</main>` : `</div></main></div>`;

  const pagedjsBoot = isPrint
    ? `<script src="/_report/vendor/paged.polyfill.js"></script>
       <script>
         class ModernHandler extends Paged.Handler {
           constructor(chunker, polisher, caller) { super(chunker, polisher, caller); }
           afterRendered() { window.__PAGED_READY__ = true; }
         }
         Paged.registerHandlers(ModernHandler);
       </script>`
    : `<script type="module" src="${themeBase}/app.js"></script>
       <script type="module" src="/_report/public/theme-switch.js"></script>
       <script type="module" src="/_report/public/export-menu.js"></script>`;

  return `<!doctype html>
<html lang="en" data-mode="${mode}" data-theme="${theme.id}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="${theme.fonts}" />
  <link rel="stylesheet" href="${themeBase}/theme.css" />
  ${isPrint
    ? `<link rel="stylesheet" href="${themeBase}/print.css" />`
    : `<link rel="stylesheet" href="${themeBase}/web.css" />`}
</head>
<body class="mode-${mode} theme-${theme.id}">
  ${appShellStart}
    ${coverBlock}
    ${tocBlock}
    <article class="doc-body">
      ${html}
    </article>
  ${appShellEnd}
  ${pagedjsBoot}
  ${reloadScript}
</body>
</html>`;
}
