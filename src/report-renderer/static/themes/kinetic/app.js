// =============================================================
// KINETIC theme — functional motion engine
// Reading progress · scroll-reveal · kinetic typography ·
// spring number counters · sliding TOC indicator · spring button
// =============================================================

const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─── 1. Reading progress bar ──────────────────────────────────
const progressFill = document.querySelector(".reading-progress-fill");
const scrollPctEl = document.getElementById("scroll-pct");

function updateProgress() {
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const pct = docHeight > 0 ? Math.min(window.scrollY / docHeight, 1) : 0;
  if (progressFill) progressFill.style.setProperty("--progress", `${pct * 100}%`);
  if (scrollPctEl) scrollPctEl.textContent = `${Math.round(pct * 100)}%`;
}

// ─── 2. Scroll-reveal: auto-tag body elements, animate when visible ──
function setupScrollReveal() {
  // Auto-decorate body elements that should reveal
  const selectors = [
    ".doc-body > p",
    ".doc-body > h1",
    ".doc-body > h2",
    ".doc-body > h3",
    ".doc-body > ul",
    ".doc-body > ol",
    ".doc-body > table",
    ".doc-body > figure",
    ".doc-body > blockquote",
    ".doc-body > .callout",
    ".doc-body > .metric-grid",
  ];
  const els = document.querySelectorAll(selectors.join(","));
  els.forEach((el) => {
    if (!el.hasAttribute("data-reveal")) el.setAttribute("data-reveal", "fade-up");
  });

  if (prefersReduced) {
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("revealed"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
  );
  document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
}

// ─── 3. Kinetic typography: split H1/cover title into letters ──
function splitIntoLetters(el) {
  if (!el || el.dataset.split === "done") return;
  const text = el.textContent;
  el.textContent = "";
  const words = text.split(/\s+/).filter(Boolean);
  words.forEach((word, wi) => {
    const wSpan = document.createElement("span");
    wSpan.className = "kinetic-word";
    for (let i = 0; i < word.length; i++) {
      const l = document.createElement("span");
      l.className = "kinetic-letter";
      l.textContent = word[i];
      l.style.transitionDelay = `${(wi * 50 + i * 25)}ms`;
      wSpan.appendChild(l);
    }
    el.appendChild(wSpan);
    if (wi < words.length - 1) el.appendChild(document.createTextNode(" "));
  });
  el.dataset.split = "done";
}

function setupKineticHeadings() {
  // Cover title + page-title (TOC) + all body H1s
  const titles = document.querySelectorAll("[data-kinetic-title], .doc-body h1");
  titles.forEach(splitIntoLetters);

  if (prefersReduced) {
    titles.forEach((el) => el.classList.add("revealed"));
    return;
  }

  // Cover title reveals immediately on load (first impression)
  const coverTitle = document.querySelector(".cover-title");
  if (coverTitle) requestAnimationFrame(() => coverTitle.classList.add("revealed"));

  // Other H1s reveal as they enter viewport
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -15% 0px", threshold: 0.15 }
  );
  titles.forEach((el) => {
    if (!el.classList.contains("cover-title")) io.observe(el);
  });
}

