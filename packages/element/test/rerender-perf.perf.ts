import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, scan } from '@readit/core'
import type { Highlighter, MathRenderer, RenderOptions } from '@readit/core'
import { createShikiHighlighter } from '@readit/highlight'
import { describe, expect, it } from 'vitest'
import { DEBOUNCE_MS, DEBOUNCE_MS_HIGHLIGHT, createRerenderer, type RerenderDeps, type RerenderHost } from '../src/rerender.js'

/**
 * C1 的重做测量：两档都测**真实重渲染路径**，不是 `render(src)` 单参数裸调用。
 *
 * 「真实」体现在三处：
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
 *  3. 模拟真实连续编辑：在文档第一个代码块的内容行末尾连续追加字符、每次都
 *     整体重渲，不是每次都冷渲染。冷渲染量不到记忆化的收益（那正是评审在 C1
 *     里指出的、上一版测量犯的错——`rerender-debounce.test.ts` 原来测的
 *     `render(src)` 单参数调用，既没有 highlighter 参与，也不是连续编辑）。
 *
 * 这份文件**不进 `npm test`**（C2）：`vitest.perf.config.ts` 的 `include` 只认
 * `*.perf.ts`，默认 `include: ['test/**\/*.test.ts']` 的主配置不会捡到它，
 * `.github/workflows/test.yml` 的 `unit` job（ubuntu/macos/windows 三个 OS
 * 阻塞矩阵）因此也碰不到它。跑它：`npm run test:perf`（package.json）。
 * 不做 CI 自动化是本轮的显式取舍，不是遗漏——移出阻塞路径是评审要求的最小修法，
 * 是否再加一个非阻塞的 CI job 留给后续任务决定。
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

function percentile(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(Math.max(Math.ceil(q * sorted.length) - 1, 0), sorted.length - 1)
  return sorted[idx] ?? 0
}

/** 文档里第一个围栏代码块的内容行——真实编辑模拟往这一行追加字符。 */
function findFirstFenceContentLine(lines: readonly string[]): number {
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/
  for (let i = 0; i < lines.length; i++) {
    if (fenceRe.test(lines[i] ?? '')) {
      const next = i + 1
      if (next < lines.length && !fenceRe.test(lines[next] ?? '')) return next
      return -1
    }
  }
  return -1
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
    const lineIdx = findFirstFenceContentLine(original.split('\n'))
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

describe('C1 重做：防抖间隔按真实重渲染路径分档测量，不是猜的、也不是量错路径', () => {
  it('未接入高亮（highlighter: null）：p95 仍低于一帧，DEBOUNCE_MS 仍是 16', () => {
    const { merged, perFile } = measureRealisticEditing({})
    expect(Object.keys(perFile)).toEqual(FILES)
    const p95 = percentile(merged, 0.95)
    const derived = Math.max(Math.ceil(p95), 16)
    expect(
      derived,
      `measured p95 = ${p95.toFixed(2)} ms over ${String(merged.length)} samples (no highlighter, ` +
        `realistic continuous-edit simulation via createRerenderer.setValue()); debounce should be ` +
        `max(ceil(p95), 16) = ${String(derived)} ms. If this is red because render() got slower, ` +
        `report the regression — do not re-pin the constant.`,
    ).toBe(DEBOUNCE_MS)
  })

  it('接入真实 Shiki 高亮（记忆化）：连续编辑同一个代码块，p95 仍低于一帧，DEBOUNCE_MS_HIGHLIGHT 仍是 16', async () => {
    // 语言集取全部 6 个语料文件实际用到的围栏语言，与宿主真实场景一致
    // （不是随手挑几个）：scan() 是 core 自己的过报式扫描，逐字取它的结果。
    const allLangs = new Set<string>()
    for (const file of FILES) {
      const src = readFileSync(join(CORPUS, file), 'utf8')
      for (const lang of scan(src, 'github').languages) allLangs.add(lang)
    }
    const highlighter: Highlighter = await createShikiHighlighter({ langs: [...allLangs] })
    const math = fakeMathRenderer()

    const { merged, perFile } = measureRealisticEditing({ highlighter, math })
    expect(Object.keys(perFile)).toEqual(FILES)
    const p95 = percentile(merged, 0.95)
    const derived = Math.max(Math.ceil(p95), 16)
    expect(
      derived,
      `measured p95 = ${p95.toFixed(2)} ms over ${String(merged.length)} samples (real Shiki highlighter, ` +
        `memoized via rerender.ts's own createRerenderer wiring; realistic continuous-edit-inside-a-code-` +
        `block simulation); debounce should be max(ceil(p95), 16) = ${String(derived)} ms. If this is red ` +
        `because highlighting got slower or memoization regressed, report the regression — do not re-pin ` +
        `the constant, and do not "fix" it by lowering render fidelity (e.g. skipping languages).`,
    ).toBe(DEBOUNCE_MS_HIGHLIGHT)
  })

  it('对照组：不做记忆化（options.highlighter 每次都是全新实例）——复现评审报告的量级差距，证明本轮修法测的是真实瓶颈', async () => {
    const allLangs = new Set<string>()
    for (const file of FILES) {
      const src = readFileSync(join(CORPUS, file), 'utf8')
      for (const lang of scan(src, 'github').languages) allLangs.add(lang)
    }
    const highlighter: Highlighter = await createShikiHighlighter({ langs: [...allLangs] })
    const math = fakeMathRenderer()

    // 直接调 render()（不经 createRerenderer，因此不享受 rerender.ts 里的记忆化包装），
    // 复用同一套「连续编辑」协议。
    const merged: number[] = []
    for (const file of FILES) {
      const original = readFileSync(join(CORPUS, file), 'utf8')
      const lineIdx = findFirstFenceContentLine(original.split('\n'))
      let current = original
      const samples: number[] = []
      for (let i = 0; i < WARMUP + RUNS; i++) {
        if (lineIdx >= 0) {
          const lines = current.split('\n')
          lines[lineIdx] = (lines[lineIdx] ?? '') + String.fromCharCode(97 + (i % 26))
          current = lines.join('\n')
        }
        const t0 = performance.now()
        render(current, { highlighter, math })
        const t1 = performance.now()
        if (i >= WARMUP) samples.push(t1 - t0)
      }
      merged.push(...samples)
    }
    const p95 = percentile(merged, 0.95)
    // 不断言等于某个精确倍数（那是另一种形式的猜数字）——只断言「明显比记忆化后的
    // DEBOUNCE_MS_HIGHLIGHT 慢」，用来证明记忆化确实是那个修法，而不是摆设。
    expect(
      p95,
      `unmemoized p95 = ${p95.toFixed(2)} ms; expected to be well above DEBOUNCE_MS_HIGHLIGHT ` +
        `(${String(DEBOUNCE_MS_HIGHLIGHT)}ms) — if it is not, memoization has stopped mattering for this ` +
        `corpus and the control comparison itself needs re-examining.`,
    ).toBeGreaterThan(DEBOUNCE_MS_HIGHLIGHT * 5)
  })
})
