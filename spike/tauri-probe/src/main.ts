import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// M0 spike: this file exists to prove that the four "heavy" dependencies the
// SPEC's size estimate assumes are ACTUALLY used at runtime, not just
// imported and tree-shaken away. Every heavy dep below produces a real,
// visible DOM artifact, so the built dist/ bundle genuinely contains its code.
// ---------------------------------------------------------------------------

function probeLog(stage: string) {
  // Fire-and-forget: logs elapsed-since-process-start both to the packaged
  // app's stdout (when launched directly from a terminal) and to a fixed
  // file on disk (works even when launched via `open`).
  invoke("probe_log", { stage }).catch(() => {});
}

function probeWriteJson(name: string, data: unknown) {
  invoke("probe_write_json", { name, json: JSON.stringify(data, null, 2) }).catch(() => {});
}

// First-paint timing: report as early as the DOM has painted at least one
// frame after DOMContentLoaded. This approximates "time to window visible"
// as measured from inside the app (see spike/README.md for what this does
// and doesn't capture).
window.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      probeLog("first_paint");
    });
  });
});

// ---------------------------------------------------------------------------
// 1. CodeMirror 6 — mount a real editor instance.
// ---------------------------------------------------------------------------
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";

let editorView: EditorView | null = null;

function mountEditor(initialDoc: string) {
  const parent = document.querySelector<HTMLElement>("#editor");
  if (!parent) return;
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [
      lineNumbers(),
      history(),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
    ],
  });
  editorView = new EditorView({ state, parent });
}

function setEditorDoc(text: string) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
  });
}

// ---------------------------------------------------------------------------
// 2. @wooorm/starry-night — highlight a real code snippet.
// ---------------------------------------------------------------------------
import { createStarryNight, common } from "@wooorm/starry-night";
import { toHtml } from "hast-util-to-html";
// starry-night's default browser loader fetches its oniguruma WASM from
// esm.sh over the network, which is wrong for an offline desktop app (and
// would be invisible in a dist/ size measurement, undercounting this dep).
// Bundle the real onig.wasm locally instead, so it's both offline-capable
// and counted honestly in the dist/ size attribution.
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";

const JS_SNIPPET = `function renderMarkdown(source) {
  const tokens = tokenize(source);
  const tree = parse(tokens);
  return toHtml(tree);
}

class DocumentStore {
  constructor(path) {
    this.path = path;
    this.dirty = false;
  }
}`;

async function runStarryNight() {
  const starryNight = await createStarryNight(common, {
    getOnigurumaUrlFetch: async () => new URL(onigWasmUrl, window.location.href),
  });
  const scope = starryNight.flagToScope("js");
  const target = document.querySelector<HTMLElement>("#highlight");
  if (!scope || !target) return;
  const tree = starryNight.highlight(JS_SNIPPET, scope);
  target.innerHTML = toHtml(tree);
}

// ---------------------------------------------------------------------------
// 3. mermaid — render a non-trivial flowchart (>=10 nodes, subgraph, long
//    labels, one classDef) and, once it's placed in its final VISIBLE
//    location, inspect the rendered SVG's element geometry to check for
//    WebKit bug 23113 (foreignObject label mispositioning) and text
//    clipping from offscreen/onscreen font-measurement mismatch.
// ---------------------------------------------------------------------------
import mermaid from "mermaid";

const MERMAID_SOURCE = `flowchart TD
  subgraph Ingestion["Document Ingestion Pipeline"]
    A[Watch filesystem for markdown changes with a fairly long label to stress layout] --> B[Parse frontmatter and body separately]
    B --> C[Tokenize using the shared lexer]
  end
  C --> D{Contains diagrams or math blocks that require a heavy renderer}
  D -- yes --> E[Queue mermaid and MathJax rendering jobs on a background idle callback]
  D -- no --> F[Render plain HTML directly on the main thread]
  E --> G[Render mermaid flowcharts inside an offscreen sandbox container]
  E --> H[Typeset MathJax formulas using the SVG output backend]
  G --> I[Swap resulting SVG into the visible document pane]
  H --> I
  F --> I
  I --> J[Notify the outline and search index of the newly rendered content]
  J --> K[Persist scroll position and cursor for the next reload]
  K --> L((Ready for user interaction))
  classDef heavy fill:#f96,stroke:#333,stroke-width:2px,color:#000
  class E,G,H heavy
`;

interface NodeGeometry {
  id: string;
  shapeRect: { x: number; y: number; width: number; height: number };
  labelRect: { x: number; y: number; width: number; height: number };
  maxEscapePx: number;
  escapesNodeBox: boolean;
  textClipped: boolean;
}

function rectOf(r: DOMRect) {
  return {
    x: Math.round(r.x * 100) / 100,
    y: Math.round(r.y * 100) / 100,
    width: Math.round(r.width * 100) / 100,
    height: Math.round(r.height * 100) / 100,
  };
}

