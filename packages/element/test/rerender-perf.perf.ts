import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, scan } from '@readit/core'
import type { Highlighter, MathRenderer, RenderOptions } from '@readit/core'
import { createShikiHighlighter } from '@readit/highlight'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEBOUNCE_MS, DEBOUNCE_MS_HIGHLIGHT, createRerenderer, type RerenderDeps, type RerenderHost } from '../src/rerender.js'

/**
 * C1 的重做测量：两档都测**真实重渲染路径**，不是 `render(src)` 单参数裸调用。
 *
 * 「真实」体现在四处：
 *  1. 走 `createRerenderer` 的公开 API（`setValue()`），不是自己手搓一个
 *     `render(value, {highlighter})` 调用——这样如果 `rerender.ts` 里
 *     `memoizeHighlighter()` 那两处包装被谁不小心删掉，本文件的测量会
 *     自动变慢、断言会自动变红，而不需要这个文件自己知道「应该被包一层」
 *     这件事。计时点选在注入进 `deps.render` 的包装函数里，只量
 *     `render()` 自己的耗时，不含 `scan()`/`setPending()` 这些开销更小的步骤，
 *     与 Task 15 原始测量的范围一致。
 *  2. highlighter 用真实的 `createShikiHighlighter`（不是桩）——评审用真实 Shiki
 *     测出的 49.9× 差距，桩测不出来。math 用下面的 `fakeMathRenderer()`，
 *     不是真实的 `@readit/math`：P1 完全禁止 `@readit/element` 依赖
 *     `@readit/math`（`test/import-direction.test.ts` 的 manifest 级检查
 *     连 devDependencies 都不放过——`ALLOWED['@readit/element']` 压根没有
 *     `@readit/math` 这个键，不像 `@readit/highlight` 那样至少留了
 *     `['type']`）。这不是抄近路：评审自己的实测已经把 math 的开销钉成
 *     「几乎无开销（1.36/2.62ms）——拖慢的完全是 highlighter」，本文件要测的
 *     维度是 highlighter，一个纯同步、按输入变化的假 math 不影响这个结论。
 *  3. 模拟真实连续编辑：在**每个文件里内容量最大的那个真正会走
 *     highlighter.highlight() 的围栏代码块**（`findLargestHighlightableContentLine`）
 *     的内容行末尾连续追加字符、每次都整体重渲，不是每次都冷渲染。
 *     这条经过一次真实的返工：最初编辑的是「第一个」围栏块，
 *     但 hast-util-sanitize.md / markdown-it.md / sindresorhus-is.md / tauri.md
 *     的第一个块都只有 1 行、二三十个字符——测的是编辑一个便宜块的乐观情形，
 *     不是真实用户会做的事（用户完全可能在文档里最大的代码块里打字）。
 *     换成「最大块」后合并 p95 从 ~2.8ms 涨到 ~30ms，DEBOUNCE_MS_HIGHLIGHT
 *     因此从 16 重导为下面这个更大的数——这正是 C1 教训的重演：静态推理
 *     「反正测的是最坏日常情形」不成立，得真的换个块量一遍才知道。
 *     `findLargestHighlightableContentLine` 排除 mermaid/math 围栏（与 core 的
 *     `scan()` 同一分类逻辑——mermaid.md 里字符数最多的块其实是个 mermaid 图，
 *     从不会被 highlighter.highlight() 摸到，选它做「最大块」会把这份测量
 *     悄悄测偏）。
 *  4. 两条独立的正确性维度各有专属断言，而不是共用一条数字，分工写在下面
 *     「两条断言分工」一节。
 *
 * 这份文件**不进 `npm test`**（C2）：`vitest.perf.config.ts` 的 `include` 只认
 * `*.perf.ts`，默认 `include: ['test/**\/*.test.ts']` 的主配置不会捡到它，
 * `.github/workflows/test.yml` 的 `unit` job（ubuntu/macos/windows 三个 OS
 * 阻塞矩阵）因此也碰不到它。跑它：`npm run test:perf`（现在根 `package.json`
 * 与 `.github/workflows/test.yml` 的 `perf` job 都接上了，ubuntu 单机跑一次）。
 *
 * ## 两条断言分工（都留着，不是互相冗余）
 *
 * - **比值断言**（`highlightedP95 / plainP95 <= RATIO_UPPER_BOUND`）是**回归哨兵**，
 *   在任何机器上都稳定：分子分母被同一台机器的整体快慢等比例约掉了。修复前的
 *   真实差距是 49.9×，修复后是 ~11×；上界的推导见 `RATIO_UPPER_BOUND` 旁的注释。
 *   这是 CI 里真正该信的那条——它不会因为 GitHub Actions 的 runner 某天分到的
 *   物理核心慢了而假红。
 * - **绝对值断言**（`derived === DEBOUNCE_MS` / `derived === DEBOUNCE_MS_HIGHLIGHT`）
 *   解释的是「这两个常数为什么恰好是这两个数」——它们是 `DEBOUNCE_MS`/
 *   `DEBOUNCE_MS_HIGHLIGHT` 的**出处**，answers "why 16" / "why the other number"，
 *   不是回归哨兵：它们仍然会随机器快慢有一定波动（`perf` job 固定跑在
 *   ubuntu-latest 上正是为了让这条尽量稳），比值断言不受这个波动影响。
 */

