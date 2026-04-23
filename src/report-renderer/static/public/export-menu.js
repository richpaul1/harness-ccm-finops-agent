// Shared export UI — drives the sidebar's Export buttons across every theme.
//
// Each theme's template renders a container:
//
//   <div id="export-menu" class="export-menu">
//     <button class="btn btn-primary" data-export="pdf">Export PDF</button>
//     <button class="btn"             data-export="pptx">Export PowerPoint</button>
//     <button class="btn"             data-export="docx">Export Word</button>
//   </div>
//
// For each [data-export] button we wire a click handler that POSTs to the
// matching /reports/<id>/<format> endpoint, reads the response as a blob,
// and hands it to the browser via an <a download>. PDF and PPTX hit
// Playwright server-side and take 5–30s; DOCX is a pure-JS render and
// returns in milliseconds. While a render is in flight we disable every
// button in the menu so the user can't spam parallel jobs.

const FORMAT_META = {
  pdf: {
    endpoint: "./pdf",
    fallbackName: "report.pdf",
    busyLabel: "Rendering PDF…",
    doneLabel: "Exported ✓",
  },
  pptx: {
    endpoint: "./pptx",
    fallbackName: "slides.pptx",
    busyLabel: "Rendering PPTX…",
    doneLabel: "Exported ✓",
  },
  docx: {
    endpoint: "./docx",
    fallbackName: "report.docx",
    busyLabel: "Generating Word…",
    doneLabel: "Exported ✓",
  },
};

function currentTheme() {
  return new URLSearchParams(location.search).get("theme") || "harness";
}

/**
 * Find the label span inside a themed button, or fall back to the button
 * itself. Themes put the visible text inside different wrappers
 * (<span>, <span class="btn-label">, bare text), so we walk the first
 * element node and use it if present.
 */
function labelNode(btn) {
  return btn.querySelector("span") || btn;
}

function filenameFromResponse(res, fallback) {
  const disp = res.headers.get("Content-Disposition") || "";
  const match = disp.match(/filename="([^"]+)"/);
  return match ? match[1] : fallback;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function runExport(btn, format, menuButtons) {
  const meta = FORMAT_META[format];
  if (!meta) {
    console.warn("Unknown export format:", format);
    return;
  }
  const label = labelNode(btn);
  const original = label.textContent;

  // Disable every button in the menu while a render is in flight.
  menuButtons.forEach((b) => (b.disabled = true));
  label.textContent = meta.busyLabel;

  try {
    const res = await fetch(
      `${meta.endpoint}?theme=${encodeURIComponent(currentTheme())}`,
      { method: "POST" },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    downloadBlob(blob, filenameFromResponse(res, meta.fallbackName));
    label.textContent = meta.doneLabel;
    setTimeout(() => (label.textContent = original), 1600);
  } catch (err) {
    console.error(`Export (${format}) failed:`, err);
    label.textContent = "Error — retry";
    setTimeout(() => (label.textContent = original), 2200);
  } finally {
    menuButtons.forEach((b) => (b.disabled = false));
  }
}

const menu = document.getElementById("export-menu");
if (menu) {
  const buttons = Array.from(menu.querySelectorAll("[data-export]"));
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const format = btn.dataset.export;
      void runExport(btn, format, buttons);
    });
  });
}
