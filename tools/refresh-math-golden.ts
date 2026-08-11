import { mkdirSync, writeFileSync } from 'node:fs'
import { createMathRenderer } from '@readit/math'
import { README_CONSTRUCTS } from '../packages/math/test/constructs.js'

/**
 * B4（docs/plans/2026-08-08-plan2-debt.md 批次 8 派单）：main 守卫，见
 * packages/highlight/scripts/refresh-shiki-golden.ts 头部的同一条注释——
 * 同一类 refresh-*-golden 脚本，同一个坑，同一个理由。
 *
 * **这个文件不能用 `import.meta.url === pathToFileURL(process.argv[1]).href`
 * 那套惯用法**（两个 highlight 包的同类脚本用的就是它）——本脚本走的是
 * `vite-node`（根 package.json 的 `refresh:math-golden` 脚本），而
 * `packages/readit/build.ts` 头部已经记录过：vite-node 会把入口文件路径整个
 * 吃掉、不落在 `process.argv` 里，那套惯用法在它下面恒假。跟 build.ts 用的是
 * 同一条判据、同一个理由：`VITEST` 由 vitest 在求值任何测试模块（含它 import
 * 的东西）之前就置为 `'true'`，直接用 `vite-node` 跑这个文件时这个变量不存在。
 */
function main(): void {
  const dir = new URL('../packages/math/test/fixtures/math/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  const renderer = createMathRenderer()
  for (const c of README_CONSTRUCTS) {
    writeFileSync(new URL(`${c.slug}.html`, dir), renderer.render(c.tex, c.display), 'utf8')
  }
  console.log('refreshed', README_CONSTRUCTS.length, 'math golden files')
}

if (process.env.VITEST === undefined) {
  main()
}
