import type { RenderOptions } from '@readit/core'
import type { Editor, EditorKind, EditorOptions } from '@readit/editor'
import type { MermaidRenderer } from '@readit/mermaid'
import { addListener, type Disposers } from './disposers.js'
import {
  createRerenderer,
  type PendingCapability,
  type RerenderDeps,
  type RerenderHost,
  type Rerenderer,
} from './rerender.js'
import { setHtml } from './set-html.js'
import type { MeasureTop } from './scroll/anchors.js'
import { synthesizeHtmlAnchors } from './scroll/html-anchors.js'
import { createScrollSync, type ScrollSync } from './scroll/sync.js'
import type { Mode } from './types.js'

/**
 * §0 A8：kernel.ts 拥有 root 与 pane 的创建与命名。这里只*接收*它已经建好、
 * 已经挂进 DOM 的两个节点（content 是 .markdown-body / part="content"，
 * sourcePane 是 .readit-source），不自己 createElement——任务书草稿里那个
 * 无定义的 `shell` 变量已被 §0 裁决删掉。
 */
export interface PanesOptions {
  /** kernel 已创建、已挂进 DOM 的预览 pane。也是预览侧的滚动容器。 */
  content: HTMLElement
  /** kernel 已创建、已挂进 DOM 的源码 pane，CodeMirror/textarea 挂在它下面。 */
  sourcePane: HTMLElement
  /** CodeMirror 的样式注入目标；plain 忽略。 */
  root: ShadowRoot | Document
  value: string
  mode: Mode
  renderOptions: Partial<RenderOptions>
  deps: RerenderDeps
  measure: MeasureTop
  /** 唯一允许的 addEventListener 入口在 disposers.ts；这里借用它注册预览滚动监听。 */
  disposers: Disposers
  /** 把「还缺什么能力」交给宿主落成 data-readit-pending（§0.1 G4）。 */
  onPending(pending: readonly PendingCapability[]): void
  /**
   * 每次 HTML 落地之后触发，在 synthesizeHtmlAnchors/scrollSync.invalidate()
   * 之后调用。kernel.ts 用它补 part="code-block"（Phase A 输出字节是冻结的，
   * 只能注入后补）与 navigation.afterRender()（外链装饰、#hash 应用）——这两件
   * 事与「怎么渲染」无关，留在 kernel.ts 里而不是搬进这个文件。
   */
  onPainted?(): void
}

export interface Panes {
  getValue(): string
  setValue(value: string): void
  setMode(mode: Mode): Promise<void>
  destroy(): void
}

const EDITOR_KIND: Record<Mode, EditorKind | null> = {
  read: null,
  plain: 'plain',
  source: 'codemirror',
  split: 'codemirror',
}

