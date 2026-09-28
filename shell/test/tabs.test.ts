import { describe, expect, it } from 'vitest'
import { cycleTab, neighborAfterClose, tabLabels } from '../src/tabs.js'

describe('tabLabels', () => {
  it('不重名时就是文件名', () => {
    expect(tabLabels(['/docs/a.md', '/notes/b.markdown'])).toEqual(['a.md', 'b.markdown'])
  })

  it('重名时加上级目录', () => {
    expect(tabLabels(['/x/docs/README.md', '/y/guide/README.md', '/x/a.md'])).toEqual([
      'README.md · docs',
      'README.md · guide',
      'a.md',
    ])
  })

  it('上级目录也同名就再往上加一级', () => {
    expect(tabLabels(['/x/a/docs/README.md', '/y/b/docs/README.md'])).toEqual([
      'README.md · a/docs',
      'README.md · b/docs',
    ])
  })

  it('同一个文件开在两个标签里分不开，就让它们同名，也不再往上多加目录（其他重名的照样分开）', () => {
    // 路径要够深：浅路径下「一直加到路径用尽」恰好也得到同样的结果，测不出这条规则。
    expect(
      tabLabels(['/home/me/x/docs/README.md', '/home/me/x/docs/README.md', '/home/me/y/docs/README.md']),
    ).toEqual(['README.md · x/docs', 'README.md · x/docs', 'README.md · y/docs'])
  })

  it('Windows 路径按反斜杠切', () => {
    expect(tabLabels(['C:\\one\\README.md', 'C:\\two\\README.md'])).toEqual([
      'README.md · one',
      'README.md · two',
    ])
  })
})

describe('neighborAfterClose', () => {
  it('先右后左，只剩自己时是 null', () => {
    expect(neighborAfterClose(['a', 'b', 'c'], 'b')).toBe('c')
    expect(neighborAfterClose(['a', 'b', 'c'], 'c')).toBe('b')
    expect(neighborAfterClose(['a'], 'a')).toBeNull()
    expect(neighborAfterClose(['a'], 'z')).toBeNull()
  })
})

describe('cycleTab', () => {
  it('首尾循环', () => {
    expect(cycleTab(['a', 'b', 'c'], 'c', 1)).toBe('a')
    expect(cycleTab(['a', 'b', 'c'], 'a', -1)).toBe('c')
    expect(cycleTab(['a', 'b', 'c'], 'a', 1)).toBe('b')
    expect(cycleTab([], 'a', 1)).toBeNull()
  })
})
