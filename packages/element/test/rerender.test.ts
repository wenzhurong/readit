import { render, scan, prepare } from '@readit/core'
import type { Highlighter, MathRenderer, RenderOptions } from '@readit/core'
import type { MermaidRenderer } from '@readit/mermaid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEBOUNCE_MS,
  DEBOUNCE_MS_HIGHLIGHT,
  createRerenderer,
  type PendingCapability,
  type RerenderDeps,
  type RerenderHost,
} from '../src/rerender.js'

/** 假时钟 + 假帧。真实实现是 setTimeout / requestAnimationFrame。 */
function harness() {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  const frames = new Map<number, () => void>()
  let next = 1
  const painted: string[] = []
  const pending: PendingCapability[][] = []
  const hydrated: MermaidRenderer[] = []

  const host: RerenderHost = {
    paint(html) {
      painted.push(html)
    },
    hydrateMermaid(renderer) {
      hydrated.push(renderer)
    },
    setPending(p) {
      pending.push([...p])
    },
  }

  const loadHighlighter = vi.fn(
    async (): Promise<Highlighter> => ({
      highlight: (code) => `<span class="fake">${code}</span>`,
      supports: () => true,
    }),
  )
  const fakeMermaid: MermaidRenderer = { hydrate: vi.fn(async () => []) }
  const loadMermaid = vi.fn(async (): Promise<MermaidRenderer> => fakeMermaid)

  const fakeMath: MathRenderer = { render: (tex, display) => `<i data-d="${String(display)}">${tex}</i>` }
  const prepareSpy = vi.fn(
    async (src: string, opts: Partial<RenderOptions>): Promise<RenderOptions> =>
      prepare(src, opts, {
        math: () => Promise.resolve({ createMathRenderer: () => fakeMath }),
        highlighter: null,
      }),
  )

  const deps: RerenderDeps = {
    render,
    scan,
    prepare: prepareSpy,
    loadHighlighter,
    loadMermaid,
    setTimer(fn, ms) {
      const id = next++
      timers.set(id, { fn, ms })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    requestFrame(fn) {
      const id = next++
      frames.set(id, fn)
      return id
    },
    cancelFrame(id) {
      frames.delete(id)
    },
  }

  return {
    host,
    deps,
    painted,
    pending,
    hydrated,
    prepareSpy,
    loadHighlighter,
    loadMermaid,
    fakeMermaid,
    timerCount: () => timers.size,
    frameCount: () => frames.size,
    runTimers() {
      const due = [...timers.values()]
      timers.clear()
      for (const t of due) t.fn()
    },
    runFrames() {
      const due = [...frames.values()]
      frames.clear()
      for (const f of due) f()
    },
  }
}

describe('输入 → 防抖 → rAF 批处理 → 整体重渲', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('一个防抖窗口内的三次输入只渲一次', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'a')
    r.update('ab')
    r.update('abc')
    r.update('abcd')
    expect(h.painted).toHaveLength(0)
    h.runTimers()
    h.runFrames()
    expect(h.painted).toHaveLength(1)
    expect(h.painted[0]).toContain('abcd')
    r.destroy()
  })

  it('防抖计时器用的是 DEBOUNCE_MS', () => {
    const seen: number[] = []
    const deps: RerenderDeps = {
      ...h.deps,
      setTimer(fn, ms) {
        seen.push(ms)
        return h.deps.setTimer(fn, ms)
      },
    }
    const r = createRerenderer(h.host, deps, {}, 'a')
    r.update('b')
    expect(seen).toEqual([DEBOUNCE_MS])
    r.destroy()
  })

  it('highlighter 已加载后，防抖计时器改用 DEBOUNCE_MS_HIGHLIGHT（C1：不用一个最坏值惩罚没接高亮的宿主，也不用一个最好值低估已接高亮的成本）', async () => {
    const seen: number[] = []
    const deps: RerenderDeps = {
      ...h.deps,
      setTimer(fn, ms) {
        seen.push(ms)
        return h.deps.setTimer(fn, ms)
      },
    }
    const r = createRerenderer(h.host, deps, {}, '```js\nlet a=1\n```\n')
    r.repaint() // 让 pending 探测到围栏语言、kick 高亮加载
    expect(h.loadHighlighter).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(h.painted.at(-1)).toContain('<span class="fake">')
    })
    seen.length = 0
    r.update('```js\nlet a=2\n```\n')
    expect(seen).toEqual([DEBOUNCE_MS_HIGHLIGHT])
    r.destroy()
  })

  it('宿主在构造时直接传入 highlighter（不经 loadHighlighter）同样按 DEBOUNCE_MS_HIGHLIGHT 计时——初始 highlighter 也要走这一档，不只是异步加载来的那个', () => {
    const seen: number[] = []
    const deps: RerenderDeps = {
      ...h.deps,
      setTimer(fn, ms) {
        seen.push(ms)
        return h.deps.setTimer(fn, ms)
      },
    }
    const preloaded: Highlighter = { highlight: (code) => `<b>${code}</b>`, supports: () => true }
    const r = createRerenderer(h.host, deps, { highlighter: preloaded }, 'a')
    r.update('b')
    expect(seen).toEqual([DEBOUNCE_MS_HIGHLIGHT])
    r.destroy()
  })

  it('计时器到点只是排一帧，渲染发生在帧回调里', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'a')
    r.update('b')
    h.runTimers()
    expect(h.painted).toHaveLength(0)
    expect(h.frameCount()).toBe(1)
    h.runFrames()
    expect(h.painted).toHaveLength(1)
    r.destroy()
  })

  it('setValue() 绕开防抖与帧，立刻渲一次', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'a')
    r.setValue('# H')
    expect(h.painted).toHaveLength(1)
    expect(h.painted[0]).toContain('<h1')
    r.destroy()
  })
})

