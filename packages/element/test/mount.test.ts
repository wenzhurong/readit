import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKernel, DEFAULT_MOUNT_OPTIONS, dedent, resolveMountOptions } from '../src/kernel.js'
import { mount } from '../src/index.js'
import { DARK_CSS, LIGHT_CSS } from '../src/styles/theme-css.js'

const DOC = '# Hello World\n\ntext\n\n```js\nvar a = 1\n```\n'

/**
 * Task 17 把 source/split/plain 接上了真实的 createEditor()（P2）——建它要走
 * `import('@readit/editor')` 的动态 import，在这套 vitest + vite 的模块图下
 * 需要真实的异步 I/O 才能落地，纯微任务循环等不到。轮询到条件成立为止，
 * 不猜一个固定时长该等多久——固定 sleep 在空闲机器上够用，但在 CI/并发负载下
 * 会闪烁（panes.test.ts 的 waitFor() 注释有实测记录：人为加满 CPU 负载后，
 * 固定 60ms 的旧版本能稳定复现超时）。
 */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

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
      loadHighlighter: null,
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
   * Task 17 把编辑器接进来了：source 走 CodeMirror（EDITOR_KIND 表），
   * 建它要经过 `import('@readit/editor')` 的动态 import，因此不是
   * createKernel() 返回时就已经落地，要 flush 一拍真实的异步 I/O。
   * 这条原本测的是「编辑器还没接入时的只读回落」，那个状态现在已经不存在——
   * 按 panes.ts 实际提供的行为订正为「真编辑器建出来了」。
   */
  it('source 模式异步建出真实的 CodeMirror 编辑器', async () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'source' }))
    await waitFor(() => kernel.sourcePane.querySelector('.cm-editor') !== null)
    expect(kernel.sourcePane.querySelector('.cm-editor')).not.toBeNull()
    expect(kernel.sourcePane.querySelector('pre.readit-source-fallback')).toBeNull()
  })

  it('切模式是幂等的，来回切不留残留节点', () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC }))
    kernel.setMode('split')
    kernel.setMode('split')
    kernel.setMode('read')
    expect(kernel.sourcePane.childNodes).toHaveLength(0)
    expect(kernel.content.querySelectorAll('h1')).toHaveLength(1)
  })

  it('setValue 在 split 下同时更新两个窗格', async () => {
    const kernel = createKernel(makeHost(), resolveMountOptions({ value: DOC, mode: 'split' }))
    // split 建的是 CodeMirror（EDITOR_KIND 表），要等它异步落地才有 .cm-content
    // 可查——sourcePane.textContent 不再是可靠的断言目标：CodeMirror 开着
    // lineNumbers() 扩展，窗格里还有一份行号 gutter 的文本混在一起。
    await waitFor(() => kernel.sourcePane.querySelector('.cm-content') !== null)
    kernel.setValue('# New\n')
    expect(kernel.content.querySelector('h1')?.textContent).toBe('New')
    expect(kernel.getValue()).toBe('# New\n')
    expect(kernel.sourcePane.querySelector('.cm-content')?.textContent).toBe('# New')
  })
})

/**
 * §0.1 G4：属性归这一批（Task 17）落地，样式那一半已经在 Task 3 的 BASE_CSS 里
 * （批次 6 只落地了触发决策，见 batch-6-report.md「§0 冲突」一节）。这里要证明
 * 的是 `host.setAttribute('data-readit-pending', …)` 真的发生了——不是
 * RerenderHost.setPending() 回调被调用（那条批次 6 已经用假 host 测过），是
 * 真实宿主 DOM 节点上的真实属性。
 */
describe('data-readit-pending：降级可见性的另一半', () => {
  it('缺数学渲染器时，宿主元素立刻带上 data-readit-pending="math"', () => {
    // rerenderer.repaint() 在 createPanes() 内部同步调用，scan() → missing() →
    // host.setPending() → kernel 的 onPending → host.dataset 全程零 await，
    // 所以不需要 flush() 就能在 createKernel() 返回后立刻看到它。
    const host = makeHost()
    const kernel = createKernel(host, resolveMountOptions({ value: 'a $x$ b' }))
    expect(host.getAttribute('data-readit-pending')).toBe('math')
    kernel.destroy()
  })

  it('math 异步加载完成后，属性被删掉而不是留一个空字符串', async () => {
    const host = makeHost()
    const kernel = createKernel(host, resolveMountOptions({ value: 'a $x$ b' }))
    expect(host.hasAttribute('data-readit-pending')).toBe(true)
    await waitFor(() => !host.hasAttribute('data-readit-pending'))
    // 用真实的 @readit/math 动态加载完成之后，pending 列表清空——kernel 用
    // delete 而不是设成空字符串，':host([data-readit-pending])' 选择器认的是
    // 「属性存在」，留一个空字符串角标不会消失。
    expect(host.hasAttribute('data-readit-pending')).toBe(false)
    expect(host.getAttribute('data-readit-pending')).toBeNull()
    kernel.destroy()
  })

  it('文档不需要任何降级能力时，属性从不出现', () => {
    const host = makeHost()
    const kernel = createKernel(host, resolveMountOptions({ value: DOC }))
    expect(host.hasAttribute('data-readit-pending')).toBe(false)
    kernel.destroy()
  })

  it('缺高亮器但宿主没打算要高亮（loadHighlighter 为 null）时不报 pending', () => {
    // rerender.ts 的 missing()：宿主没给 loadHighlighter 不算「加载中」，是一个
    // 已经完成的选择，不该被角标提醒——DOC 带一个 ```js 围栏块。
    const host = makeHost()
    const kernel = createKernel(host, resolveMountOptions({ value: DOC, highlighter: null }))
    expect(host.hasAttribute('data-readit-pending')).toBe(false)
    kernel.destroy()
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
    // 批次 3（Task 7）起，codeblock.ts 交给 highlight() 的正文改为去掉围栏尾换行的
    // trimmed，与 data-snippet-clipboard-copy-content 及无高亮回落路径对齐——见
    // packages/core/src/rules/codeblock.ts 与它的提交说明。
    expect(highlight.highlight).toHaveBeenCalledWith('var a = 1', 'js')
    expect(highlight.supports).not.toHaveBeenCalled()
  })
})
