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
   */
  loadHighlighter: (() => Promise<Highlighter>) | null
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
