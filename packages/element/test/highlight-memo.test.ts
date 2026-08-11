import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Highlighter } from '@readit/core'
import { describe, expect, it } from 'vitest'
import { MEMO_CAPACITY, memoizeHighlighter } from '../src/highlight-memo.js'

function counting(highlight: (code: string, lang: string) => string | null = (code) => `<hl>${code}</hl>`): {
  highlighter: Highlighter
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    highlighter: {
      supports: () => true,
      highlight(code, lang) {
        calls.push(`${lang}\x00${code}`)
        return highlight(code, lang)
      },
    },
  }
}

describe('memoizeHighlighter：highlight() 纯同步确定性，缓存对字节零影响，只省重算', () => {
  it('同一个 (code, lang) 第二次调用不再穿透到底层 highlighter', () => {
    const { highlighter, calls } = counting()
    const memo = memoizeHighlighter(highlighter)
    expect(memo.highlight('let a=1', 'js')).toBe('<hl>let a=1</hl>')
    expect(memo.highlight('let a=1', 'js')).toBe('<hl>let a=1</hl>')
    expect(calls).toEqual(['js\x00let a=1'])
  })

  it('lang 相同 code 不同、code 相同 lang 不同，都是不同的缓存键', () => {
    const { highlighter, calls } = counting()
    const memo = memoizeHighlighter(highlighter)
    memo.highlight('a', 'js')
    memo.highlight('b', 'js')
    memo.highlight('a', 'ts')
    expect(calls).toEqual(['js\x00a', 'js\x00b', 'ts\x00a'])
  })

  it('null（不支持该语言）也被缓存住，不会一直重复穿透', () => {
    const { highlighter, calls } = counting(() => null)
    const memo = memoizeHighlighter(highlighter)
    expect(memo.highlight('x', 'zzz')).toBeNull()
    expect(memo.highlight('x', 'zzz')).toBeNull()
    expect(calls).toEqual(['zzz\x00x'])
  })

  it('supports() 直通，不缓存——它本身是纯查表，缓存它不省东西', () => {
    let supportsCalls = 0
    const memo = memoizeHighlighter({
      supports: () => {
        supportsCalls++
        return true
      },
      highlight: () => 'x',
    })
    memo.supports('js')
    memo.supports('js')
    expect(supportsCalls).toBe(2)
  })

  it('超过容量后按 LRU 逐出最久未用的那个，命中的键会被续命', () => {
    const { highlighter, calls } = counting()
    const memo = memoizeHighlighter(highlighter, 2)
    memo.highlight('a', 'js') // cache: [a]
    memo.highlight('b', 'js') // cache: [a, b]
    memo.highlight('a', 'js') // 命中 a，挪到最新：逻辑顺序变成 [b, a]
    calls.length = 0
    memo.highlight('c', 'js') // 容量 2，插入前逐出最久未用的 b：cache 变成 [a, c]
    expect(calls).toEqual(['js\x00c'])

    calls.length = 0
    expect(memo.highlight('a', 'js')).toBe('<hl>a</hl>') // a 仍在，命中
    expect(calls).toEqual([])
    expect(memo.highlight('b', 'js')).toBe('<hl>b</hl>') // b 已被逐出，重新穿透
    expect(calls).toEqual(['js\x00b'])
  })

  it('MEMO_CAPACITY 对目前语料里最大的文件仍有余量（用真实块数核对，不是猜的常数）', () => {
    // 不用 `new URL(relative, import.meta.url)`：happy-dom（§0 A2，本包 environment）的
    // 全局 URL 构造器对「相对路径 + file: base」解析有 bug，见
    // test/leak.test.ts:162-170、test/rerender-debounce.test.ts 同一处记录。
    const TEST_DIR = dirname(fileURLToPath(import.meta.url))
    const CORPUS = join(TEST_DIR, '..', '..', 'core', 'test', 'corpus', 'real-world')
    const FENCE = /^ {0,3}(`{3,}|~{3,})/gm
    let maxBlocks = 0
    let maxFile = ''
    for (const file of readdirSync(CORPUS).filter((f) => f.endsWith('.md'))) {
      const src = readFileSync(join(CORPUS, file), 'utf8')
      const fenceLines = (src.match(FENCE) ?? []).length
      const blocks = Math.floor(fenceLines / 2) // 每个代码块一开一闭两行围栏
      if (blocks > maxBlocks) {
        maxBlocks = blocks
        maxFile = file
      }
    }
    expect(maxFile, '换语料集会让下面这条余量断言的依据跟着变，钉住文件名以免悄悄过期').toBe(
      'sindresorhus-is.md',
    )
    expect(maxBlocks).toBe(45)
    // highlight-memo.ts 顶部注释：2× 最大块数，为「比目前语料更大的文档」与
    // 「LRU 逐出节奏落后一两拍」留余量。
    expect(MEMO_CAPACITY).toBeGreaterThanOrEqual(maxBlocks * 2)
  })
})
