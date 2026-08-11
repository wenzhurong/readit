import { describe, expect, it, vi } from 'vitest'
import { createDisposers } from '../src/disposers.js'
import { createPanes } from '../src/panes.js'
import { browserDeps } from '../src/rerender.js'

/**
 * 建编辑器要走两层动态 import（`import('@readit/editor')` + 内部再
 * `import('./plain.js')`/`import('./codemirror.js')` 一次）。在这套
 * vitest + vite 的模块图下，即便目标文件已经转译过，这条链路也要经过真实的
 * 异步 I/O（Vite 的按需转译管线），纯 Promise.resolve() 微任务循环等不到。
 *
 * 一开始用「固定 sleep 一段时间」实现过——在空闲机器上够用，但在 CI/并发负载
 * 下会闪烁：把 8 个并行 vitest 进程挤在同一台机器上跑，固定 60ms 就不够了
 * （本批实测：人为加满 CPU 负载后，「plain 档建 textarea」这条用例能稳定复现
 * 超时）。改成轮询到条件成立为止，而不是等一个猜出来的固定时长——这样它在
 * 空闲机器上几乎不费时间，在繁忙机器上会自动多等，而不是在两种场景下用
 * 同一个写死的数字赌概率。
 */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * §0 A8：createPanes() 接收 kernel 已创建的节点，不自己 createElement。
 * kernel.ts 真实给的 content/sourcePane 类名分别是 .markdown-body（part="content"）
 * 与 .readit-source（见 packages/element/src/kernel.ts、test/mount.test.ts 的
 * 「sourcePane 与 content 的 class 满足 §0 A8 的命名表」）。这里造一对结构等价的
 * 替身节点，不经过完整 createKernel()（那要拉进 shadow root / 主题 / 导航等一整套
 * 不相关的装置），panes.ts 只关心它们的类名与「已经在文档树里」这两件事。
 */
function host(): { container: HTMLElement; content: HTMLElement; sourcePane: HTMLElement } {
  const container = document.createElement('div')
  document.body.append(container)
  const content = document.createElement('div')
  content.className = 'readit-pane readit-pane-content markdown-body'
  const sourcePane = document.createElement('div')
  sourcePane.className = 'readit-pane readit-source'
  container.append(sourcePane, content)
  return { container, content, sourcePane }
}

describe('createPanes：模式状态机', () => {
  it('read 档只有预览，不建编辑器', async () => {
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: '# H',
      mode: 'read',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      disposers: createDisposers(),
      onPending: () => {},
    })
    // read 档不建编辑器（EDITOR_KIND.read === null），rerenderer.repaint() 又是
    // createPanes() 内部同步调用的——这条路径全程没有 await，不需要等。
    expect(content.innerHTML).toContain('<h1')
    expect(content.hidden).toBe(false)
    expect(sourcePane.hidden).toBe(true)
    expect(sourcePane.childElementCount).toBe(0)
    panes.destroy()
  })

  it('plain 档建 textarea，不碰 CodeMirror', async () => {
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: 'a',
      mode: 'plain',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      disposers: createDisposers(),
      onPending: () => {},
    })
    await waitFor(() => sourcePane.querySelector('textarea') !== null)
    expect(sourcePane.querySelector('textarea')).not.toBeNull()
    expect(sourcePane.querySelector('.cm-editor')).toBeNull()
    panes.destroy()
  })

  it('plain 档里打字会重渲预览（走防抖 → 帧）', async () => {
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: 'a',
      mode: 'plain',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      disposers: createDisposers(),
      onPending: () => {},
    })
    // 先在真时钟下把编辑器建好（动态 import 需要真实的异步 I/O，见 waitFor()
    // 的注释），再切假时钟去测防抖窗口——两件事不能同时用同一套时钟。
    await waitFor(() => sourcePane.querySelector('textarea') !== null)
    const ta = sourcePane.querySelector('textarea')
    expect(ta).not.toBeNull()
    if (ta === null) return

    vi.useFakeTimers()
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    ta.value = '# Changed'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    vi.advanceTimersByTime(20)
    expect(content.innerHTML).toContain('Changed')
    expect(panes.getValue()).toBe('# Changed')
    panes.destroy()
    raf.mockRestore()
    vi.useRealTimers()
  })

  it('预览里的原生 HTML 块在每次重渲后都补上了锚点', async () => {
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: 'para\n\n<p>native</p>\n\ntail\n',
      mode: 'read',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      disposers: createDisposers(),
      onPending: () => {},
    })
    // read 档，内容同样是 createPanes() 内部同步 repaint 出来的，不需要等。
    expect(content.querySelectorAll('[data-line-synthetic]').length).toBeGreaterThan(0)
    panes.destroy()
  })

  it('切回 read 会拆掉编辑器，destroy() 之后两个 pane 都是空的', async () => {
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: 'a',
      mode: 'plain',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      disposers: createDisposers(),
      onPending: () => {},
    })
    await waitFor(() => sourcePane.querySelector('textarea') !== null)
    expect(sourcePane.querySelector('textarea')).not.toBeNull()
    await panes.setMode('read')
    expect(sourcePane.querySelector('textarea')).toBeNull()
    panes.destroy()
    expect(sourcePane.childElementCount).toBe(0)
    expect(content.childElementCount).toBe(0)
  })

  it('onPending 把「还缺什么」交出去——降级要可见', async () => {
    const seen: string[][] = []
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: 'a $x$ b',
      mode: 'read',
      renderOptions: {},
      deps: { ...browserDeps(null), prepare: () => new Promise(() => {}) },
      measure: () => 0,
      disposers: createDisposers(),
      onPending: (p) => seen.push([...p]),
    })
    // read 档，setPending() 在 rerenderer.repaint() 内部同步调用（rerender.ts
    // 的 paint()：scan → missing → host.setPending() 都在 await deps.prepare()
    // 之前），不需要等。
    expect(seen.at(-1)).toEqual(['math'])
    panes.destroy()
  })
})

describe('createPanes：连续切模式不留过时的编辑器（generation 守卫）', () => {
  it('split -> split -> read 连续调用，三次都不 await，最终 sourcePane 必须是空的', async () => {
    const { content, sourcePane } = host()
    const panes = createPanes({
      content,
      sourcePane,
      root: document,
      value: 'a',
      mode: 'read',
      renderOptions: {},
      deps: browserDeps(null),
      measure: () => 0,
      disposers: createDisposers(),
      onPending: () => {},
    })
    // 故意不 await 中间两次——只有最后一次「切回 read」代表真正想要的最终状态。
    void panes.setMode('split')
    void panes.setMode('split')
    await panes.setMode('read')
    // 再等所有在途的 dynamic import / createEditor() 落地，确认它们没有把
    // 编辑器的 DOM 迟一拍地塞回 sourcePane。这里没有「出现了」可以正向轮询的
    // 条件（要证明的恰恰是「不出现」），所以固定等一段足够长的时间——但比起
    // 60ms 的旧版本留了大得多的余量：generation 守卫要等两次被丢弃的
    // buildEditor() 调用（各自一次 import('@readit/editor') + 一次
    // import('./codemirror.js')）都真正跑完，两次都发生在被丢弃的分支上，
    // 用真实调用量出来的时间会比单次「plain 档建 textarea」那条更长。
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(sourcePane.childElementCount).toBe(0)
    panes.destroy()
  })
})
