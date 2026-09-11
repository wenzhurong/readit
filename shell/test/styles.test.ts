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

it('正文居中，两侧留白随窗口变化且只有"行宽封顶"写法的一半', () => {
  // 留白 =（窗口宽 − measure）/ 4。式子里的两样缺一不可：
  //   · margin-inline:auto —— 没有它就是"固定宽度贴左边"，留白不随窗口变；
  //   · max-width 里的那个 50% —— 没有它（即直接写 var(--readit-shell-measure)）
  //     留白就回到 / 2，也就是 2026-09-11 要减掉的那一半。
  // 这里只守 CSS 文本。「新写法的留白正好是旧写法一半」是像素级的断言，两个引擎里
  // 实测在 browser/element/shell-measure.spec.ts。
  expect(declaration('#reader::part(content)', 'max-width')).toBe(
    'calc(50% + var(--readit-shell-measure) / 2)',
  )
  expect(declaration('#reader::part(content)', 'margin-inline')).toBe('auto')
  // 变量本身用全文匹配：#reader 还出现在 `html, body, #app, #reader {` 这个组选择器里，
  // 按规则块取会先命中那一个（第一次写这条守卫时就是这么错的）。
  expect(css()).toMatch(/--readit-shell-measure:\s*\d+(\.\d+)?rem;/)
})

it('模式控件宽度不可压缩 —— 否则缩窗口会把它挤扁且再也回不来', () => {
  // 棘轮：压扁后 draggable 读到的宽度变小，clamp 上界跟着变大，控件永远贴在边界外。
  expect(declaration('#mode-switch', 'width')).toBe('max-content')
})