export function createPanes(opts: PanesOptions): Panes {
  let value = opts.value
  let editor: Editor | null = null
  let sync: ScrollSync | null = null
  // 每次 applyMode() 调用（不只是每次真的建了编辑器）都自增一次：一次
  // split->split->read 的连续调用里，前两次发起的 buildEditor() 在它们的
  // dynamic import 落地之前，desired mode 已经变成 read——若只在 buildEditor()
  // 内部自增，第二次 split 的 mine 会恰好等于当时的 generation，误把「已经
  // 过时的构建」当成最新的接上，在 sourcePane 里留下不该在的编辑器。
  let generation = 0
  let destroyed = false

  const host: RerenderHost = {
    paint(html) {
      setHtml(opts.content, html)
      // 每次重渲后重补原生 HTML 块的锚点：markdown-it 的 html_block 渲染器
      // 把 data-line 丢了，Task 16 在这一侧补回来。
      synthesizeHtmlAnchors(opts.content, value)
      sync?.invalidate()
      opts.onPainted?.()
    },
    hydrateMermaid(renderer: MermaidRenderer) {
      void renderer.hydrate(opts.content)
    },
    setPending(pending) {
      opts.onPending(pending)
    },
  }

  const rerenderer: Rerenderer = createRerenderer(host, opts.deps, opts.renderOptions, value)

  // 预览滚动监听只装一次，贯穿这个 Panes 实例的整个生命周期——handler 只在
  // sync 非空时才有动作，read 模式或编辑器还没建好时它是安全的空操作。这样
  // 不需要在每次 buildEditor/teardownEditor 时反复 add/remove，也就不会在
  // 一次挂载里多次切模式时往 disposers 里堆积一串只会跑一次就作废的 disposer。
  const onPreviewScroll = (): void => {
    sync?.fromPreview()
  }
  addListener(opts.disposers, opts.content, 'scroll', onPreviewScroll)

  const teardownEditor = (): void => {
    editor?.destroy()
    editor = null
    sync?.destroy()
    sync = null
    opts.sourcePane.replaceChildren()
  }

  /**
   * 编辑器加载失败时的只读回落——§12「降级必须可见」。真实故障（宿主离线、
   * CDN 分片 404）与「组件已经被摘掉、动态 import 却还在半空中」这两种情形
   * 走的是同一条 catch：都不该变成一片空白，也不该变成未处理的 rejection
   * （本批实测撞到过：happy-dom/vitest 环境在测试文件结束后拆掉模块运行时，
   * 一个仍在 import() 中的 CodeMirror 加载会抛
   * "Cannot load ... after the environment was torn down"——不接住它，
   * 每次跑 npm test 都有一定概率在无关文件上报出一条幽灵式的 unhandled
   * rejection）。
   */
  const showEditorFallback = (): void => {
    const doc = opts.sourcePane.ownerDocument
    const pre = doc.createElement('pre')
    pre.className = 'readit-source-fallback'
    pre.setAttribute('data-editor', 'unavailable')
    pre.textContent = value
    opts.sourcePane.replaceChildren(pre)
  }

  const buildEditor = async (kind: EditorKind, mine: number): Promise<void> => {
    const editorOptions: EditorOptions = {
      parent: opts.sourcePane,
      root: opts.root,
      value,
      onChange: (next) => {
        value = next
        rerenderer.update(next)
      },
      onScroll: (topLine) => {
        sync?.fromEditor(topLine)
      },
    }
    try {
      // element -> @readit/editor 只有这一条边，且是动态的（P1 / §0 A7）：
      // CodeMirror 那份体积只有真正切进 source / split 的宿主才付。
      const { createEditor } = await import('@readit/editor')
      const created = await createEditor(kind, editorOptions)
      if (destroyed || mine !== generation) {
        created.destroy()
        return
      }
      editor = created
      sync = createScrollSync({
        source: created,
        preview: opts.content,
        content: opts.content,
        measure: opts.measure,
        contentHeight: () => opts.content.scrollHeight,
        lineCount: () => value.split('\n').length,
      })
    } catch {
      if (destroyed || mine !== generation) return
      showEditorFallback()
    }
  }

  const applyMode = async (next: Mode): Promise<void> => {
    const mine = ++generation
    const showSource = next !== 'read'
    const showContent = next === 'read' || next === 'split'
    opts.sourcePane.hidden = !showSource
    opts.content.hidden = !showContent
    teardownEditor()
    const kind = EDITOR_KIND[next]
    if (kind === null) return
    await buildEditor(kind, mine)
  }

  void applyMode(opts.mode)
  rerenderer.repaint()

  return {
    getValue() {
      // 有编辑器时以它为准，不是这里自己追的 value——组合期间编辑器会推迟
      // 落笔（codemirror.ts 的 view.composing 分支），但 panes.ts 自己的
      // value 在 setValue() 里是立即同步覆盖的，两者会在组合期间短暂不一致。
      // 这条分支是 IME 验收线抓出来的真实缺陷：没有它，宿主在预编辑串还没
      // 提交时调 getValue() 会拿到一个「还没真正发生」的值，等于外部写入
      // 悄悄吞掉了用户正在输入的内容——这正是「组合期间的 setValue 被推迟」
      // 这条契约想防的事，只是防丢的是编辑器内部状态，getValue() 这个读口
      // 之前没有跟着守住。
      return editor?.getValue() ?? value
    },
    setValue(next) {
      value = next
      editor?.setValue(next)
      rerenderer.setValue(next)
    },
    async setMode(next) {
      if (destroyed) return
      await applyMode(next)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      generation++
      teardownEditor()
      rerenderer.destroy()
      opts.content.replaceChildren()
    },
  }
}
