// Native links remain useful without JavaScript. Retain the current section
// only when it is this page's and the compiled destination does not lack it.
function retainSection(event) {
  const link = event.target instanceof Element && event.target.closest("[data-sourcey-context-missing]");
  if (!link) return;
  let fragment;
  try { fragment = decodeURIComponent(location.hash.slice(1)); }
  catch { fragment = ""; }
  const kept = fragment && document.getElementById(fragment) && !JSON.parse(link.getAttribute("data-sourcey-context-missing")).includes(fragment);
  link.hash = kept ? location.hash : "";
}
document.addEventListener("click", retainSection);
document.addEventListener("auxclick", retainSection);

document.addEventListener("pointerdown", event => {
  for (const menu of document.querySelectorAll(".sourcey-context-menu[open]")) {
    if (event.target instanceof Element && !menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const menu = document.querySelector(".sourcey-context-menu[open]");
  if (!menu) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
  event.preventDefault();
});
