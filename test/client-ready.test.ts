import { afterEach, expect, it, vi } from "vitest";
import { deferEnhancement } from "../src/client/ready.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["loading", "interactive"])("initializes once when a %s document finishes loading without idle callbacks", readyState => {
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", { readyState });
  const init = vi.fn();
  deferEnhancement(init);
  expect(init).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("load"));
  window.dispatchEvent(new Event("load"));
  expect(init).toHaveBeenCalledOnce();
});

it("initializes a late module without waiting for an event that has already fired", () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { readyState: "complete" });
  const init = vi.fn();
  deferEnhancement(init);
  expect(init).toHaveBeenCalledOnce();
});

it("retains bounded idle scheduling where the browser supports it", () => {
  const requestIdleCallback = vi.fn();
  vi.stubGlobal("window", { requestIdleCallback });
  vi.stubGlobal("document", { readyState: "complete" });
  const init = vi.fn();
  deferEnhancement(init);
  expect(requestIdleCallback).toHaveBeenCalledWith(init, { timeout: 250 });
  expect(init).not.toHaveBeenCalled();
  requestIdleCallback.mock.calls[0][0]();
  expect(init).toHaveBeenCalledOnce();
});
