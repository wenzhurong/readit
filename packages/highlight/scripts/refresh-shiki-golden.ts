/**
 * 重写 packages/highlight/test/fixtures/shiki/*.html（③档 D-TOKEN 冻结黄金文件）。
 * 只在**有意**接受 shiki 4.4.2 → 新版本的 token 划分变化时跑，跑完必须逐字看 diff。
 *
 *   npm run refresh:shiki-golden --workspace @readit/highlight
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createShikiHighlighter } from '../src/index.js'
import { LANGS, SNIPPETS } from '../test/snippets.js'

/**
 * B4（批次 8 派单，定义见 .superpowers/sdd/2026-08-09-plan2-element-editor/batch-8-report.md）：main 守卫。批次 3 复审
 * 记过一笔——`measure-lang-packs.ts` 曾经就是这个形状（模块顶层无守卫地
 * `writeFileSync`），被测试 `import` 时会在 import 求值阶段就把黄金文件重写一遍，
 * 让后面比对「提交的文件是否与当前实测一致」的断言失去意义（永远在跟自己刚写的
 * 东西比）。这个文件此刻没有任何测试 import 它（`grep` 过各包 test 目录
 * 与根 test 目录），所以还不是活洞，但形状与修复前的 `measure-lang-packs.ts`
 * 一模一样——补上同一个守卫，防将来谁从测试里 import 这里的某个符号时重现它。
 */
async function main(): Promise<void> {
  const dir = new URL('../test/fixtures/shiki/', import.meta.url)
  mkdirSync(dir, { recursive: true })

  const hl = await createShikiHighlighter({ langs: [...LANGS] })
  for (const s of SNIPPETS) {
    const html = hl.highlight(s.code, s.lang)
    if (html === null) throw new Error(`shiki 没有认出语言 ${s.lang}（片段 ${s.slug}）`)
    writeFileSync(new URL(`${s.slug}.html`, dir), html, 'utf8')
  }
  console.log('refreshed', SNIPPETS.length, 'shiki golden files')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
