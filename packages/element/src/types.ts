import type { Highlighter, MathRenderer } from '@readit/core/types'

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
}

export interface MountHandle {
  setValue(value: string): void
  getValue(): string
  setMode(mode: Mode): void
  setTheme(theme: Theme): void
  destroy(): void
}
