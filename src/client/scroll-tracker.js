// Scroll tracker — highlights the active sidebar nav link as user scrolls.
//
// Observes [data-traverse-target] section anchors and toggles .active
// on the matching #nav fragment link. All visual styling is in sourcey.css;
// this file only manages the class.
(function () {
  function init() {
    var navbar = document.getElementById('navbar');
    var navLinks = document.querySelectorAll('#nav .nav-link, #nav .nav-group-link');
    var targets = document.querySelectorAll('[data-traverse-target]');

    // For prose pages, also track heading elements that TOC links point to
    var tocHeadingEls = [];
    document.querySelectorAll('#toc .toc-item').forEach(function (link) {
      var href = link.getAttribute('href');
      if (href && href.indexOf('#') !== -1) {
        var el = document.getElementById(href.split('#')[1]);
        if (el) tocHeadingEls.push(el);
      }
    });

    if (!targets.length && !tocHeadingEls.length) return;
    if (!navLinks.length && !tocHeadingEls.length) return;

    var currentId = null;
    var clickedId = null; // When set, overrides scroll-based activation
    var clickTimer = null;

    // Map traverse-target id → nav link element (by matching href fragment)
    var linkMap = {};
    navLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      if (href && href.indexOf('#') !== -1) {
        linkMap[href.split('#')[1]] = link;
      }
    });

    // If no fragment-based nav links AND no TOC headings, nothing to track
    if (!Object.keys(linkMap).length && !tocHeadingEls.length) return;

    // TOC links (right sidebar) — share the same scroll tracking
    var tocLinks = document.querySelectorAll('#toc .toc-item');
    var tocMap = {};
    tocLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      if (href && href.indexOf('#') !== -1) {
        tocMap[href.split('#')[1]] = link;
      }
    });

    // Only manage active state on fragment-linked nav items and TOC items.
    // Doc page nav links keep their SSR-set active class untouched.
    var fragmentNavLinks = Object.values(linkMap);

    function activate(id, force) {
      if (id === currentId && !force) return;
      currentId = id;

      fragmentNavLinks.forEach(function (link) {
        link.classList.remove('active');
      });
      tocLinks.forEach(function (link) {
        link.classList.remove('active');
      });

      var active = linkMap[id];
      if (active) {
        active.classList.add('active');
        active.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }

      var tocActive = tocMap[id];
      if (tocActive) {
        tocActive.classList.add('active');
      }
    }

    // Scroll to element with header offset.
    // For the first traverse target, scroll to the very top of the page
    // so the title and all top padding are visible.
    function scrollToId(id, behavior) {
      var el = document.getElementById(id);
      if (!el) return;
      var firstTarget = targets.length ? targets[0].getAttribute('data-traverse-target') : null;
      if (id === firstTarget) {
        window.scrollTo({ top: 0, behavior: behavior });
        return;
      }
      var offset = (navbar ? navbar.offsetHeight : 0) - 1;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: behavior });
    }

    // Handle anchor clicks: activate highlight, scroll with header offset, lock scroll tracker.
    function handleAnchorClick(e, selector) {
      var link = e.target.closest(selector);
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.indexOf('#') === -1) return;
      var id = href.split('#')[1];
      if (!id) return;

      e.preventDefault();
      clickedId = id;
      activate(id, true);
      scrollToId(id, 'smooth');
      history.replaceState(null, '', '#' + id);

      clearTimeout(clickTimer);
      clickTimer = setTimeout(function () { clickedId = null; }, 800);
    }

    var tocEl = document.getElementById('toc');
    if (tocEl) tocEl.addEventListener('click', function (e) { handleAnchorClick(e, '.toc-item'); });

    var navEl = document.getElementById('nav');
    if (navEl) navEl.addEventListener('click', function (e) { handleAnchorClick(e, '.nav-link, .nav-group-link'); });

    // Use scroll event for reliable activation at all positions.
    function onScroll() {
      // If a nav link was just clicked, don't override it until scroll settles
      if (clickedId) return;

      var threshold = (navbar ? navbar.offsetHeight : 0) + 20;
      var best = null;

      // Check API traverse targets
      for (var i = 0; i < targets.length; i++) {
        var top = targets[i].getBoundingClientRect().top;
        if (top <= threshold) {
          best = targets[i].getAttribute('data-traverse-target');
        } else {
          break;
        }
      }

      // Check TOC heading elements (prose pages)
      for (var j = 0; j < tocHeadingEls.length; j++) {
        var hTop = tocHeadingEls[j].getBoundingClientRect().top;
        if (hTop <= threshold) {
          best = tocHeadingEls[j].id;
        } else {
          break;
        }
      }

      // At top of page, default to first section
      var allTargets = targets.length ? targets : tocHeadingEls;
      if (!best && allTargets.length) {
        best = targets.length
          ? allTargets[0].getAttribute('data-traverse-target')
          : allTargets[0].id;
      }

      // At bottom of page, force last section active
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 10) {
        var last = allTargets[allTargets.length - 1];
        best = targets.length ? last.getAttribute('data-traverse-target') : last.id;
      }

      if (best) activate(best);
    }

    // Throttle scroll handler
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(function () {
          onScroll();
          ticking = false;
        });
      }
    }, { passive: true });

    // Activate on initial load based on URL hash or scroll position.
    // Always use JS scroll to override the browser's native hash scroll,
    // which uses CSS scroll-margin-top and may not match the actual navbar height.
    var hash = window.location.hash.slice(1)
      || new URLSearchParams(window.location.search).get('target');
    if (hash && document.getElementById(hash)) {
      activate(hash);
      // Defer to next frame so browser's native hash scroll completes first
      requestAnimationFrame(function () { scrollToId(hash, 'instant'); });
    } else {
      onScroll();
    }

    // Handle hash changes (back/forward navigation)
    window.addEventListener('hashchange', function () {
      var id = window.location.hash.slice(1);
      if (id) {
        activate(id, true);
        scrollToId(id, 'smooth');
      }
    });
  }

  var target = window.location.hash.slice(1)
    || new URLSearchParams(window.location.search).get('target');
  if (target) {
    requestAnimationFrame(init);
  } else if ('requestIdleCallback' in window) {
    window.requestIdleCallback(init, { timeout: 250 });
  } else {
    window.addEventListener('load', init, { once: true });
  }
})();
