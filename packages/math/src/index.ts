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
import type { LiteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import type { LiteElement, LiteNode } from '@mathjax/src/js/adaptors/lite/Element.js'
import type { MathRenderer } from '@readit/core/types'

/**
 * TeX package allowlist (SPEC §7.5 / cross-task security note).
 * Deliberately excludes `html` (the live `\href{javascript:...}` vector) and
 * `unicode`/`mhchem` (unneeded attack surface). This is a package allowlist,
 * not a safe-handler: not loading the package is the mitigation.
 */
export const TEX_PACKAGES: readonly string[] = Object.freeze([
  'base',
  'ams',
  'newcommand',
  'noundefined',
  'noerrors',
])

let sharedAdaptor: LiteAdaptor | null = null
function getAdaptor(): LiteAdaptor {
  if (sharedAdaptor === null) {
    sharedAdaptor = liteAdaptor()
    RegisterHTMLHandler(sharedAdaptor)
  }
  return sharedAdaptor
}

/** True for lite-DOM element nodes (as opposed to text/comment nodes). */
function isLiteElement(node: LiteNode): node is LiteElement {
  return 'attributes' in node
}

/**
 * MathJax echoes the user's raw TeX into `data-latex`/`data-latex-item`
 * attributes across dozens of nodes. `skipAttributes` cannot suppress this
 * in 4.1.3 (SPEC §17.3), so this pure lite-DOM traversal strips them instead.
 */
function stripLatexHints(adaptor: LiteAdaptor, node: LiteElement): void {
  adaptor.removeAttribute(node, 'data-latex')
  adaptor.removeAttribute(node, 'data-latex-item')
  for (const child of adaptor.childNodes(node)) {
    if (isLiteElement(child)) {
      stripLatexHints(adaptor, child)
    }
  }
}

/**
 * One fresh MathDocument per formula, not per renderer (SPEC §17.3).
 * Measured: reusing a MathDocument across convert() calls lets TeX macro
 * state (e.g. \newcommand) leak from one formula into the next. Per-formula
 * isolation costs ~1 ms and buys composable golden snapshots plus immunity
 * to macro bombs in untrusted READMEs.
 */
export function createMathRenderer(): MathRenderer {
  const adaptor = getAdaptor()
  return {
    render(tex: string, display: boolean): string {
      const output = new SVG({
        fontData: MathJaxTexFont,
        fontCache: 'none',
        displayOverflow: 'scroll',
      })
      const doc = mathjax.document('', {
        InputJax: new TeX({ packages: [...TEX_PACKAGES], tags: 'none' }),
        OutputJax: output,
      })
      const node = doc.convert(tex, { display }) as LiteElement
      stripLatexHints(adaptor, node)
      adaptor.setAttribute(node, 'data-tex', tex)
      return adaptor.outerHTML(node)
    },
  }
}
