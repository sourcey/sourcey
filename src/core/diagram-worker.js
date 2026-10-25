import process from 'node:process';
import { JSDOM } from 'jsdom';

// Mermaid reads a diagram in a DOM: a document, and the browser's Option and
// CSS.supports, with which it tells a sequence box's colour from its name.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Option = dom.window.Option;
dom.window.CSS = {
  supports(property, value) {
    const style = new dom.window.Option().style;
    style.setProperty(property, value);
    return style.getPropertyValue(property) !== '';
  },
};
const { default: mermaid } = await import('mermaid');
const { renderMermaidDiagram } = await import('@sourcey/beautiful-mermaid');
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

/**
 * One drawing for every theme: its colours are the page's, which it names as
 * CSS variables, and its text is set in the page's Inter.
 */
const OPTIONS = { bg: 'var(--diagram-bg)', fg: 'var(--diagram-fg)', transparent: true, embedFonts: false };
/** Frontmatter or a directive configures a diagram; Mermaid applies them as it parses, until it is reset. */
const CONFIGURED = /^\s*---\s*$|%%\{/m;

// The build's diagram renderer, in a process of its own: one diagram at a time,
// read by Mermaid's own parser and drawn from what it reads.
let queue = Promise.resolve();
process.on('message', request => {
  queue = queue.then(async () => {
    const configured = CONFIGURED.test(request.source);
    try {
      if (configured) await mermaid.mermaidAPI.parse(request.source);
      const { type, db } = await mermaid.mermaidAPI.getDiagramFromText(request.source);
      const svg = renderMermaidDiagram({ type, db, config: mermaid.mermaidAPI.getConfig() }, OPTIONS);
      process.send({ id: request.id, svg });
    } catch (error) {
      // A type Mermaid does not know is named by its first line; the rest of its message repeats the source.
      process.send({ id: request.id, error: error.name === 'UnknownDiagramError' ? error.message.split('\n')[0] : error.message });
    } finally {
      if (configured) mermaid.mermaidAPI.reset();
    }
  });
});
