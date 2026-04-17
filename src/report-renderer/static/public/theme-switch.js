const select = document.getElementById("theme-select");
if (select) {
  select.addEventListener("change", () => {
    const url = new URL(location.href);
    url.searchParams.set("theme", select.value);
    location.href = url.toString();
  });
}
