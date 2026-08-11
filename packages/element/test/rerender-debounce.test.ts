import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '@readit/core'
import { describe, expect, it } from 'vitest'
import { DEBOUNCE_MS } from '../src/rerender.js'

/**
 * 「按 p95 定」这句话在这里有确切含义：对 corpus/real-world/ 全部 6 个文件
 * 各跑 RUNS 次 render()，去掉每文件前 WARMUP 次，把剩下 6*(RUNS-WARMUP) 个
 * 样本合成一个分布，取它的 p95 记作 T，防抖间隔取 max(ceil(T), 16)
 * （16ms 是一帧，低于一帧的防抖没有意义）。
 *
 * 2026-08-10 实测（Darwin 25.5.0 / Node 22.23.1，RUNS=100 / WARMUP=10）：
 *   gitignore 1.07 · hast-util-sanitize 1.72 · markdown-it 0.39
 *   mermaid 3.73 · sindresorhus-is 2.79 · tauri 1.04   （各自 p95，ms）
 *   合并 6*(100-10)=540 样本：p50 1.07 · p95 2.94 · p99 3.70
 * 所以 T=2.94 → max(3, 16) = 16。
 *
 * 这条断言会随代码变慢而变红。**变红时先上报，不要重钉这个数**——把
 * DEBOUNCE_MS 从 16 改成 40 是把「渲染慢了 14 倍」这件事记成了一个常数。
 */
// 不用 `new URL('../../core/test/corpus/real-world/', import.meta.url)`：happy-dom
// （§0 A2，本包的 vitest environment）的全局 URL 构造器对「相对路径 + file: base」
// 解析有 bug——不管传进去的 base 是什么，结果的 scheme 总变成它自己伪造的
// http://localhost:.../@fs/... location，readdirSync/readFileSync 会抛
// "The URL must be of scheme file"（同一缺陷已在 test/leak.test.ts:162-170 与
// test/set-html-usage.test.ts 记录过）。改用 dirname(fileURLToPath(import.meta.url))
// + join 全程走 node:path，不经过全局 URL。
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

describe('防抖间隔是量出来的，不是猜的', () => {
  it('样本集就是 real-world 语料的那 6 个文件，一个不多一个不少', () => {
    // 换了样本集，上面那个 p95 就换了含义。钉住它，让换样本变成一次显式修改。
    expect(FILES).toEqual([
      'gitignore.md',
      'hast-util-sanitize.md',
      'markdown-it.md',
      'mermaid.md',
      'sindresorhus-is.md',
      'tauri.md',
    ])
  })

  it('全部样本的 p95 仍低于一帧，所以 DEBOUNCE_MS 仍是 16', () => {
    const samples: number[] = []
    for (const file of FILES) {
      const src = readFileSync(join(CORPUS, file), 'utf8')
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now()
        render(src)
        const t1 = performance.now()
        if (i >= WARMUP) samples.push(t1 - t0)
      }
    }
    expect(samples).toHaveLength(FILES.length * (RUNS - WARMUP))

    const p95 = percentile(samples, 0.95)
    const derived = Math.max(Math.ceil(p95), 16)
    expect(
      derived,
      `measured p95 = ${p95.toFixed(2)} ms over ${String(samples.length)} samples; ` +
        `debounce should be max(ceil(p95), 16) = ${String(derived)} ms. ` +
        `If this is red because render() got slower, report the regression — do not re-pin the constant.`,
    ).toBe(DEBOUNCE_MS)
  })
})
