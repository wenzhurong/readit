import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

it('desktop shell pins the reusable find bar to the WebView viewport', () => {
  const css = readFileSync(join(HERE, '..', 'src', 'styles.css'), 'utf8')
  expect(css).toMatch(/#reader\s*\{[^}]*--readit-find-position:\s*fixed;/s)
})

const css = (): string => readFileSync(join(HERE, '..', 'src', 'styles.css'), 'utf8')

const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css())?.[1] ?? ''
}

const declaration = (selector: string, property: string): string =>
  new RegExp(`${property}:\\s*([^;]+);`).exec(ruleBody(selector))?.[1]?.trim() ?? ''

it('模式控件默认半透明，指到/键盘聚焦/拖动时才完整显示', () => {
  const opacity = Number(declaration('#mode-switch', 'opacity'))
  expect(opacity).toBeGreaterThan(0)
  expect(opacity).toBeLessThan(1)
  // :focus-within 不能少 —— 少了它键盘用户 Tab 到控件上时看不见自己在哪。
  expect(css()).toMatch(/#mode-switch:hover,\s*\n#mode-switch:focus-within,/)
})

it('模式控件与"未保存"芯片不占同一个位置', () => {
  // 两者都靠右上；竖排错开是刻意的决定，横排会依赖模式控件的宽度，而它随语言变。
  expect(declaration('#mode-switch', 'right')).toBe(declaration('#document-state', 'right'))
  expect(declaration('#mode-switch', 'top')).not.toBe(declaration('#document-state', 'top'))
})
