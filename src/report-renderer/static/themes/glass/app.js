// Glass theme client — scrollspy, scroll-adaptive atmosphere, PDF export

// ─── Scroll-adaptive atmosphere ───────────────────────────────
// As the user scrolls, the four atmospheric orbs gently parallax.
// The sidebar's glass intensity + saturation strengthens with depth.
const atmo = Array.from(document.querySelectorAll(".atmosphere > .atmo"));
const root = document.documentElement;
const sidebar = document.querySelector(".app-sidebar");

let targetY = 0;
let currentY = 0;
let ticking = false;

// Parallax factors per orb — slightly different speeds create depth
const factors = [0.18, -0.26, 0.14, -0.32];

function onScroll() {
  targetY = window.scrollY;
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(tick);
  }
}

function tick() {
  // Ease current toward target for buttery motion
  currentY += (targetY - currentY) * 0.12;

  atmo.forEach((el, i) => {
    const offset = currentY * (factors[i] || 0.1);
    el.style.setProperty("--atmo-y", String(offset.toFixed(2)));
    el.style.setProperty("--atmo-x", String((offset * 0.4).toFixed(2)));
  });

  // scroll-depth 0..1 over the first viewport of scroll — sidebar intensifies
  const depth = Math.min(currentY / (window.innerHeight * 0.8), 1);
  root.style.setProperty("--scroll-depth", depth.toFixed(3));

  if (Math.abs(targetY - currentY) > 0.4) {
    requestAnimationFrame(tick);
  } else {
    currentY = targetY;
    ticking = false;
  }
}

window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ─── Cursor-aware refraction on the cover ─────────────────────
// Subtle: the cover-card's highlight catches the "light" of the cursor.
const coverCard = document.querySelector(".cover-card");
if (coverCard) {
  coverCard.addEventListener("pointermove", (e) => {
    const rect = coverCard.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    coverCard.style.setProperty("--cursor-x", `${x}%`);
    coverCard.style.setProperty("--cursor-y", `${y}%`);
  });
  coverCard.addEventListener("pointerleave", () => {
    coverCard.style.removeProperty("--cursor-x");
    coverCard.style.removeProperty("--cursor-y");
  });
}

// ─── Scrollspy for the sidebar TOC ────────────────────────────
const tocLinks = Array.from(document.querySelectorAll(".sidebar-toc a"));
const headings = tocLinks
  .map((a) => ({ a, el: document.getElementById(a.dataset.id) }))
  .filter((x) => x.el);

function setActive(id) {
  tocLinks.forEach((link) =>
    link.classList.toggle("active", link.dataset.id === id)
  );
}

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.target.offsetTop - b.target.offsetTop)[0];
    if (visible) setActive(visible.target.id);
  },
  { rootMargin: "-8% 0px -72% 0px", threshold: 0 }
);
headings.forEach(({ el }) => observer.observe(el));

tocLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const el = document.getElementById(link.dataset.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${link.dataset.id}`);
      setActive(link.dataset.id);
    }
  });
});

// ─── PDF export ────────────────────────────────────────────────
const exportBtn = document.getElementById("export-pdf");
if (exportBtn) {
  const label = exportBtn.querySelector("span");
  exportBtn.addEventListener("click", async () => {
    const theme = new URLSearchParams(location.search).get("theme") || "glass";
    const orig = label?.textContent ?? exportBtn.textContent;
    exportBtn.disabled = true;
    if (label) label.textContent = "Rendering…";
    try {
      const res = await fetch(`/pdf?theme=${encodeURIComponent(theme)}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disp = res.headers.get("Content-Disposition") || "";
      const nameMatch = disp.match(/filename="([^"]+)"/);
      a.href = url;
      a.download = nameMatch ? nameMatch[1] : "report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (label) label.textContent = "Exported";
      setTimeout(() => { if (label) label.textContent = orig; }, 1600);
    } catch (err) {
      console.error(err);
      if (label) label.textContent = "Error";
      setTimeout(() => { if (label) label.textContent = orig; }, 2000);
    } finally {
      exportBtn.disabled = false;
    }
  });
}
