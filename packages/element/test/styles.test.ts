import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ELEMENT_CSS, LIGHT_DOM_CSS } from '../src/styles.js'
import { BASE_CSS } from '../src/styles/base-css.js'
import { DARK_CSS, LIGHT_CSS } from '../src/styles/theme-css.js'

/**
 * §0 A6：`packages/element/src/styles.ts` 是本包 `exports["./styles"]` 指向的实体，
 * Task 9 的构建脚本在这批之外消费它——这里只钉住「存在、类型对、内容与运行时内核
 * 实际 adopt 的样式同源」，具体的构建期断言（产物闭包里能不能找到选择器、
 * ./styles.css 是否与 LIGHT_DOM_CSS 逐字节相同）留给 Task 9 自己的测试。
 */
describe('styles.ts（§0 A6）', () => {
  it('两个常量都是非空字符串', () => {
    expect(typeof ELEMENT_CSS).toBe('string')
    expect(typeof LIGHT_DOM_CSS).toBe('string')
    expect(ELEMENT_CSS.length).toBeGreaterThan(0)
    expect(LIGHT_DOM_CSS.length).toBeGreaterThan(0)
  })

  it('ELEMENT_CSS 与运行时内核实际 adopt 的三份样式同源（两个主题 + 版面规则都在）', () => {
    expect(ELEMENT_CSS).toContain(LIGHT_CSS)
    expect(ELEMENT_CSS).toContain(DARK_CSS)
    expect(ELEMENT_CSS).toContain(BASE_CSS)
  })

  it('LIGHT_DOM_CSS 是浅色主题 + 版面规则，给 light DOM 逃生舱当默认样式表', () => {
    expect(LIGHT_DOM_CSS).toContain(LIGHT_CSS)
    expect(LIGHT_DOM_CSS).toContain(BASE_CSS)
    expect(LIGHT_DOM_CSS).not.toContain(DARK_CSS)
  })

  it('exports["./styles"] 确实指向这个文件', () => {
    // 不用 `new URL('../package.json', import.meta.url)`：happy-dom（§0 A2）的全局 URL
    // 会覆盖 Node 内置的那个，对相对路径的解析基准不是 import.meta.url 而是它自己的
    // 伪 location，结果是一个 http: URL 而不是 file:，fileURLToPath 会抛
    // "The URL must be of scheme file"。改用 dirname(fileURLToPath(import.meta.url))
    // + join 全程走 node:path，不经过全局 URL。
    const testDir = dirname(fileURLToPath(import.meta.url))
    const pkgPath = join(testDir, '..', 'package.json')
    const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports: Record<string, string> }
    expect(manifest.exports['./styles']).toBe('./src/styles.ts')
  })
})
