// Client app: TOC scrollspy, smooth scroll, export PDF button
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

const exportBtn = document.getElementById("export-pdf");
if (exportBtn) {
  exportBtn.addEventListener("click", async () => {
    const originalLabel = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = "Rendering…";
    try {
      const theme = new URLSearchParams(location.search).get("theme") || "harness";
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
      exportBtn.textContent = "Exported ✓";
      setTimeout(() => (exportBtn.textContent = originalLabel), 1600);
    } catch (err) {
      console.error(err);
      exportBtn.textContent = "Error — retry";
      setTimeout(() => (exportBtn.textContent = originalLabel), 2200);
    } finally {
      exportBtn.disabled = false;
    }
  });
}