describe('C1：加载到的 highlighter 被记忆化包裹（集成验证，不只是 highlight-memo.ts 自己的单元测试）', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('同一份未变的代码块重渲两次，只穿透一次 highlight()', async () => {
    let calls = 0
    const countingLoader = vi.fn(
      async (): Promise<Highlighter> => ({
        highlight: (code) => {
          calls++
          return `<span class="fake">${code}</span>`
        },
        supports: () => true,
      }),
    )
    const deps: RerenderDeps = { ...h.deps, loadHighlighter: countingLoader }
    const r = createRerenderer(h.host, deps, {}, '```js\nlet a=1\n```\n')
    r.repaint()
    await vi.waitFor(() => {
      expect(h.painted.at(-1)).toContain('<span class="fake">')
    })
    expect(calls).toBe(1)
    r.repaint() // 内容没变，仍是整体重渲一次
    expect(calls).toBe(1) // 仍是 1：命中缓存，没有再穿透到底层 highlighter
    r.destroy()
  })

  it('高亮加载器收到文档里扫出的围栏语言，而不是被空手调用', async () => {
    // 空手调用是壳里那个缺陷的形状：createShikiHighlighter() 不传 langs 得到空
    // 语言集，supports() 恒 false，每个围栏静默回落朴素 <pre>。加载器如果拿不到
    // 语言，宿主就没有任何办法把这件事做对——所以形参必须真的被送到。
    const seen: string[][] = []
    const loader = vi.fn(async (langs: readonly string[]): Promise<Highlighter> => {
      seen.push([...langs])
      return { highlight: (code) => `<i>${code}</i>`, supports: () => true }
    })
    const deps: RerenderDeps = { ...h.deps, loadHighlighter: loader }
    const r = createRerenderer(h.host, deps, {}, '```ts\na\n```\n\n```rust\nb\n```\n')
    r.repaint()
    await vi.waitFor(() => {
      expect(seen.length).toBe(1)
    })
    expect(seen[0]).toEqual(['ts', 'rust'])
    r.destroy()
  })

  it('换到带新语言的文档会重新加载，且带上历史并集——只给本次的语言，回到旧文档就没人支持了', async () => {
    const seen: string[][] = []
    const loader = vi.fn(async (langs: readonly string[]): Promise<Highlighter> => {
      const supported = new Set(langs)
      seen.push([...langs])
      return {
        highlight: (code, lang) => (supported.has(lang) ? `<i>${code}</i>` : null),
        supports: (lang) => supported.has(lang),
      }
    })
    const deps: RerenderDeps = { ...h.deps, loadHighlighter: loader }
    const r = createRerenderer(h.host, deps, {}, '```ts\na\n```\n')
    r.repaint()
    await vi.waitFor(() => {
      expect(seen.length).toBe(1)
    })

    r.setValue('```rust\nb\n```\n')
    await vi.waitFor(() => {
      expect(seen.length).toBe(2)
    })

    expect(seen).toEqual([['ts'], ['ts', 'rust']])
    r.destroy()
  })

  it('未知围栏语言只请求一次——scan() 按契约过报，不能因为「加载完仍不支持」而反复重载', async () => {
    const seen: string[][] = []
    const loader = vi.fn(async (langs: readonly string[]): Promise<Highlighter> => {
      seen.push([...langs])
      return { highlight: () => null, supports: () => false }
    })
    const deps: RerenderDeps = { ...h.deps, loadHighlighter: loader }
    const r = createRerenderer(h.host, deps, {}, '```zzzznotalanguage\na\n```\n')
    r.repaint()
    await vi.waitFor(() => {
      expect(seen.length).toBe(1)
    })
    r.repaint()
    r.repaint()
    r.repaint()
    await Promise.resolve()
    expect({ loads: seen.length, asked: seen[0] }).toEqual({
      loads: 1,
      asked: ['zzzznotalanguage'],
    })
    r.destroy()
  })

  it('宿主构造时直接传入的 highlighter 同样被包裹，不只是异步加载来的那个', () => {
    let calls = 0
    const preloaded: Highlighter = {
      highlight: (code) => {
        calls++
        return `<b>${code}</b>`
      },
      supports: () => true,
    }
    const r = createRerenderer(h.host, h.deps, { highlighter: preloaded }, '```js\nlet a=1\n```\n')
    r.repaint()
    expect(calls).toBe(1)
    r.repaint()
    expect(calls).toBe(1)
    r.destroy()
  })
})

