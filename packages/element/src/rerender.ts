import { DEFAULT_LOADERS, prepare as corePrepare, render as coreRender, scan as coreScan } from '@readit/core'
import type { Highlighter, InlineMathMode, RenderOptions, ScanResult } from '@readit/core'
import type { MermaidRenderer } from '@readit/mermaid'
import { memoizeHighlighter } from './highlight-memo.js'

/**
 * 防抖间隔（ms）——**未接入高亮**这一档（`highlighter === null`，宿主没打算要高亮，
 * 或高亮还在加载中）。来源是 `test/rerender-perf.perf.ts`：对
 * corpus/real-world/ 全部 6 个文件各模拟一次真实连续编辑（在每个文件里内容量最大
 * 的、真正会走 highlighter.highlight() 的围栏块内容行末尾连续追加字符、每次都
 * 整体重渲，不是每次都冷渲染），合并 600 个样本的 p95 记作 T，间隔取
 * max(ceil(T), 16)。2026-08-10 实测 T ≈ 2.6-2.9 ms（多次独立运行的范围），
 * 远低于一帧，所以取一帧。那条测试**不进 `npm test`**（见 C2：跨三个 OS 的阻塞矩阵
 * 撑不住一条墙钟断言的抖动），跑它用根 `package.json` 的 `test:perf` 脚本
 * （`.github/workflows/test.yml` 的 `perf` job 在 ubuntu 单机跑一次）；
 * 它会在 T 涨过 16 时变红——是这个常数的来源，不是它的注解。
 *
 * 这一档编辑的是「最大可高亮块」而不是「第一个块」——见 `DEBOUNCE_MS_HIGHLIGHT`
 * 注释里的教训，这一档虽然数值不敏感（没有 highlighter 参与，块大小不影响
 * markdown 解析耗时），但两档共用同一套编辑协议，避免同一份文件里存在两种
 * 互相不一致的「真实编辑」定义。
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
 * **这个数经历过一次返工，记录下来是因为过程本身有教训**：加上记忆化之后第一次
 * 测量，编辑的是文档「第一个」围栏块，测出 p95 ≈2.8ms、与未接入高亮那档同一量级，
 * 一度以为两档数值巧合相等。但语料里 4/6 个文件的第一个块只有 1 行、二三十个
 * 字符——那是「编辑一个便宜块」的乐观情形，不是真实用户会做的事（用户完全可能在
 * 文档里最大的代码块里打字）。换成编辑「每个文件里内容量最大、真正会走
 * highlight() 的块」（`findLargestHighlightableContentLine`，排除 mermaid/math
 * 围栏——语料里字符数最多的单个块其实是 mermaid.md 的一张 mermaid 图，从不会被
 * highlighter 摸到，选它会把测量测偏）后，合并 p95 从 ~2.8ms 涨到 ~30ms
 * （hast-util-sanitize.md 与 sindresorhus-is.md 各自的最大块——689 与 1066
 * 字符——p95 分别在 29-30ms 与 38-39ms）。这正是 C1 教训的重演：「看起来合理的
 * 调用形状」本身就可能是错的，得真的换一种编辑目标重新量一遍才知道，不能停在
 * 静态推理。
 *
 * 数值本身：独立跑了 8 次这份新测量（同一份代码，未改动），p95 落在
 * 29.63-30.25ms 之间——紧贴着「30」这个整数边界，直接 `Math.ceil` 会让这 8 次
 * 给出 30 或 31 两种不同结果，纯粹是测量噪声而非代码变化。
 * `test/rerender-perf.perf.ts` 的 `deriveHighlightedDebounceMs()` 因此在取整前
 * 先加 5ms 缓冲、再取整到十的倍数，8 个样本全部稳定收敛到 40——相对最高单次样本
 * （30.25ms）留了约 32% 余量。
 *
 * 真正的回归哨兵不是这个常数的精确匹配，是 `test/rerender-perf.perf.ts` 里的
 * **比值断言**（已接入高亮档 p95 / 未接入高亮档 p95 ≤ 25×，跨机器稳定，不受
 * 「哪台机器测的」影响）——这个绝对值常数解释的只是「40 这个数从哪来」，
 * 详见该文件文件头「两条断言分工」一节。
 */
export const DEBOUNCE_MS_HIGHLIGHT = 40

/** 还缺、且还有可能补上的能力。渲染仍然照常发生，只是降级。 */
export type PendingCapability = 'math' | 'highlight' | 'mermaid'

export interface RerenderHost {
  /** 把整块 HTML 写进 DOM。element 只有一条注入路径（setHtml），由调用方接进来。 */
  paint(html: string): void
  /** Phase A HTML 落地后，把其中的 mermaid 占位符原地水合。 */
  hydrateMermaid(renderer: MermaidRenderer): void
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
  /** Mermaid 与高亮同样由宿主注入，元素包对它只有类型边。 */
  loadMermaid: (() => Promise<MermaidRenderer>) | null
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

/** 浏览器里的真实 deps。两个可选重能力由宿主给，其余全是标准 API 与 core 的导出。 */
export function browserDeps(
  loadHighlighter: (() => Promise<Highlighter>) | null,
  loadMermaid: (() => Promise<MermaidRenderer>) | null = null,
): RerenderDeps {
  return {
    render: (src, opts) => coreRender(src, opts),
    scan: (src, inlineMath) => coreScan(src, inlineMath),
    prepare: (src, opts) => corePrepare(src, opts, DEFAULT_LOADERS),
    loadHighlighter,
    loadMermaid,
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
  let mermaid: MermaidRenderer | null = null
  const inflight = new Set<PendingCapability>()
  const failed = new Set<PendingCapability>()
  let timer: number | null = null
  let frame: number | null = null
  let destroyed = false

  const missing = (found: ScanResult): PendingCapability[] => {
    const out: PendingCapability[] = []
    if (found.needsMath && math === null) out.push('math')
    if (found.needsHighlight && highlighter === null && deps.loadHighlighter !== null) out.push('highlight')
    if (found.needsMermaid && mermaid === null && deps.loadMermaid !== null) out.push('mermaid')
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
      } else if (cap === 'highlight') {
        const load = deps.loadHighlighter
        if (load === null) continue
        void load().then((h) => {
          done(() => {
            highlighter = memoizeHighlighter(h)
          })
        }, fail)
      } else {
        const load = deps.loadMermaid
        if (load === null) continue
        void load().then((renderer) => {
          done(() => {
            mermaid = renderer
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
    if (found.needsMermaid && mermaid !== null) host.hydrateMermaid(mermaid)
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
