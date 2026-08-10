import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKernel, DEFAULT_MOUNT_OPTIONS, dedent, resolveMountOptions } from '../src/kernel.js'
import { mount } from '../src/index.js'
import { DARK_CSS, LIGHT_CSS } from '../src/styles/theme-css.js'

const DOC = '# Hello World\n\ntext\n\n```js\nvar a = 1\n```\n'

let hosts: HTMLElement[] = []

function makeHost(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  hosts.push(host)
  return host
}

afterEach(() => {
  for (const host of hosts) host.remove()
  hosts = []
})

describe('mount 的默认值', () => {
  it('缺省是 read / shadow / auto，与 P4 的 MountOptions 一一对上', () => {
    expect(DEFAULT_MOUNT_OPTIONS).toEqual({
      value: '',
      mode: 'read',
      shadow: true,
      theme: 'auto',
      baseUrl: '',
      inlineMath: 'github',
      math: null,
      highlighter: null,
      emojiBase: 'https://github.githubassets.com/images/icons/emoji/',
      onNavigate: null,
    })
  })

  it('resolveMountOptions 只覆盖给了的键', () => {
    expect(resolveMountOptions({ mode: 'split' }).mode).toBe('split')
    expect(resolveMountOptions({ mode: 'split' }).theme).toBe('auto')
  })

  /**
   * MountHandle 上没有 find()——查找属 M6（设计文档 §9 修订 2）。留空壳挨过评审
   * 批评，所以这条把「不存在」也钉住：宿主 typeof 检查得到 undefined，而不是一个
   * 永远返回空的方法。
   */
  it('MountHandle 恰好是 P4 的五个方法，没有 find', () => {
    const handle = mount(makeHost(), { value: DOC })
    expect(Object.keys(handle).sort()).toEqual(['destroy', 'getValue', 'setMode', 'setTheme', 'setValue'])
    expect((handle as unknown as Record<string, unknown>)['find']).toBeUndefined()
    handle.destroy()
  })
})

describe('read 模式渲染', () => {
  it('把 Phase A 的输出注入 shadow root 的 .markdown-body', () => {
    const host = makeHost()
    mount(host, { value: DOC })
    const content = host.shadowRoot?.querySelector('.markdown-body')
    expect(content?.querySelector('h1')?.textContent).toBe('Hello World')
    expect(content?.querySelector('h1')?.getAttribute('data-line')).toBe('0')
  })

  it('只开 root / content / code-block 三个 part（设计文档 §9 修订 3）', () => {
    const host = makeHost()
    mount(host, { value: DOC })
    const shadow = host.shadowRoot
    const parts = [...(shadow?.querySelectorAll('[part]') ?? [])].map((el) => el.getAttribute('part'))
    expect(new Set(parts)).toEqual(new Set(['root', 'content', 'code-block']))
  })

  /**
   * part="code-block" 只能在注入之后补：Phase A 的输出字节是冻结的（56/68 那条
   * 基线），往 <pre> 上加属性会动它。
   */
  it('code-block 的 part 是注入后补的，Phase A 的字符串里没有', () => {
    const host = makeHost()
    mount(host, { value: DOC })
    const pre = host.shadowRoot?.querySelector('pre')
    expect(pre?.getAttribute('part')).toBe('code-block')
  })

  it('setValue 重渲，getValue 拿回源码而不是 HTML', () => {
    const host = makeHost()
    const handle = mount(host, { value: DOC })
    handle.setValue('## Second\n')
    expect(handle.getValue()).toBe('## Second\n')
    expect(host.shadowRoot?.querySelector('h2')?.textContent).toBe('Second')
    expect(host.shadowRoot?.querySelector('h1')).toBeNull()
  })

  it('shadow:false 时内容直接进宿主，不建 shadow root', () => {
    const host = makeHost()
    mount(host, { value: DOC, shadow: false })
    expect(host.shadowRoot).toBeNull()
    expect(host.querySelector('.markdown-body h1')?.textContent).toBe('Hello World')
  })
})

