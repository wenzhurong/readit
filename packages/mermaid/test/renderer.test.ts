import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMermaidRendererWith,
  type MermaidAdapter,
  type SvgSanitizer,
} from '../src/renderer.js'

/** 与 renderer.ts 的 NEUTRAL_LAYER_VALUES 对应。 */
const NEUTRAL: ReadonlyArray<readonly [string, string]> = [
  ['opacity', '1'],
  ['transform', 'none'],
  ['filter', 'none'],
]

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

  it('neutralises WebKit layer triggers only on foreignObject HTML descendants', async () => {
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
      // SVG 侧的几何变换必须留着
      svgTransform: 'translate(1 2)',
      // 从「删掉声明」改成「写上中性值」：外观等价（都回到初始值），但只有后者
      // 压得住样式表里的 !important —— 见 guardForeignObjectLayers 的注释。
      opacityStyle: '1',
      transformStyle: 'none',
      filterStyle: 'none',
      opacityAttribute: null,
      // 三者之外的行内属性不受影响
      color: 'red',
    })
  })

  it('本来没有行内声明的每一层，事后都带上 !important 的中性值——这是能压住样式表的唯一位置', async () => {
    // 真 WebKit 实测（2026-08-17）：`classDef risky opacity:0.3` 不产生行内样式，
    // 它被编译成注入 SVG 的 <style>：`#id .risky span{opacity:0.3!important}`。
    // 标签 span 的 style 属性是 null，计算值却是 0.3 —— 删行内声明够不着。
    //
    // 这条只能钉「写入的形状」：层叠里 style 属性的 !important 排在选择器匹配的
    // 之上，所以中性值写在这里才压得住。**真正的层叠行为由浏览器层守**
    // （browser/element/mermaid.spec.ts 用真 classDef 断言计算值），
    // 因为 happy-dom 会把 <style> 的内容整个丢掉，这里表达不了样式表来源。
    const target = placeholder()
    const mermaid: MermaidAdapter = {
      initialize() {},
      async render() {
        return {
          svg:
            '<svg><g transform="translate(4 8)" class="risky"><foreignObject>' +
            '<div><span class="nodeLabel"><p>label</p></span></div>' +
            '</foreignObject></g></svg>',
        }
      },
    }
    await createMermaidRendererWith(mermaid, { sanitize: (svg) => svg }).hydrate(document)

    const shape = (selector: string): unknown => {
      const el = target.querySelector<HTMLElement>(selector)
      return NEUTRAL.map(([property, value]) => [
        el?.style.getPropertyValue(property) === value,
        el?.style.getPropertyPriority(property),
      ])
    }
    const pinned = [[true, 'important'], [true, 'important'], [true, 'important']]

    expect({
      // foreignObject 里的每一层都要盖到，不只是最外层
      div: shape('foreignObject div'),
      span: shape('foreignObject span'),
      p: shape('foreignObject p'),
      // SVG 侧的几何变换照旧不碰
      svgTransform: target.querySelector('g')?.getAttribute('transform'),
      // foreignObject 自身是 SVG 元素，不在护栏范围内
      foreignObjectStyle: target.querySelector('foreignObject')?.getAttribute('style'),
    }).toEqual({
      div: pinned,
      span: pinned,
      p: pinned,
      svgTransform: 'translate(4 8)',
      foreignObjectStyle: null,
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
