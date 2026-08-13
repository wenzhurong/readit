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

/** GitHub 自身为 23 个自定义 emoji 短代码提供的绝对 CDN 前缀（2026-08-06 实测）。 */
export const GITHUB_EMOJI_BASE = 'https://github.githubassets.com/images/icons/emoji/'

export interface RenderOptions {
  inlineMath: InlineMathMode
  math: MathRenderer | null
  highlighter: Highlighter | null
  allowDangerousHtml: boolean
  explain: boolean
  /**
   * 23 个自定义 emoji（`:shipit:` 等）PNG 的前缀。
   *
   * 默认是 `GITHUB_EMOJI_BASE`，因为保真度是本项目的头号承诺：GitHub 发的就是
   * 那个绝对 CDN URL，语料 `gfm/emoji` 逐字节比对的也是它。
   *
   * ⚠️ **但这个默认值与 SPEC §6 规则 10 的离线约束直接冲突**——那条要求自定义
   * emoji 必须本地打包，理由是「否则打开一个含 `:shipit:` 的 README 就违反了
   * 离线约束」。冲突是真实的，且**语料测试看不见它**：语料比对的是 HTML 标记，
   * 不是运行时有没有发出网络请求。CDN URL 让语料变绿的同时打破了离线承诺。
   *
   * 这个选项就是冲突的出口。离线宿主把它指向自己伺服的路径即可：
   * 23 个 PNG 已提交在 `packages/core/data/emoji/`，SPEC §5.1 预算了构建时
   * 拷贝到 `dist/emoji/`。
   *
   * ```ts
   * render(src, { emojiBase: '/assets/emoji/' })   // 完全离线
   * ```
   *
   * 无论取何值，Phase A 自身**永不发起网络请求**——它只是把一个字符串写进
   * `src` 属性。是否真的去取那个 URL，由渲染这段 HTML 的宿主决定。
   */
  emojiBase: string
}

export const DEFAULT_OPTIONS: Readonly<RenderOptions> = Object.freeze({
  inlineMath: 'github',
  math: null,
  highlighter: null,
  allowDangerousHtml: false,
  explain: false,
  emojiBase: GITHUB_EMOJI_BASE,
})

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