/** 见上面第 2 条：不用真实 @readit/math，纯同步、按输入变化即可。 */
function fakeMathRenderer(): MathRenderer {
  return {
    render: (tex, display) => `<span class="fake-math" data-display="${String(display)}">${tex}</span>`,
  }
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(TEST_DIR, '..', '..', 'core', 'test', 'corpus', 'real-world')
const RUNS = 100
const WARMUP = 10

const FILES = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.md'))
  .sort()

/**
 * 每档应有的样本总数：6 个文件 × RUNS。原 `rerender-debounce.test.ts` 的那条
 * `toHaveLength` 钉子挪到这份文件里，为每一档都留一条——挪文件的那一版曾经掉过一次
 * （只在失败信息里带上 `merged.length`，没有任何断言真的钉住它），补回来。
 *
 * 是 `FILES.length * RUNS`，不是 `FILES.length * (RUNS - WARMUP)`：这份文件里
 * `measureRealisticEditing()`/对照组的循环跑 `WARMUP + RUNS` 次、只丢弃前 `WARMUP`
 * 次（`samples.slice(WARMUP)`），留下的是 `RUNS` 个样本——`WARMUP` 是在总次数之外
 * 额外多跑的预热，不是从 `RUNS` 里扣掉的一部分。这与已删除的
 * `rerender-debounce.test.ts` 旧版本的约定不同（那边 `RUNS` 是总次数、`WARMUP`
 * 从里面扣），两种写法都自洽，但公式不能从一份文件抄到另一份不检查循环形状——
 * 第一次这样抄就把这条钉子写错了（`expected 540 but got 600`），已改正。
 */
const EXPECTED_SAMPLE_COUNT = FILES.length * RUNS

function percentile(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(Math.max(Math.ceil(q * sorted.length) - 1, 0), sorted.length - 1)
  return sorted[idx] ?? 0
}

const FENCE_WITH_LANG = /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9][A-Za-z0-9+#._-]*)?/

/**
 * 文档里内容量最大的、真正会走 `highlighter.highlight()` 的围栏块的内容起始行——
 * 真实编辑模拟往这一行追加字符。排除语言是 `mermaid`/`math` 的围栏（与
 * `packages/core/src/prepare.ts` 的 `scan()` 同一分类：那两种围栏走独立的渲染
 * 路径，从不进 `codeblock.ts` 的 `highlighter?.highlight()` 调用），也排除裸围栏
 * （无语言标注，`codeblock.ts` 里 `scopeClassFor('')` 判定不出高亮 class，同样
 * 不会摸到 highlighter）。找不到任何符合条件的块时返回 -1（调用方据此跳过追加，
 * 该文件的重渲仍然照跑，只是内容不变）。
 */
function findLargestHighlightableContentLine(lines: readonly string[]): number {
  let bestLine = -1
  let bestSize = -1
  let openAt = -1
  let openLang = ''
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_WITH_LANG.exec(lines[i] ?? '')
    if (m !== null) {
      if (openAt === -1) {
        openAt = i
        openLang = m[2] ?? ''
      } else {
        const contentStart = openAt + 1
        if (contentStart < i && openLang !== 'mermaid' && openLang !== 'math' && openLang !== '') {
          const size = lines.slice(contentStart, i).reduce((sum, l) => sum + l.length, 0)
          if (size > bestSize) {
            bestSize = size
            bestLine = contentStart
          }
        }
        openAt = -1
      }
    }
  }
  return bestLine
}

