import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')) as T

describe('known high-severity npm advisories stay patched', () => {
  const core = readJson<{ dependencies: Record<string, string> }>('packages/core/package.json')
  const element = readJson<{ dependencies: Record<string, string> }>('packages/element/package.json')
  const mermaid = readJson<{ dependencies: Record<string, string> }>('packages/mermaid/package.json')
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

  it('ships the markdown-it release without the quadratic reference and inline-HTML paths', () => {
    // 2026-10-20 公布：GHSA-gfr2（默认配置可达）、GHSA-vfgh（html: true，readit 硬编码打开）。
    // 特制文件能把窗口卡死几十秒；行为由 corpus-adversarial 的计时门守，这里守装上的版本。
    expect(core.dependencies['markdown-it']).toBe('15.0.3')
    expect(lock.packages['node_modules/markdown-it']?.version).toBe('15.0.3')
  })

  it('ships one patched DOMPurify for both packages that import it', () => {
    // 2026-10-22 公布的 critical/high（≤3.4.16）都要 IN_PLACE、SAFE_FOR_TEMPLATES 配 DOM 返回、
    // 或 XHTML 解析模式；readit 的三处调用都是字符串进出，不受影响，但审计门照样拦。element 与
    // mermaid 钉同一版本，树里只留一份 DOMPurify。
    expect(element.dependencies['dompurify']).toBe('3.4.17')
    expect(mermaid.dependencies['dompurify']).toBe('3.4.17')
    expect(lock.packages['node_modules/dompurify']?.version).toBe('3.4.17')
  })

  it('keeps the test, dev-server and build toolchain above the affected ranges', () => {
    // 2026-09-29 至 10-28 收录进审计库的一批 high。都不进产品包，但审计门照样拦。happy-dom 要 21.0.4：
    // npm audit 建议的 20.14.6 修不掉 GHSA-834v 与 GHSA-c8p4。brace-expansion 经
    // @mathjax/src → mj-context-menu → rimraf → glob → minimatch 带进来。
    expect(lock.packages['node_modules/happy-dom']?.version).toBe('21.0.4')
    expect(lock.packages['node_modules/vite']?.version).toBe('8.2.4')
    expect(lock.packages['node_modules/vitest']?.version).toBe('4.1.12')
    expect(lock.packages['node_modules/source-map-js']?.version).toBe('1.2.2')
    expect(lock.packages['node_modules/brace-expansion']?.version).toBe('5.0.12')
  })
})
