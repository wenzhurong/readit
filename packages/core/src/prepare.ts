import { DEFAULT_OPTIONS, type Highlighter, type InlineMathMode, type MathRenderer, type RenderOptions } from './types.js'

export interface ScanResult {
  needsMath: boolean
  needsMermaid: boolean
  needsHighlight: boolean
  /** Fence info words, first-seen order, without `math` and `mermaid`. */
  languages: string[]
}

export interface Loaders {
  math: () => Promise<{ createMathRenderer(): MathRenderer }>
  /** null until a highlighter package exists; the scan still reports languages. */
  highlighter: null | (() => Promise<{ createHighlighter(): Highlighter }>)
}

export const DEFAULT_LOADERS: Loaders = {
  math: () => import('@readit/math'),
  highlighter: null,
}

const FENCE_INFO = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9][A-Za-z0-9+#._-]*)/gm
const DOLLAR = /\$/
const DOLLAR_DOLLAR = /\$\$/

/**
 * Conservative prescan. It may over-report (a `$` inside a code span still asks for math);
 * it must never under-report, because render() has no way to load anything.
 */
export function scan(src: string, inlineMath: InlineMathMode): ScanResult {
  const languages: string[] = []
  let needsMermaid = false
  let fenceMath = false
  FENCE_INFO.lastIndex = 0
  for (let m = FENCE_INFO.exec(src); m !== null; m = FENCE_INFO.exec(src)) {
    const info = m[1]!
    if (info === 'mermaid') {
      needsMermaid = true
    } else if (info === 'math') {
      fenceMath = true
    } else if (!languages.includes(info)) {
      languages.push(info)
    }
  }
  const needsMath = fenceMath || DOLLAR_DOLLAR.test(src) || (inlineMath !== 'off' && DOLLAR.test(src))
  return { needsMath, needsMermaid, needsHighlight: languages.length > 0, languages }
}

/**
 * The one and only await on the rendering path. Resolves every renderer render() will need,
 * so that render() itself is a pure synchronous function of (src, opts).
 */
export async function prepare(
  src: string,
  opts: Partial<RenderOptions> = {},
  loaders: Loaders = DEFAULT_LOADERS,
): Promise<RenderOptions> {
  const resolved: RenderOptions = { ...DEFAULT_OPTIONS, ...opts }
  const found = scan(src, resolved.inlineMath)
  if (resolved.math === null && found.needsMath) {
    resolved.math = (await loaders.math()).createMathRenderer()
  }
  if (resolved.highlighter === null && found.needsHighlight && loaders.highlighter !== null) {
    resolved.highlighter = (await loaders.highlighter()).createHighlighter()
  }
  return resolved
}
