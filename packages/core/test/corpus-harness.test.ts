import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NON_SNAPSHOT_DIRS,
  compareToFixture,
  contentPinObligation,
  diffHunks,
  diffShape,
  discoverCorpus,
  findOrphanWhitelistKeys,
  formatDiffHunks,
  ratchetShouldPass,
  readCorpus,
  shapeCarriesNoSignal,
  shapeMismatchMessage,
  validateKnownMismatches,
  type MismatchEntry,
} from './corpus-harness.js'
import { discoverKarlcow, readKarlcow } from './corpus-adversarial.js'
import { PATHOLOGICAL_CASES } from './corpus/adversarial/pathological.js'

describe('corpus inventory', () => {
  const names = discoverCorpus()

  // Exact, not the SPEC 13.3 band — see the matching assertion in corpus.test.ts for why a band
  // lets the corpus silently shrink underneath the fidelity number.
  it('holds exactly the 68 committed files (SPEC 13.3 mandates 45-70)', () => {
    expect(names.length).toBe(68)
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

/**
 * The LCS tie-break is load-bearing, and until this block nothing asserted it.
 *
 * `diffHunks` walks ONE optimal alignment backwards. When both backtrack directions are equally
 * good its tie-break picks the one that consumes `expected`. That choice is invisible to `edits`
 * — a function of LCS length, identical under every optimal alignment — but it decides `hunks`,
 * and therefore decides what 15 ledger entries are pinned to.
 *
 * A reviewer flipped the comparison to its mirror and every test in this file still passed, while
 * `real-world/mermaid` silently re-pinned from 22 hunks to 12 (`edits` unchanged at 84). A
 * maintainer would then have been told by `corpus.test.ts` that a new regression had landed inside
 * an already-failing file, which would have been false — nothing changed but the aligner.
 *
 * The two cases below were found by brute-forcing every pair of {a,b}-strings up to length 4
 * against both aligners: 28 of those pairs discriminate, and these are the two smallest that do it
 * in OPPOSITE directions. Pinning both matters — a single case could be satisfied by an aligner
 * that just minimises (or maximises) hunks, which is not what the committed one does.
 */
describe('diffHunks: the LCS tie-break is pinned, not incidental', () => {
  it('prefers consuming `expected` on a tie (mirror gives 3 hunks here, not 2)', () => {
    expect(diffShape(['a', 'a', 'a', 'b'], ['b', 'a', 'b', 'a'])).toEqual({ hunks: 2, edits: 4 })
  })

  it('and that is not "whichever gives fewer hunks" (mirror gives 2 here, not 3)', () => {
    expect(diffShape(['b', 'a', 'a'], ['a', 'b', 'a', 'b'])).toEqual({ hunks: 3, edits: 3 })
  })

  /**
   * The invariant the ledger's failure message tells maintainers to reason with: on a tie-break
   * change `edits` cannot move, so `edits` unchanged + `hunks` moved means the aligner, not the
   * renderer. Asserted here as the property it is — `edits` is fully determined by LCS length —
   * so that "suspect the aligner" stays true advice rather than a comment that rots.
   */
  it('edits is aligner-independent: it is |a| + |b| - 2 * LCS, whichever alignment is walked', () => {
    for (const [a, b] of [
      [['a', 'a', 'a', 'b'], ['b', 'a', 'b', 'a']],
      [['b', 'a', 'a'], ['a', 'b', 'a', 'b']],
    ] as const) {
      const lcsLength = (x: readonly string[], y: readonly string[]): number => {
        const t = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
        for (let i = 1; i <= x.length; i += 1) {
          for (let j = 1; j <= y.length; j += 1) {
            t[i]![j] = x[i - 1] === y[j - 1] ? t[i - 1]![j - 1]! + 1 : Math.max(t[i - 1]![j]!, t[i]![j - 1]!)
          }
        }
        return t[x.length]![y.length]!
      }
      expect(diffShape(a, b).edits).toBe(a.length + b.length - 2 * lcsLength(a, b))
    }
  })
})

/**
 * `diffHunks` is what turned ratchet direction 3 from two bare integers into an actionable
 * failure. The pin can only ever say "the magnitude moved"; these locations and lines are what
 * lets a maintainer decide whether that movement is a regression to fix or a recorded cause to
 * re-pin — the judgement the whole ledger depends on them making correctly.
 */
describe('diffHunks (the locations behind the magnitude)', () => {
  it('reports nothing for identical input', () => {
    expect(diffHunks(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('locates a single changed line on both sides, with its content', () => {
    expect(diffHunks(['a', 'X', 'c'], ['a', 'b', 'c'])).toEqual([
      { actualStart: 1, expectedStart: 1, removed: ['X'], added: ['b'] },
    ])
  })

  it('keeps two separate changes separate, in document order', () => {
    expect(diffHunks(['X', 'b', 'Y'], ['a', 'b', 'c'])).toEqual([
      { actualStart: 0, expectedStart: 0, removed: ['X'], added: ['a'] },
      { actualStart: 2, expectedStart: 2, removed: ['Y'], added: ['c'] },
    ])
  })

  it('groups adjacent changed lines into one hunk', () => {
    expect(diffHunks(['a', 'X', 'Y', 'd'], ['a', 'b', 'c', 'd'])).toEqual([
      { actualStart: 1, expectedStart: 1, removed: ['X', 'Y'], added: ['b', 'c'] },
    ])
  })

  it('records a pure insertion as added-only and a pure deletion as removed-only', () => {
    expect(diffHunks(['a', 'c'], ['a', 'b', 'c'])).toEqual([
      { actualStart: 1, expectedStart: 1, removed: [], added: ['b'] },
    ])
    expect(diffHunks(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      { actualStart: 1, expectedStart: 1, removed: ['b'], added: [] },
    ])
  })

  /**
   * The locations must survive index cascade too, or they would point a maintainer at the wrong
   * line — the same failure mode that makes a positional differing-line count useless as a pin.
   */
  it('locates a late change by its real position, not one shifted by an earlier insertion', () => {
    const expected = Array.from({ length: 500 }, (_, i) => `line ${i}`)
    const actual = ['inserted at the top', ...expected]
    actual[400] = 'REGRESSION'
    const hunks = diffHunks(actual, expected)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toEqual({ actualStart: 0, expectedStart: 0, removed: ['inserted at the top'], added: [] })
    expect(hunks[1]!.removed).toEqual(['REGRESSION'])
    expect(hunks[1]!.added).toEqual(['line 399'])
    expect(hunks[1]!.actualStart).toBe(400)
    expect(hunks[1]!.expectedStart).toBe(399)
  })

  it('agrees with diffShape by construction — same alignment, so they cannot disagree', () => {
    const a = ['a', 'X', 'c', 'd', 'Y', 'f']
    const b = ['a', 'b', 'c', 'd', 'e', 'f']
    const hunks = diffHunks(a, b)
    expect(diffShape(a, b)).toEqual({
      hunks: hunks.length,
      edits: hunks.reduce((s, h) => s + h.removed.length + h.added.length, 0),
    })
  })
})

describe('formatDiffHunks (what the maintainer actually reads)', () => {
  it('shows each hunk with a 1-based location on both sides and its -/+ lines', () => {
    const text = formatDiffHunks(diffHunks(['a', 'X', 'c'], ['a', 'b', 'c']))
    expect(text).toContain('hunk 1/1 — actual line 2, oracle line 2 (-1 +1)')
    expect(text).toContain('    - X')
    expect(text).toContain('    + b')
  })

  it('caps long hunks and says how much it withheld, rather than dumping 305 edits', () => {
    const a = Array.from({ length: 40 }, (_, i) => `A${i}`)
    const b = Array.from({ length: 40 }, (_, i) => `B${i}`)
    const text = formatDiffHunks(diffHunks(a, b), { maxLinesPerHunk: 3 })
    expect(text).toContain('    - A0')
    expect(text).not.toContain('    - A39')
    expect(text).toContain('more line(s) in this hunk')
  })

  it('caps the number of hunks too', () => {
    const a = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? `same${i}` : `A${i}`))
    const b = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? `same${i}` : `B${i}`))
    const text = formatDiffHunks(diffHunks(a, b), { maxHunks: 2 })
    expect(text).toContain('hunk 1/10')
    expect(text).toContain('hunk 2/10')
    expect(text).not.toContain('hunk 3/10')
    expect(text).toContain('more hunk(s)')
  })

  it('says so plainly when there is nothing to show', () => {
    expect(formatDiffHunks([])).toContain('no line-level difference')
  })
})

/**
 * Direction 3b's trigger. `{ hunks, edits }` only says something about a file's CONTENT while
 * some of that file still matches its oracle; when nothing matches, `hunks` is stuck at 1 and
 * `edits` is just the two line counts, so rewriting a line moves neither number. Four ledger
 * entries are in exactly that state, and this predicate is what makes `corpus.test.ts` demand a
 * verbatim `output` pin from them instead of trusting a magnitude that cannot see anything.
 */
describe('shapeCarriesNoSignal (when the magnitude pin degenerates)', () => {
  it('is true when no line matches: hunks is stuck at 1 and edits is just the line counts', () => {
    const a = ['<div class="highlight">', '<pre>', 'src', '</pre>', '</div>']
    const b = ['<section data-type="mermaid">', 'src-oracle', '</section>']
    const shape = diffShape(a, b)
    expect(shape).toEqual({ hunks: 1, edits: 8 })
    expect(shapeCarriesNoSignal(shape, a, b)).toBe(true)
  })

  it('demonstrates the blindness it detects: rewriting every line moves neither number', () => {
    const a = ['<div class="highlight">', '<pre>', 'src', '</pre>', '</div>']
    const b = ['<section data-type="mermaid">', 'src-oracle', '</section>']
    const rewritten = ['<div class="WRONG">', '<pre id="spurious">', 'src', '</pre>', '</div>']
    expect(diffShape(rewritten, b)).toEqual(diffShape(a, b))
  })

  it('is false as soon as a single line matches, because the alignment has something to anchor on', () => {
    const a = ['<div class="highlight">', 'shared', '</div>']
    const b = ['<section>', 'shared', '</section>']
    expect(shapeCarriesNoSignal(diffShape(a, b), a, b)).toBe(false)
  })

  it('is false for a file that matches outright — there is no pin to degenerate', () => {
    const a = ['x', 'y']
    expect(shapeCarriesNoSignal(diffShape(a, a), a, a)).toBe(false)
  })
})

/**
 * Direction 3b's decision, and specifically the ORDER it decides in. The four-state version of
 * this logic told a maintainer to delete the only content protection a file had, in response to a
 * rendering change it could not see — and the state where it did that is reachable.
 */
describe('contentPinObligation (which 3b obligation an entry is under)', () => {
  const oracle = ['<section data-type="mermaid">', 'SRC', '</section>']
  const obligation = (
    actual: readonly string[],
    output: string[] | undefined,
  ): ReturnType<typeof contentPinObligation> =>
    contentPinObligation(diffShape(actual, oracle), actual, oracle, { output })

  it('demands a pin from a blind entry that has none', () => {
    expect(obligation(['a', 'b', 'c', 'd', 'e'], undefined)).toBe('must-pin')
  })

  it('checks the pin of a blind entry that has one', () => {
    expect(obligation(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'e'])).toBe('pin-must-match')
  })

  it('asks for nothing from a non-blind entry with no pin (the other 11 entries)', () => {
    expect(obligation(['<section data-type="mermaid">', 'x', '</section>'], undefined)).toBe('no-pin')
  })

  /**
   * The reviewer's probe, run rather than described. Blindness ends because the new first line
   * happens to match the oracle's, but `{ hunks: 1, edits: 8 }` is PRESERVED, so direction 3 sees
   * nothing at all — and every line of readit's output changed underneath it. The old `else`
   * branch reached exactly one conclusion here: "delete `output`".
   */
  it('reports the content change when a pinned entry stops being blind AND its output moved', () => {
    const today = ['a', 'b', 'c', 'd', 'e']
    const after = ['<section data-type="mermaid">', 'a', 'b', 'c', 'd', 'e', 'f']

    // Direction 3 is satisfied across the transition: the magnitude is identical.
    expect(diffShape(today, oracle)).toEqual({ hunks: 1, edits: 8 })
    expect(diffShape(after, oracle)).toEqual({ hunks: 1, edits: 8 })
    // And 3b's trigger flips, which is what used to route this into the deletion message.
    expect(shapeCarriesNoSignal(diffShape(today, oracle), today, oracle)).toBe(true)
    expect(shapeCarriesNoSignal(diffShape(after, oracle), after, oracle)).toBe(false)

    expect(obligation(after, today)).toBe('content-moved')
    expect(obligation(after, today)).not.toBe('drop-pin')
  })

  /**
   * The other half of the same rule: deletion IS authorized, but only once the content has been
   * shown to hold still. Here readit's output is byte-identical to the pin and the entry stopped
   * being blind because the ORACLE moved — nothing to diagnose, so the pin is pure bookkeeping.
   */
  it('authorizes deleting the pin only when readit output is byte-identical to it', () => {
    const unchanged = ['<section data-type="mermaid">', 'x', '</section>']
    expect(obligation(unchanged, [...unchanged])).toBe('drop-pin')
  })

  it('compares the pin by value, not by identity, and notices a length-only change', () => {
    const after = ['<section data-type="mermaid">', 'x', '</section>']
    expect(obligation(after, ['<section data-type="mermaid">', 'x'])).toBe('content-moved')
  })
})

/**
 * The message is the deliverable of ratchet direction 3: the pin fires, and what the maintainer
 * reads next decides whether they diagnose the change or re-pin it reflexively. It is built in
 * the harness rather than inlined into the assertion so its two jobs can be asserted directly.
 */
describe('shapeMismatchMessage', () => {
  const entry = {
    diff: { hunks: 2, edits: 4 },
    causes: [{ category: 'readit-bug' as const, explanation: 'x', source: 'y' }],
  }

  it('carries the recorded and measured shapes, the hunks, and the tool for the full listing', () => {
    const hunks = diffHunks(['a', 'X', 'c'], ['a', 'b', 'c'])
    const msg = shapeMismatchMessage('gfm/footnotes', entry, { hunks: 1, edits: 2 }, hunks)
    expect(msg).toContain('recorded: {"hunks":2,"edits":4}')
    expect(msg).toContain('measured: {"hunks":1,"edits":2}')
    expect(msg).toContain('    - X')
    expect(msg).toContain('npm run corpus:diff -- gfm/footnotes')
    expect(msg).toContain('NEW, unrelated regression')
  })

  /**
   * The clause that stops the message from confidently accusing a maintainer of a regression
   * that does not exist. `edits` unchanged while `hunks` moved cannot be a rendering change.
   */
  it('names the aligner when edits held still and only hunks moved', () => {
    const msg = shapeMismatchMessage('real-world/mermaid', entry, { hunks: 5, edits: 4 }, [])
    expect(msg).toContain('`edits` is UNCHANGED and only `hunks` moved')
    expect(msg).toContain('ALIGNER change')
    expect(msg).toContain('tie-break')
  })

  it('does not raise the aligner when edits moved too — that really is a content change', () => {
    const msg = shapeMismatchMessage('real-world/mermaid', entry, { hunks: 5, edits: 9 }, [])
    expect(msg).not.toContain('ALIGNER change')
  })

  /**
   * The ALL-CAPS aligner warning is the loudest thing on the screen, and until this the only next
   * step it offered was to go and read a comparison operator. The project now has a near-decisive
   * mechanical answer — the two tie-break tests above, both of which go red under a tie-break
   * change — so the clause hands that over rather than withholding it.
   */
  it('hands over the mechanical check instead of asking the maintainer to eyeball the aligner', () => {
    const msg = shapeMismatchMessage('real-world/mermaid', entry, { hunks: 5, edits: 4 }, [])
    expect(msg).toContain('corpus-harness.test.ts')
    expect(msg).toContain('the LCS tie-break is pinned, not incidental')
    expect(msg).toContain('If they are GREEN, the aligner has not changed')
    // And it does not overclaim: the signature is a heuristic, not a proof.
    expect(msg).toContain('heuristic, not a proof')
  })

  /**
   * Why the clause has to be a heuristic, demonstrated rather than asserted in prose: a REAL
   * regression can produce `edits` unchanged + `hunks` moved. Repair the recorded 1-line hunk at
   * index 1 and break the line next to the recorded one at index 3, and the two hunks merge into
   * one while the edit count does not budge. This is the exact arithmetic the message quotes.
   */
  it('the aligner signature is a heuristic: a rendering change can produce it too', () => {
    const expected = ['a', 'b', 'c', 'd', 'e']
    const recorded = ['a', 'X', 'c', 'Y', 'e']
    expect(diffShape(recorded, expected)).toEqual({ hunks: 2, edits: 4 })

    // hunk 1 fixed (X -> b); the line after the second recorded hunk breaks (e -> Z).
    const alsoChanged = ['a', 'b', 'c', 'Y', 'Z']
    expect(diffShape(alsoChanged, expected)).toEqual({ hunks: 1, edits: 4 })
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
