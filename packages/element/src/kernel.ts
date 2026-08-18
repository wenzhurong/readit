import { GITHUB_EMOJI_BASE } from '@readit/core'
import {
  FIND_CSS,
  createFindController,
  lineAtOffset,
  type FindController,
  type FindOptions,
  type FindResult,
} from '@readit/find'
import { createDisposers, type Disposers } from './disposers.js'
import { createRoot, ownerView, type RootContext } from './shadow.js'
import { createNavigation, type NavigationController } from './navigate.js'
import { createPanes, type Panes } from './panes.js'
import { browserDeps, type PendingCapability } from './rerender.js'
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
  breaks: false,
  math: null,
  highlighter: null,
  emojiBase: GITHUB_EMOJI_BASE,
  onNavigate: null,
  loadHighlighter: null,
  loadMermaid: null,
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
  /** part="content"，.markdown-body。read / split 下可见，也是预览侧的滚动容器。 */
  readonly content: HTMLDivElement
  /** 源码窗格。panes.ts 的 createPanes() 把 createEditor() 接在它下面。 */
  readonly sourcePane: HTMLDivElement
  readonly navigation: NavigationController
  /** 窗口内错误态。path 显示的是解析后的完整路径（设计文档 §8）。 */
  showError(title: string, path: string, detail: string): void
  clearError(): void
  readonly destroyed: boolean
  /** 注册一个「每次预览重渲之后」的回调，按注册顺序跑。 */
  onAfterRender(fn: () => void): void
  getValue(): string
  setValue(value: string): void
  getMode(): Mode
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  find(query?: string, options?: FindOptions): FindResult
  destroy(): void
}

