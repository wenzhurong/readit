import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')) as T

describe('known high-severity npm advisories stay patched', () => {
  const core = readJson<{ dependencies: Record<string, string> }>('packages/core/package.json')
  const lock = readJson<{ packages: Record<string, { version?: string }> }>('package-lock.json')

  it('pins the shipped YAML parser to the reviewed patched release', () => {
    expect(core.dependencies['js-yaml']).toBe('4.3.2')
    expect(lock.packages['node_modules/js-yaml']?.version).toBe('4.3.2')
  })

  it('keeps the PostCSS build chain above the affected nanoid range', () => {
    expect(lock.packages['node_modules/nanoid']?.version).toBe('3.3.18')
  })

  it('keeps the MathJax speech-rule-engine XML parser above the affected xmldom range', () => {
    // 2026-09-28 公布的一批 high（≤0.9.11）。链路 @mathjax/src → speech-rule-engine → xmldom；
    // readit 只加载 MathJax 的核心、TeX、SVG，产品包里没有它，但 CI 的审计门照样拦。
    expect(lock.packages['node_modules/@xmldom/xmldom']?.version).toBe('0.9.12')
  })
})
