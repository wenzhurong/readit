export type EditorKind = 'codemirror' | 'plain'

export interface EditorOptions {
  parent: HTMLElement
  /** CodeMirror 需要它做样式注入；plain 档忽略。 */
  root: ShadowRoot | Document
  value: string
  onChange(value: string): void
  /** topLine 是 0 基的首个可见源码行，供滚动同步用。 */
  onScroll(topLine: number): void
}

export interface Editor {
  setValue(value: string): void
  getValue(): string
  focus(): void
  /** 0 基的首个可见源码行。 */
  topLine(): number
  scrollToLine(line: number): void
  destroy(): void
}