describe('按需能力探测：数学、高亮与 Mermaid', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('没有 $ 的文档不 kick prepare()', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'plain text')
    r.repaint()
    expect(h.prepareSpy).not.toHaveBeenCalled()
    expect(h.pending.at(-1)).toEqual([])
    r.destroy()
  })

  it('敲出 $ 后 kick 一次，且加载期间照样渲——降级可见，不是空白也不抛错', () => {
    const r = createRerenderer(h.host, h.deps, {}, 'plain text')
    r.setValue('a $x^2$ b')
    expect(h.prepareSpy).toHaveBeenCalledTimes(1)
    expect(h.pending.at(-1)).toEqual(['math'])
    // 这就是「降级必须可见」的具体形态：math 还没到，core 发的是一个装着
    // 字面 TeX 的 <math-renderer>，读者看得见 $x^2$，而不是空白或异常。
    expect(h.painted).toHaveLength(1)
    expect(h.painted[0]).toContain('<math-renderer class="js-inline-math"')
    expect(h.painted[0]).toContain('$x^2$')
    r.destroy()
  })

  it('prepare() 落地后自动再渲一次，这次带上 math，pending 清空', async () => {
    const r = createRerenderer(h.host, h.deps, {}, 'plain text')
    r.setValue('a $x^2$ b')
    await vi.waitFor(() => {
      expect(h.painted).toHaveLength(2)
    })
    expect(h.painted[1]).toContain('<i data-d="false">x^2</i>')
    expect(h.pending.at(-1)).toEqual([])
    r.destroy()
  })

  it('加载在途时的连续输入不会重复 kick', () => {
    const r = createRerenderer(h.host, h.deps, {}, '')
    r.setValue('$a$')
    r.setValue('$ab$')
    r.setValue('$abc$')
    expect(h.prepareSpy).toHaveBeenCalledTimes(1)
    r.destroy()
  })

  it('加载失败的能力不重试，pending 一直报着它——失败也必须可见', async () => {
    const failing: RerenderDeps = {
      ...h.deps,
      prepare: vi.fn(() => Promise.reject(new Error('offline'))),
    }
    const r = createRerenderer(h.host, failing, {}, '')
    r.setValue('$a$')
    await vi.waitFor(() => {
      expect(failing.prepare).toHaveBeenCalledTimes(1)
    })
    r.setValue('$ab$')
    expect(failing.prepare).toHaveBeenCalledTimes(1)
    expect(h.pending.at(-1)).toEqual(['math'])
    r.destroy()
  })

  it('宿主没给高亮加载器时，围栏语言不算 pending——那是宿主的选择，不是加载中', () => {
    const noLoader: RerenderDeps = { ...h.deps, loadHighlighter: null }
    const r = createRerenderer(h.host, noLoader, {}, '')
    r.setValue('```js\nlet a=1\n```\n')
    expect(h.pending.at(-1)).toEqual([])
    r.destroy()
  })

  it('宿主给了高亮加载器时，第一次用到某围栏语言会 kick 它', async () => {
    const r = createRerenderer(h.host, h.deps, {}, '')
    r.setValue('```js\nlet a=1\n```\n')
    expect(h.pending.at(-1)).toEqual(['highlight'])
    expect(h.loadHighlighter).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(h.painted.at(-1)).toContain('<span class="fake">')
    })
    r.destroy()
  })

  it('mermaid 加载期间先落 Phase A 源码并报 pending，能力到货后再水合', async () => {
    const deferred: { resolve: ((renderer: MermaidRenderer) => void) | null } = { resolve: null }
    const loadMermaid = vi.fn(
      () =>
        new Promise<MermaidRenderer>((resolve) => {
          deferred.resolve = resolve
        }),
    )
    const deps: RerenderDeps = { ...h.deps, loadMermaid }
    const r = createRerenderer(h.host, deps, {}, '')
    r.setValue('```mermaid\nflowchart LR\nA --> B\n```\n')

    expect(h.pending.at(-1)).toEqual(['mermaid'])
    expect(loadMermaid).toHaveBeenCalledTimes(1)
    expect(h.painted.at(-1)).toContain('highlight-source-mermaid')
    expect(h.painted.at(-1)).toContain('flowchart LR')
    expect(h.hydrated).toEqual([])

    deferred.resolve?.(h.fakeMermaid)
    await vi.waitFor(() => {
      expect(h.hydrated).toEqual([h.fakeMermaid])
    })
    expect(h.pending.at(-1)).toEqual([])
    r.destroy()
  })

  it('宿主没给 mermaid 加载器时只保留 Phase A，不把已完成的产品选择报成 pending', () => {
    const deps: RerenderDeps = { ...h.deps, loadMermaid: null }
    const r = createRerenderer(h.host, deps, {}, '')
    r.setValue('```mermaid\nflowchart LR\nA --> B\n```\n')
    expect(h.pending.at(-1)).toEqual([])
    expect(h.painted.at(-1)).toContain('flowchart LR')
    expect(h.hydrated).toEqual([])
    r.destroy()
  })

  it('mermaid 加载失败后不重试，pending 与 Phase A 源码都保留', async () => {
    const loadMermaid = vi.fn(() => Promise.reject(new Error('chunk offline')))
    const deps: RerenderDeps = { ...h.deps, loadMermaid }
    const r = createRerenderer(h.host, deps, {}, '')
    r.setValue('```mermaid\nflowchart LR\nA --> B\n```\n')
    await vi.waitFor(() => expect(loadMermaid).toHaveBeenCalledTimes(1))
    r.setValue('```mermaid\nflowchart LR\nA --> C\n```\n')
    expect(loadMermaid).toHaveBeenCalledTimes(1)
    expect(h.pending.at(-1)).toEqual(['mermaid'])
    expect(h.painted.at(-1)).toContain('A --&gt; C')
    r.destroy()
  })
})

