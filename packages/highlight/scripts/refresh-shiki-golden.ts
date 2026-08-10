/**
 * 重写 packages/highlight/test/fixtures/shiki/*.html（③档 D-TOKEN 冻结黄金文件）。
 * 只在**有意**接受 shiki 4.4.2 → 新版本的 token 划分变化时跑，跑完必须逐字看 diff。
 *
 *   npm run refresh:shiki-golden --workspace @readit/highlight
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createShikiHighlighter } from '../src/index.js'
import { LANGS, SNIPPETS } from '../test/snippets.js'

const dir = new URL('../test/fixtures/shiki/', import.meta.url)
mkdirSync(dir, { recursive: true })

const hl = await createShikiHighlighter({ langs: [...LANGS] })
for (const s of SNIPPETS) {
  const html = hl.highlight(s.code, s.lang)
  if (html === null) throw new Error(`shiki 没有认出语言 ${s.lang}（片段 ${s.slug}）`)
  writeFileSync(new URL(`${s.slug}.html`, dir), html, 'utf8')
}
console.log('refreshed', SNIPPETS.length, 'shiki golden files')
