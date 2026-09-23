(function () {
  var root = document.querySelector(".sourcey-reader");
  if (!root) return;
  root.querySelectorAll("[data-reader-enhancement]").forEach(function (el) {
    el.hidden = false;
  });
  root.querySelectorAll("[data-reader-fallback]").forEach(function (el) {
    el.hidden = true;
  });
  var toggle = root.querySelector(".menu-toggle");
  var menu = root.querySelector("#reader-mobile-nav");
  function closeMenu() {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
  }
  toggle.addEventListener("click", function () {
    var open = toggle.getAttribute("aria-expanded") !== "true";
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  });
  window.matchMedia("(min-width: 901px)").addEventListener("change", function (event) {
    if (event.matches) closeMenu();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
      toggle.focus();
    }
    var search = root.querySelector("a.search-link");
    if (
      search &&
      event.key === "/" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.target.closest("input, textarea, select, [contenteditable]")
    ) {
      event.preventDefault();
      window.location.href = search.href;
    }
  });
  var select = root.querySelector("#chapter-select");
  select.addEventListener("change", function () {
    window.location.href = select.value;
  });
  var copy = root.querySelector("[data-copy-page]");
  if (copy)
    copy.addEventListener("click", async function () {
      var label = copy.querySelector("span");
      try {
        await navigator.clipboard.writeText(window.location.href);
        label.textContent = "Copied";
      } catch {
        label.textContent = "Copy the address bar URL";
      }
      setTimeout(function () {
        label.textContent = "Copy link";
      }, 2500);
    });
  var links = Array.from(root.querySelectorAll(".docs-toc nav a"));
  if ("IntersectionObserver" in window) {
    var observer = new window.IntersectionObserver(
      function (entries) {
        var active = entries.find(function (entry) {
          return entry.isIntersecting;
        });
        if (!active) return;
        links.forEach(function (link) {
          if (link.hash === "#" + active.target.id) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-100px 0px -65% 0px" },
    );
    root.querySelectorAll(".reader-prose h2, .reader-prose h3").forEach(function (heading) {
      observer.observe(heading);
    });
  }
})();
