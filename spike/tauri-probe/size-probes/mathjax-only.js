import { mathjax } from "@mathjax/src/mjs/mathjax.js";
import { TeX } from "@mathjax/src/mjs/input/tex.js";
import { SVG } from "@mathjax/src/mjs/output/svg.js";
import { browserAdaptor } from "@mathjax/src/mjs/adaptors/browserAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/mjs/handlers/html.js";
import { MathJaxTexFont } from "@mathjax/mathjax-tex-font/mjs/svg.js";

export function boot() {
  const target = document.querySelector("#math");
  RegisterHTMLHandler(browserAdaptor());
  const tex = new TeX({ packages: ["base"] });
  const svg = new SVG({ fontCache: "local", font: new MathJaxTexFont() });
  const html = mathjax.document(document, { InputJax: tex, OutputJax: svg });
  const node = html.convert("\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}", {
    display: true,
  });
  if (target) target.appendChild(node);
}
