// Search — client-side search dialog with keyboard navigation
(function () {
  function init() {
    var dialog = document.getElementById("search-dialog");
    var input = document.getElementById("search-input");
    var results = document.getElementById("search-results");
    var openBtn = document.getElementById("search-open");
    if (!dialog || !input || !results) return;

    var entries = [];
    var activeIndex = -1;
    var filtered = [];
    // Results arrive a batch at a time: the next is read as the list nears its end.
    var hasMore = false;
    var loadingMore = null;
    var indexLoaded = false;
    var returnFocus;

    var engine;
    var loading;
    var querySequence = 0;
    var queryTimer;
    var assets;
    function searchAssets(page) {
      var module = page.querySelector('meta[name="sourcey-search-module"]');
      var indexes = page.querySelector('meta[name="sourcey-search-indexes"]');
      if (!module || !indexes) throw new Error("This page names no search assets");
      return { module: new URL(module.content, location.href).href, indexes: JSON.parse(indexes.content) };
    }
    function startSearch(named) {
      return import(/* @vite-ignore */ named.module).then(function (module) { return module.loadSearch(named.indexes); });
    }
    // A page left open across a deploy names search assets the new build
    // replaced: read the names the page carries now, once, and start again.
    function currentAssets() {
      return fetch(location.href, { cache: "no-store" })
        .then(function (response) { if (!response.ok) throw new Error(response.statusText); return response.text(); })
        .then(function (html) { return searchAssets(new DOMParser().parseFromString(html, "text/html")); });
    }
    function loadJsonIndex(callback) {
      if (indexLoaded) { callback(); return; }
      if (!loading) {
        loading = Promise.resolve()
          .then(function () { return startSearch(assets || (assets = searchAssets(document))); })
          .catch(function () {
            return currentAssets().then(function (current) { return startSearch(current).then(function (loaded) { assets = current; return loaded; }); });
          })
          .then(function (loaded) {
            engine = loaded;
            entries = loaded.rows.map(shown);
            indexLoaded = true;
          }).finally(function () { loading = null; });
      }
      loading.then(callback).catch(showFailure);
    }

    /** One line in place of results: loading, nothing found, or a failure with its way out. */
    function showStatus(text, action) {
      var status = document.createElement("p");
      status.className = "search-status";
      status.textContent = text;
      if (action) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "search-status-action";
        button.textContent = action.label;
        button.addEventListener("click", action.run);
        status.append(" ", button);
      }
      results.replaceChildren(status);
    }
    function showFailure() {
      showStatus(dialog.getAttribute("data-error"), {
        label: dialog.getAttribute("data-retry"),
        run: function () {
          showStatus(dialog.getAttribute("data-loading"));
          loadJsonIndex(function () { showResults(input.value); });
          input.focus();
        },
      });
    }

    var dialogInner = dialog.querySelector(".search-dialog-inner");

    function positionDialog() {
      if (!dialogInner) return;
      if (window.innerWidth < 1024 || !openBtn || openBtn.getBoundingClientRect().width < 40) {
        Object.assign(dialogInner.style, { position: "absolute", top: "16px", left: "16px", right: "16px", width: "auto", maxWidth: "none", transform: "none", margin: "0" });
        return;
      }
      var rect = openBtn.getBoundingClientRect();
      dialogInner.style.position = "absolute";
      dialogInner.style.top = rect.top - 4 + "px";
      var extraWidth = Math.min(rect.width * 0.5, 200);
      dialogInner.style.left = rect.left - extraWidth / 2 + "px";
      dialogInner.style.width = rect.width + extraWidth + "px";
      dialogInner.style.maxWidth = "none";
      dialogInner.style.transform = "none";
      dialogInner.style.margin = "0";
    }

    function open() {
      returnFocus = document.activeElement;
      positionDialog();
      if (!dialog.open) dialog.showModal();
      dialog.classList.add("open");
      input.value = "";
      input.focus();
      if (!indexLoaded) {
        showStatus(dialog.getAttribute("data-loading"));
        loadJsonIndex(function () {
          showResults(input.value);
        });
      } else {
        showResults("");
      }
      document.addEventListener("keydown", onDialogKey);
    }

    function close() {
      querySequence++;
      clearTimeout(queryTimer);
      dialog.classList.remove("open");
      dialog.close();
      if (returnFocus && returnFocus.focus) returnFocus.focus();
      document.removeEventListener("keydown", onDialogKey);
    }

    async function showResults(query) {
      if (!indexLoaded) return;
      var request = ++querySequence;
      var q = query.toLowerCase().trim();
      hasMore = false;
      if (!q) {
        // Where each part of the site starts, under the part's name.
        filtered = entries.map(function (e) {
          return Object.assign({}, e, { category: e.tab || e.category });
        });
      } else {
        try {
          var found = await engine.query(q);
          if (request !== querySequence || !dialog.open) return;
          filtered = found.rows.map(shown);
          hasMore = found.more;
        } catch {
          if (request !== querySequence) return;
          failed();
          return;
        }
      }

      activeIndex = filtered.length ? 0 : -1;
      render();
      fill();
    }

    function shown(e) { return Object.assign({}, e, { summary: e.qualifiedName || e.title, tag: e.owner || e.tab }); }
    function failed() {
      engine.dispose(); indexLoaded = false; entries = []; hasMore = false;
      showFailure();
    }

    /** The current query's next results, appended where the list ends. */
    function loadMore() {
      if (!hasMore) return Promise.resolve();
      if (loadingMore) return loadingMore;
      var request = querySequence;
      loadingMore = engine.more().then(function (found) {
        if (request !== querySequence || !dialog.open) return;
        filtered = filtered.concat(found.rows.map(shown));
        hasMore = found.more;
        render(false);
        fill();
      }, function () {
        if (request === querySequence) failed();
      }).finally(function () { loadingMore = null; });
      return loadingMore;
    }
    /** A list with room below its last result reads on until it fills or ends. */
    function fill() {
      if (hasMore && results.scrollHeight - results.scrollTop - results.clientHeight < 120) loadMore();
    }

    /** `follow`, unless false, keeps the active result in view. */
    function render(follow) {
      var html = "";
      var lastCategory = "";

      for (var i = 0; i < filtered.length; i++) {
        var e = filtered[i];
        var cat = e.category || "Results";

        if (cat !== lastCategory) {
          html += '<div class="search-category">' + escapeHtml(cat) + "</div>";
          lastCategory = cat;
        }

        var cls = "search-result" + (i === activeIndex ? " active" : "");
        var label = e.method
          ? '<span class="method-badge" data-method="' +
            e.method.toLowerCase() +
            '">' +
            e.method.toUpperCase() +
            "</span> " +
            '<span class="search-result-path">' +
            escapeHtml(e.path) +
            "</span>"
          : '<span class="search-result-path">' + escapeHtml(e.summary) + "</span>";
        // A row's part of the site, unless its group or its title already names it.
        var tagLine = e.tag && e.tag !== cat && e.tag !== e.summary
          ? '<span class="search-result-tag">' + escapeHtml(e.tag) + "</span>"
          : "";
        // A summary that only repeats the path, or the method and path, says nothing more:
        // an MCP tool's path is its name, and an operation without a summary is titled by both.
        var summaryLine =
          e.method && e.summary && e.summary !== e.path && e.summary.toLowerCase() !== (e.method + " " + e.path).toLowerCase()
            ? '<span class="search-result-summary">' + escapeHtml(e.summary) + "</span>"
            : "";

        html +=
          '<a href="' +
          escapeAttr(e.url) +
          '" class="' +
          cls +
          '" data-index="' +
          i +
          '">' +
          '<div class="search-result-main">' +
          label +
          summaryLine +
          "</div>" +
          tagLine +
          "</a>";
      }

      results.innerHTML = html;
      if (!filtered.length) showStatus(dialog.getAttribute("data-empty"));

      // Scroll active result into view
      var activeEl = follow !== false && results.querySelector(".search-result.active");
      if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    }

    function escapeHtml(s) {
      var el = document.createElement("span");
      el.textContent = s;
      return el.innerHTML;
    }

    function escapeAttr(s) {
      return escapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function navigate(index) {
      if (index < 0 || index >= filtered.length) return;
      var entry = filtered[index];
      close();
      window.location.href = entry.url;
    }

    function onDialogKey(e) {
      if (e.key === "Escape") {
        close();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (activeIndex === filtered.length - 1 && hasMore) {
          loadMore().then(function () { activeIndex = Math.min(activeIndex + 1, filtered.length - 1); render(); });
          return;
        }
        activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
        render();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        render();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0) navigate(activeIndex);
        return;
      }
    }

    input.addEventListener("input", function () {
      querySequence++;
      clearTimeout(queryTimer);
      queryTimer = setTimeout(function () {
        if (!indexLoaded) {
          if (!loading) loadJsonIndex(function () { showResults(input.value); });
          return;
        }
        showResults(input.value);
      }, 100);
    });

    results.addEventListener("scroll", fill, { passive: true });

    results.addEventListener("click", function (e) {
      var result = e.target.closest(".search-result");
      if (result) {
        e.preventDefault();
        navigate(parseInt(result.getAttribute("data-index"), 10));
      }
    });

    // Open search
    if (openBtn) openBtn.addEventListener("click", open);

    // Also bind mobile search button
    var mobileBtn = document.getElementById("search-open-mobile");
    if (mobileBtn) mobileBtn.addEventListener("click", open);

    // Keyboard shortcut: Ctrl+K or /
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        open();
      }
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        open();
      }
    });

    dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });

    // Close on backdrop click
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) close();
    });

    function isEditable(el) {
      var tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(init, { timeout: 250 });
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
