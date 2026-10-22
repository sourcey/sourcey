import process from 'node:process';
import ELK from 'elkjs';
import { decodeHTML } from 'entities';
import { darkTheme, defaultTheme, layout, parse, renderSvg } from '@speajus/mermaid-to-svg';

/** Mermaid's line break inside a label. */
const BREAK = /\s*<br\s*\/?>\s*/gi;
/** Any other markup in a label. */
const TAG = /<\/?[A-Za-z][^>]*>/g;
/** The parts of a diagram a reader reads: labels, messages, notes and titles, never identifiers. */
const TEXT = new Set(['label', 'text', 'message', 'title', 'description']);

/**
 * Mermaid's labels are HTML, so a diagram is drawn with each one's text as
 * a reader sees it: `<br>` breaks a line, other markup is left out, and an
 * entity such as `&lt;` is the character it names. The renderer draws each
 * line of a flowchart node's label, so there `<br>` is a line break;
 * everything else it draws on one line, so there it reads as a space.
 */
function readLabels(ir) {
  const read = (field, lines) => decodeHTML(field.replace(BREAK, lines ? '\n' : ' ').replace(TAG, ''));
  const visit = (value, lines) => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, lines));
    if (!value || typeof value !== 'object') return;
    for (const [key, field] of Object.entries(value)) {
      if (typeof field === 'string' && TEXT.has(key)) value[key] = read(field, lines);
      else visit(field, false);
    }
  };
  for (const [key, field] of Object.entries(ir)) {
    if (typeof field === 'string' && TEXT.has(key)) ir[key] = read(field, false);
    else visit(field, ir.type === 'flowchart' && key === 'nodes');
  }
  return ir;
}

/** The renderer's estimate of text size, measuring each line of a label that has several. */
const metrics = {
  measureText(text, fontSize) {
    const lines = text.split('\n');
    return {
      width: Math.max(...lines.map((line) => line.length)) * fontSize * 0.6,
      height: fontSize * 1.2 + (lines.length - 1) * fontSize * 1.3,
      ascent: fontSize * 0.8,
      descent: fontSize * 0.2,
    };
  },
};