/**
 * 一个不会真的调度计时器/帧的 RerenderDeps 壳：本文件只用 setValue()，走同步
 * paint()。`prepare` 故意给一个永不 resolve 的 Promise——两档场景要么已经在
 * `options.math` 里预先给好真实 MathRenderer（math 不会被判定为缺失，
 * kick() 根本不会调它），要么就是「未接入高亮」场景里 math 确实缺失、
 * 会被 kick 一次，但本文件不关心 math 的异步加载几时落地，只关心
 * `render()` 自己每次调用的同步耗时；让它真的走 `@readit/core` 的
 * `prepare()`（进而动态 import `@readit/math`）只会引入一次不受控的后台
 * 加载，混进「这份测量到底在测什么」，与本文件的度量维度无关。
 */
function noopSchedulingDeps(timedRender: RerenderDeps['render'], loadHighlighter: RerenderDeps['loadHighlighter']): RerenderDeps {
  return {
    render: timedRender,
    scan,
    prepare: () => new Promise<RenderOptions>(() => {}),
    loadHighlighter,
    setTimer: () => 0,
    clearTimer: () => {},
    requestFrame: () => 0,
    cancelFrame: () => {},
  }
}

/**
 * 用 `createRerenderer` 的真实 `setValue()` 驱动一次「打开文档 + 连续编辑」会话，
 * 只计时喂给它的 `render` 依赖——即 rerender.ts:168 那次调用本身。
 */
function measureRealisticEditing(options: Partial<RenderOptions>): { perFile: Record<string, number>; merged: number[] } {
  const perFile: Record<string, number> = {}
  const merged: number[] = []
  const host: RerenderHost = { paint: () => {}, setPending: () => {} }

  for (const file of FILES) {
    const original = readFileSync(join(CORPUS, file), 'utf8')
    const lineIdx = findLargestHighlightableContentLine(original.split('\n'))
    const samples: number[] = []
    let current = original

    const timedRender: RerenderDeps['render'] = (src, opts) => {
      const t0 = performance.now()
      const html = render(src, opts)
      const t1 = performance.now()
      samples.push(t1 - t0)
      return html
    }
    const deps = noopSchedulingDeps(timedRender, null)
    const r = createRerenderer(host, deps, options, current)

    for (let i = 0; i < WARMUP + RUNS; i++) {
      if (lineIdx >= 0) {
        const lines = current.split('\n')
        lines[lineIdx] = (lines[lineIdx] ?? '') + String.fromCharCode(97 + (i % 26))
        current = lines.join('\n')
      }
      r.setValue(current) // 同步：立刻触发一次 paint() → deps.render()，绕开防抖/帧
    }
    r.destroy()

    const measured = samples.slice(WARMUP) // 去掉每文件前 WARMUP 次（首次含冷启动/JIT 预热）
    perFile[file] = percentile(measured, 0.95)
    merged.push(...measured)
  }
  return { perFile, merged }
}

/**
 * 比值上界的依据（不是拍脑袋）：本机独立测了 4 轮「未接入高亮」/「已接入记忆化
 * 高亮」这对分布，merged p95 比值分别是 10.61 / 10.82 / 10.71 / 11.76×，单文件
 * 比值里最高的是 hast-util-sanitize.md，四轮分别是 16.9 / 20.9 / 21.9 / 19.6×。
 * 对照组（同样的真实 Shiki，但不做记忆化）复现出的比值稳定在 ~53×（150ms 量级
 * 除以 ~2.8ms，见下面「对照组」用例）。
 *
 * 25× 的位置：比观测到的最高单文件比值（21.9×）还高，给机器噪声与语料变化留
 * 余量；同时明显低于对照组比值的一半（53/2≈26.5，取整数留一点距离），
 * 一次真实的「记忆化被删掉」或「Shiki 显著退化」会把比值推向 50× 量级，
 * 25× 早在半路就会先红。
 */
const RATIO_UPPER_BOUND = 25

