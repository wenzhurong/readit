import { describe, expect, it } from 'vitest'
import { render } from '../src/index.js'
import {
  type KnownMismatches,
  compareToFixture,
  diffShape,
  discoverCorpus,
  findOrphanWhitelistKeys,
  ratchetShouldPass,
  readCorpus,
  readFixture,
  readProvenance,
  validateKnownMismatches,
} from './corpus-harness.js'
import knownMismatchesJson from './known-mismatches.json' with { type: 'json' }

/**
 * This is readit's central, falsifiable claim: normalized render() output equals GitHub's real
 * blob-view HTML for the committed corpus, byte for byte, after only the SPEC 4.1-sanctioned
 * normalization (unwrap the article shell, strip non-deterministic salt, restore D-LINK/D-CAMO,
 * blank octicon paths, flatten highlight spans, reduce the mermaid enrichment section, drop
 * hovercard noise, sort attributes, collapse whitespace).
 *
 * `{ math: null, highlighter: null }`: Phase A's render() is synchronous and takes an already
 * resolved renderer; passing null exercises the deterministic no-network fallback path
 * (`<math-renderer class="js-inline-math" style="display: inline-block">…</math-renderer>`, or
 * its `js-display-math` / `display: block` twin for the two block forms; plain highlighted-shell
 * markup) rather than requiring a live MathJax/starry-night instance in a zero-network test run.
 *
 * `known-mismatches.json` is a three-way ratchet (Task 36; third direction added by the branch
 * review), copying the pattern this project already trusts (`test/spec/known-failures.json` +
 * `harness.ts`'s `runSpecSuite`, see its anti-rot guard) rather than inventing a parallel
 * mechanism. It is a named, categorized DEBT LEDGER, not a mute switch:
 *
 *  1. A corpus file not listed here must match its oracle fixture, full stop — an unrecorded
 *     mismatch fails loudly and by name (see task-24-report.md for how the original 22 were
 *     diagnosed, and task-36-report.md for the verified-current 15).
 *  2. A file that IS listed must still fail to match — the moment it starts matching, the debt is
 *     paid off and the stale entry must be deleted, or the ledger could quietly rot into a
 *     permanent excuse instead of tracking real, current gaps.
 *  3. A listed file must still fail by the same MAGNITUDE it recorded. Without this the ledger
 *     over-matched: "still unequal" made all 15 listed files exempt from every kind of regression
 *     detection, so a new and entirely unrelated bug landing inside one of them was invisible.
 *     Each entry pins a `diff` shape (see `diffShape`) and the assertion below is "still failing,
 *     AND still failing exactly this much".
 */
const NAMES = discoverCorpus()
const PROVENANCE = readProvenance()
// `resolveJsonModule` widens each `category` string to `string`, not the `MismatchCategory` union;
// the cast is safe because `validateKnownMismatches` below actually checks every category against
// the same three-value enum at runtime — a bad category fails that test, not silently type-checks.
const KNOWN_MISMATCHES: KnownMismatches = knownMismatchesJson as KnownMismatches

describe('corpus vs committed GitHub oracle fixtures (zero network)', () => {
  // Pinned to the exact count, not to SPEC 13.3's 45-60 band. A band lets the corpus shrink
  // silently: deleting five files turns "45 of 60" into "40 of 55" with the suite still green,
  // and the headline fidelity number is computed over whatever survived. Deleting or adding a
  // corpus file is a deliberate act and should have to say so here.
  it('has exactly 60 corpus files (SPEC 13.3 mandates 45-60; 60 is what is committed)', () => {
    expect(NAMES.length).toBe(60)
  })

  it('covers the four snapshotted SPEC 13.3 categories', () => {
    const categories = new Set(NAMES.map((n) => n.split('/')[0]))
    expect([...categories].sort()).toEqual(['frontend', 'gfm', 'github-only', 'real-world'])
  })

  it('every known-mismatches key names a real corpus file', () => {
    expect(findOrphanWhitelistKeys(KNOWN_MISMATCHES, NAMES)).toEqual([])
  })

  it('every known-mismatches entry is named and categorized (readit-bug|deviation|normalizer-gap)', () => {
    expect(validateKnownMismatches(KNOWN_MISMATCHES)).toEqual([])
  })

  it.each(NAMES)('%s', (name) => {
    const provenance = PROVENANCE[name]
    expect(
      provenance,
      `no oracle provenance for "${name}". The contents endpoint only serves committed files: ` +
        'push the corpus first, then run `npm run oracle:refresh` from the merged commit SHA.',
    ).toBeDefined()

    const actualHtml = render(readCorpus(name), { math: null, highlighter: null })
    // provenance is asserted defined immediately above; the `!` documents that for
    // noUncheckedIndexedAccess rather than tolerating a real gap.
    const result = compareToFixture(actualHtml, readFixture(name), provenance!)
    const entry = KNOWN_MISMATCHES[name]

    if (entry === undefined) {
      // Not on the ledger: must match, full stop. On a mismatch, print the line diff first —
      // vitest shows it element by element and points at the offending tag — then the full-string
      // backstop for a difference the line split cannot show (e.g. whitespace inside <pre>).
      if (!result.equal) {
        expect(result.actualLines).toEqual(result.expectedLines)
        expect(result.actual).toBe(result.expected)
      }
      expect(result.equal).toBe(true)
      return
    }

    // On the ledger, direction 2: the anti-rot direction. It must still fail to match — if it now
    // passes, the recorded debt is gone and the fix is to delete this file's entry from
    // known-mismatches.json, not to leave it whitelisted.
    expect(
      ratchetShouldPass(result.equal, true),
      `"${name}" now matches the oracle fixture. Its debt is paid off — delete its entry from ` +
        `test/known-mismatches.json (recorded cause(s): ${entry.causes.map((c) => c.category).join(', ')}).`,
    ).toBe(true)

    // On the ledger, direction 3: the anti-over-match direction. Being listed excuses the causes
    // this entry NAMES, not the file. If the magnitude moved, something changed that the recorded
    // prose does not describe.
    const shape = diffShape(result.actualLines, result.expectedLines)
    expect(
      shape,
      `"${name}" still mismatches its oracle fixture, but by a different amount than recorded.\n` +
        `Being on the ledger excuses only the ${entry.causes.length} cause(s) it names ` +
        `(${entry.causes.map((c) => c.category).join(', ')}) — it is NOT a blanket exemption for ` +
        'this file.\n' +
        'The overwhelmingly likely reading of a change here is that a NEW, unrelated regression ' +
        'landed inside an already-failing file: find it and fix it.\n' +
        'Only once you have confirmed the change genuinely belongs to a cause already listed — or ' +
        'you are adding a new, named, explained cause alongside it — should you re-pin `diff` in ' +
        'test/known-mismatches.json. Re-pinning reflexively to get back to green throws away the ' +
        'only protection these 15 files have.',
    ).toEqual(entry.diff)
  })
})
