import { beforeEach, describe, expect, it } from 'vitest'
import { buildTextModel, findTextMatches, lineAtOffset, rangeForMatch } from '../src/model.js'

describe('find 文本模型', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('把嵌套文本节点压平，并把跨节点命中精确映回 Range', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Al<strong>ph</strong>a</p><p> beta</p>'
    document.body.append(root)

    const model = buildTextModel(root)
    const matches = findTextMatches(model.text, 'alpha b')
    const range = rangeForMatch(model, matches[0]!)

    expect(model.text).toBe('Alpha beta')
    expect(matches).toEqual([{ start: 0, end: 7 }])
    expect(range.toString()).toBe('Alpha b')
    expect(range.startContainer.textContent).toBe('Al')
    expect(range.startOffset).toBe(0)
    expect(range.endContainer.textContent).toBe(' beta')
    expect(range.endOffset).toBe(2)
  })

  it('跳过不可搜索的脚本、样式、模板与隐藏子树', () => {
    const root = document.createElement('div')
    root.innerHTML = [
      '<p>visible</p>',
      '<script>script secret</script>',
      '<style>.secret { color: red }</style>',
      '<template>template secret</template>',
      '<p hidden>hidden secret</p>',
      '<p aria-hidden="true">aria secret</p>',
    ].join('')

    expect(buildTextModel(root).text).toBe('visible')
  })

  it('按字面量、默认忽略大小写且不产生重叠命中', () => {
    expect(findTextMatches('a+b aab A+B banana', 'a+b')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ])
    expect(findTextMatches('banana', 'ana')).toEqual([{ start: 1, end: 4 }])
    expect(findTextMatches('Alpha alpha', 'Alpha', { caseSensitive: true })).toEqual([
      { start: 0, end: 5 },
    ])
    expect(findTextMatches('anything', '')).toEqual([])
  })

  it('把源码偏移换算成零基源码行，不依赖已挂载的 CodeMirror DOM', () => {
    const source = ['top', 'middle', 'needle', 'bottom'].join('\n')
    const [match] = findTextMatches(source, 'needle')
    expect(match).toEqual({ start: 11, end: 17 })
    expect(lineAtOffset(source, match!.start)).toBe(2)
    expect(lineAtOffset(source, -10)).toBe(0)
    expect(lineAtOffset(source, 999)).toBe(3)
  })
})
