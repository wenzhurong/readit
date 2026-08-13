export interface MermaidRenderer {
  /** Hydrate every Phase A mermaid code-block placeholder under this root. */
  hydrate(root: ParentNode): Promise<readonly MermaidHydrationResult[]>
}

export interface MermaidHydrationResult {
  readonly state: 'ready' | 'error'
  readonly source: string
}

interface MermaidRenderResult {
  svg: string
  bindFunctions?: (element: Element) => void
}

export interface MermaidAdapter {
  initialize(config: {
    startOnLoad: false
    securityLevel: 'strict'
    suppressErrorRendering: true
    htmlLabels: true
    fontFamily: string
    theme: 'default' | 'dark'
    themeVariables: { fontSize: string }
  }): void
  render(id: string, code: string): Promise<MermaidRenderResult>
}

export interface SvgSanitizer {
  sanitize(
    dirty: string,
    config: {
      USE_PROFILES: { svg: true; svgFilters: true; html: true }
      ADD_TAGS: ['foreignObject']
      HTML_INTEGRATION_POINTS: { 'annotation-xml': true; foreignobject: true }
    },
  ): string
}

let nextId = 0
let renderQueue: Promise<void> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(work, work)
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

function uniqueId(doc: Document): string {
  let id = ''
  do id = `readit-mermaid-${++nextId}`
  while (doc.getElementById(id) !== null || doc.getElementById(`d${id}`) !== null)
  return id
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return String(error)
}

/**
 * WebKit bug 23113 needs both a transformed SVG ancestor and a composited HTML
 * descendant. Mermaid's defaults do not create that combination, but author
 * classDef/style directives can put these three properties on label HTML.
 * Keep SVG geometry transforms intact; only strip layer-triggering properties
 * from HTML descendants of foreignObject.
 */
function guardForeignObjectLayers(root: Element): void {
  for (const foreignObject of root.querySelectorAll('foreignObject')) {
    for (const html of foreignObject.querySelectorAll<HTMLElement>('*')) {
      for (const property of ['opacity', 'transform', 'filter'] as const) {
        html.style.removeProperty(property)
        html.removeAttribute(property)
      }
      if (html.getAttribute('style')?.trim() === '') html.removeAttribute('style')
    }
  }
}

function addMeasurementRule(
  doc: Document,
  id: string,
  fontFamily: string,
  fontSize: string,
): HTMLStyleElement {
  const style = doc.createElement('style')
  style.dataset['readitMermaidMeasure'] = id
  // id is generated above, fontSize is admitted only by the px grammar below,
  // and fontFamily is the browser-serialized computed value. Mermaid creates
  // #d<ID> in light DOM, so hostile inherited `* { ... !important }` rules can
  // otherwise corrupt measurement even though they cannot enter the final
  // shadow tree. Reset only the inherited properties that affect text metrics.
  // Mermaid creates #d<ID> itself because render() deliberately receives no
  // third argument; this rule makes that temporary div laid-out but offscreen.
  style.textContent =
    `#d${id}{position:absolute;left:-99999px;top:0;` +
    `font-family:${fontFamily}!important;font-size:${fontSize}!important;` +
    'line-height:normal!important;letter-spacing:normal!important;' +
    'word-spacing:normal!important;font-style:normal!important;' +
    'font-variant-numeric:normal!important;text-transform:none!important}' +
    `#d${id} *{font-family:inherit!important;line-height:normal!important;` +
    'letter-spacing:normal!important;word-spacing:normal!important;' +
    'font-style:normal!important;font-variant-numeric:normal!important;' +
    'text-transform:none!important}'
  ;(doc.head ?? doc.documentElement).appendChild(style)
  return style
}

function sourceBlocks(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.highlight-source-mermaid')].filter(
    (element) => element.dataset['readitMermaidState'] === undefined,
  )
}

export function createMermaidRendererWith(
  mermaid: MermaidAdapter,
  sanitizer: SvgSanitizer,
): MermaidRenderer {
  const renderOne = async (target: HTMLElement): Promise<MermaidHydrationResult> => {
    const source = target.querySelector('pre')?.textContent ?? ''
    const doc = target.ownerDocument
    const view = doc.defaultView
    const computed = view?.getComputedStyle(target)
    const fontFamily = computed?.fontFamily || 'system-ui, sans-serif'
    const rawFontSize = computed?.fontSize || '16px'
    const fontSize = /^\d+(?:\.\d+)?px$/.test(rawFontSize) ? rawFontSize : '16px'
    const colorScheme = computed?.colorScheme ?? ''
    const theme = colorScheme.split(/\s+/).includes('dark') ? 'dark' : 'default'
    const id = uniqueId(doc)

    target.dataset['readitMermaidState'] = 'loading'
    try {
      // fonts.ready only waits for faces that the document has already
      // decided it needs. The Phase A <pre> uses a monospace face, so the
      // proportional Mermaid label face may still be idle at this point.
      // Request that exact face before the readiness barrier or Mermaid can
      // measure once with fallback metrics and inject later with real metrics.
      await doc.fonts?.load?.(`${fontSize} ${fontFamily}`)
      await doc.fonts?.ready
      const rendered = await enqueue(async () => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          htmlLabels: true,
          fontFamily,
          theme,
          themeVariables: { fontSize },
        })
        const measurementStyle = addMeasurementRule(doc, id, fontFamily, fontSize)
        try {
          // SPEC §10.3: exactly two arguments. Passing target as a third argument
          // takes Mermaid down its shadow-unaware document.getElementById path.
          return await mermaid.render(id, source)
        } finally {
          measurementStyle.remove()
          doc.getElementById(`d${id}`)?.remove()
          doc.getElementById(id)?.remove()
        }
      })
      const safeSvg = sanitizer.sanitize(rendered.svg, {
        USE_PROFILES: { svg: true, svgFilters: true, html: true },
        ADD_TAGS: ['foreignObject'],
        // DOMPurify 3.4 requires non-default namespace integration points to
        // be opted in separately from ADD_TAGS. Without this, foreignObject
        // survives but every Mermaid HTML label below it is stripped.
        HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true },
      })
      target.innerHTML = safeSvg
      guardForeignObjectLayers(target)
      target.classList.add('readit-mermaid')
      target.dataset['readitMermaidState'] = 'ready'
      if (rendered.bindFunctions !== undefined) {
        rendered.bindFunctions(target)
        // 真浏览器结构验收不能窃取 Mermaid 内部闭包；用一个内部
        // 状态标记证明注入后的交互绑定步骤已经执行。
        target.dataset['readitMermaidBound'] = 'true'
      }
      return { state: 'ready', source }
    } catch (error) {
      target.dataset['readitMermaidState'] = 'error'
      const message = doc.createElement('div')
      message.className = 'readit-mermaid-error'
      message.setAttribute('role', 'alert')
      message.textContent = `Mermaid 图表无法渲染：${errorMessage(error)}`
      target.appendChild(message)
      return { state: 'error', source }
    }
  }

  return {
    async hydrate(root) {
      const results: MermaidHydrationResult[] = []
      for (const target of sourceBlocks(root)) results.push(await renderOne(target))
      return results
    },
  }
}
