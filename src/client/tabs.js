// Code sample language dropdown + response code tabs + copy button.
//
// Handles three interaction patterns:
// 1. Language dropdown — toggles .code-lang-menu, switches .code-lang-panel
// 2. Response tabs — switches .response-tab active state + .response-panel
// 3. Copy button — copies code from the active panel to clipboard
(function () {
  function init() {
    var selectedLang = null;

    // ── Language Dropdown ──────────────────────────────────────────────

    // Toggle dropdown open/close
    document.addEventListener("click", function (e) {
      var trigger = e.target.closest(".code-lang-trigger");

      // Close all open dropdowns first
      document.querySelectorAll(".code-lang-menu").forEach(function (menu) {
        if (!trigger || !menu.parentElement.contains(trigger)) {
          closeMenu(menu);
          var btn = menu.parentElement.querySelector(".code-lang-trigger");
          if (btn) btn.setAttribute("aria-expanded", "false");
        }
      });

      if (!trigger) return;
      e.stopPropagation();

      var menu = trigger.nextElementSibling;
      if (!menu) return;

      var isOpen = !menu.classList.contains("hidden");
      if (isOpen) {
        closeMenu(menu);
      } else {
        menu.classList.remove("hidden");
        positionMenu(trigger, menu);
      }
      trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
    });

    // Select a language / example variant from the dropdown
    document.addEventListener("click", function (e) {
      var option = e.target.closest(".code-lang-option");
      if (!option) return;

      var dropdown = option.closest(".code-lang-dropdown");
      var canSync = !!(dropdown && dropdown.hasAttribute("data-lang-sync"));
      var lang = option.textContent.trim();

      // Close the menu
      var menu = option.closest(".code-lang-menu");
      if (menu) {
        closeMenu(menu);
        var trigger = menu.parentElement.querySelector(".code-lang-trigger");
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      }

      var scrollY = window.scrollY;
      activateLang(option);

      // Sync language across code-sample groups only (not example variants).
      if (canSync && lang !== selectedLang) {
        selectedLang = lang;
        var ownGroup = option.closest(".code-group");
        document.querySelectorAll(".code-group").forEach(function (group) {
          if (group === ownGroup || !group.querySelector(".code-lang-dropdown[data-lang-sync]"))
            return;
          group.querySelectorAll(".code-lang-option").forEach(function (opt) {
            if (opt.textContent.trim() === lang) activateLang(opt);
          });
        });
      }

      window.scrollTo(0, scrollY);
    });

    function closeMenu(menu) {
      menu.classList.add("hidden");
      menu.style.position = "";
      menu.style.top = "";
      menu.style.right = "";
      menu.style.bottom = "";
      menu.style.maxHeight = "";
    }

    function positionMenu(trigger, menu) {
      var rect = trigger.getBoundingClientRect();
      var gap = 4;
      var viewportPadding = 8;
      var below = window.innerHeight - rect.bottom - viewportPadding;
      var above = rect.top - viewportPadding;
      var openUp = below < 160 && above > below;

      menu.style.position = "fixed";
      menu.style.right = Math.max(viewportPadding, window.innerWidth - rect.right) + "px";
      menu.style.maxHeight = Math.max(96, Math.floor((openUp ? above : below) - gap)) + "px";

      if (openUp) {
        menu.style.top = "";
        menu.style.bottom = Math.max(viewportPadding, window.innerHeight - rect.top + gap) + "px";
      } else {
        menu.style.bottom = "";
        menu.style.top = Math.min(window.innerHeight - viewportPadding, rect.bottom + gap) + "px";
      }
    }

    // The panels a dropdown controls. A header variant dropdown (in the shared
    // card header) drives the matching response status panel; otherwise panels
    // live in the dropdown's own `.code-lang-scope` or `.code-group`.
    function panelScopeForOption(option) {
      var headerWrap = option.closest("[data-response-dropdown]");
      if (headerWrap) {
        var idx = headerWrap.getAttribute("data-response-dropdown");
        var group = headerWrap.closest(".code-group");
        var panel =
          group && group.querySelector('.response-panel[data-response-panel="' + idx + '"]');
        if (panel) return panel;
      }
      return option.closest(".code-lang-scope") || option.closest(".code-group");
    }

    function activateLang(option) {
      var dropdown = option.closest(".code-lang-dropdown");
      var scope = panelScopeForOption(option);
      var index = option.getAttribute("data-lang-index");

      // Update the dropdown label + options (label/trigger live in the dropdown,
      // which for a header variant switcher is separate from the panel scope).
      if (dropdown) {
        var label = dropdown.querySelector(".code-lang-label");
        dropdown.querySelectorAll(".code-lang-option").forEach(function (opt) {
          var isActive = opt.getAttribute("data-lang-index") === index;
          opt.setAttribute("aria-selected", isActive ? "true" : "false");
          opt.className = opt.className.replace(/(dark:)?text-\[rgb\([^\]]+\)\]/g, "").trim();
          if (isActive) {
            opt.classList.add(
              "text-[rgb(var(--color-primary))]",
              "dark:text-[rgb(var(--color-primary-light))]",
            );
            if (label) label.textContent = opt.textContent.trim();
            var triggerIcon = dropdown.querySelector(".code-lang-trigger .code-lang-icon");
            var optIcon = opt.querySelector(".lang-icon");
            if (triggerIcon && optIcon) triggerIcon.innerHTML = optIcon.outerHTML;
          } else {
            opt.classList.add(
              "text-[rgb(var(--color-stone-600))]",
              "dark:text-[rgb(var(--color-stone-400))]",
            );
          }
        });
      }

      // Update panels within the controlled scope.
      if (scope) {
        scope.querySelectorAll(".code-lang-panel").forEach(function (p) {
          p.classList.toggle("active", p.getAttribute("data-lang-panel") === index);
        });
      }
    }

    // ── Response Tabs ──────────────────────────────────────────────────

    document.addEventListener("click", function (e) {
      var tab = e.target.closest(".response-tab");
      if (!tab) return;

      var container = tab.closest(".response-tabs");
      var index = tab.getAttribute("data-response-index");
      var scrollY = window.scrollY;

      // Update tabs
      container.querySelectorAll(".response-tab").forEach(function (t) {
        var isActive = t.getAttribute("data-response-index") === index;
        t.classList.toggle("active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
      });

      // Update panels
      container.querySelectorAll(".response-panel").forEach(function (p) {
        p.classList.toggle("active", p.getAttribute("data-response-panel") === index);
      });

      // Show only the active status's variant switcher in the header.
      container.querySelectorAll("[data-response-dropdown]").forEach(function (d) {
        d.classList.toggle("hidden", d.getAttribute("data-response-dropdown") !== index);
      });

      window.scrollTo(0, scrollY);
    });

    // ── Copy Button ────────────────────────────────────────────────────

    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".copy-btn");
      if (!btn) return;

      var container = btn.closest(".code-group") || btn.closest(".prose-code-block");
      if (!container) return;

      // Find the active panel's code, or the nearest code element. With nested
      // panels (a variant switcher inside a response tab), prefer the deepest
      // active panel, which is last in document order.
      var activePanels = container.querySelectorAll(
        ".code-lang-panel.active, .response-panel.active",
      );
      var activePanel = activePanels.length ? activePanels[activePanels.length - 1] : null;
      var codeEl = activePanel
        ? activePanel.querySelector("code, .code-block, .font-mono")
        : container.querySelector("code, .code-block, .font-mono");

      if (!codeEl) return;

      var text = codeEl.textContent || "";
      navigator.clipboard.writeText(text).then(function () {
        btn.classList.add("copied");
        var tooltip = btn.nextElementSibling;
        if (tooltip && tooltip.classList.contains("copy-tooltip")) {
          tooltip.textContent = "Copied!";
        }
        setTimeout(function () {
          btn.classList.remove("copied");
          if (tooltip && tooltip.classList.contains("copy-tooltip")) {
            tooltip.textContent = "Copy";
          }
        }, 2000);
      });
    });

    // ── Rust Doctest Hidden-Line Toggle ──────────────────────────────
    // (Copy is handled by the shared .copy-btn inside each code block.)

    document.addEventListener("click", function (e) {
      var toggleBtn = e.target.closest(".rust-doctest-toggle-hidden");
      if (!toggleBtn) return;
      var fullSel = toggleBtn.getAttribute("data-target");
      var displaySel = toggleBtn.getAttribute("data-display");
      var fullEl = fullSel ? document.getElementById(fullSel.replace(/^#/, "")) : null;
      var displayEl = displaySel ? document.getElementById(displaySel.replace(/^#/, "")) : null;
      if (!fullEl || !displayEl) return;
      var fullHidden = fullEl.hasAttribute("hidden");
      if (fullHidden) {
        fullEl.removeAttribute("hidden");
        displayEl.setAttribute("hidden", "");
        toggleBtn.textContent = "Hide hidden lines";
      } else {
        fullEl.setAttribute("hidden", "");
        displayEl.removeAttribute("hidden");
        toggleBtn.textContent = "Show hidden lines";
      }
    });

    // Close dropdowns on Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        document.querySelectorAll(".code-lang-menu").forEach(function (menu) {
          menu.classList.add("hidden");
          var btn = menu.parentElement.querySelector(".code-lang-trigger");
          if (btn) btn.setAttribute("aria-expanded", "false");
        });
      }
    });

    // ── Directive Tabs (:::tabs and :::code-group) ────────────────────

    document.addEventListener("click", function (e) {
      var tab = e.target.closest(".directive-tab");
      if (!tab) return;

      var group = tab.getAttribute("data-tab-group");
      var index = tab.getAttribute("data-tab-index");
      var scrollY = window.scrollY;

      // Update tab buttons
      document
        .querySelectorAll('.directive-tab[data-tab-group="' + group + '"]')
        .forEach(function (t) {
          t.classList.toggle("active", t.getAttribute("data-tab-index") === index);
        });

      // Update panels
      document
        .querySelectorAll('.directive-tab-panel[data-tab-group="' + group + '"]')
        .forEach(function (p) {
          p.classList.toggle("active", p.getAttribute("data-tab-index") === index);
        });

      window.scrollTo(0, scrollY);
    });
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(init, { timeout: 250 });
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
