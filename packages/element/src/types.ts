import type { Highlighter, MathRenderer } from '@readit/core/types'
import type { MermaidRenderer } from '@readit/mermaid'
import type { FindOptions, FindResult } from '@readit/find'

export type Mode = 'read' | 'source' | 'split' | 'plain'
export type Theme = 'auto' | 'light' | 'dark'

export interface MountOptions {
  value: string
  mode: Mode
  shadow: boolean
  theme: Theme
  baseUrl: string
  // 与 @readit/core 的 InlineMathMode 结构相同。这里按 P4 逐字写出联合类型，
  // 而不是复用那个别名 —— 契约怎么写的，签名就怎么读。
  inlineMath: 'github' | 'strict' | 'off'
  /**
   * 段落内软换行是否发 `<br>`。默认 `false` —— 那是 GitHub 对仓库里 `.md` 文件的
   * 行为（实测：6 份真实抓取的语料里，段落内软换行产出 0 个 `<br>`）。
   *
   * 置 `true` 得到的是**编辑器预览那一套**（Cursor / VS Code / Obsidian，也是
   * GitHub 评论区的行为）。本地文档阅读器有正当理由选它——见
   * `RenderOptions.breaks` 的完整理由。
   */
  breaks: boolean
  math: MathRenderer | null
  highlighter: Highlighter | null
  emojiBase: string
  onNavigate: ((path: string) => void) | null
  /**
   * 高亮器的异步加载器（task-17-brief「新增契约提案」第 2 条）。P1 禁止
   * @readit/element 在运行时 import @readit/highlight，而 SPEC §5.1 又要求
   * 「首次遇到围栏语言」才加载那份体积——两条同时成立的唯一办法是加载器
   * 由宿主注入。默认 null：宿主没打算要高亮，rerender.ts 的 missing() 不会
   * 把 'highlight' 报进 pending（那不是「加载中」，是一个已经完成的选择）。
   * 与 `highlighter` 字段互补：后者是宿主直接给实例的同步路径，这个字段是
   * 「等真的用到再去拿」的懒加载路径。
   *
   * **形参 `languages` 必须用上。** 它是到目前为止见过的全部围栏语言的并集
   * （小写、去重）。`createShikiHighlighter()` 不传 `langs` 得到的是空语言集，
   * 对任何语言都 `supports() === false`，于是每个围栏静默回落朴素 `<pre>`——
   * 不报错也不提示。语言集在工厂期就定死（`highlight()` 契约上必须纯同步），
   * 所以这是宿主唯一的注入点。文档换到新语言时元素会带着新的并集再调一次。
   */
  loadHighlighter: ((languages: readonly string[]) => Promise<Highlighter>) | null
  /**
   * Mermaid Phase B 水合器的异步加载器。与 loadHighlighter 一样由宿主
   * 注入，以便重依赖只在文档首次出现 mermaid 围栏时才下载。
   * null 表示宿主选择只显示 Phase A 源码，不计入 pending。
   */
  loadMermaid: (() => Promise<MermaidRenderer>) | null
}

export interface MountHandle {
  setValue(value: string): void
  getValue(): string
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  /** With no query, opens and focuses the built-in find bar. */
  find(query?: string, options?: FindOptions): FindResult
  destroy(): void
}
