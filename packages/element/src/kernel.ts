import { GITHUB_EMOJI_BASE, render } from '@readit/core'
import { createDisposers, type Disposers } from './disposers.js'
import { createRoot, ownerView, type RootContext } from './shadow.js'
import { setHtml } from './set-html.js'
import { BASE_CSS } from './styles/base-css.js'
import { DARK_CSS, LIGHT_CSS } from './styles/theme-css.js'
import { createThemeController, type ResolvedTheme } from './theme.js'
import type { Mode, MountOptions, Theme } from './types.js'

export const DEFAULT_MOUNT_OPTIONS: MountOptions = {
  value: '',
  mode: 'read',
  shadow: true,
  theme: 'auto',
  baseUrl: '',
  inlineMath: 'github',
  math: null,
  highlighter: null,
  emojiBase: GITHUB_EMOJI_BASE,
  onNavigate: null,
}

export function resolveMountOptions(opts?: Partial<MountOptions>): MountOptions {
  return { ...DEFAULT_MOUNT_OPTIONS, ...opts }
}

const MODES: readonly string[] = ['read', 'source', 'split', 'plain']
const THEMES: readonly string[] = ['auto', 'light', 'dark']
const INLINE_MATH: readonly string[] = ['github', 'strict', 'off']

export function isMode(value: string): value is Mode {
  return MODES.includes(value)
}
export function isTheme(value: string): value is Theme {
  return THEMES.includes(value)
}
export function isInlineMath(value: string): value is MountOptions['inlineMath'] {
  return INLINE_MATH.includes(value)
}

/**
 * 轻 DOM 里的源码带着 HTML 的缩进进来，而 4 个空格在 Markdown 里是代码块。
 * 只去公共缩进，不动相对缩进。
 */
export function dedent(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').replace(/^[ \t]*\n/, '').split('\n')
  let common = Number.POSITIVE_INFINITY
  for (const line of lines) {
    if (line.trim() === '') continue
    const indent = /^[ \t]*/.exec(line)
    common = Math.min(common, indent === null ? 0 : indent[0].length)
  }
  if (!Number.isFinite(common) || common === 0) return lines.join('\n')
  return lines.map((line) => (line.trim() === '' ? line.trimStart() : line.slice(common))).join('\n')
}

export interface Kernel {
  readonly host: HTMLElement
  readonly options: MountOptions
  readonly root: RootContext
  readonly disposers: Disposers
  /** part="content"，.markdown-body。read / split 下可见。 */
  readonly content: HTMLDivElement
  /** 源码窗格。Task 13–17 把 createEditor() 接进这里。 */
  readonly sourcePane: HTMLDivElement
  readonly destroyed: boolean
  /** 注册一个「每次预览重渲之后」的回调，按注册顺序跑。 */
  onAfterRender(fn: () => void): void
  /** 按当前 value / mode 重画。 */
  rerender(): void
  getValue(): string
  setValue(value: string): void
  getMode(): Mode
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  destroy(): void
}

export function createKernel(host: HTMLElement, opts: MountOptions): Kernel {
  const view = ownerView(host)
  const doc = host.ownerDocument
  const disposers = createDisposers()
  const root = createRoot(host, opts.shadow, disposers)

  const sourcePane = doc.createElement('div')
  sourcePane.className = 'readit-pane readit-pane-source'

  const content = doc.createElement('div')
  content.className = 'readit-pane readit-pane-content markdown-body'
  content.setAttribute('part', 'content')

  root.root.append(sourcePane, content)

  let value = opts.value
  let mode: Mode = opts.mode
  let destroyed = false

  const assertLive = (): void => {
    if (destroyed) {
      throw new Error('readit: 这个挂载实例已经 destroy()，不能再用。需要的话重新 mount()。')
    }
  }

  const applyStyles = (resolved: ResolvedTheme): void => {
    // 只 adopt 当前主题这一张。两份单主题文件互斥地上，所以不需要把 22 KB 的规则
    // 逐条改写到 :host([data-theme=…]) 下——那要么靠 CSS 嵌套（WebKit 17.2 起才有
    // 宽松嵌套解析，而 M6 的 WKWebView 可能更老），要么靠正则改写 CSS 文本。
    // data-theme 仍然写在宿主上：它是 ::part 与 --readit-* 消费者看得见的公开状态。
    root.setStyles([resolved === 'dark' ? DARK_CSS : LIGHT_CSS, BASE_CSS])
  }

  const theme = createThemeController(host, view, opts.theme, applyStyles, disposers)
  applyStyles(theme.resolved)

  const afterRender: Array<() => void> = []

  // part="code-block" 是 SPEC §9.2 的永久公开 API，但 Phase A 的输出字节是冻结的
  // （56/68 那条基线），所以属性只能在注入之后补。
  afterRender.push(() => {
    for (const pre of content.querySelectorAll('pre')) pre.setAttribute('part', 'code-block')
  })

  const renderContent = (): void => {
    // element 里把 HTML 写进 DOM 只准走 setHtml()（唯一入口，由 set-html.ts 实现，
    // 见 test/set-html-usage.test.ts 的源码级断言）。content 是真实 HTMLDivElement，
    // 结构上满足 setHtml 的 HtmlSink 参数（有 innerHTML，可能有 setHTML）。
    setHtml(
      content,
      render(value, {
        inlineMath: opts.inlineMath,
        math: opts.math,
        highlighter: opts.highlighter,
        emojiBase: opts.emojiBase,
      }),
    )
    for (const fn of afterRender) fn()
  }

  /**
   * 接缝：Task 13–17 在这里换成 `createEditor(kind, { parent, root, value, onChange, onScroll })`
   * （P2），kind 按 mode 取 'plain' 或 'codemirror'。
   *
   * 在那之前不是空白也不抛——按 §12「降级必须可见」显示只读源码，并用
   * data-editor="none" 把「编辑器没接进来」这个状态说出来。
   */
  const renderSource = (): void => {
    sourcePane.textContent = ''
    const pre = doc.createElement('pre')
    pre.className = 'readit-source-fallback'
    pre.setAttribute('data-editor', 'none')
    pre.textContent = value
    sourcePane.appendChild(pre)
  }

  const rerender = (): void => {
    root.root.setAttribute('data-mode', mode)
    const showSource = mode !== 'read'
    const showContent = mode === 'read' || mode === 'split'
    sourcePane.hidden = !showSource
    content.hidden = !showContent
    if (showSource) renderSource()
    else sourcePane.textContent = ''
    if (showContent) renderContent()
    else content.textContent = ''
  }

  rerender()

  const kernel: Kernel = {
    host,
    options: opts,
    root,
    disposers,
    content,
    sourcePane,
    get destroyed(): boolean {
      return destroyed
    },
    onAfterRender(fn: () => void): void {
      afterRender.push(fn)
    },
    rerender,
    getValue(): string {
      return value
    },
    setValue(next: string): void {
      assertLive()
      value = next
      rerender()
    },
    getMode(): Mode {
      return mode
    },
    setMode(next: Mode): void {
      assertLive()
      mode = next
      rerender()
    },
    setTheme(next: Theme): void {
      assertLive()
      theme.set(next)
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      content.textContent = ''
      sourcePane.textContent = ''
      afterRender.length = 0
      disposers.disposeAll()
    },
  }

  return kernel
}