/**
 * 「已接入高亮」这一档的 DEBOUNCE_MS_HIGHLIGHT 推导。原来「未接入高亮」那一档用的
 * `Math.max(Math.ceil(p95), DEBOUNCE_MS_FLOOR)` 在这一档不能直接照搬：独立跑了
 * 8 次这份测量（同一份代码，未改动），p95 落在 29.63 / 29.67 / 29.91 / 29.93 /
 * 29.95 / 30.01 / 30.03 / 30.25 ms——紧贴着「30」这个整数边界两侧。不加缓冲直接
 * `Math.ceil`，这 8 次会给出 30 或 31 两种不同结果，而这中间没有任何一次代码改动：
 * 纯粹是测量噪声贴着取整边界，`expect(derived).toBe(DEBOUNCE_MS_HIGHLIGHT)`
 * 这种精确匹配会在两个值之间随 CI 跑批闪烁，那不是回归信号，是坏测试。
 *
 * 「未接入高亮」那一档不需要这个处理，因为它的地板本身就有 5 倍以上余量
 * （measured ~2.8ms vs DEBOUNCE_MS=16ms）——地板吸收了全部噪声，`Math.ceil`
 * 落在哪个整数根本不影响 `Math.max(..., 16)` 的结果。这一档没有这层保护
 * （测出来的值本身就*是*那个决定性的数），所以要显式处理。
 *
 * 处理方式：先加 5ms 缓冲再取整到十的倍数——`Math.ceil((p95 + 5) / 10) * 10`。
 * 用上面全部 8 个实测样本验证过：29.63+5=34.63→40，30.25+5=35.25→40，
 * 全部 8 个样本在加缓冲后都落进同一个「40」桶，不再有任何一次会给出别的结果。
 * 40ms 相对最高实测样本（30.25ms）留了约 32% 余量（9.75ms）——不是碰巧凑出来的
 * 整数，是这条公式在这批真实分布上稳定收敛到的值。
 *
 * 代价：这个缓冲会吞掉一次「个位数到十位数百分比」量级的真实变慢（比如从 30ms
 * 涨到 34ms 不会让这条断言变红）。这是刻意的取舍，不是漏判——真正的回归哨兵是
 * 上面的 RATIO_UPPER_BOUND 那条比值断言（跨机器稳定，不受这层取整影响）；
 * 这条绝对值断言的职责按文件头「两条断言分工」写的，只是解释
 * DEBOUNCE_MS_HIGHLIGHT 这个常数从哪来，不是最后一道回归防线。
 */
function deriveHighlightedDebounceMs(p95: number): number {
  const CUSHION_MS = 5
  const ROUND_TO_MS = 10
  return Math.max(Math.ceil((p95 + CUSHION_MS) / ROUND_TO_MS) * ROUND_TO_MS, DEBOUNCE_MS)
}

