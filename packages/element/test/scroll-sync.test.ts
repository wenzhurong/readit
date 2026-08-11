import { describe, expect, it, vi } from 'vitest'
import { collectAnchors, lineToTop, topToLine, type Anchor, type MeasureTop } from '../src/scroll/anchors.js'
import { createScrollSync, type ScrollSource } from '../src/scroll/sync.js'

function content(lines: readonly number[]): { el: HTMLElement; measure: MeasureTop } {
  const el = document.createElement('div')
  el.innerHTML = lines.map((l) => `<p data-line="${String(l)}">l${String(l)}</p>`).join('')
  document.body.append(el)
  const tops = new Map<Element, number>()
  ;[...el.children].forEach((c, i) => tops.set(c, i * 100))
  // happy-dom 没有排版，offsetTop 恒为 0——测量因此是注入的。
  // 真实实现是 el => (el as HTMLElement).offsetTop，由 Task 17 在真浏览器里覆盖。
  return { el, measure: (node) => tops.get(node) ?? 0 }
}

describe('collectAnchors', () => {
  it('按 top 升序，且强制行号单调不减', () => {
    const { el, measure } = content([0, 10, 4, 20])
    expect(collectAnchors(el, measure)).toEqual<Anchor[]>([
      { line: 0, top: 0 },
      { line: 10, top: 100 },
      { line: 10, top: 200 },
      { line: 20, top: 300 },
    ])
  })

  it('同一垂直位置上的多个锚点只留行号最小的那个', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p data-line="3">a</p><p data-line="5">b</p>'
    document.body.append(el)
    expect(collectAnchors(el, () => 42)).toEqual<Anchor[]>([{ line: 3, top: 42 }])
  })

  it('data-line 不是非负整数的节点被跳过，而不是变成 NaN 锚点', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p data-line="x">a</p><p data-line="-1">b</p><p data-line="2">c</p>'
    document.body.append(el)
    expect(collectAnchors(el, () => 7)).toEqual<Anchor[]>([{ line: 2, top: 7 }])
  })
})

const A: Anchor[] = [
  { line: 0, top: 0 },
  { line: 10, top: 200 },
  { line: 30, top: 400 },
]

describe('lineToTop / topToLine', () => {
  it('锚点上是精确的', () => {
    expect(lineToTop(A, 10, 800, 40)).toBe(200)
    expect(topToLine(A, 400, 800, 40)).toBe(30)
  })

  it('两锚点之间线性插值', () => {
    expect(lineToTop(A, 5, 800, 40)).toBe(100)
    expect(lineToTop(A, 20, 800, 40)).toBe(300)
    expect(topToLine(A, 100, 800, 40)).toBe(5)
    expect(topToLine(A, 300, 800, 40)).toBe(20)
  })

  it('末锚点之后按「剩余行数 : 剩余高度」外推，不越界', () => {
    expect(lineToTop(A, 39, 800, 40)).toBe(800)
    expect(lineToTop(A, 999, 800, 40)).toBe(800)
    expect(topToLine(A, 800, 800, 40)).toBe(39)
    expect(topToLine(A, 99999, 800, 40)).toBe(39)
  })

  it('首锚点之前夹到首锚点', () => {
    expect(lineToTop(A, -5, 800, 40)).toBe(0)
    expect(topToLine(A, -5, 800, 40)).toBe(0)
  })

  it('没有锚点时退化成 0，而不是抛错', () => {
    expect(lineToTop([], 12, 800, 40)).toBe(0)
    expect(topToLine([], 300, 800, 40)).toBe(0)
  })
})

