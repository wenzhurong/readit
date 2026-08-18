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
  /**
   * 段落内的**软换行**（单个换行、行尾没有两个空格也没有反斜杠）要不要发 `<br>`。
   *
   * **默认 `false`，因为那才是 GitHub。** 这一条是量出来的不是记出来的：
   * `packages/core/test/fixtures/real-world/` 里 6 份从 github.com 抓回的 HTML，
   * 对应源码里的段落内软换行，**GitHub 产出 0 个由它们而来的 `<br>`**
   * （mermaid.html 里那 6 个全部来自源码显式写的 `<br>`/`<br/>`）。
   * 由 `packages/core/test/breaks.test.ts` 逐份重算并钉住；软换行的**条数**取决于
   * 「什么算段落内软换行」的判据，那条测试里写死了它用的那一套。
   * 语料逐字节比对跑的就是这个默认值，**不要改它**。
   *
   * ## 那为什么还要有这个选项
   *
   * 与 `emojiBase` 同一性质：保真度与另一条真实需求冲突，选项是冲突的出口。
   *
   * GitHub 自己也分两套——**评论/issue 里换行就是换行**（`breaks: true`），
   * **仓库里的 `.md` 文件不是**。而绝大多数本地编辑器（Cursor / VS Code 预览、
   * Obsidian、Typora）按前一套渲染。于是同一份文档在「写它的地方」和「GitHub 上」
   * 长得不一样，作者通常按前者的观感在写。
   *
   * 一个**本地文档阅读器**面对的是作者硬盘上的文件，不是仓库页面。把它钉死在
   * 后一套，等于要求用户改掉自己全部历史文档。所以：**引擎默认保真，宿主可以
   * 选择另一套，并且这个选择必须是显式的**。
   *
   * 三个入口，优先级由宿主决定：`render(src, { breaks })`、
   * `mount({ breaks })`、以及文档自己的 frontmatter `readit-breaks: true`
   * （见 `readFrontmatterOptions`，与 `readit-inline-math` 同一机制）。
   */
  breaks: boolean
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
  // false = GitHub 的 .md 文件渲染。语料比对依赖它，改这个值会让 56/68 变红。
  breaks: false,
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
