import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js'
import '@mathjax/src/js/input/tex/noerrors/NoErrorsConfiguration.js'
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js'
import type { LiteElement } from '@mathjax/src/js/adaptors/lite/Element.js'
import { TEX_PACKAGES } from './index.js'

/**
 * Ask a live MathJax SVG output jax for its stylesheet text.
 * Used by tools/gen-svg-stylesheet.ts and by the drift test; never on the render path.
 * Not hot-path-safe: unlike index.ts, each call registers a fresh adaptor/handler
 * with MathJax's global handler list rather than reusing a shared singleton —
 * fine for its low-call-count tooling/test usage, wrong for a per-formula render path.
 */
export function extractSvgStylesheet(): string {
  const adaptor = liteAdaptor()
  RegisterHTMLHandler(adaptor)
  const output = new SVG({
    fontData: MathJaxTexFont,
    fontCache: 'none',
    displayOverflow: 'scroll',
  })
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: [...TEX_PACKAGES], tags: 'none' }),
    OutputJax: output,
  })
  doc.convert('x', { display: false })
  return adaptor.textContent(output.styleSheet(doc) as LiteElement)
}
