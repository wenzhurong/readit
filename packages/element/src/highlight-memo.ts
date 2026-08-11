import type { Highlighter } from '@readit/core'

/**
 * 记忆化缓存的容量帽（键的个数）。
 *
 * 依据（不是拍脑袋）：`test/highlight-memo.test.ts` 的
 * 「MEMO_CAPACITY 对目前语料里最大的文件仍有余量」用例，实测
 * `corpus/real-world/` 6 个文件里代码块最多的一个（sindresorhus-is.md）
 * 有 45 个围栏代码块。取 2× 这个数（90）再取整到 128（2 的幂，好算好记）：
 *
 * 为什么要 2× 而不是刚好够：用户在一份有 N 个代码块的文档里连续编辑其中
 * 一个块，每次击键都会因为块内容变了而产生一个新缓存键——旧的那个键从此
 * 再也不会被查到，是纯粹的死重，但在被挤出去之前仍占一个槽位。LRU 会在
 * 触达容量时优先逐出这些「刚被超越、不会再被用到」的旧键（它们最近一次
 * 被访问的时间早于同一轮里被反复命中的其它 N-1 个静态块），所以稳态占用
 * 只会略高于 N，不会真的涨到 2N——但审查者要求的是「有依据」而不是
 * 「测过一次刚好没出问题」，2× 是给「文档比目前语料任何一份都大」与
 * 「LRU 逐出节奏落后一两拍」留出的显式余量，不是精确算出来的下界。
 * 换语料集时上面那条测试会先失败（同 `rerender-debounce.test.ts` 的
 * 语料清单钉子），逼这个数字的依据跟着更新，而不是悄悄过期。
 */
export const MEMO_CAPACITY = 128

/**
 * 把一个 Highlighter 包一层记忆化代理。
 *
 * 为什么这样做是透明的、不改变任何字节：`Highlighter.highlight()` 的契约是
 * 纯同步、确定性（Phase A 的硬要求——见 Global Constraints「Highlighter.highlight()
 * 必须纯同步」；同一个 (code, lang) 对，工厂产出的这个 highlighter 实例
 * 任何时候调用都必须给出同一个字符串或同一个 null），所以缓存只是不重算，
 * 不影响任何一条 render() 输出的字节。
 *
 * 为什么需要它：`packages/core/src/rules/codeblock.ts` 对**每一个**代码块
 * 同步调一次 `highlight()`，而 `rerender.ts` 的重渲策略是「整份文档重渲」
 * （`render()` 返回整块字符串，增量重渲在架构上不可能）。不加这一层，
 * 在一篇有 10 个代码块的文档里敲一个字符，会把 10 个内容完全没变的代码块
 * 全部重新高亮一遍——这正是评审用 `createShikiHighlighter` 实测出「prepared
 * render() 比 bare render() 慢 49.9×」的根因，不是 highlighter 本身慢，
 * 是重复算了不该重算的东西。
 *
 * key 用 `lang + '\x00' + code`：'\x00' 是控制字符，语言名不会含它，源码
 * 理论上可以但极端罕见；即便真撞上也只是缓存命中错了一次，不是正确性缺陷——
 * `highlight()` 返回 null 时 `codeblock.ts` 回落到转义纯文本，字节仍然合法，
 * 只是错过了一次高亮，这条早就在 SPEC §12「降级不是崩溃」里覆盖了。
 *
 * `supports()` 不缓存、直通：它本身就是纯查表（各实现都是 O(1) 的 Set/Map
 * 查询，见 `packages/highlight/src/shiki.ts` 与 `starry-night.ts`），缓存它
 * 只会多一层开销，没有省到东西。
 */
export function memoizeHighlighter(inner: Highlighter, capacity: number = MEMO_CAPACITY): Highlighter {
  // Map 天然保序（插入顺序），命中时 delete 再 set 把该键挪到「最新」那一端，
  // 插入前若已到容量上限就删掉最旧的（keys() 的第一个）——这就是一个不需要
  // 额外链表的 LRU。
  const cache = new Map<string, string | null>()

  const touch = (key: string, value: string | null): void => {
    cache.delete(key)
    cache.set(key, value)
  }

  return {
    supports: (lang) => inner.supports(lang),
    highlight(code, lang) {
      const key = lang + '\x00' + code
      if (cache.has(key)) {
        const hit = cache.get(key) ?? null
        touch(key, hit) // 命中也要挪到最新，不然一直编辑同一个块也会被别的块顶掉。
        return hit
      }
      const value = inner.highlight(code, lang)
      if (cache.size >= capacity) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(key, value)
      return value
    },
  }
}
