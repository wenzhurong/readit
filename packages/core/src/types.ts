export interface Highlighter {
  /** 返回高亮后的 HTML；不支持该语言时返回 null，调用方回落到朴素 <pre> */
  highlight(code: string, lang: string): string | null
  supports(lang: string): boolean
}

export interface MathRenderer {
  /** TeX -> 自包含 HTML 字符串。必须是纯同步、确定性的 */
  render(tex: string, display: boolean): string
}

export type InlineMathMode = 'github' | 'strict' | 'off'

export interface RenderOptions {
  inlineMath: InlineMathMode
  math: MathRenderer | null
  highlighter: Highlighter | null
  allowDangerousHtml: boolean
  explain: boolean
}

export const DEFAULT_OPTIONS: RenderOptions = {
  inlineMath: 'github',
  math: null,
  highlighter: null,
  allowDangerousHtml: false,
  explain: false,
}

/** 美元护栏的判定日志条目 */
export interface ExplainEntry {
  offset: number
  verdict: 'opened' | 'closed' | 'rejected'
  ruleId: 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8'
}

export interface RenderResult {
  html: string
  explain: ExplainEntry[]
}
