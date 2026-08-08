import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NON_SNAPSHOT_DIRS,
  compareToFixture,
  diffShape,
  discoverCorpus,
  findOrphanWhitelistKeys,
  ratchetShouldPass,
  readCorpus,
  validateKnownMismatches,
  type MismatchEntry,
} from './corpus-harness.js'
import { discoverKarlcow, readKarlcow } from './corpus-adversarial.js'
import { PATHOLOGICAL_CASES } from './corpus/adversarial/pathological.js'

describe('corpus inventory', () => {
  const names = discoverCorpus()

  // Exact, not the SPEC 13.3 band — see the matching assertion in corpus.test.ts for why a band
  // lets the corpus silently shrink underneath the fidelity number.
  it('holds exactly the 60 committed files (SPEC 13.3 mandates 45-60)', () => {
    expect(names.length).toBe(60)
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

describe('NON_SNAPSHOT_DIRS', () => {
  // `test/corpus/inline-math/` doesn't exist today — the 159-case dollar-guard corpus lives at
  // `test/inline-math/corpus.json`, outside CORPUS_DIR entirely — so 'inline-math' in
  // NON_SNAPSHOT_DIRS is otherwise never actually exercised by discoverCorpus() against the real
  // corpus tree. A synthetic temp directory pins the exclusion behavior itself, independent of
  // whether that directory happens to exist today.
  it('excludes every listed directory, not just the ones the real corpus tree happens to have', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'corpus-non-snapshot-'))
    await mkdir(join(dir, 'gfm'), { recursive: true })
    await writeFile(join(dir, 'gfm', 'kept.md'), 'kept', 'utf8')
    for (const excluded of NON_SNAPSHOT_DIRS) {
      await mkdir(join(dir, excluded), { recursive: true })
      await writeFile(join(dir, excluded, 'should-not-appear.md'), 'x', 'utf8')
    }
    expect(NON_SNAPSHOT_DIRS).toContain('adversarial')
    expect(NON_SNAPSHOT_DIRS).toContain('inline-math')
    expect(discoverCorpus(dir)).toEqual(['gfm/kept'])
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

/**
 * The two-way ratchet (Task 36): a corpus file not on the `known-mismatches.json` whitelist must
 * match the oracle exactly, and a file that IS on the whitelist must NOT match — the moment a
 * whitelisted file starts matching, its entry is stale debt and the build must break until someone
 * deletes it. `ratchetShouldPass` is the pure decision behind `corpus.test.ts`'s per-file assertion;
 * testing it in isolation (rather than only through the real 60-file corpus) is what lets us name
 * and assert both ratchet directions without needing to fabricate a real mismatching fixture pair.
 */
describe('ratchetShouldPass (the two-way corpus-mismatch ratchet)', () => {
  it('an unlisted file that matches the oracle passes (the normal case)', () => {
    expect(ratchetShouldPass(true, false)).toBe(true)
  })

  it('an unlisted file that mismatches the oracle breaks the build (a new, unrecorded failure)', () => {
    expect(ratchetShouldPass(false, false)).toBe(false)
  })

  it('a whitelisted file that still mismatches passes (the recorded, still-real debt)', () => {
    expect(ratchetShouldPass(false, true)).toBe(true)
  })

  it('a whitelisted file that now matches breaks the build (stale debt: delete the entry)', () => {
    expect(ratchetShouldPass(true, true)).toBe(false)
  })
})

/**
 * The third ratchet direction (branch review, Critical 1). "Still unequal" alone made all 15
 * ledger files exempt from every kind of regression detection: a new, unrelated bug could land
 * inside one of them and the suite stayed green. `diffShape` is the magnitude the ledger pins so
 * the assertion can be "still failing, AND still failing exactly this much".
 *
 * The property that matters is the last test here: a second, unrelated change must move the shape.
 * Everything above it pins the behaviour that makes that property trustworthy — in particular that
 * the measure is immune to index cascade, which is exactly what makes a naive
 * compare-line-i-to-line-i count useless for this job.
 */
describe('diffShape (the magnitude the mismatch ledger pins)', () => {
  it('reports nothing for identical input', () => {
    expect(diffShape(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual({ hunks: 0, edits: 0 })
  })

  it('counts a single changed line as one hunk of two edits (one delete, one insert)', () => {
    expect(diffShape(['a', 'X', 'c'], ['a', 'b', 'c'])).toEqual({ hunks: 1, edits: 2 })
  })

  it('counts two changes in separate places as two hunks', () => {
    expect(diffShape(['X', 'b', 'Y'], ['a', 'b', 'c'])).toEqual({ hunks: 2, edits: 4 })
  })

  it('counts two adjacent changed lines as ONE hunk, not two', () => {
    expect(diffShape(['a', 'X', 'Y', 'd'], ['a', 'b', 'c', 'd'])).toEqual({ hunks: 1, edits: 4 })
  })

  it('handles a pure insertion and a pure deletion', () => {
    expect(diffShape(['a', 'c'], ['a', 'b', 'c'])).toEqual({ hunks: 1, edits: 1 })
    expect(diffShape(['a', 'b', 'c'], ['a', 'c'])).toEqual({ hunks: 1, edits: 1 })
  })

  it('handles one side being empty', () => {
    expect(diffShape([], ['a', 'b'])).toEqual({ hunks: 1, edits: 2 })
    expect(diffShape(['a', 'b'], [])).toEqual({ hunks: 1, edits: 2 })
    expect(diffShape([], [])).toEqual({ hunks: 0, edits: 0 })
  })

  /**
   * The whole reason the pin is a shape and not a differing-line count. Inserting one line near
   * the top shifts every later index, so a naive positional compare calls this "1001 differing
   * lines" — a number that is mostly noise, changes completely on any unrelated edit, and would
   * make the pin churn-prone enough that people would update it reflexively. The real answer is
   * one hunk of one edit.
   */
  it('is immune to index cascade: one early insertion is one hunk, not a thousand differing lines', () => {
    const expected = Array.from({ length: 1000 }, (_, i) => `line ${i}`)
    const actual = ['inserted at the top', ...expected]
    expect(diffShape(actual, expected)).toEqual({ hunks: 1, edits: 1 })

    // The naive measure this replaces, for contrast.
    const positional = expected.filter((line, i) => actual[i] !== line).length
    expect(positional).toBe(1000)
  })

  /**
   * The failure the ledger actually needs to catch, stated directly: a file that is already
   * failing for a recorded reason picks up a SECOND, unrelated regression somewhere else. The
   * shape must move, or the ledger entry is a blanket exemption.
   */
  it('moves when an already-failing file picks up a second, unrelated regression', () => {
    const expected = ['a', 'b', 'c', 'd', 'e']
    const knownBad = ['a', 'RECORDED-BUG', 'c', 'd', 'e']
    const pinned = diffShape(knownBad, expected)
    expect(pinned).toEqual({ hunks: 1, edits: 2 })

    const alsoNewBug = ['a', 'RECORDED-BUG', 'c', 'NEW-UNRELATED-BUG', 'e']
    expect(diffShape(alsoNewBug, expected)).not.toEqual(pinned)
    expect(diffShape(alsoNewBug, expected)).toEqual({ hunks: 2, edits: 4 })
  })

  it('moves when a new regression only ADDS a line to an already-failing file', () => {
    const expected = ['a', 'b', 'c']
    const knownBad = ['a', 'RECORDED-BUG', 'c']
    const withExtra = ['a', 'RECORDED-BUG', 'c', '<div class="spurious">']
    expect(diffShape(withExtra, expected)).not.toEqual(diffShape(knownBad, expected))
  })
})

/** A minimal well-formed ledger entry, for the validator/orphan tests below. */
function entry(causes: MismatchEntry['causes'], diff = { hunks: 1, edits: 2 }): MismatchEntry {
  return { diff, causes }
}

describe('findOrphanWhitelistKeys', () => {
  it('flags a whitelist key that names no real corpus file', () => {
    const orphans = findOrphanWhitelistKeys(
      { 'gfm/does-not-exist': entry([{ category: 'readit-bug', explanation: 'x', source: 'y' }]) },
      ['gfm/real-file'],
    )
    expect(orphans).toEqual(['gfm/does-not-exist'])
  })

  it('reports no orphans when every key names a real corpus file', () => {
    const orphans = findOrphanWhitelistKeys(
      { 'gfm/real-file': entry([{ category: 'readit-bug', explanation: 'x', source: 'y' }]) },
      ['gfm/real-file', 'gfm/other-file'],
    )
    expect(orphans).toEqual([])
  })
})

describe('validateKnownMismatches', () => {
  it('accepts a well-formed entry with no errors', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': entry([
        { category: 'readit-bug', explanation: 'custom emoji src is a local relative path', source: 'task-24 #4' },
      ]),
    })
    expect(errors).toEqual([])
  })

  it('rejects an entry with zero causes listed', () => {
    const errors = validateKnownMismatches({ 'gfm/emoji': entry([]) })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.name).toBe('gfm/emoji')
  })

  it('rejects a cause with a category outside readit-bug|deviation|normalizer-gap', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': entry([{ category: 'mystery' as never, explanation: 'x', source: 'y' }]),
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('category')
  })

  it('rejects a cause with an empty explanation', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': entry([{ category: 'readit-bug', explanation: '   ', source: 'y' }]),
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('explanation')
  })

  it('rejects a cause with an empty source reference', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': entry([{ category: 'readit-bug', explanation: 'x', source: '' }]),
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('source')
  })

  it('reports one error per malformed cause, not just the first', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': entry([
        { category: 'mystery' as never, explanation: '', source: 'y' },
        { category: 'readit-bug', explanation: 'ok', source: 'ok' },
      ]),
    })
    // the first cause is wrong on two counts (category + explanation); the second is fine
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(errors.every((e) => e.name === 'gfm/emoji')).toBe(true)
  })

  // The magnitude pin is what stops a ledger entry from becoming a blanket exemption, so an entry
  // must not be able to exist without one — otherwise the easy way out of a shape mismatch would
  // be to drop the field rather than investigate the regression it is reporting.
  it('rejects an entry that pins no diff magnitude at all', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': { causes: [{ category: 'readit-bug', explanation: 'x', source: 'y' }] } as never,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('diff')
  })

  it('rejects a diff magnitude of zero, which would describe a file that matches', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': entry([{ category: 'readit-bug', explanation: 'x', source: 'y' }], { hunks: 0, edits: 0 }),
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('diff')
  })

  it('rejects a non-integer diff magnitude', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': entry([{ category: 'readit-bug', explanation: 'x', source: 'y' }], {
        hunks: 1,
        edits: 2.5,
      }),
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('diff')
  })

  it('rejects the pre-pin bare-array entry shape, so the old format cannot creep back in', () => {
    const errors = validateKnownMismatches({
      'gfm/emoji': [{ category: 'readit-bug', explanation: 'x', source: 'y' }] as never,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('{ diff, causes }')
  })
})