describe('destroy()', () => {
  it('取消未到点的计时器与未跑的帧，且迟到的加载不再落笔', async () => {
    const h = harness()
    // 包一层对象而不是裸 `let resolveLate: T | null = null`：TypeScript 的控制流
    // 分析在「变量声明为 null，随后只在一个异步执行的闭包里被赋值，再在外层读」
    // 这个形状下会把外层读到的类型收窄回声明时的 null，`resolveLate?.(...)`
    // 因此在编译期被判成对 never 调用（TS2349）。落进对象属性上可以绕开——
    // 属性访问不享受同一套变量级收窄，读到的仍是声明的联合类型。运行时行为不变。
    const deferred: { resolve: ((h: Highlighter) => void) | null } = { resolve: null }
    const late: RerenderDeps = {
      ...h.deps,
      loadHighlighter: () =>
        new Promise<Highlighter>((res) => {
          deferred.resolve = res
        }),
    }
    const r = createRerenderer(h.host, late, {}, '')
    r.setValue('```js\nx\n```\n')
    r.update('```js\ny\n```\n')
    expect(h.timerCount()).toBe(1)
    r.destroy()
    expect(h.timerCount()).toBe(0)
    expect(h.frameCount()).toBe(0)
    const before = h.painted.length
    deferred.resolve?.({ highlight: () => '<b>x</b>', supports: () => true })
    await Promise.resolve()
    await Promise.resolve()
    expect(h.painted).toHaveLength(before)
  })
})
