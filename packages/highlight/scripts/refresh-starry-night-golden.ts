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

/**
 * B4（批次 8 派单，定义见 .superpowers/sdd/2026-08-09-plan2-element-editor/batch-8-report.md）：main 守卫，见
 * refresh-shiki-golden.ts 头部的同一条注释——同一个坑，同一个理由，还不是活洞
 * （无测试 import 它），但形状与修复前的 measure-lang-packs.ts 一样。
 */
async function main(): Promise<void> {
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
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
