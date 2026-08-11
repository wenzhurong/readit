import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 这份文件此前直接量墙钟时间来导出 `DEBOUNCE_MS`——评审 C1/C2 两条都指向它：
 *
 *  - C1：`render(src)` 单参数裸调用不是 `rerender.ts:168` 真实重渲染路径的形状，
 *    不带 highlighter；真实接入高亮的场景实测比这条基线慢 49.9×，这条断言永远
 *    抓不到 Shiki 的性能回归。
 *  - C2：把一条会随机器噪声抖动的墙钟断言放进跨 ubuntu/macos/windows 三个 OS
 *    的阻塞矩阵（`.github/workflows/test.yml` 的 `unit` job 原样跑 `npm test`），
 *    余量只有 5.4 倍，Windows runner 对 CPU 密集负载慢 2-5 倍是常态，假红会
 *    主动引导人去追一个不存在的回归。
 *
 * 两条都已修：真实的、按「未接入高亮」/「已接入记忆化高亮」分档的测量与断言
 * 挪到了 `test/rerender-perf.perf.ts`（见 `vitest.perf.config.ts` 与
 * `package.json` 的 `test:perf` 脚本），不进默认 `npm test`。
 *
 * 这份文件只留下这一条：**样本集本身**的钉子。它是非计时断言，对机器抖动免疫，
 * 留在原地——`rerender-perf.perf.ts` 的两条 p95 断言的含义完全建立在
 * 「样本集就是这固定的 6 个文件」之上，换语料集会让那两个数字的含义跟着变，
 * 所以钉住它，让换样本变成一次显式修改，而不是悄悄发生。
 */
// 不用 `new URL('../../core/test/corpus/real-world/', import.meta.url)`：happy-dom
// （§0 A2，本包的 vitest environment）的全局 URL 构造器对「相对路径 + file: base」
// 解析有 bug——不管传进去的 base 是什么，结果的 scheme 总变成它自己伪造的
// http://localhost:.../@fs/... location，readdirSync 会抛
// "The URL must be of scheme file"（同一缺陷已在 test/leak.test.ts:162-170 与
// test/set-html-usage.test.ts 记录过）。改用 dirname(fileURLToPath(import.meta.url))
// + join 全程走 node:path，不经过全局 URL。
const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(TEST_DIR, '..', '..', 'core', 'test', 'corpus', 'real-world')

const FILES = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.md'))
  .sort()

describe('防抖间隔的测量样本集是量出来的、不是猜的（计时断言见 test:perf）', () => {
  it('样本集就是 real-world 语料的那 6 个文件，一个不多一个不少', () => {
    // 换了样本集，rerender-perf.perf.ts 里的两个 p95 就换了含义。钉住它，
    // 让换样本变成一次显式修改。
    expect(FILES).toEqual([
      'gitignore.md',
      'hast-util-sanitize.md',
      'markdown-it.md',
      'mermaid.md',
      'sindresorhus-is.md',
      'tauri.md',
    ])
  })
})