describe('C1 重做：防抖间隔按真实重渲染路径分档测量，不是猜的、也不是量错路径', () => {
  let allLangs: string[]
  let rawHighlighter: Highlighter
  let a: { perFile: Record<string, number>; merged: number[] }
  let b: { perFile: Record<string, number>; merged: number[] }

  beforeAll(async () => {
    const langs = new Set<string>()
    for (const file of FILES) {
      const src = readFileSync(join(CORPUS, file), 'utf8')
      for (const lang of scan(src, 'github').languages) langs.add(lang)
    }
    allLangs = [...langs]
    rawHighlighter = await createShikiHighlighter({ langs: allLangs })
    const math = fakeMathRenderer()
    a = measureRealisticEditing({})
    b = measureRealisticEditing({ highlighter: rawHighlighter, math })
  }, 60_000)

  it('样本量对得上：两档都是 6 个文件 × RUNS，没有文件因为某种原因贡献 0 个样本', () => {
    expect(Object.keys(a.perFile), '未接入高亮档').toEqual(FILES)
    expect(Object.keys(b.perFile), '已接入高亮档').toEqual(FILES)
    expect(a.merged, '未接入高亮档 merged 长度').toHaveLength(EXPECTED_SAMPLE_COUNT)
    expect(b.merged, '已接入高亮档 merged 长度').toHaveLength(EXPECTED_SAMPLE_COUNT)
  })

  it('未接入高亮（highlighter: null）：p95 仍低于一帧，DEBOUNCE_MS 仍是 16', () => {
    const p95 = percentile(a.merged, 0.95)
    const derived = Math.max(Math.ceil(p95), 16)
    expect(
      derived,
      `measured p95 = ${p95.toFixed(2)} ms over ${String(a.merged.length)} samples (no highlighter, ` +
        `realistic continuous-edit simulation via createRerenderer.setValue(), editing each file's ` +
        `largest highlightable fence — see file header); debounce should be max(ceil(p95), 16) = ` +
        `${String(derived)} ms. If this is red because render() got slower, report the regression — ` +
        `do not re-pin the constant.`,
    ).toBe(DEBOUNCE_MS)
  })

  it('接入真实 Shiki 高亮（记忆化，编辑每个文件里最大的可高亮代码块）：DEBOUNCE_MS_HIGHLIGHT 按这个最坏情形重导', () => {
    const p95 = percentile(b.merged, 0.95)
    // 用 deriveHighlightedDebounceMs 而不是原来那条 `max(ceil(p95), 16)`：
    // 独立跑了 8 次，测出的 p95 落在 29.63–30.25ms 之间——紧贴着「30」这个整数
    // 边界两侧。`Math.ceil` 不加缓冲的话，同一份没有任何改动的代码，今天测出来
    // 是 30、明天测出来是 31，CI 里的 perf job 会在两个值之间随机闪烁，
    // 那不是「代码变慢了」，是量出来的数字紧贴着取整边界。derive 函数里有
    // 完整推导，这里只断言它的结果。
    const derived = deriveHighlightedDebounceMs(p95)
    expect(
      derived,
      `measured p95 = ${p95.toFixed(2)} ms over ${String(b.merged.length)} samples (real Shiki highlighter, ` +
        `memoized via rerender.ts's own createRerenderer wiring; realistic continuous-edit-inside-the-` +
        `largest-highlightable-block simulation — editing the first block instead measured an ` +
        `optimistic ~2.8ms because most files' first fence is a one-liner); debounce should be ` +
        `deriveHighlightedDebounceMs(p95) = ${String(derived)} ms. If this is red because highlighting got ` +
        `slower or memoization regressed, report the regression — do not re-pin the constant, and do not ` +
        `"fix" it by lowering render fidelity (e.g. skipping languages) or by editing a smaller block.`,
    ).toBe(DEBOUNCE_MS_HIGHLIGHT)
  })

  it('比值哨兵：已接入高亮档相对未接入高亮档的 p95 比值，跨机器稳定，是真正该被 CI 信任的回归信号', () => {
    const pA = percentile(a.merged, 0.95)
    const pB = percentile(b.merged, 0.95)
    const ratio = pB / pA
    expect(
      ratio,
      `ratio = ${ratio.toFixed(2)}× (A p95=${pA.toFixed(2)}ms, B p95=${pB.toFixed(2)}ms). Healthy runs on ` +
        `this machine measured 10.6–11.8× merged / up to ~22× on the single worst file; the unmemoized ` +
        `control below reproduces ~50×. Upper bound is ${String(RATIO_UPPER_BOUND)}× — see the constant's ` +
        `comment for the derivation. This assertion is machine-speed-independent (both numbers scale ` +
        `together with CPU speed); if it's red, something about highlighting itself got relatively more ` +
        `expensive — report the regression, do not raise the bound to make it pass.`,
    ).toBeLessThan(RATIO_UPPER_BOUND)
  })

  it('对照组：不做记忆化（每次都是全新的 Shiki highlighter 实例）——复现评审报告的量级差距，证明比值哨兵的上界确实卡在健康与破坏之间', () => {
    const math = fakeMathRenderer()
    const merged: number[] = []
    for (const file of FILES) {
      const original = readFileSync(join(CORPUS, file), 'utf8')
      const lineIdx = findLargestHighlightableContentLine(original.split('\n'))
      let current = original
      const samples: number[] = []
      for (let i = 0; i < WARMUP + RUNS; i++) {
        if (lineIdx >= 0) {
          const lines = current.split('\n')
          lines[lineIdx] = (lines[lineIdx] ?? '') + String.fromCharCode(97 + (i % 26))
          current = lines.join('\n')
        }
        const t0 = performance.now()
        // 直接调 render()（不经 createRerenderer，因此不享受 rerender.ts 里的记忆化包装），
        // 复用同一套「编辑最大块」协议与同一个 rawHighlighter（未被包裹）。
        render(current, { highlighter: rawHighlighter, math })
        const t1 = performance.now()
        if (i >= WARMUP) samples.push(t1 - t0)
      }
      merged.push(...samples)
    }
    expect(merged, '对照组 merged 长度').toHaveLength(EXPECTED_SAMPLE_COUNT)

    const pA = percentile(a.merged, 0.95)
    const pUnmemo = percentile(merged, 0.95)
    const unmemoRatio = pUnmemo / pA
    // 不断言等于某个精确倍数（那是另一种形式的猜数字）——只断言「比值上界确实
    // 卡在健康（~11×）与破坏（~50×）之间」，用真实数字证明 RATIO_UPPER_BOUND
    // 不是拍脑袋选的中间值。
    expect(
      unmemoRatio,
      `unmemoized ratio = ${unmemoRatio.toFixed(2)}× (unmemoized p95=${pUnmemo.toFixed(2)}ms, ` +
        `A p95=${pA.toFixed(2)}ms); expected to be well above RATIO_UPPER_BOUND (${String(RATIO_UPPER_BOUND)}×) ` +
        `— if it is not, memoization has stopped mattering for this corpus and both the control ` +
        `comparison and RATIO_UPPER_BOUND's derivation need re-examining.`,
    ).toBeGreaterThan(RATIO_UPPER_BOUND * 1.5)
  })
})
