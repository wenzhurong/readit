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
      value: { ready: new Promise<void>((resolve) => (releaseFonts = resolve)) },
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
      expect(rule?.textContent).not.toContain('display:none')
      expect(source).toBe('flowchart LR\nA --> B')
      return { svg: '<svg><script>bad()</script><text>safe</text></svg>', bindFunctions }
    })
    const mermaid: MermaidAdapter = { initialize, render }
    const sanitizer: SvgSanitizer = {
      sanitize(dirty) {
        events.push('sanitize')
        expect(dirty).toContain('<script>')
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
      events: ['initialize', 'render', 'sanitize', 'bind'],
      state: 'ready',
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
