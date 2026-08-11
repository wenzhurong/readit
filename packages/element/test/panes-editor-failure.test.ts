import { describe, expect, it, vi } from 'vitest'
import { createDisposers } from '../src/disposers.js'
import { browserDeps } from '../src/rerender.js'

/**
 * 单独一个文件：这里要 mock 掉整个 @readit/editor，跟 panes.test.ts 其余用例
 * 依赖真实 createEditor() 的假设互不相容（vi.mock 是整文件生效的，混进同一个
 * 文件会连累那些需要真实 textarea/CodeMirror 的用例）。
 *
 * 本批在真机上跑通 npm test 时，实测撞到过 buildEditor() 里
 * `await import('@readit/editor')` 抛错却没人接住的情形（happy-dom/vitest
 * 环境在测试文件结束后拆掉模块运行时，一个仍在 import() 中的 CodeMirror 加载
 * 会抛 "Cannot load ... after the environment was torn down"）——不接住它，
 * 每次跑 npm test 都有一定概率在无关文件上报出一条幽灵式的 unhandled rejection。
 * 这份文件直接构造「createEditor() 拒绝」的情形，证明 panes.ts 的 catch 分支
 * 真的按 §12「降级必须可见」显示只读回落，而不只是吞掉异常。
 */
vi.mock('@readit/editor', () => ({
  createEditor: vi.fn(async () => {
    throw new Error('模拟的编辑器加载失败')
  }),
}))

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function host(): { content: HTMLElement; sourcePane: HTMLElement } {
  const container = document.createElement('div')
  document.body.append(container)
  const content = document.createElement('div')
  content.className = 'readit-pane readit-pane-content markdown-body'
  const sourcePane = document.createElement('div')
  sourcePane.className = 'readit-pane readit-source'
  container.append(sourcePane, content)
  return { content, sourcePane }
}

describe('createPanes：编辑器加载失败时的只读回落', () => {
  it('createEditor() 拒绝时，sourcePane 显示只读回落而不是空白，且不产生未处理的 rejection', async () => {
    const { createPanes } = await import('../src/panes.js')
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: '# 源码内容\n',
      mode: 'plain',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      disposers: createDisposers(),
      onPending: () => {},
    })
    await waitFor(() => sourcePane.querySelector('pre.readit-source-fallback') !== null)
    const pre = sourcePane.querySelector('pre.readit-source-fallback')
    expect(pre).not.toBeNull()
    expect(pre?.getAttribute('data-editor')).toBe('unavailable')
    expect(pre?.textContent).toBe('# 源码内容\n')
    // 没有真编辑器可用，但预览侧仍然照常渲染——降级不该连带砸掉还能用的那一半。
    expect(content.innerHTML).toContain('源码内容')
    panes.destroy()
  })
})
