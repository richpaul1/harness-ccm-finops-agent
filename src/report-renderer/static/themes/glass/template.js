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

// A living atmospheric background layer — rendered in both web and print
// but only the web version animates + responds to scroll.
function atmosphereLayer() {
  return `<div class="atmosphere" aria-hidden="true">
    <div class="atmo atmo-1"></div>
    <div class="atmo atmo-2"></div>
    <div class="atmo atmo-3"></div>
    <div class="atmo atmo-4"></div>
    <div class="atmo-noise"></div>
  </div>`;
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

  // Cover page — floating glass title card over full atmospheric bloom
  const coverBlock = `
    <section class="cover-page" id="cover">
      <div class="cover-atmosphere" aria-hidden="true">
        <div class="atmo atmo-1"></div>
        <div class="atmo atmo-2"></div>
        <div class="atmo atmo-3"></div>
        <div class="atmo atmo-4"></div>
        <div class="atmo-noise"></div>
      </div>
      <header class="cover-head">
        <div class="cover-brand">
          <div class="cover-logo">
            <span class="cover-orb"></span>
            <span class="cover-logo-text">${theme.brand.wordmark}</span>
          </div>
          <span class="cover-brand-sub">${theme.brand.sub}</span>
        </div>
        <span class="cover-classification">${meta.classification || ""}</span>
      </header>

      <div class="cover-card glass">
        <div class="cover-eyebrow">${meta.docType || ""}</div>
        <h1 class="cover-title">${meta.title}</h1>
        ${meta.subtitle ? `<p class="cover-subtitle">${meta.subtitle}</p>` : ""}
        <div class="cover-meta-grid">
          <div class="cover-meta-cell">
            <span class="cover-meta-label">Prepared for</span>
            <span class="cover-meta-value">${meta.customer || ""}</span>
          </div>
          <div class="cover-meta-cell">
            <span class="cover-meta-label">Date</span>
            <span class="cover-meta-value">${meta.date || ""}</span>
          </div>
          <div class="cover-meta-cell">
            <span class="cover-meta-label">Author</span>
            <span class="cover-meta-value">${meta.author || ""}</span>
          </div>
        </div>
      </div>
    </section>
  `;

  const tocBlock = `
    <section class="page-break-before toc-page" id="table-of-contents">
      <div class="page-kicker">Contents</div>
      <h1 class="page-title">Table of Contents</h1>
      <div class="print-toc-wrap glass">
        ${printTocHtml(toc)}
      </div>
    </section>
  `;

  const reloadScript = liveReload
    ? `<script>
        const es = new EventSource("/_reload");
        es.onmessage = (e) => { if (e.data === "reload") location.reload(); };
      </script>`
    : "";

  const appShellStart = isPrint
    ? `<main class="print-doc">${atmosphereLayer()}`
    : `${atmosphereLayer()}
       <div class="app-shell">
         <aside class="app-sidebar glass" aria-label="Table of contents">
           <div class="sidebar-brand">
             <span class="sidebar-orb"></span>
             <div class="sidebar-brand-text">
               <span class="sidebar-name">${theme.brand.wordmark}</span>
               <span class="sidebar-sub">${theme.brand.sub}</span>
             </div>
           </div>

           <button class="btn btn-primary glass" id="export-pdf">
             <span>Export PDF</span>
             <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v9m0 0L3 6m4 4l4-4M1 13h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
           </button>

           <div class="sidebar-meta">
             <div class="sidebar-kicker">${meta.docType || ""}</div>
             <div class="sidebar-title">${meta.title}</div>
             <div class="sidebar-sub-meta">${meta.customer || ""} · ${meta.date || ""}</div>
           </div>

           ${themeSwitcher(themes, theme.id)}

           <nav class="sidebar-toc">${tocHtml(toc)}</nav>
         </aside>
         <main class="app-main">
           <div class="doc-container glass">`;

  const appShellEnd = isPrint ? `</main>` : `</div></main></div>`;

  const pagedjsBoot = isPrint
    ? `<script src="/_report/vendor/paged.polyfill.js"></script>
       <script>
         class GlassHandler extends Paged.Handler {
           constructor(chunker, polisher, caller) { super(chunker, polisher, caller); }
           afterRendered() { window.__PAGED_READY__ = true; }
         }
         Paged.registerHandlers(GlassHandler);
       </script>`
    : `<script type="module" src="${themeBase}/app.js"></script>
       <script type="module" src="/_report/public/theme-switch.js"></script>`;

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
