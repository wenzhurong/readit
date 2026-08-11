import { describe, expect, it } from 'vitest'
import { createPlainEditor, topLineFromScroll, FALLBACK_LINE_HEIGHT } from '../src/plain.js'
import { editorContractCases, runAllCases, type ContractEnv } from './contract.js'

const env: ContractEnv = {
  mount() {
    const parent = document.createElement('div')
    document.body.append(parent)
    return { parent, root: document }
  },
  type(parent, value) {
    const ta = parent.querySelector('textarea')
    if (ta === null) throw new Error('plain editor did not create a textarea')
    ta.value = value
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  },
}

describe('plain 档满足 P2 的 Editor 契约', () => {
  for (const c of editorContractCases((opts) => Promise.resolve(createPlainEditor(opts)), env)) {
    it(c.name, async () => {
      await expect(c.run()).resolves.toBeUndefined()
    })
  }

  it('整张表一次跑完也是零失败（runAllCases 是 Task 17 在浏览器里用的入口）', async () => {
    const cases = editorContractCases((opts) => Promise.resolve(createPlainEditor(opts)), env)
    await expect(runAllCases(cases)).resolves.toEqual([])
  })
})

describe('plain 档的行数学是纯函数，不依赖排版', () => {
  it('scrollTop / lineHeight 向下取整，并夹在 [0, lineCount-1]', () => {
    expect(topLineFromScroll(0, 20, 10)).toBe(0)
    expect(topLineFromScroll(39, 20, 10)).toBe(1)
    expect(topLineFromScroll(40, 20, 10)).toBe(2)
    expect(topLineFromScroll(99999, 20, 10)).toBe(9)
    expect(topLineFromScroll(-5, 20, 10)).toBe(0)
  })

  it('lineHeight 拿不到数字时回落到常量，而不是产出 NaN', () => {
    expect(topLineFromScroll(100, Number.NaN, 10)).toBe(0)
    expect(topLineFromScroll(100, 0, 10)).toBe(0)
    expect(FALLBACK_LINE_HEIGHT).toBe(20)
  })

  it('空文档只有一行，topLine 恒为 0', () => {
    expect(topLineFromScroll(500, 20, 1)).toBe(0)
  })
})

describe('plain 档关掉软换行', () => {
  it('textarea 带 wrap="off"——否则「视觉行」与「源码行」不再一一对应，topLine() 无定义', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const ed = createPlainEditor({
      parent,
      root: document,
      value: 'x',
      onChange: () => {},
      onScroll: () => {},
    })
    expect(parent.querySelector('textarea')?.getAttribute('wrap')).toBe('off')
    ed.destroy()
  })
})
