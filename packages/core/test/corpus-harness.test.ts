import { describe, expect, it } from 'vitest'
import { compareToFixture, discoverCorpus, readCorpus } from './corpus-harness.js'
import { discoverKarlcow, readKarlcow } from './corpus-adversarial.js'
import { PATHOLOGICAL_CASES } from './corpus/adversarial/pathological.js'

describe('corpus inventory', () => {
  const names = discoverCorpus()

  it('sits in the 45-60 file band mandated by SPEC 13.3', () => {
    expect(names.length).toBeGreaterThanOrEqual(45)
    expect(names.length).toBeLessThanOrEqual(60)
  })

  it('covers the four snapshotted categories and excludes adversarial', () => {
    expect([...new Set(names.map((n) => n.split('/')[0]))].sort()).toEqual([
      'frontend',
      'gfm',
      'github-only',
      'real-world',
    ])
    expect(names.some((n) => n.startsWith('adversarial/'))).toBe(false)
  })

  it('splits relative images three ways, because GitHub treats them three ways', () => {
    expect(names).toContain('github-only/image-relative-bare')
    expect(names).toContain('github-only/image-relative-linked')
    expect(names).toContain('github-only/image-raw-html')
    expect(readCorpus('github-only/image-relative-bare').trim()).toBe('![logo](assets/logo.png)')
    expect(readCorpus('github-only/image-relative-linked').trim()).toBe('[![logo](assets/logo.png)](https://example.com)')
    expect(readCorpus('github-only/image-raw-html').trim()).toBe('<img src="assets/logo.png" alt="logo" width="120">')
  })

  it('every corpus file is non-empty and single-purpose (under 2 KB except real-world)', () => {
    for (const name of names) {
      const src = readCorpus(name)
      expect(src.length, name).toBeGreaterThan(0)
      if (!name.startsWith('real-world/')) expect(src.length, name).toBeLessThan(2048)
    }
  })

  it('is sorted and de-duplicated so test order is stable', () => {
    expect(names).toEqual([...names].sort())
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('adversarial inventory', () => {
  it('vendors the 103 MIT karlcow inputs', () => {
    const names = discoverKarlcow()
    expect(names).toHaveLength(103)
    expect(names.every((n) => n.endsWith('.md'))).toBe(true)
    // `names` is asserted to have length 103 immediately above, so index 0 is always present; the
    // `!` documents that invariant for noUncheckedIndexedAccess rather than tolerating a real gap.
    expect(readKarlcow(names[0]!).length).toBeGreaterThan(0)
  })

  it('carries the cmark pathological generators', () => {
    expect(PATHOLOGICAL_CASES.map((c) => c.name)).toContain('nested-brackets')
    expect(PATHOLOGICAL_CASES).toHaveLength(16)
    expect(PATHOLOGICAL_CASES.find((c) => c.name === 'nested-brackets')!.source()).toHaveLength(40001)
  })
})

describe('compareToFixture', () => {
  it('reports equality after normalisation', () => {
    const r = compareToFixture(
      '<div id="file" class="md"><article class="markdown-body"><p dir="auto">hi</p></article></div>',
      '<p dir="auto">hi</p>',
      { repo: 'o/r', ref: 'a'.repeat(40), dir: '' },
    )
    expect(r.equal).toBe(true)
    expect(r.actual).toBe('<p dir="auto">hi</p>')
  })

  it('reports a line diff when the shapes differ', () => {
    const r = compareToFixture('<blockquote><p>x</p></blockquote>', '<div class="markdown-alert"><p>x</p></div>', {
      repo: 'o/r',
      ref: 'a'.repeat(40),
      dir: '',
    })
    expect(r.equal).toBe(false)
    expect(r.actualLines[0]).toBe('<blockquote>')
    expect(r.expectedLines[0]).toBe('<div class="markdown-alert">')
  })
})
