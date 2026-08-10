import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DARK_CSS,
  DARK_CSS_BYTES,
  LIGHT_CSS,
  LIGHT_CSS_BYTES,
  THEME_CSS_VERSION,
} from '../src/styles/theme-css.js'

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('github-markdown-css/package.json'))
const onDisk = (file: string): string => readFileSync(join(pkgDir, file), 'utf8')

describe('github-markdown-css 冻结成 JS 字符串', () => {
  it('钉死在 SPEC §5 的 5.9.0', () => {
    expect(THEME_CSS_VERSION).toBe('5.9.0')
  })

  it('与 node_modules 里的单主题文件逐字节相同', () => {
    expect(LIGHT_CSS).toBe(onDisk('github-markdown-light.css'))
    expect(DARK_CSS).toBe(onDisk('github-markdown-dark.css'))
  })

  /**
   * 这条是「为什么用单主题文件」那句话的可执行形式。合并版 github-markdown.css
   * 的 dark 规则嵌在 @media (prefers-color-scheme: dark) 里，在浅色系统上无论
   * 放哪都不生效（SPEC §9.2）。哪天有人把生成脚本指到合并版，这里立刻红。
   */
  it('两份都没有 prefers-color-scheme 媒体查询', () => {
    expect(LIGHT_CSS).not.toContain('@media (prefers-color-scheme')
    expect(DARK_CSS).not.toContain('@media (prefers-color-scheme')
  })

  it('都是给 .markdown-body 用的，且没有 :root（shadow root 里 :root 不匹配任何东西）', () => {
    expect(LIGHT_CSS).toContain('.markdown-body')
    expect(DARK_CSS).toContain('.markdown-body')
    expect(LIGHT_CSS).not.toContain(':root')
    expect(DARK_CSS).not.toContain(':root')
  })

  it('字节数与常量自洽', () => {
    expect(LIGHT_CSS_BYTES).toBe(Buffer.byteLength(LIGHT_CSS, 'utf8'))
    expect(DARK_CSS_BYTES).toBe(Buffer.byteLength(DARK_CSS, 'utf8'))
  })

  /**
   * SPEC §9.2 记的是「各 22,219 B」。若这条红了，说明 SPEC 记录的字节数与
   * 5.9.0 的实际内容不符——按 §7.3 的规矩这属于「上报而非重钉」：先在 PR 里
   * 写明实测值与 SPEC 的差，再改这一个数字，不要顺手抹平。
   */
  it('字节数与 SPEC §9.2 记录的 22,219 B 一致', () => {
    expect([LIGHT_CSS_BYTES, DARK_CSS_BYTES]).toEqual([22219, 22219])
  })
})