const FONT_SIZE = 14;
/** The space a subgraph keeps above its members for its title, and around them. */
const SUBGRAPH_PADDING = '[top=36,left=16,bottom=16,right=16]';
/** Subgraphs as Mermaid's own default and dark themes colour them. */
const SUBGRAPH_STYLE = {
  default: { fill: '#ffffde', stroke: '#aaaa33', text: '#333333' },
  dark: { fill: '#474949', stroke: 'rgba(255, 255, 255, 0.25)', text: '#e0dfdf' },
};
const elk = new ELK();
const ELK_DIRECTION = { TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' };

/**
 * The direction each subgraph declares (`direction LR`), which the renderer's
 * reading of a flowchart leaves out, from Mermaid's own reading of it.
 */
async function declaredDirections(source) {
  const { default: mermaid } = await import('mermaid');
  const { db } = await mermaid.mermaidAPI.getDiagramFromText(source);
  return new Map(db.getSubGraphs().filter((subgraph) => subgraph.dir).map((subgraph) => [subgraph.id, subgraph.dir === 'TD' ? 'TB' : subgraph.dir]));
}

/**
 * The renderer lays a flowchart's subgraphs out flat and draws none of them.
 * A flowchart with subgraphs is laid out here instead, each subgraph a
 * container around its members (a node in the innermost subgraph that lists
 * it), in the renderer's own layered layout and node sizes, so its nodes and
 * edges draw as before and its subgraphs can be drawn beneath them.
 *
 * Subgraphs run as Mermaid runs them. One that no link crosses is laid out on
 * its own, in the direction it declares, or else across the one around it, so
 * a top-to-bottom chart lists a subgraph's members down its side. One a link
 * crosses is laid out with the one around it, in its direction.
 */
async function layoutSubgraphs(ir, declared) {
  const subgraphs = new Map(ir.subgraphs.map((subgraph) => [subgraph.id, subgraph]));
  const parent = new Map();
  // Inner subgraphs come first, so a node's first subgraph is its innermost.
  for (const subgraph of ir.subgraphs) for (const id of subgraph.nodeIds) if (!parent.has(id)) parent.set(id, subgraph.id);
  const ancestors = (id) => { const chain = []; for (let at = parent.get(id); at; at = parent.get(at)) chain.push(at); return [...chain, 'root']; };
  const crossed = (id) => ir.edges.some((edge) => ancestors(edge.source).includes(id) !== ancestors(edge.target).includes(id));
  // The direction each subgraph's members are laid out in, from the outside in.
  const direction = new Map([['root', ir.direction]]);
  const directionOf = (id) => {
    if (!direction.has(id)) {
      const around = directionOf(parent.get(id) ?? 'root');
      direction.set(id, crossed(id) ? around : declared.get(id) ?? (around === 'TB' ? 'LR' : 'TB'));
    }
    return direction.get(id);
  };
  const size = (label, shape) => {
    const text = metrics.measureText(label, FONT_SIZE);
    const box = { width: Math.max(text.width + 24, 60), height: Math.max(text.height + 24, 40) };
    return shape === 'diamond' ? { width: box.width * 1.4, height: box.height * 1.4 } : box;
  };
  const layered = (dir) => ({
    'elk.algorithm': 'layered',
    'elk.direction': ELK_DIRECTION[dir] ?? 'DOWN',
    'elk.spacing.nodeNode': '40',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.edgeRouting': 'ORTHOGONAL',
  });
  // A layout of its own ranks nodes no link joins together, in the order they are written, as Mermaid
  // ranks them, rather than packing them apart as separate pieces. ELK reads this only where a layout
  // starts: a subgraph laid out with the one around it takes it from there.
  const run = (dir) => ({ ...layered(dir), 'elk.separateConnectedComponents': 'false', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' });
  const elkNode = new Map([['root', { id: 'root', layoutOptions: { ...run(ir.direction), 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' }, children: [], edges: [] }]]);
  for (const node of ir.nodes) if (!subgraphs.has(node.id)) elkNode.set(node.id, { id: node.id, ...size(node.label, node.shape), labels: [{ text: node.label }] });
  for (const subgraph of ir.subgraphs) {
    // A subgraph is at least as wide as its title. ELK 0.9 reads the minimum size of one laid out
    // with the one around it with its axes swapped when that layout runs top to bottom or bottom to
    // top; one laid out on its own it reads as given.
    const width = metrics.measureText(subgraph.label, FONT_SIZE).width + 32;
    const own = !crossed(subgraph.id);
    const vertical = !own && !['LR', 'RL'].includes(directionOf(subgraph.id));
    elkNode.set(subgraph.id, { id: subgraph.id, children: [], edges: [], layoutOptions: {
      ...(own ? run : layered)(directionOf(subgraph.id)), 'elk.hierarchyHandling': own ? 'SEPARATE_CHILDREN' : 'INCLUDE_CHILDREN',
      'elk.padding': SUBGRAPH_PADDING, 'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': vertical ? `(40,${width})` : `(${width},40)`,
    } });
  }
  for (const [id, node] of elkNode) if (id !== 'root') elkNode.get(parent.get(id) ?? 'root').children.push(node);
  // An edge belongs to the innermost subgraph holding both its ends, so one laid out on its own routes its own.
  for (const edge of ir.edges) {
    const around = ancestors(edge.target);
    const container = ancestors(edge.source).find((id) => around.includes(id));
    elkNode.get(container).edges.push({ id: edge.id, sources: [edge.source], targets: [edge.target], labels: edge.label ? [{ text: edge.label, width: edge.label.length * FONT_SIZE * 0.6, height: FONT_SIZE * 1.2 }] : [] });
  }
  const laid = await elk.layout(elkNode.get('root'));
  // ELK places a node within its parent and an edge within the container it names; both are drawn on the page.
  const placed = new Map([['root', { x: 0, y: 0, width: laid.width, height: laid.height }]]);
  const laidEdges = [...(laid.edges ?? []).map((edge) => ({ edge, holder: 'root' }))];
  const walk = (node, left, top) => {
    const at = { x: left + node.x, y: top + node.y, width: node.width, height: node.height };
    placed.set(node.id, at);
    for (const edge of node.edges ?? []) laidEdges.push({ edge, holder: node.id });
    for (const child of node.children ?? []) walk(child, at.x, at.y);
  };
  for (const node of laid.children ?? []) walk(node, 0, 0);
  const nodes = ir.nodes.filter((node) => !subgraphs.has(node.id)).map((node) => {
    const at = placed.get(node.id);
    return { id: node.id, x: at.x, y: at.y, width: at.width, height: at.height, label: node.label, shape: node.shape };
  });
  const edges = laidEdges.map(({ edge, holder }) => {
    const source = ir.edges.find((item) => item.id === edge.id);
    const container = placed.get(edge.container ?? holder);
    const points = (edge.sections ?? []).flatMap((section) => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].filter(Boolean)).map((point) => ({ x: container.x + point.x, y: container.y + point.y }));
    return { id: edge.id, source: source.source, target: source.target, label: source.label, points, type: source.type, arrowHead: source.arrowHead };
  });
  // Outer subgraphs first, so an inner one draws over the one around it.
  const depth = (id) => (parent.has(id) ? 1 + depth(parent.get(id)) : 0);
  const boxes = ir.subgraphs.map((subgraph) => ({ ...subgraph, ...pick(placed.get(subgraph.id)) })).sort((a, b) => depth(a.id) - depth(b.id));
  const extent = [...nodes, ...boxes];
  return {
    diagramType: 'flowchart',
    nodes,
    edges,
    subgraphs: boxes,
    width: Math.max(...extent.map((item) => item.x + item.width)) + 40,
    height: Math.max(...extent.map((item) => item.y + item.height)) + 40,
  };
}

const pick = ({ x, y, width, height }) => ({ x, y, width, height });
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Subgraph containers and their titles, drawn under the edges and nodes. */
function drawSubgraphs(svg, positioned, dark) {
  if (!positioned.subgraphs?.length) return svg;
  const style = SUBGRAPH_STYLE[dark ? 'dark' : 'default'];
  const boxes = positioned.subgraphs.map((box) => `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" ry="4" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1"></rect><text x="${box.x + box.width / 2}" y="${box.y + 22}" text-anchor="middle" font-size="${FONT_SIZE}" font-family="&quot;trebuchet ms&quot;, verdana, arial, sans-serif" fill="${style.text}">${escape(box.label)}</text></g>`).join('');
  const defs = svg.indexOf('</defs>');
  return defs < 0 ? svg : `${svg.slice(0, defs + 7)}${boxes}${svg.slice(defs + 7)}`;
}

/** The node style the renderer gives each shape, for its text colour. */
const SHAPE_STYLE = { diamond: 'decision', rounded: 'rounded', stadium: 'rounded', circle: 'circle', 'double-circle': 'circle', cylinder: 'cylinder', subroutine: 'subroutine' };

/**
 * The renderer draws a label of several lines without the text's own height,
 * so its lines land at the top of the diagram. Such labels are taken out of
 * the nodes before drawing and returned with their places, to be drawn over
 * the nodes at their centres.
 */
function takeMultilineLabels(positioned) {
  const taken = [];
  for (const node of positioned.nodes ?? []) {
    if (typeof node.label !== 'string' || !node.label.includes('\n')) continue;
    taken.push({ lines: node.label.split('\n'), x: node.x + node.width / 2, y: node.y + node.height / 2, shape: node.shape });
    node.label = '';
  }
  return taken;
}

function drawLabels(svg, labels, dark) {
  if (!labels.length) return svg;
  const theme = dark ? darkTheme : defaultTheme;
  const lineHeight = theme.fontSize * 1.3;
  const text = labels.map(({ lines, x, y, shape }) => {
    const fill = (theme.nodeStyles[SHAPE_STYLE[shape]] ?? theme.nodeStyles.default).textColor;
    const top = y - ((lines.length - 1) * lineHeight) / 2;
    return `<text x="${x}" y="${top}" font-size="${theme.fontSize}" font-family="${escape(theme.fontFamily)}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${lines.map((line, index) => `<tspan x="${x}" y="${top + index * lineHeight}">${escape(line)}</tspan>`).join('')}</text>`;
  }).join('');
  return svg.replace(/<\/svg>\s*$/, `${text}</svg>`);
}

// The build's diagram renderer, in a process of its own: one diagram at a time,
// read and laid out once, and drawn in each theme from that layout.
let queue = Promise.resolve();
process.on('message', request => {
  queue = queue.then(async () => {
    try {
      const ir = readLabels(await parse(request.source));
      const positioned = ir.type === 'flowchart' && ir.subgraphs?.length ? await layoutSubgraphs(ir, await declaredDirections(request.source)) : await layout(ir, { fontMetrics: metrics });
      const labels = takeMultilineLabels(positioned);
      const draw = (dark) => drawLabels(drawSubgraphs(renderSvg(positioned, dark ? 'dark' : 'default', request.prefixes[dark ? 'dark' : 'light']), positioned, dark), labels, dark);
      process.send({ id: request.id, light: draw(false), dark: draw(true) });
    } catch (error) {
      process.send({ id: request.id, error: error.message });
    }
  });
});
