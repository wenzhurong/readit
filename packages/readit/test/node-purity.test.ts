import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../dist')
const PROBE = join(HERE, 'fixtures/node-purity-probe.mjs')

describe("Node 里 import '.' 不触及任何浏览器全局（SPEC §9.3 / 设计 §2.2）", () => {
  it('import + render + scan 全程没有读或写 document / window / navigator', () => {
    const r = spawnSync(process.execPath, [PROBE, join(DIST, 'core.js'), join(DIST, 'core.cjs')], {
      encoding: 'utf8',
    })
    expect(r.status, `${r.stdout ?? ''}\n${r.stderr ?? ''}`).toBe(0)

    const out = JSON.parse(r.stdout) as {
      touched: { name: string; stack: string }[]
      esmHtml: string
      cjsHtml: string
      scanned: { needsMath: boolean; needsHighlight: boolean }
    }

    // 若这条红了、而肇事者是某个被内联的第三方依赖的 `typeof window` 探测：
    // 按 §7.3 与 P6 的纪律**上报**，不要在这里加豁免名单。一个「无害的特征探测」
    // 与一个「真的会在 SSR 里炸的浏览器分支」在这一层长得一模一样，
    // 而分辨它们的成本远低于宿主在生产环境里发现它的成本。
    expect(out.touched.map((t) => `${t.name}\n${t.stack}`)).toEqual([])

    // 顺带证明探针不是在空转：'.' 真的渲染了东西，而且 ESM 与 CJS 两条路一致。
    expect(out.esmHtml).toContain('markdown-heading')
    expect(out.esmHtml).toContain('markdown-accessiblity-table')
    expect(out.cjsHtml).toBe(out.esmHtml)
    expect(out.scanned).toMatchObject({ needsMath: true, needsHighlight: true })
  })
})
