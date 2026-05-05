/**
 * Acme theme — browser-side behaviour.
 * Scroll-spy for the TOC, active-link highlighting.
 */

// ── TOC scroll-spy ────────────────────────────────────────────────────────────
const tocLinks = /** @type {NodeListOf<HTMLAnchorElement>} */ (
  document.querySelectorAll(".toc-list li a[data-id]")
);

if (tocLinks.length > 0) {
  const headingIds = Array.from(tocLinks).map((a) => a.dataset.id).filter(Boolean);
  const headings = headingIds
    .map((id) => document.getElementById(/** @type {string} */ (id)))
    .filter(Boolean);

  const markActive = (id) => {
    tocLinks.forEach((a) => {
      a.classList.toggle("active", a.dataset.id === id);
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          markActive(entry.target.id);
          return;
        }
      }
    },
    { rootMargin: "-10% 0px -80% 0px" }
  );

  headings.forEach((el) => observer.observe(/** @type {Element} */ (el)));
}