// ─── 4. Spring-animated metric-card number counters ────────────
function parseNumeric(str) {
  const match = str.match(/^([^\d\-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const [, prefix, numStr, suffix] = match;
  const numeric = parseFloat(numStr.replace(/,/g, ""));
  if (isNaN(numeric)) return null;
  const hasCommas = numStr.includes(",");
  const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;
  return { prefix, numeric, suffix, hasCommas, decimals };
}

function formatNumber(n, { hasCommas, decimals }) {
  const fixed = n.toFixed(decimals);
  if (!hasCommas) return fixed;
  const [whole, dec] = fixed.split(".");
  const commaed = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${commaed}.${dec}` : commaed;
}

function animateCounter(el) {
  const original = el.textContent;
  const parsed = parseNumeric(original.trim());
  if (!parsed) return;

  const target = parsed.numeric;
  const durationMs = 1100;
  const startTime = performance.now();
  // Spring-y ease-out (custom)
  const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

  function tick(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = easeOutExpo(t);
    const current = target * eased;
    el.textContent = `${parsed.prefix}${formatNumber(current, parsed)}${parsed.suffix}`;
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = original;
  }
  requestAnimationFrame(tick);
}

function setupCounters() {
  const values = document.querySelectorAll(".metric-card .metric-value");
  if (prefersReduced) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.35 }
  );
  values.forEach((el) => io.observe(el));
}

// ─── 5. Sliding TOC indicator ──────────────────────────────────
const tocLinks = Array.from(document.querySelectorAll(".sidebar-toc a"));
const tocIndicator = document.querySelector(".toc-indicator");
const headings = tocLinks
  .map((a) => ({ a, el: document.getElementById(a.dataset.id) }))
  .filter((x) => x.el);

const sectionTotalEl = document.getElementById("section-total");
const sectionPctEl = document.getElementById("section-pct");
const h1Count = document.querySelectorAll(".doc-body h1").length;
if (sectionTotalEl) sectionTotalEl.textContent = String(h1Count).padStart(2, "0");

function moveIndicatorTo(link) {
  if (!tocIndicator || !link) return;
  const scrollerRect = tocIndicator.parentElement.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  const y = linkRect.top - scrollerRect.top + tocIndicator.parentElement.scrollTop;
  const h = linkRect.height * 0.6;
  tocIndicator.style.transform = `translateY(${y + linkRect.height * 0.2}px)`;
  tocIndicator.style.height = `${h}px`;
  tocIndicator.classList.add("visible");

  // Update section counter — which H1 are we in?
  const h1Els = Array.from(document.querySelectorAll(".doc-body h1"));
  const id = link.dataset.id;
  const h1 = document.getElementById(id);
  if (sectionPctEl) {
    let idx = h1Els.findIndex((el) => el === h1);
    if (idx === -1) {
      // fallback: find nearest H1 above
      const y = h1 ? h1.offsetTop : 0;
      idx = h1Els.findIndex((el) => el.offsetTop > y) - 1;
      if (idx < 0) idx = 0;
    }
    sectionPctEl.textContent = String(idx + 1).padStart(2, "0");
  }
}

function setActiveLink(id) {
  let active = null;
  tocLinks.forEach((link) => {
    const is = link.dataset.id === id;
    link.classList.toggle("active", is);
    if (is) active = link;
  });
  moveIndicatorTo(active);
}

function setupScrollspy() {
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.target.offsetTop - b.target.offsetTop)[0];
      if (visible) setActiveLink(visible.target.id);
    },
    { rootMargin: "-8% 0px -70% 0px", threshold: 0 }
  );
  headings.forEach(({ el }) => io.observe(el));

  tocLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const el = document.getElementById(link.dataset.id);
      if (el) {
        el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
        history.replaceState(null, "", `#${link.dataset.id}`);
        setActiveLink(link.dataset.id);
      }
    });
  });

  // Initial position
  if (headings[0]) setActiveLink(headings[0].a.dataset.id);
}

// ─── 6. Spring button physics ──────────────────────────────────
function setupSpringButtons() {
  document.querySelectorAll("[data-spring]").forEach((btn) => {
    btn.addEventListener("pointerdown", () => btn.classList.add("pressing"));
    const release = () => btn.classList.remove("pressing");
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointerleave", release);
    btn.addEventListener("pointercancel", release);
  });
}

// ─── 7. Cursor-reactive cover title ────────────────────────────
// Each letter on the cover title leans slightly toward the cursor
function setupCoverCursor() {
  if (prefersReduced) return;
  const cover = document.querySelector(".cover-page");
  const title = document.querySelector(".cover-title");
  if (!cover || !title) return;

  let letters = [];
  let coverRect = null;
  const refresh = () => {
    letters = Array.from(title.querySelectorAll(".kinetic-letter"));
    coverRect = cover.getBoundingClientRect();
  };
  refresh();

  let targetX = 0, targetY = 0;
  let currentX = 0, currentY = 0;

  cover.addEventListener("pointermove", (e) => {
    if (!coverRect) refresh();
    targetX = (e.clientX - coverRect.left - coverRect.width / 2) / coverRect.width;
    targetY = (e.clientY - coverRect.top - coverRect.height / 2) / coverRect.height;
  });
  cover.addEventListener("pointerleave", () => { targetX = 0; targetY = 0; });
  window.addEventListener("resize", refresh);
  window.addEventListener("scroll", refresh, { passive: true });

  function loop() {
    currentX += (targetX - currentX) * 0.08;
    currentY += (targetY - currentY) * 0.08;

    letters.forEach((l, i) => {
      const depth = ((i % 7) + 2) * 0.7; // distinct depth per letter
      const tx = currentX * depth;
      const ty = currentY * depth;
      l.style.transform = l.classList.contains("revealed-settled")
        ? `translate(${tx}px, ${ty}px)`
        : "";
    });
    requestAnimationFrame(loop);
  }

  // After reveal transition finishes, lock in settled state so the cursor tracking takes over
  setTimeout(() => {
    letters.forEach((l) => l.classList.add("revealed-settled"));
    requestAnimationFrame(loop);
  }, 1400);
}

// PDF/PPTX/DOCX export wiring now lives in the shared
// /_report/public/export-menu.js module loaded from template.js.

// ─── Boot ──────────────────────────────────────────────────────
window.addEventListener("scroll", updateProgress, { passive: true });
window.addEventListener("resize", updateProgress);
updateProgress();

setupKineticHeadings();
setupScrollReveal();
setupCounters();
setupScrollspy();
setupSpringButtons();
setupCoverCursor();
