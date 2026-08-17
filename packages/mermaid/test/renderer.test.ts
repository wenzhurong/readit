import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMermaidRendererWith,
  type MermaidAdapter,
  type SvgSanitizer,
} from '../src/renderer.js'

function placeholder(source = 'flowchart LR\nA --> B'): HTMLDivElement {
  const target = document.createElement('div')
  target.className = 'highlight highlight-source-mermaid'
  target.style.fontFamily = 'Inter'
  target.style.fontSize = '18px'
  const pre = document.createElement('pre')
  pre.textContent = source
  target.appendChild(pre)
  document.body.appendChild(target)
  return target
}

afterEach(() => {
  document.body.replaceChildren()
  document.head.querySelectorAll('[data-readit-mermaid-measure]').forEach((node) => node.remove())
  vi.restoreAllMocks()
})

describe('createMermaidRendererWith', () => {
  it('waits for fonts, uses the two-argument offscreen render path, sanitizes, injects, then binds', async () => {
    const events: string[] = []
    let releaseFonts: (() => void) | undefined
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        load: vi.fn(async (font: string) => {
          events.push('font-load')
          expect(font).toBe('18px Inter')
          return []
        }),
        ready: new Promise<void>((resolve) => (releaseFonts = resolve)),
      },
    })
    const initialize = vi.fn((_: Parameters<MermaidAdapter['initialize']>[0]) =>
      events.push('initialize'),
    )
    const bindFunctions = vi.fn(() => events.push('bind'))
    const render = vi.fn(async function (id: string, source: string) {
      events.push('render')
      const temp = document.createElement('div')
      temp.id = `d${id}`
      document.body.appendChild(temp)
      const rule = document.head.querySelector<HTMLStyleElement>('[data-readit-mermaid-measure]')
      expect(rule?.textContent).toContain('position:absolute')
      expect(rule?.textContent).toContain('left:-99999px')
      expect(rule?.textContent).toContain('font-family:Inter!important')
      expect(rule?.textContent).toContain('letter-spacing:normal!important')
      expect(rule?.textContent).toContain(`#d${id} *`)
      expect(rule?.textContent).not.toContain('display:none')
      expect(source).toBe('flowchart LR\nA --> B')
      return { svg: '<svg><script>bad()</script><text>safe</text></svg>', bindFunctions }
    })
    const mermaid: MermaidAdapter = { initialize, render }
    const sanitizer: SvgSanitizer = {
      sanitize(dirty, config) {
        events.push('sanitize')
        expect(dirty).toContain('<script>')
        expect(config).toEqual({
          USE_PROFILES: { svg: true, svgFilters: true, html: true },
          ADD_TAGS: ['foreignObject'],
          HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true },
        })
        return '<svg><text>safe</text></svg>'
      },
    }
    const target = placeholder()
    const hydration = createMermaidRendererWith(mermaid, sanitizer).hydrate(document)
    await Promise.resolve()
    expect(render).not.toHaveBeenCalled()
    releaseFonts?.()
    await hydration

    expect({
      renderArgCounts: render.mock.calls.map((call) => call.length),
      config: initialize.mock.calls[0]?.[0],
      events,
      state: target.dataset['readitMermaidState'],
      bound: target.dataset['readitMermaidBound'],
      hasSafeSvg: target.querySelector('svg text')?.textContent,
      hasScript: target.querySelector('script') !== null,
      tempRemoved: document.querySelector('[id^="dreadit-mermaid-"]') === null,
    }).toEqual({
      renderArgCounts: [2],
      config: {
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        htmlLabels: true,
        fontFamily: 'Inter',
        theme: 'default',
        themeVariables: { fontSize: '18px' },
      },
      events: ['font-load', 'initialize', 'render', 'sanitize', 'bind'],
      state: 'ready',
      bound: 'true',
      hasSafeSvg: 'safe',
      hasScript: false,
      tempRemoved: true,
    })
  })

  it('removes WebKit layer triggers only from foreignObject HTML descendants', async () => {
    const target = placeholder()
    const mermaid: MermaidAdapter = {
      initialize() {},
      async render() {
        return {
          svg:
            '<svg><g transform="translate(1 2)"><foreignObject>' +
            '<div style="opacity:.4; transform:scale(2); filter:blur(1px); color:red" ' +
            'opacity=".4">label</div></foreignObject></g></svg>',
        }
      },
    }
    const sanitizer: SvgSanitizer = { sanitize: (svg) => svg }
    await createMermaidRendererWith(mermaid, sanitizer).hydrate(document)

    const label = target.querySelector<HTMLElement>('foreignObject div')
    expect({
      svgTransform: target.querySelector('g')?.getAttribute('transform'),
      opacityStyle: label?.style.opacity,
      transformStyle: label?.style.transform,
      filterStyle: label?.style.filter,
      opacityAttribute: label?.getAttribute('opacity'),
      color: label?.style.color,
    }).toEqual({
      svgTransform: 'translate(1 2)',
      opacityStyle: '',
      transformStyle: '',
      filterStyle: '',
      opacityAttribute: null,
      color: 'red',
    })
  })

  it('测量规则钉渲染上下文的行高而不是 normal，无法解析成 px 时才回落 normal', async () => {
    // 长标签被裁的成因就在这里。注入后的 SVG 落在 .highlight-source-mermaid 里，
    // 继承 .markdown-body 的 line-height: 1.5（16px 基准下 24px）；而测量若按
    // `normal`（约 1.15–1.2）算，Mermaid 会把 foreignObject 按矮 ~30% 的高度定死，
    // 多行标签就在节点边框处被切掉。两侧必须同值。
    const seen: string[] = []
    const withLineHeight = placeholder()
    withLineHeight.style.lineHeight = '24px'
    const withoutLineHeight = placeholder()

    const mermaid: MermaidAdapter = {
      initialize() {},
      async render() {
        seen.push(
          document.head.querySelector<HTMLStyleElement>('[data-readit-mermaid-measure]')
            ?.textContent ?? '',
        )
        return { svg: '<svg></svg>' }
      },
    }
    await createMermaidRendererWith(mermaid, { sanitize: (svg) => svg }).hydrate(document)

    const occurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1

    expect({
      targets: seen.length,
      // 容器规则与 `#d<ID> *` 规则两处都要带上，后者才是真正命中标签内层元素的那条
      pinnedBoth: occurrences(seen[0] ?? '', 'line-height:24px!important'),
      pinnedLeaksNormal: (seen[0] ?? '').includes('line-height:normal!important'),
      fallbackBoth: occurrences(seen[1] ?? '', 'line-height:normal!important'),
    }).toEqual({
      targets: 2,
      pinnedBoth: 2,
      pinnedLeaksNormal: false,
      fallbackBoth: 2,
    })
  })

  it('keeps source visible and resolves with a named error state on invalid syntax', async () => {
    const source = 'flowchart LR\nA[[[ --> ???'
    const target = placeholder(source)
    const mermaid: MermaidAdapter = {
      initialize() {},
      async render() {
        throw new Error('Parse error on line 2')
      },
    }
    const sanitizer: SvgSanitizer = { sanitize: (svg) => svg }
    const results = await createMermaidRendererWith(mermaid, sanitizer).hydrate(document)

    expect({
      results,
      state: target.dataset['readitMermaidState'],
      source: target.querySelector('pre')?.textContent,
      role: target.querySelector('.readit-mermaid-error')?.getAttribute('role'),
      error: target.querySelector('.readit-mermaid-error')?.textContent,
    }).toEqual({
      results: [{ state: 'error', source }],
      state: 'error',
      source,
      role: 'alert',
      error: 'Mermaid 图表无法渲染：Parse error on line 2',
    })
  })

  it('hydrates each placeholder once', async () => {
    placeholder('flowchart LR\nA --> B')
    placeholder('sequenceDiagram\nA->>B: hi')
    const render = vi.fn(async () => ({ svg: '<svg><text>ok</text></svg>' }))
    const renderer = createMermaidRendererWith(
      { initialize() {}, render },
      { sanitize: (svg) => svg },
    )
    expect((await renderer.hydrate(document)).map((result) => result.state)).toEqual([
      'ready',
      'ready',
    ])
    expect(await renderer.hydrate(document)).toEqual([])
    expect(render).toHaveBeenCalledTimes(2)
  })
})
