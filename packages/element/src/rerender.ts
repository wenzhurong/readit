import { DEFAULT_LOADERS, prepare as corePrepare, render as coreRender, scan as coreScan } from '@readit/core'
import type { Highlighter, InlineMathMode, RenderOptions, ScanResult } from '@readit/core'

/**
 * 防抖间隔（ms）。这个 16 不是猜的，来源是
 * test/rerender-debounce.test.ts：corpus/real-world/ 全部 6 个文件各跑 100 次
 * render()（去掉每文件前 10 次预热），合并 540 个样本的 p95 记作 T，间隔取
 * max(ceil(T), 16)。2026-08-10 实测 T = 2.94 ms，远低于一帧，所以取一帧。
 * 那条测试会在 T 涨过 16 时变红——它是这个常数的来源，不是它的注解。
 */
export const DEBOUNCE_MS = 16

/** 还缺、且还有可能补上的能力。渲染仍然照常发生，只是降级。 */
export type PendingCapability = 'math' | 'highlight'

export interface RerenderHost {
  /** 把整块 HTML 写进 DOM。element 只有一条注入路径（setHtml），由调用方接进来。 */
  paint(html: string): void
  /**
   * 降级必须可见（SPEC §12）：把「仍然缺席」的能力名交给宿主，由它落成
   * 宿主元素上的 data-readit-pending。空数组表示都到齐了。
   * 加载失败的能力也留在这个列表里——静默的永久降级比慢更糟。
   */
  setPending(pending: readonly PendingCapability[]): void
}

export interface RerenderDeps {
  render(src: string, opts: Partial<RenderOptions>): string
  scan(src: string, inlineMath: InlineMathMode): ScanResult
  /** core 的 prepare()：渲染路径上唯一一处 await，数学的动态加载走它。 */
  prepare(src: string, opts: Partial<RenderOptions>): Promise<RenderOptions>
  /**
   * 高亮加载器。P1 不许 @readit/element 在运行时 import @readit/highlight，
   * 所以这条只能由宿主注入；null 表示宿主根本没打算要高亮——那不是「加载中」，
   * 是一个已经完成的选择，不该报进 pending。
   */
  loadHighlighter: (() => Promise<Highlighter>) | null
  setTimer(fn: () => void, ms: number): number
  clearTimer(handle: number): void
  requestFrame(fn: () => void): number
  cancelFrame(handle: number): void
}

export interface Rerenderer {
  /** 用户输入路径：防抖 → rAF 批处理 → 整体重渲。 */
  update(value: string): void
  /** 换文档：立刻同步渲一次，绕开防抖与帧。 */
  setValue(value: string): void
  /** 用当前 value 立刻渲一次（切模式、能力到货后走这条）。 */
  repaint(): void
  destroy(): void
}

/** 浏览器里的真实 deps。loadHighlighter 由宿主给，其余全是标准 API 与 core 的导出。 */
export function browserDeps(loadHighlighter: (() => Promise<Highlighter>) | null): RerenderDeps {
  return {
    render: (src, opts) => coreRender(src, opts),
    scan: (src, inlineMath) => coreScan(src, inlineMath),
    prepare: (src, opts) => corePrepare(src, opts, DEFAULT_LOADERS),
    loadHighlighter,
    setTimer: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimer: (handle) => {
      globalThis.clearTimeout(handle)
    },
    requestFrame: (fn) => globalThis.requestAnimationFrame(fn),
    cancelFrame: (handle) => {
      globalThis.cancelAnimationFrame(handle)
    },
  }
}

export function createRerenderer(
  host: RerenderHost,
  deps: RerenderDeps,
  options: Partial<RenderOptions>,
  initialValue: string,
): Rerenderer {
  const inlineMath: InlineMathMode = options.inlineMath ?? 'github'
  let value = initialValue
  let math = options.math ?? null
  let highlighter = options.highlighter ?? null
  const inflight = new Set<PendingCapability>()
  const failed = new Set<PendingCapability>()
  let timer: number | null = null
  let frame: number | null = null
  let destroyed = false

  const missing = (found: ScanResult): PendingCapability[] => {
    const out: PendingCapability[] = []
    if (found.needsMath && math === null) out.push('math')
    if (found.needsHighlight && highlighter === null && deps.loadHighlighter !== null) out.push('highlight')
    return out
  }

  const kick = (want: readonly PendingCapability[]): void => {
    for (const cap of want) {
      if (inflight.has(cap) || failed.has(cap)) continue
      inflight.add(cap)
      const done = (ok: () => void): void => {
        inflight.delete(cap)
        if (destroyed) return
        ok()
        paint()
      }
      const fail = (): void => {
        inflight.delete(cap)
        failed.add(cap)
        if (!destroyed) host.setPending(missing(deps.scan(value, inlineMath)))
      }
      if (cap === 'math') {
        void deps.prepare(value, { ...options, math, highlighter }).then((resolved) => {
          done(() => {
            math = resolved.math
          })
        }, fail)
      } else {
        const load = deps.loadHighlighter
        if (load === null) continue
        void load().then((h) => {
          done(() => {
            highlighter = h
          })
        }, fail)
      }
    }
  }

  /** 一次完整重渲。**先落笔，再 kick**——降级的那一帧必须先出现在屏幕上。 */
  const paint = (): void => {
    if (destroyed) return
    const found = deps.scan(value, inlineMath)
    const want = missing(found)
    host.setPending(want)
    host.paint(deps.render(value, { ...options, math, highlighter }))
    if (want.length > 0) kick(want)
  }

  const cancelPending = (): void => {
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    if (frame !== null) {
      deps.cancelFrame(frame)
      frame = null
    }
  }

  return {
    update(next) {
      if (destroyed) return
      value = next
      if (timer !== null) deps.clearTimer(timer)
      timer = deps.setTimer(() => {
        timer = null
        if (frame !== null) return
        frame = deps.requestFrame(() => {
          frame = null
          paint()
        })
      }, DEBOUNCE_MS)
    },
    setValue(next) {
      if (destroyed) return
      value = next
      cancelPending()
      paint()
    },
    repaint() {
      if (destroyed) return
      cancelPending()
      paint()
    },
    destroy() {
      destroyed = true
      cancelPending()
    },
  }
}
