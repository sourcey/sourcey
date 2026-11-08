// A reference split into pages keeps the deep links it had as one page: its overview lists each
// section, operation and model under the anchor it had there, and a reader arriving at one is
// carried to the page that holds it, at its place there when that page holds more.
function carry() {
  let fragment;
  try { fragment = decodeURIComponent(location.hash.slice(1)); }
  catch { return; }
  const found = fragment && document.getElementById(fragment);
  const entry = found && found.closest(".reference-operation-links > li[id]");
  const link = entry && entry.querySelector(":scope > a[href]");
  if (!link) return;
  const target = new URL(link.href);
  if (target.pathname === location.pathname) return;
  // An alias names the anchor it stands for; an entry within a section's row is a place on its page.
  const anchor = found.getAttribute("data-anchor") ?? found.id;
  if (anchor !== entry.id) target.hash = anchor;
  location.replace(target.href);
}
carry();
window.addEventListener("hashchange", carry);
