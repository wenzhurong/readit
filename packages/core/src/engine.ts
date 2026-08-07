import MarkdownItConstructor from 'markdown-it'
import type { MarkdownIt } from 'markdown-it'
import type { RenderOptions } from './types.js'

/** 一条渲染规则。文件位于 src/rules/<name>.ts，形如 export function applyXxx(md: MarkdownIt): void */
export type Rule = (md: MarkdownIt) => void

/**
 * 语义规则：改变 CommonMark/GFM **解析或语义**结果的规则。
 * cmark-gfm 的 spec.txt 对这些有明确期望，所以 L1 规格套件必须带上它们。
 * 例：GFM 扩展自动链接、tagfilter、表格 align 属性、<s> -> <del>。
 */
export const SEMANTIC_RULES: Rule[] = []

/**
 * 外形规则：只往输出上贴 GitHub 特有的外壳/属性，不改变解析语义。
 * 例：dir="auto"、标题锚点 wrapper、<markdown-accessiblity-table>、代码块 wrapper、data-line。
 * L1 规格套件**不**加载它们 —— 加载了会让 672 条 GFM 里的绝大多数无条件失败，
 * 「672/672 减白名单」那条验收线就不再可达。它们由 L2 黄金文件套件负责。
 */
export const SHAPE_RULES: Rule[] = []

function baseEngine(opts: RenderOptions): MarkdownIt {
  return new MarkdownItConstructor({
    html: opts.allowDangerousHtml,
    xhtmlOut: false,
    breaks: false,
    langPrefix: 'language-',
    // linkify-it 6 把 fuzzyLink 默认关了；GFM 扩展自动链接由 SEMANTIC_RULES 里的
    // 自写规则移植（SPEC §6 规则 1）。这里必须保持 false，不要改回 true。
    linkify: false,
    typographer: false,
  })
}

/** 完整引擎：语义规则 + 外形规则。render() 走这条。 */
export function createEngine(opts: RenderOptions): MarkdownIt {
  const md = baseEngine(opts)
  for (const apply of SEMANTIC_RULES) apply(md)
  for (const apply of SHAPE_RULES) apply(md)
  return md
}

/** 规格一致性引擎：只加载语义规则。仅供 test/spec/ 下的 L1 套件使用。 */
export function createSpecEngine(opts: RenderOptions): MarkdownIt {
  const md = baseEngine(opts)
  for (const apply of SEMANTIC_RULES) apply(md)
  return md
}
