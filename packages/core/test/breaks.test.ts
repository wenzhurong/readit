import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { render, DEFAULT_OPTIONS, readFrontmatterOptions } from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 段落内的软换行：单个换行，行尾既没有两个空格也没有反斜杠。
 * 三行，所以有两处软换行。
 */
const SOFT = '**日期**：2026-08-05\n**对应**：x\n**仓库**：a · b\n'

describe('breaks 选项', () => {
  it('默认不发 <br> —— 这就是 GitHub 对仓库里 .md 文件的行为', () => {
    const html = render(SOFT, {})
    expect(html).not.toContain('<br')
    expect(DEFAULT_OPTIONS.breaks).toBe(false)
  })

  it('breaks: true 时每处软换行发一个 <br>，且是 GitHub 的无斜杠拼法', () => {
    const html = render(SOFT, { breaks: true })
    expect((html.match(/<br>/g) ?? []).length).toBe(2)
    // xhtmlOut: false —— GitHub 发 <br> 不是 <br />
    expect(html).not.toContain('<br />')
  })

  it('硬换行不受这个选项影响：两种写法在两档下都发 <br>', () => {
    for (const src of ['A  \nB\n', 'A\\\nB\n']) {
      for (const breaks of [false, true]) {
        expect(render(src, { breaks })).toContain('<br>')
      }
    }
  })

  /**
   * 这条是这个选项的**承重断言**，不是补充。
   *
   * 默认值必须留在 false，因为语料的逐字节比对跑的就是它。下面直接从抓回来的
   * GitHub HTML 里量：源码有多少软换行、GitHub 发了多少个由软换行而来的 <br>。
   *
   * ⚠️ **softBreaks 这个数只在本测试的 startsBlock 判据下成立**，换一套「什么算
   * 段落内软换行」的判据会得到别的数（控制端另一次临时扫描用更宽的判据得到 353）。
   * 它是描述性的、随语料增删而动；**承重的是 brFromSoftBreaks 那个 0**，
   * 它在任何合理判据下都成立。
   *
   * 若哪天有人把默认值改成 true，语料比对会红；但那时的报错是「几百处字节差异」，
   * 没人看得出根因。这条让根因直接说出来。
   */
  it('语料实证：GitHub 不把软换行变成 <br>', () => {
    const corpusDir = join(HERE, 'corpus/real-world')
    const fixtureDir = join(HERE, 'fixtures/real-world')
    const startsBlock = (s: string): boolean =>
      /^\s*(#{1,6}\s|>|(-|\*|\+)\s|\d+\.\s|\||```|~~~|---\s*$|\s*$)/.test(s)

    let softBreaks = 0
    let brFromSoftBreaks = 0
    let files = 0

    for (const name of readdirSync(corpusDir).filter((f) => f.endsWith('.md'))) {
      const src = readFileSync(join(corpusDir, name), 'utf8')
      const html = readFileSync(join(fixtureDir, name.replace(/\.md$/, '.html')), 'utf8')
      files++

      const lines = src.split('\n')
      let inFence = false
      for (let i = 0; i < lines.length - 1; i++) {
        const a = lines[i]!
        const b = lines[i + 1]!
        if (/^\s*(```|~~~)/.test(a)) {
          inFence = !inFence
          continue
        }
        if (inFence || !a.trim() || !b.trim()) continue
        if (startsBlock(a) || startsBlock(b)) continue
        if (a.endsWith('  ') || a.endsWith('\\') || /<br\s*\/?>\s*$/.test(a)) continue
        softBreaks++
      }

      // GitHub 输出里的 <br> 减去源码里显式写的，剩下的才可能来自软换行
      const brInHtml = (html.match(/<br\b/g) ?? []).length
      const explicitInSrc = (src.match(/<br\s*\/?>/g) ?? []).length
      brFromSoftBreaks += Math.max(0, brInHtml - explicitInSrc)
    }

    expect({ files, softBreaks, brFromSoftBreaks }).toEqual({
      files: 6,
      softBreaks: 152,
      brFromSoftBreaks: 0,
    })
  })
})

describe('readit-breaks frontmatter', () => {
  it('读真正的 YAML 布尔', () => {
    expect(readFrontmatterOptions('---\nreadit-breaks: true\n---\n# x\n')).toEqual({ breaks: true })
    expect(readFrontmatterOptions('---\nreadit-breaks: false\n---\n# x\n')).toEqual({ breaks: false })
  })

  it('字符串 "true" 不算 —— 不做宽容，否则「写错了」和「关掉了」无法区分', () => {
    expect(readFrontmatterOptions('---\nreadit-breaks: "true"\n---\n# x\n')).toEqual({})
    expect(readFrontmatterOptions('---\nreadit-breaks: yes\n---\n# x\n')).toEqual({})
  })

  it('与 readit-inline-math 共存，互不干扰', () => {
    expect(
      readFrontmatterOptions('---\nreadit-inline-math: off\nreadit-breaks: true\n---\n# x\n'),
    ).toEqual({ inlineMath: 'off', breaks: true })
  })

  it('没有 frontmatter 时什么都不返回', () => {
    expect(readFrontmatterOptions('# x\n')).toEqual({})
  })
})
