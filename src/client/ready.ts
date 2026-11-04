/** Delay noncritical enhancements without missing a load that already happened. */
export function deferEnhancement(init: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(init, { timeout: 250 });
  } else if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
}