describe('createScrollSync：双向同步不得自激', () => {
  function setup() {
    const { el, measure } = content([0, 10, 30])
    const preview = document.createElement('div')
    preview.append(el)
    document.body.append(preview)
    const source: ScrollSource = { topLine: vi.fn(() => 0), scrollToLine: vi.fn() }
    const sync = createScrollSync({
      source,
      preview,
      content: el,
      measure,
      contentHeight: () => 800,
      lineCount: () => 40,
    })
    return { sync, source, preview, el }
  }

  /**
   * 这四条数值相对 task-16-brief.md 原文做了订正——发现于本批 TDD 的红灯阶段。
   * `setup()` 里 `content([0, 10, 30])` 用的 `measure` 按数组下标给 top
   * （`i * 100`：line0→top0、line10→top100、line30→top200），但原文这个
   * describe 块的期望值（200 / 20 / 前一条的 fromEditor(20)）是按模块级
   * 常量 `A`（line10→top200，`i * 200` 的另一套映射）的数字抄来的——两套
   * fixture 恰好共享同一串行号 [0,10,30]，数值却不是同一套。
   * `collectAnchors`/`lineToTop`/`topToLine` 两个 describe 块各自内部一致
   * 且已独立通过，问题只出在这个块把哪套 top 映射代入公式算错了。
   * 下面的期望值是对着 packages/element/src/scroll/anchors.ts 的公式手算
   * 并用一段独立脚本核对过的（600/620 行附近的报告有完整推导），不是把
   * "测试要求的数字" 直接改成 "代码吐出来的数字" 消极地让它变绿。
   */
  it('编辑器滚动把预览推到对应偏移', () => {
    const { sync, preview } = setup()
    sync.fromEditor(10)
    expect(preview.scrollTop).toBe(100)
    sync.destroy()
  })

  it('由自己推出去的那次预览滚动不再反弹回编辑器', () => {
    const { sync, source, preview } = setup()
    sync.fromEditor(10)
    expect(preview.scrollTop).toBe(100)
    // 浏览器接着会派一次 scroll 事件——它是我们自己造成的，必须被吃掉。
    sync.fromPreview()
    expect(source.scrollToLine).not.toHaveBeenCalled()
    sync.destroy()
  })

  it('用户真正滚预览时才回推编辑器', () => {
    const { sync, source, preview } = setup()
    preview.scrollTop = 300
    sync.fromPreview()
    // top=300 越过最后一个真锚点（line 30 / top 200），按「剩余行数:剩余高度」
    // 外推：span=800-200=600，t=(300-200)/600=1/6，line=round(30+1/6*9)=32。
    expect(source.scrollToLine).toHaveBeenCalledWith(32)
    sync.destroy()
  })

  it('回推之后编辑器派回来的那次 scroll 同样被吃掉', () => {
    const { sync, preview } = setup()
    preview.scrollTop = 300
    sync.fromPreview()
    // 上一步 fromPreview() 算出的行号是 32（见上一条用例），回声防护按的是
    // 「fromPreview 刚推给编辑器的那个值」，不是任意行号——必须用同一个值,
    // 否则这条测的就不是回声防护,是巧合。
    sync.fromEditor(32)
    expect(preview.scrollTop).toBe(300)
    sync.destroy()
  })

  it('invalidate() 之后重新采锚点', () => {
    const { sync, el, preview } = setup()
    el.innerHTML = '<p data-line="0">a</p>'
    sync.invalidate()
    sync.fromEditor(30)
    // 旧的 3 个锚点节点已被 innerHTML 整体替换掉；新的单个 <p> 不在 setup()
    // 的 tops Map 里，measure() 对它落到 ?? 0 的默认值——所以重新采样后只有
    // 一个锚点 {line:0, top:0}，line=30 落在「末锚点之后」的外推分支。
    // 直接复用 lineToTop 独立算一遍期望值，而不是把这个浮点数硬编码进断言：
    // 这条要测的是「invalidate 之后真的按新 DOM 重新采样」，插值算法本身已经
    // 由上面的 lineToTop/topToLine 套件验过，不需要在这里重复一份魔法数字。
    expect(preview.scrollTop).toBeCloseTo(lineToTop([{ line: 0, top: 0 }], 30, 800, 40))
    sync.destroy()
  })

  it('destroy() 之后两个方向都不再动任何东西', () => {
    const { sync, source, preview } = setup()
    sync.destroy()
    sync.fromEditor(30)
    expect(preview.scrollTop).toBe(0)
    preview.scrollTop = 300
    sync.fromPreview()
    expect(source.scrollToLine).not.toHaveBeenCalled()
  })
})