function analyzeMermaidGeometry(svg: SVGSVGElement): NodeGeometry[] {
  const results: NodeGeometry[] = [];
  const nodeGroups = Array.from(svg.querySelectorAll<SVGGElement>("g.node"));
  const tolerancePx = 2;
  for (const g of nodeGroups) {
    const shapeEl = Array.from(g.children).find((el) =>
      ["rect", "polygon", "circle", "ellipse", "path"].includes(el.tagName.toLowerCase()),
    ) as SVGGraphicsElement | undefined;
    const labelDiv = g.querySelector<HTMLElement>(
      "foreignObject .nodeLabel, foreignObject div, foreignObject span",
    );
    if (!shapeEl || !labelDiv) continue;
    const shapeRect = shapeEl.getBoundingClientRect();
    const labelRect = labelDiv.getBoundingClientRect();
    const escapeLeft = shapeRect.left - labelRect.left;
    const escapeTop = shapeRect.top - labelRect.top;
    const escapeRight = labelRect.right - shapeRect.right;
    const escapeBottom = labelRect.bottom - shapeRect.bottom;
    const maxEscape = Math.max(escapeLeft, escapeTop, escapeRight, escapeBottom);
    const textClipped =
      labelDiv.scrollWidth > labelDiv.clientWidth + 1 ||
      labelDiv.scrollHeight > labelDiv.clientHeight + 1;
    results.push({
      id: g.id,
      shapeRect: rectOf(shapeRect),
      labelRect: rectOf(labelRect),
      maxEscapePx: Math.round(maxEscape * 100) / 100,
      escapesNodeBox: maxEscape > tolerancePx,
      textClipped,
    });
  }
  return results;
}

async function runMermaid() {
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", flowchart: { htmlLabels: true } });

  const visibleTarget = document.querySelector<HTMLElement>("#diagram");
  if (!visibleTarget) return;

  // Per the spike brief: render into an offscreen-but-attached sandbox
  // (position: absolute; left: -99999px — NOT display:none, which breaks
  // measurement in Chromium too, mermaid#6652), with fonts settled first,
  // and with the sandbox's font-family matching the visible container's.
  await document.fonts.ready;

  const sandbox = document.createElement("div");
  sandbox.id = "mermaid-sandbox";
  sandbox.style.position = "absolute";
  sandbox.style.left = "-99999px";
  sandbox.style.top = "0";
  sandbox.style.font = getComputedStyle(visibleTarget).font || "16px sans-serif";
  document.body.appendChild(sandbox);

  const { svg } = await mermaid.render("probe-diagram", MERMAID_SOURCE, sandbox);
  sandbox.remove();

  visibleTarget.innerHTML = svg;

  // Let layout settle in the real, final, visible location before measuring
  // — this is exactly where a user would see WebKit bug 23113 manifest.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const svgEl = visibleTarget.querySelector("svg");
  if (svgEl) {
    const geometry = analyzeMermaidGeometry(svgEl as SVGSVGElement);
    const anyEscape = geometry.some((g) => g.escapesNodeBox);
    const anyClip = geometry.some((g) => g.textClipped);
    probeWriteJson("mermaid-geometry", {
      nodeCount: geometry.length,
      anyLabelEscapesNodeBox: anyEscape,
      anyTextClipped: anyClip,
      nodes: geometry,
    });
  } else {
    probeWriteJson("mermaid-geometry", { error: "no <svg> found after render" });
  }
}

// ---------------------------------------------------------------------------
// 4. MathJax (@mathjax/src + @mathjax/mathjax-tex-font) — typeset a real
//    TeX formula to SVG using the genuine modular v4 API (not the
//    monolithic component script), so the bundler actually pulls in the
//    TeX parser + SVG output + font glyph data.
// ---------------------------------------------------------------------------
import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import { TeX } from "@mathjax/src/mjs/input/tex.js";
import { SVG } from "@mathjax/src/mjs/output/svg.js";
import { browserAdaptor } from "@mathjax/src/mjs/adaptors/browserAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/mjs/handlers/html.js";
import { MathJaxTexFont } from "@mathjax/mathjax-tex-font/mjs/svg.js";

function runMathJax() {
  const target = document.querySelector<HTMLElement>("#math");
  if (!target) return;

  RegisterHTMLHandler(browserAdaptor());
  const tex = new TeX({ packages: ["base"] });
  const svg = new SVG({ fontCache: "local", font: new MathJaxTexFont() });
  const html = mathjax.document(document, { InputJax: tex, OutputJax: svg });

  const node = html.convert(
    "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
    { display: true },
  );
  target.appendChild(node as unknown as Node);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const styleNode = (svg as any).styleSheet ? (svg as any).styleSheet(html) : null;
  if (styleNode) target.appendChild(styleNode as unknown as Node);
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
async function boot() {
  mountEditor("# Loading…\n\nThe 40 KB sample document will replace this shortly.");

  await Promise.all([
    Promise.resolve().then(runStarryNight),
    Promise.resolve().then(runMermaid),
    Promise.resolve().then(runMathJax),
  ]);

  probeLog("heavy_render_done");

  try {
    const res = await fetch("/sample-40kb.md");
    const text = await res.text();
    setEditorDoc(text);
    probeLog("doc_loaded");
    probeWriteJson("doc-loaded", { bytes: new TextEncoder().encode(text).length });
  } catch (err) {
    probeWriteJson("doc-loaded", { error: String(err) });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  boot();
});
