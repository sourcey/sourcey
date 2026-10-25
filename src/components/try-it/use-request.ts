import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { RequestDescription, RequestDraft } from "../../core/request.js";
import { sendRequest, type ConsoleResponse } from "./transport.js";

/** Own cancellation and stale-response protection independently of form rendering. */
export function useRequest(id: string) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<ConsoleResponse>();
  const [sentDraft, setSentDraft] = useState<RequestDraft>();
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  const active = useRef(true);

  function abort() {
    generation.current++;
    if (!controller.current) return;
    controller.current.abort();
    controller.current = undefined;
    setSending(false);
    setMessage("Request cancelled.");
  }
  useLayoutEffect(() => {
    active.current = true;
    const mount = document.getElementById(id);
    mount?.addEventListener("sourcey:try-it-close", abort);
    return () => {
      active.current = false;
      generation.current++;
      controller.current?.abort();
      controller.current = undefined;
      mount?.removeEventListener("sourcey:try-it-close", abort);
    };
  }, [id]);

  async function send(request: RequestDescription, draft: RequestDraft) {
    if (controller.current) return;
    const run = ++generation.current;
    const pending = new AbortController();
    controller.current = pending;
    setSending(true);
    setMessage("");
    try {
      const result = await sendRequest(request, pending.signal);
      if (!active.current || run !== generation.current) return;
      setResponse(result);
      setSentDraft(draft);
      setMessage(`Received HTTP ${result.status}.`);
    } catch (error) {
      if (!active.current || run !== generation.current) return;
      setMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? "Request cancelled."
          : "The browser could not complete this request. Check your connection and the server’s browser-access settings. You can also copy the request and run it in a terminal.",
      );
    } finally {
      if (active.current && run === generation.current) {
        controller.current = undefined;
        setSending(false);
      }
    }
  }
  function reset() {
    setResponse(undefined);
    setSentDraft(undefined);
    setMessage("");
  }
  return { sending, message, response, sentDraft, setMessage, send, abort, reset };
}