export function createKernel(host: HTMLElement, opts: MountOptions): Kernel {
  const view = ownerView(host)
  const doc = host.ownerDocument
  const disposers = createDisposers()
  const root = createRoot(host, opts.shadow, disposers)

  const sourcePane = doc.createElement('div')
  // §0 A8 定的类名是 .readit-source（Task 17 的 createPanes() 接收这个节点，
  // 不自己 createElement，task-17-brief.md 的测试直接查 .readit-source /
  // .readit-source textarea）。保留 readit-pane 是给 BASE_CSS 共享的窗格布局
  // 规则（min-width/overflow/[hidden]）用的，跟 content 保留 readit-pane 是
  // 同一个理由——A8 给的是「必须包含」的类，不是「只能有」的类，content 自己
  // 也在 .markdown-body 之外多带了 readit-pane。
  sourcePane.className = 'readit-pane readit-source'

  const content = doc.createElement('div')
  content.className = 'readit-pane readit-pane-content markdown-body'
  content.setAttribute('part', 'content')

  const errorPane = doc.createElement('div')
  errorPane.className = 'readit-error'
  errorPane.setAttribute('role', 'alert')
  errorPane.hidden = true
  const errorTitle = doc.createElement('p')
  errorTitle.className = 'readit-error-title'
  const errorPath = doc.createElement('p')
  errorPath.className = 'readit-error-path'
  const errorDetail = doc.createElement('p')
  errorDetail.className = 'readit-error-detail'
  errorPane.append(errorTitle, errorPath, errorDetail)

  root.root.append(errorPane, sourcePane, content)

  const showError = (title: string, path: string, detail: string): void => {
    errorTitle.textContent = title
    errorPath.textContent = path
    errorDetail.textContent = detail
    errorPane.hidden = false
  }
  const clearError = (): void => {
    errorPane.hidden = true
    errorTitle.textContent = ''
    errorPath.textContent = ''
    errorDetail.textContent = ''
  }

  let mode: Mode = opts.mode
  let destroyed = false

  const assertLive = (): void => {
    if (destroyed) {
      throw new Error('readit: 这个挂载实例已经 destroy()，不能再用。需要的话重新 mount()。')
    }
  }

  const applyStyles = (resolved: ResolvedTheme): void => {
    // 只 adopt 当前主题这一张，两份互斥地上——不是因为「规则体不能挂在
    // :host([data-theme=…]) 下」，批次 5 换源文件之后 LIGHT_CSS/DARK_CSS 各自的
    // 变量块本来就是 :host([data-theme="light"|"dark"]) 生成出来的（Task 18，
    // scripts/gen-theme-css.ts），运行时也确实能两张同时 adopt 而不冲突
    // （ELEMENT_CSS 那份构建产物就是两张都在）。这里仍然只 adopt 一张，是因为
    // LIGHT_CSS/DARK_CSS 各自的规则体（三万多字节，占了绝大部分体积）是相同的
    // 文本重复了两份——两张都 adopt 等于把这份规则体在 adoptedStyleSheets 里
    // 保留两份，纯粹的浪费，不是正确性需要。data-theme 仍然写在宿主上：它是
    // ::part 与 --readit-* 消费者看得见的公开状态。
    root.setStyles([
      resolved === 'dark' ? DARK_CSS : LIGHT_CSS,
      `${BASE_CSS}\n${FIND_CSS}`,
    ])
  }

  const theme = createThemeController(host, view, opts.theme, applyStyles, disposers)
  applyStyles(theme.resolved)

  const afterRender: Array<() => void> = []
  let finder: FindController | null = null

  // part="code-block" 是 SPEC §9.2 的永久公开 API，但 Phase A 的输出字节是冻结的
  // （56/68 那条基线），所以属性只能在注入之后补。
  afterRender.push(() => {
    for (const pre of content.querySelectorAll('pre')) pre.setAttribute('part', 'code-block')
    for (const diagram of content.querySelectorAll('.highlight-source-mermaid')) {
      diagram.setAttribute('part', 'mermaid')
    }
  })

  const navigation = createNavigation(
    {
      view,
      host,
      content,
      baseUrl: opts.baseUrl,
      onNavigate: opts.onNavigate,
      showError,
      clearError,
    },
    disposers,
  )
  // 装饰外链与应用挂起的 #hash 都要等 HTML 进了 DOM 才有意义。
  afterRender.push(() => {
    navigation.afterRender()
  })
  // Active queries must be rebound after every Phase A repaint and after
  // Mermaid swaps its source <pre> for a fresh SVG subtree.
  afterRender.push(() => {
    finder?.refresh()
  })

  // CodeMirror 的样式注入目标：shadow 模式下是 ShadowRoot 本身（container 就是它），
  // light DOM 逃生舱下没有 ShadowRoot 可言，退回宿主所属的 Document——与
  // createRoot() 判定 shadow 与否用的是同一个 opts.shadow，两边不会各说各话。
  const editorRoot: ShadowRoot | Document = opts.shadow ? (root.container as ShadowRoot) : doc

  root.root.setAttribute('data-mode', mode)

  const panes: Panes = createPanes({
    content,
    sourcePane,
    root: editorRoot,
    value: opts.value,
    mode: opts.mode,
    renderOptions: {
      inlineMath: opts.inlineMath,
      breaks: opts.breaks,
      math: opts.math,
      highlighter: opts.highlighter,
      emojiBase: opts.emojiBase,
    },
    deps: browserDeps(opts.loadHighlighter, opts.loadMermaid),
    measure: (el) => (el as HTMLElement).offsetTop,
    disposers,
    onPending(pending: readonly PendingCapability[]): void {
      // §0.1 G4：属性归这一批落地——样式那一半（角标）已经在 Task 3 的
      // BASE_CSS 里，缺的正是这个 setAttribute()。空数组代表都到齐了，删掉
      // 属性而不是设成空字符串：CSS 选择器 :host([data-readit-pending]) 认的
      // 是「属性存在」，空字符串仍然存在，角标不会消失。
      if (pending.length === 0) delete host.dataset['readitPending']
      else host.dataset['readitPending'] = pending.join(' ')
    },
    onPainted(): void {
      for (const fn of afterRender) fn()
    },
  })

  finder = createFindController({
    owner: host,
    mount: root.root,
    target: () => content,
    // split has a complete, visible preview DOM; source/plain must use the
    // document string because CodeMirror virtualizes offscreen lines.
    source: () => (mode === 'source' || mode === 'plain' ? panes.getValue() : null),
    revealSource(match): void {
      panes.scrollSourceToLine(lineAtOffset(panes.getValue(), match.start))
    },
  })

  const kernel: Kernel = {
    host,
    options: opts,
    root,
    disposers,
    content,
    sourcePane,
    navigation,
    showError,
    clearError,
    get destroyed(): boolean {
      return destroyed
    },
    onAfterRender(fn: () => void): void {
      afterRender.push(fn)
    },
    getValue(): string {
      return panes.getValue()
    },
    setValue(next: string): void {
      assertLive()
      panes.setValue(next)
    },
    getMode(): Mode {
      return mode
    },
    setMode(next: Mode): void {
      assertLive()
      mode = next
      root.root.setAttribute('data-mode', next)
      void panes.setMode(next).then(() => finder?.refresh())
    },
    setTheme(next: Theme): void {
      assertLive()
      theme.set(next)
    },
    find(query?: string, options?: FindOptions): FindResult {
      assertLive()
      return finder!.find(query, options)
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      // 先断内容再拆监听：反过来的话最后一次事件可能打到半拆的状态上。
      finder?.destroy()
      finder = null
      panes.destroy()
      clearError()
      afterRender.length = 0
      disposers.disposeAll()
    },
  }

  return kernel
}
