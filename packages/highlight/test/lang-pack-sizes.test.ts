import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { measureAll, type Report } from '../scripts/measure-lang-packs.js'

const committed = JSON.parse(
  readFileSync(new URL('../data/lang-pack-sizes.json', import.meta.url), 'utf8'),
) as Report

/** SPEC §5.1：首次遇到 `$` 时无条件加载的数学包，~677 KB gzip，没有任何闸门。 */
const MATH_PAYLOAD_GZIP = 677 * 1024

describe('语言包体积台账', () => {
  const fresh = measureAll()

  it('提交进仓库的表还是当前依赖版本的实测值', () => {
    for (const key of ['shiki', 'starryNight'] as const) {
      expect(fresh[key].version, key).toBe(committed[key].version)
      expect(fresh[key].count, key).toBe(committed[key].count)
      // raw 是文件字节数，跨平台完全确定；gzip 随 Node 自带的 zlib 版本有微小浮动，
      // 所以 raw 逐字比，gzip 留 5% 余量。
      expect(fresh[key].top.map((p) => [p.name, p.raw]), key).toEqual(
        committed[key].top.map((p) => [p.name, p.raw]),
      )
      expect(fresh[key].gzip.max, key).toBeGreaterThan(committed[key].gzip.max * 0.95)
      expect(fresh[key].gzip.max, key).toBeLessThan(committed[key].gzip.max * 1.05)
    }
  })

  it('记录的结论是「不建闸」，并逐字记着万一要建时的文案', () => {
    expect(committed.gate.built).toBe(false)
    expect(committed.gate.copyIfEverBuilt).toBe(
      '这个代码块的语言包较大（<N> KB），已跳过高亮。[仍要加载]',
    )
  })

  it('支撑「不建闸」的那条实测事实仍然成立：最大的语法包仍小于无闸门的数学包', () => {
    // 这条断言就是决策本身。哪天 shiki 出了一个比数学包还大的语法包，它先红，
    // 决策就必须重新做一次——而不是靠谁记得回来看这张表。
    expect(fresh.shiki.gzip.max).toBeLessThan(MATH_PAYLOAD_GZIP)
    expect(fresh.starryNight.gzip.max).toBeLessThan(MATH_PAYLOAD_GZIP)
  })

  it('分布仍然是极度右偏的：中位数是个位数 KB，超 50 KB 的是个位数个', () => {
    expect(fresh.shiki.gzip.p50).toBeLessThan(4 * 1024)
    expect(fresh.shiki.over['50KB']).toBeLessThanOrEqual(4)
    expect(fresh.starryNight.gzip.p50).toBeLessThan(4 * 1024)
    expect(fresh.starryNight.over['50KB']).toBeLessThanOrEqual(4)
  })
})