describe('模式状态机', () => {
  it('read 只显示预览窗格', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC }))
    expect(kernel.content.hidden).toBe(false)
    expect(kernel.sourcePane.hidden).toBe(true)
    expect(kernel.root.root.getAttribute('data-mode')).toBe('read')
  })

  /**
   * §0 A8 命名表：sourcePane 的 class 必须含 .readit-source，content 必须含
   * .markdown-body——Task 17 的 createPanes() 接收这两个节点而不自己
   * createElement，命名对不上它就接不上。
   */
  it('sourcePane 与 content 的 class 满足 §0 A8 的命名表', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC }))
    expect(kernel.sourcePane.classList.contains('readit-source')).toBe(true)
    expect(kernel.content.classList.contains('markdown-body')).toBe(true)
  })

  it.each([['source'], ['plain']] as const)('%s 只显示源码窗格', (mode) => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode }))
    expect(kernel.content.hidden).toBe(true)
    expect(kernel.sourcePane.hidden).toBe(false)
    expect(kernel.root.root.getAttribute('data-mode')).toBe(mode)
  })

  it('split 两个窗格都显示', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'split' }))
    expect(kernel.content.hidden).toBe(false)
    expect(kernel.sourcePane.hidden).toBe(false)
  })

  /**
   * 编辑器是 Task 13–17。在它接进来之前，源码窗格不是空白也不抛——按 §12
   * 「降级必须可见」显示只读源码，并用 data-editor="none" 把这个状态说出来。
   */
  it('编辑器未接入时源码窗格显示只读源码，并自报 data-editor="none"', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'source' }))
    const pre = kernel.sourcePane.querySelector('pre.readit-source-fallback')
    expect(pre?.getAttribute('data-editor')).toBe('none')
    expect(pre?.textContent).toBe(DOC)
  })

  it('切模式是幂等的，来回切不留残留节点', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC }))
    kernel.setMode('split')
    kernel.setMode('split')
    kernel.setMode('read')
    expect(kernel.sourcePane.childNodes).toHaveLength(0)
    expect(kernel.content.querySelectorAll('h1')).toHaveLength(1)
  })

  it('setValue 在 split 下同时更新两个窗格', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'split' }))
    kernel.setValue('# New\n')
    expect(kernel.content.querySelector('h1')?.textContent).toBe('New')
    expect(kernel.sourcePane.textContent).toBe('# New\n')
  })
})

describe('主题接线', () => {
  it('setTheme 换的是整张样式表，不是往上叠一张', () => {
    const host = makeHost()
    const kernel = createKernel(host, resolveMountOptions({ value: DOC, theme: 'light' }))
    const shadow = host.shadowRoot
    if (shadow === null) throw new Error('unreachable')
    expect(shadow.adoptedStyleSheets).toHaveLength(2)
    expect(host.getAttribute('data-theme')).toBe('light')
    kernel.setTheme('dark')
    expect(shadow.adoptedStyleSheets).toHaveLength(2)
    expect(host.getAttribute('data-theme')).toBe('dark')
  })

  it('light 与 dark 用的是两份不同的单主题文件', () => {
    expect(LIGHT_CSS).not.toBe(DARK_CSS)
  })

  it('永不写 document.documentElement / document.body 的样式', () => {
    const headBefore = document.head.innerHTML
    const host = makeHost()
    const handle = mount(host, { value: DOC, theme: 'dark' })
    expect(document.head.innerHTML).toBe(headBefore)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    expect(document.body.getAttribute('data-theme')).toBeNull()
    expect(document.adoptedStyleSheets).toHaveLength(0)
    handle.destroy()
  })
})

describe('destroy 之后', () => {
  it('再用句柄会抛出说得清的错误，而不是静默无事发生', () => {
    const handle = mount(makeHost(), { value: DOC })
    handle.destroy()
    expect(() => handle.setValue('x')).toThrow(/已经 destroy/)
    expect(() => handle.setMode('split')).toThrow(/已经 destroy/)
    expect(() => handle.setTheme('dark')).toThrow(/已经 destroy/)
  })

  it('destroy 可以重复调用', () => {
    const handle = mount(makeHost(), { value: DOC })
    handle.destroy()
    expect(() => handle.destroy()).not.toThrow()
  })
})

describe('dedent', () => {
  it('去掉公共缩进——4 个空格在 Markdown 里是代码块，不能带进去', () => {
    expect(dedent('\n      # Title\n\n      text\n    ')).toBe('# Title\n\ntext\n')
  })

  it('没有公共缩进时原样返回', () => {
    expect(dedent('# Title\n  indented\n')).toBe('# Title\n  indented\n')
  })
})

describe('未知选项值', () => {
  /**
   * 任务书原文断言的是 `highlight.supports` 被调用——但 @readit/core 的
   * render() 管线（rules/codeblock.ts）从不调用 `Highlighter.supports()`，
   * 它直接调 `highlighter?.highlight(code, lang)` 并把 null 结果当「不支持」
   * 处理（回落纯转义文本）。核对过 packages/core/src/rules/codeblock.ts：
   * `supports` 是 Highlighter 接口的一部分，但消费方是 Task 7/8 的工厂函数
   * 决定装载哪些语言，不是 render() 本身。照抄原断言会红，且红得没有道理——
   * 红的不是 kernel.ts 的行为，是任务书对 core 契约的一个错误假设。
   * 这里改成断言 `highlighter.highlight` 真的收到了 kernel 传下去的选项对象
   * （而不是 kernel 自己另起一份），保留「照单全收，不猜」这句话本来要测的
   * 东西：kernel.ts 不对 highlighter 做任何额外判断，原样交给 render()。
   */
  it('渲染选项照单全收，不猜——kernel 不额外调用 highlighter.supports，只把它原样交给 render()', () => {
    const highlight = { highlight: vi.fn(() => null), supports: vi.fn(() => false) }
    createKernel(makeHost(), resolveMountOptions({ value: DOC, highlighter: highlight }))
    expect(highlight.highlight).toHaveBeenCalledWith('var a = 1\n', 'js')
    expect(highlight.supports).not.toHaveBeenCalled()
  })
})
