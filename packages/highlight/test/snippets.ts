export interface Snippet {
  readonly slug: string
  readonly lang: string
  readonly code: string
}

/**
 * 与 packages/core/test/corpus/frontend/highlight-*.md 的围栏正文逐字相同。
 * 这样 ①档（语料只验 wrapper class）与 ③档（本包的冻结黄金文件验 token 划分）
 * 盯的是同一批输入，两档的结论可以互相对齐。
 *
 * 正文末尾不带换行：core 的 renderBlock 交给 highlight() 的就是去掉尾换行的正文
 * （见本任务对 packages/core/src/rules/codeblock.ts 的修改）。
 */
export const SNIPPETS: readonly Snippet[] = [
  { slug: 'js', lang: 'js', code: 'const greet = (name) => `hi ${name}`\nexport default greet' },
  { slug: 'ts', lang: 'ts', code: 'interface P { id: number }\nexport const f = (p: P): string => String(p.id)' },
  { slug: 'python', lang: 'python', code: 'def f(x: int) -> int:\n    return x * 2' },
  { slug: 'rust', lang: 'rust', code: 'fn main() {\n    println!("hi");\n}' },
  { slug: 'diff', lang: 'diff', code: '- old line\n+ new line' },
]

/** 五个片段的语言名，直接当作 createShikiHighlighter 的 langs 传入。 */
export const LANGS: readonly string[] = SNIPPETS.map((s) => s.lang)
