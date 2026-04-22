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
      const num =
        h.level === 1
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

  // Cover — oversized display type, kinetic cursor response on title
  const coverBlock = `
    <section class="cover-page" id="cover">
      <header class="cover-head">
        <div class="cover-brand">
          <div class="brand-row">
            <span class="brand-index">${theme.brand.wordmark}</span>
            <span class="brand-sep" aria-hidden="true"></span>
            <span class="brand-sub">${theme.brand.sub}</span>
          </div>
        </div>
        <span class="cover-classification">
          <span class="cover-dot" aria-hidden="true"></span>
          ${meta.classification || ""}
        </span>
      </header>

      <div class="cover-meta-topline">
        <span class="meta-tag">${meta.docType || ""}</span>
        <span class="meta-tag meta-tag-date">${meta.date || ""}</span>
      </div>

      <div class="cover-main">
        <h1 class="cover-title" data-kinetic-title>${meta.title}</h1>
        ${meta.subtitle ? `<p class="cover-subtitle" data-reveal="fade-up">${meta.subtitle}</p>` : ""}
      </div>

      <footer class="cover-foot" data-reveal="fade-up">
        <div class="cover-foot-cell">
          <span class="foot-label">Customer</span>
          <span class="foot-value">${meta.customer || ""}</span>
        </div>
        <div class="cover-foot-cell">
          <span class="foot-label">Prepared by</span>
          <span class="foot-value">${meta.author || ""}</span>
        </div>
        <div class="cover-foot-cell cover-scroll-hint">
          <span class="foot-label">Scroll</span>
          <span class="scroll-indicator" aria-hidden="true">
            <span class="scroll-indicator-line"></span>
          </span>
        </div>
      </footer>

      <div class="cover-grid-overlay" aria-hidden="true"></div>
    </section>
  `;

  const tocBlock = `
    <section class="page-break-before toc-page" id="table-of-contents">
      <div class="page-kicker">§ Contents</div>
      <h1 class="page-title" data-kinetic-title>Table of Contents</h1>
      ${printTocHtml(toc)}
    </section>
  `;

  const reloadScript = liveReload
    ? `<script>
        const es = new EventSource("/_reload");
        es.onmessage = (e) => { if (e.data === "reload") location.reload(); };
      </script>`
    : "";

  // Web shell — progress bar + sidebar with sliding indicator
  const appShellStart = isPrint
    ? `<main class="print-doc">`
    : `<div class="reading-progress" aria-hidden="true"><span class="reading-progress-fill"></span></div>
       <div class="app-shell">
         <aside class="app-sidebar" aria-label="Table of contents">
           <div class="sidebar-brand">
             <span class="sidebar-tag">INDEX</span>
             <div class="sidebar-title">
               <span>${theme.brand.wordmark}</span>
               <span class="sidebar-sub">${theme.brand.sub}</span>
             </div>
           </div>

           <div class="export-menu" id="export-menu">
             <button class="btn btn-icon btn-primary" data-export="pdf" data-spring title="Export PDF" aria-label="Export PDF">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m15 15-3 3-3-3"/></svg>
               <span class="btn-label">Export PDF</span>
             </button>
             <button class="btn btn-icon" data-export="pptx" data-spring title="Export PowerPoint" aria-label="Export PowerPoint">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="12" rx="1"/><path d="M12 15v4"/><path d="M8 21h8"/><path d="m7 10 3-3 3 3 4-5"/></svg>
               <span class="btn-label">Export PowerPoint</span>
             </button>
             <button class="btn btn-icon" data-export="docx" data-spring title="Export Word" aria-label="Export Word">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>
               <span class="btn-label">Export Word</span>
             </button>
           </div>

           <div class="sidebar-meta">
             <div class="meta-label">Document</div>
             <div class="meta-title">${meta.title}</div>
             <div class="meta-sub">
               <span>${meta.customer || ""}</span>
               <span class="meta-sub-sep">/</span>
               <span>${meta.date || ""}</span>
             </div>
           </div>

           ${themeSwitcher(themes, theme.id)}

           <nav class="sidebar-toc" aria-label="Sections">
             <div class="toc-indicator" aria-hidden="true"></div>
             ${tocHtml(toc)}
           </nav>

           <div class="sidebar-foot">
             <span class="foot-stat"><span class="foot-stat-value" id="scroll-pct">0%</span> read</span>
             <span class="foot-stat"><span class="foot-stat-value" id="section-pct">01</span>/<span id="section-total">—</span></span>
           </div>
         </aside>
         <main class="app-main">
           <div class="doc-container">`;

  const appShellEnd = isPrint ? `</main>` : `</div></main></div>`;

  const pagedjsBoot = isPrint
    ? `<script src="/_report/vendor/paged.polyfill.js"></script>
       <script>
         class KineticHandler extends Paged.Handler {
           constructor(chunker, polisher, caller) { super(chunker, polisher, caller); }
           afterRendered() { window.__PAGED_READY__ = true; }
         }
         Paged.registerHandlers(KineticHandler);
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
