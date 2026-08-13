import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * SPEC 与实现的同步守卫。
 *
 * 这不是文档 lint。它守的是一类具体的失效：**上位契约与实现漂移，而没有任何东西会响。**
 * 计划一栽过两次——`mode: 'plain'` 在 M4 里程碑行出现却从未定义（实现者只能猜），
 * 以及验收线「100% diff 通过」丢掉了 §4 原有的「（带具名白名单）」限定词
 * （一个从来没人打算设的不可达标准，靠两跳转录进入了执行）。
 *
 * 断言的是「SPEC 里写的那几个具体串，与代码里的实际取值一致」。
 * 它抓不到所有漂移，但抓得到这几条已经付过学费的。
 *
 * 任务书 task-19-brief.md 原始草稿里 "mount() 返回对象不含 find" 那条的正则
 * （`spec.match(/-> \{[^}]*\}/)`）在 TDD 红灯阶段实测发现一处真实缺陷：SPEC.md
 * §7.1 附近的 `readFrontmatterOptions(src) -> {inlineMath?}` 比 §9.4 的
 * `mount()` 签名更早出现，`.match()` 不带 g 标志只取第一个命中——抓到的是前者，
 * 不是 mount() 真正的返回对象。这样写的断言即使 `find` 真的被加回 mount() 的
 * 返回对象，这条测试也不会红，是一条自我肯定的假护栏。这里改成把 `mount(el, {…})`
 * 签名与紧随其后的 `-> {…}` 合并成一次匹配，定位到唯一的目标块。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const spec = readFileSync(`${ROOT}SPEC.md`, 'utf8')
const elementTypes = readFileSync(`${ROOT}packages/element/src/types.ts`, 'utf8')

describe('SPEC 与实现同步', () => {
  it('§9.4 的 mode 联合类型含全部四个取值，与 element 的 Mode 一致', () => {
    // 实现侧的真源
    const match = elementTypes.match(/export type Mode = ([^\n]+)/)
    expect(match, 'packages/element/src/types.ts 里应有 export type Mode').not.toBeNull()
    const impl = new Set(
      [...(match![1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]),
    )
    expect(impl).toEqual(new Set(['read', 'source', 'split', 'plain']))

    // SPEC 侧必须逐个出现在 §9.4 的签名里
    const sig = spec.match(/mount\(el, \{[\s\S]{0,400}?\}\)/)
    expect(sig, 'SPEC §9.4 应有 mount() 签名块').not.toBeNull()
    for (const mode of impl) {
      expect(sig![0], `§9.4 的 mode 联合类型缺 '${mode}'`).toContain(`'${mode}'`)
    }
  })

  it("'plain' 在 SPEC 里有定义，不只是出现在里程碑表", () => {
    // 计划一的教训：一个词只在验收行出现、从不被定义，实现者只能猜。
    const occurrences = [...spec.matchAll(/'plain'/g)].length
    expect(occurrences, "'plain' 只出现一次说明它仍未被定义").toBeGreaterThan(1)
    expect(spec).toMatch(/`'plain'`[^\n]*textarea|textarea[^\n]*`'plain'`/)
  })

  it('§9.4 的 mount() 返回对象不含 find —— 它属 M6', () => {
    // 把 mount(el, {…}) 签名与紧随其后的 -> {…} 合并成一次匹配，避免命中
    // SPEC 里更早出现的另一处同形状文本（见文件头注释）。
    const call = spec.match(/mount\(el, \{[\s\S]{0,400}?\}\)\s*->\s*\{[^}]*\}/)
    expect(call, 'SPEC §9.4 应有 mount() 签名 + 返回对象').not.toBeNull()
    expect(call![0]).not.toContain('find')
    // 且必须写明它去哪了，否则读者会以为是遗漏
    expect(spec).toMatch(/find[^\n]*M6|M6[^\n]*find/)
  })

  it('§9.2 的 ::part() 名单包含 M5 钉死的 mermaid part', () => {
    const parts = spec.match(/`::part\(\)` 名字是永久公开 API`?\*\*[\s\S]{0,400}/)
    expect(parts, 'SPEC §9.2 应有 ::part() 名单段').not.toBeNull()
    const publicNames = parts![0].match(/当前名单为([^。]+)/)
    expect(publicNames, 'SPEC §9.2 应明确列出当前公开 part 名单').not.toBeNull()
    expect(publicNames?.[1]?.match(/`[^`]+`/g)).toEqual([
      '`root`',
      '`content`',
      '`code-block`',
      '`mermaid`',
    ])
    expect(parts![0]).toMatch(/`mermaid`[^\n]*Phase A[^\n]*Phase B/)
  })

  it('§5 包表把 @readit/find 标为 M6', () => {
    const row = spec.split('\n').find((l) => l.includes('@readit/find'))
    expect(row, 'SPEC §5 应有 @readit/find 行').toBeDefined()
    expect(row!).toContain('M6')
  })
})
