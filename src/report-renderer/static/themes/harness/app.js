// Client app: TOC scrollspy + smooth scroll. The sidebar Export menu is
// wired up by the shared /_report/public/export-menu.js module.
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
  { rootMargin: "-10% 0px -70% 0px", threshold: 0 }
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

