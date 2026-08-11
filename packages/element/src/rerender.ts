import { DEFAULT_LOADERS, prepare as corePrepare, render as coreRender, scan as coreScan } from '@readit/core'
import type { Highlighter, InlineMathMode, RenderOptions, ScanResult } from '@readit/core'
import { memoizeHighlighter } from './highlight-memo.js'

/**
 * 防抖间隔（ms）——**未接入高亮**这一档（`highlighter === null`，宿主没打算要高亮，
 * 或高亮还在加载中）。来源是 `test/rerender-perf.perf.ts`：对
 * corpus/real-world/ 全部 6 个文件各模拟一次真实连续编辑（在第一个代码块内容行末尾
 * 连续追加字符、每次都整体重渲，不是每次都冷渲染），去掉每文件前 10 次预热，合并
 * 600 个样本的 p95 记作 T，间隔取 max(ceil(T), 16)。2026-08-10 实测 T = 2.92 ms，
 * 远低于一帧，所以取一帧。那条测试**不进 `npm test`**（见 C2：跨三个 OS 的阻塞矩阵
 * 撑不住一条墙钟断言的抖动），要跑它见 `packages/element/package.json` 的
 * `test:perf` 脚本；它会在 T 涨过 16 时变红——是这个常数的来源，不是它的注解。
 */
export const DEBOUNCE_MS = 16

/**
 * 防抖间隔（ms）——**已接入高亮**这一档（`highlighter !== null`）。
 *
 * 单独测这一档不是为了防御性地留一手：评审用真实的 `createShikiHighlighter` 实测过，
 * 不做记忆化的话，`prepared render()` 的 p95 是 `bare render()` 的 **49.9×**
 * （540 样本，154.81ms vs 3.10ms）——根因是 `codeblock.ts` 对每一个代码块同步调
 * `highlight()`，而重渲是整份文档重渲，编辑一个字符会把所有内容没变的代码块也
 * 重新高亮一遍。真正的修法是 `highlight-memo.ts` 的记忆化代理（`highlight()`
 * 按 Phase A 的硬要求是纯同步、确定性的，缓存对字节零影响，只省重算），
 * 不是把这个常数从 16 改成 155——那是把「渲染慢了 50 倍」这件事记成了一个常数，
 * 这个项目已经因猜数字栽过两次。
 *
 * 加上记忆化之后，`test/rerender-perf.perf.ts` 用同样的「真实连续编辑」协议
 * （模拟用户正在某个代码块里连续敲字——对已接入记忆化高亮的这一档，这是仍会
 * 触发真实重算的最坏日常情形：只有正在编辑的那一个块会缓存未命中，其余块
 * 命中缓存）测出 p95 与「未接入高亮」那一档在同一量级（2026-08-10 实测
 * T = 2.84 ms，600 样本，见该文件），间隔同样取 max(ceil(T), 16) = 16。两档数值目前恰好相等
 * 不是巧合去掉分档的理由——它们是两条**独立**测量、独立断言，一条只测「没有
 * highlighter 参与」的路径，一条专测「highlighter 参与、且必须是真实高亮器」
 * 的路径，只有后者才抓得到「记忆化被不小心删掉」或「Shiki 本身变慢」这类
 * 回归（详见该常数与 DEBOUNCE_MS 的独立注释）。
 */
export const DEBOUNCE_MS_HIGHLIGHT = 16

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
  // 记忆化包一层：宿主直接传入的、以及经 kick() 异步加载到的 highlighter 都要包，
  // 两条路径都会喂进 render()、都会被 codeblock.ts 对每个代码块同步调
  // highlight()——不包其中一条，那一条路径下的宿主仍然会踩 C1 那个 49.9× 的坑。
  // 见 highlight-memo.ts 顶部注释：highlight() 契约上纯同步确定性，包一层缓存
  // 对字节零影响。
  const initialHighlighter = options.highlighter ?? null
  let highlighter = initialHighlighter === null ? null : memoizeHighlighter(initialHighlighter)
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
            highlighter = memoizeHighlighter(h)
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
      // 按当前是否已接入高亮取不同的档：highlighter 是这个闭包里的可变局部量，
      // 排计时器这一刻的值就是这次防抖窗口该用的值——不用一个最坏值去惩罚
      // 没接高亮的宿主（C1）。
      const ms = highlighter !== null ? DEBOUNCE_MS_HIGHLIGHT : DEBOUNCE_MS
      timer = deps.setTimer(() => {
        timer = null
        if (frame !== null) return
        frame = deps.requestFrame(() => {
          frame = null
          paint()
        })
      }, ms)
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
