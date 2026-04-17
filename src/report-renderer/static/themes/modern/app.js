// Shared client behaviour for the Modern theme.
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

const exportBtn = document.getElementById("export-pdf");
if (exportBtn) {
  const label = exportBtn.querySelector("span");
  exportBtn.addEventListener("click", async () => {
    const theme = new URLSearchParams(location.search).get("theme") || "modern";
    const orig = label?.textContent ?? exportBtn.textContent;
    exportBtn.disabled = true;
    if (label) label.textContent = "Rendering…";
    try {
      const res = await fetch(`./pdf?theme=${encodeURIComponent(theme)}`, {
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
      setTimeout(() => {
        if (label) label.textContent = orig;
      }, 1600);
    } catch (err) {
      console.error(err);
      if (label) label.textContent = "Error";
      setTimeout(() => {
        if (label) label.textContent = orig;
      }, 2000);
    } finally {
      exportBtn.disabled = false;
    }
  });
}
