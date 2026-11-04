// Mobile navigation drawer using native <dialog>.
import { deferEnhancement } from "./ready.js";
//
// Opens as a modal dialog with backdrop. Closes on:
// backdrop click, nav link click, Escape (native dialog behavior).
// Dropdown toggles list visibility for tab selection.
(function () {
  function storageGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Ignore blocked storage. Sidebar navigation still works normally.
    }
  }

  function storageRemove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore blocked storage. Sidebar navigation still works normally.
    }
  }

  function normalizePath(pathname) {
    var clean = (pathname || '/').replace(/\/+$/, '') || '/';
    clean = clean.replace(/\/index(?:\.html)?$/, '') || '/';
    clean = clean.replace(/\.html$/, '');
    return clean || '/';
  }

  function commonPath(paths) {
    if (!paths.length) return null;
    var parts = paths.map(function (path) {
      return normalizePath(path).split('/').filter(Boolean);
    });
    var common = [];

    for (var i = 0; i < parts[0].length; i++) {
      var part = parts[0][i];
      var allMatch = parts.every(function (segments) {
        return segments[i] === part;
      });
      if (!allMatch) break;
      common.push(part);
    }

    return '/' + common.join('/');
  }

  function navScope(nav) {
    var paths = [];
    nav.querySelectorAll('a.nav-link[href]').forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      try {
        var url = new URL(href, window.location.href);
        if (url.origin === window.location.origin) {
          paths.push(url.pathname);
        }
      } catch {
        // Ignore malformed hrefs.
      }
    });

    return commonPath(paths);
  }

  // The site's root, which every page names as the base of its assets.
  function siteScope() {
    var meta = document.querySelector('meta[name="sourcey-assets"]');
    var content = meta && meta.getAttribute('content');
    if (!content) return null;

    try {
      var url = new URL(content, window.location.href);
      if (url.origin === window.location.origin) return normalizePath(url.pathname);
    } catch {
      // Ignore malformed metadata.
    }

    return null;
  }

  function sidebarStorageKey(scroller, nav) {
    var tab = scroller.getAttribute('data-sourcey-sidebar-tab') || 'default';
    var scope = navScope(nav) || siteScope() || normalizePath(window.location.pathname);
    return 'sourcey:sidebar-scroll:v1:' + window.location.origin + scope + ':' + tab;
  }

  function clampSidebarScroll(scroller, top) {
    var max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return Math.max(0, Math.min(top, max));
  }

  function saveSidebarScroll(scroller, key) {
    storageSet(key, String(Math.round(scroller.scrollTop || 0)));
  }

  function restoreSidebarScroll(scroller, key) {
    var raw = storageGet(key);
    if (raw === null) return false;
    storageRemove(key);

    var top = Number(raw);
    if (!Number.isFinite(top) || top <= 0) return false;

    function apply() {
      scroller.scrollTop = clampSidebarScroll(scroller, top);
    }

    apply();
    requestAnimationFrame(apply);
    return true;
  }

  function revealActiveSidebarLink(nav) {
    var active = nav.querySelector('.nav-link.active');
    if (!active) return;
    requestAnimationFrame(function () {
      active.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }

  function shouldSaveForNavigation(e, link) {
    if (!link || e.defaultPrevented) return false;
    if (e.button !== undefined && e.button !== 0) return false;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    if (link.hasAttribute('download')) return false;

    var target = link.getAttribute('target');
    if (target && target.toLowerCase() !== '_self') return false;

    var href = link.getAttribute('href');
    if (!href || href.startsWith('#')) return false;

    try {
      var url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return false;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
        return false;
      }
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function initDesktopSidebarScroll() {
    var scroller = document.querySelector('[data-sourcey-sidebar-scroll]');
    var nav = document.getElementById('nav');
    if (!scroller || !nav) return;

    var key = sidebarStorageKey(scroller, nav);
    var restored = restoreSidebarScroll(scroller, key);
    if (!restored) revealActiveSidebarLink(nav);

    nav.addEventListener('click', function (e) {
      var link = e.target.closest('a[href]');
      if (shouldSaveForNavigation(e, link)) {
        saveSidebarScroll(scroller, key);
      }
    });
  }

  function init() {
    initDesktopSidebarScroll();

    var dialog = document.getElementById('mobile-nav');
    var openBtns = document.querySelectorAll('[data-drawer-slide]');
    if (!dialog) return;

    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (event) {
      if (event.matches && dialog.open) dialog.close();
    });

    openBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        dialog.showModal();
      });
    });

    // Close on backdrop click (click on dialog element itself, not its children)
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });

    // Close on nav link or close button click
    dialog.addEventListener('click', function (e) {
      if (e.target.closest('a') || e.target.closest('[data-close-drawer]')) dialog.close();
    });

    // Dropdown: toggle list visibility
    var toggle = document.getElementById('drawer-group-toggle');
    var list = document.getElementById('drawer-group-list');
    if (!toggle || !list) return;

    function closeDropdown() {
      list.style.display = 'none';
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function () {
      var open = list.style.display !== 'none';
      if (open) {
        closeDropdown();
      } else {
        list.style.display = '';
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    // Close dropdown when clicking outside it
    dialog.addEventListener('click', function (e) {
      if (list.style.display !== 'none' && !e.target.closest('.drawer-dropdown')) {
        closeDropdown();
      }
    });
  }

  deferEnhancement(init);
})();
