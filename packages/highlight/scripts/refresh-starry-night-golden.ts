/**
 * 重写 packages/highlight/test/fixtures/starry-night/*.html（③档 D-TOKEN）。
 * 只在**有意**接受 starry-night 3.10.0 → 新版本的 token 划分变化时跑，跑完逐字看 diff。
 *
 *   npm run refresh:starry-night-golden --workspace @readit/highlight
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createStarryNightHighlighter } from '../src/index.js'
import { SNIPPETS } from '../test/snippets.js'

const require_ = createRequire(import.meta.url)
const onigWasmUrl = pathToFileURL(require_.resolve('vscode-oniguruma/release/onig.wasm')).href

const dir = new URL('../test/fixtures/starry-night/', import.meta.url)
mkdirSync(dir, { recursive: true })

const hl = await createStarryNightHighlighter({ onigWasmUrl })
for (const s of SNIPPETS) {
  const html = hl.highlight(s.code, s.lang)
  if (html === null) throw new Error(`starry-night 的 common 里没有语言 ${s.lang}（片段 ${s.slug}）`)
  writeFileSync(new URL(`${s.slug}.html`, dir), html, 'utf8')
}
console.log('refreshed', SNIPPETS.length, 'starry-night golden files')
