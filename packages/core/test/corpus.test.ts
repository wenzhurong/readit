import { describe, expect, it } from 'vitest'
import { render } from '../src/index.js'
import {
  type KnownMismatches,
  compareToFixture,
  contentPinObligation,
  diffHunks,
  diffShape,
  discoverCorpus,
  findOrphanWhitelistKeys,
  ratchetShouldPass,
  readCorpus,
  readFixture,
  readProvenance,
  shapeMismatchMessage,
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
 *
 *     What direction 3 can and cannot see: the shape moves iff a line changes MATCH STATUS, so
 *     its blind surface on a file is exactly the lines of readit's output that already differ.
 *     That figure is NOT quoted here — the test "the magnitude pin's blind surface is 99 of 5249
 *     lines" below recomputes it from the committed corpus every run, because a number written
 *     into a comment is a number nobody re-derives. (The 109 this comment used to state was
 *     `sum(max(1, removed))`, which credits a pure-insertion hunk with a readit line that does
 *     not exist; the honest count is the removed side alone.) It is bounded and disclosed, not
 *     total. But on four entries it IS total: `frontend/mermaid-{large,syntax-error,valid}` and
 *     `gfm/tagfilter` share no line at all with their oracle, which leaves `hunks` stuck at 1 and
 *     `edits` equal to the two line counts. Those four (16 lines) pin `output` verbatim instead —
 *     see `shapeCarriesNoSignal`, and direction 3b in the assertion below, which requires the pin
 *     exactly when the magnitude degenerates and forbids it otherwise.
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

  /**
   * The magnitude pin's cost, recomputed rather than quoted. `{ hunks, edits }` moves only when a
   * line changes MATCH STATUS, so the lines it cannot see are exactly the lines of readit's output
   * that already fail to match — the removed side of every hunk. That is the disclosure this
   * mechanism owes, and a disclosure carried in a comment is one nobody re-derives: the figure
   * stated in prose on this branch was 109, which is `sum(max(1, removed))` and credits a
   * pure-insertion hunk (`removed: []`, no readit line at all) with one blind line. The real
   * answer is 99, and it is asserted here so that widening the blind surface is a visible act.
   *
   * `real-world/mermaid` carries 52 of the 99 on its own; see the residual note on
   * `MismatchEntry.output` for why that is a stopping point and what closing it would cost.
   */
  it("the magnitude pin's blind surface is 99 of 5249 lines, and 52 of those are one entry", () => {
    let blind = 0
    let lines = 0
    let mermaid = 0
    for (const name of Object.keys(KNOWN_MISMATCHES)) {
      const result = compareToFixture(
        render(readCorpus(name), { math: null, highlighter: null }),
        readFixture(name),
        PROVENANCE[name]!,
      )
      const removed = diffHunks(result.actualLines, result.expectedLines).reduce((n, h) => n + h.removed.length, 0)
      blind += removed
      lines += result.actualLines.length
      if (name === 'real-world/mermaid') mermaid = removed
    }
    expect({ blind, lines, mermaid }).toEqual({ blind: 99, lines: 5249, mermaid: 52 })
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

    // The `{ hunks: 0, edits: 0 }`-while-unequal case. `validateKnownMismatches` requires a
    // magnitude of at least 1, so a file whose only divergence is invisible to `toDiffLines`
    // (whitespace inside a `<pre>`, say) could never be legally pinned — and the assertion below
    // would report it as a baffling "expected {0,0} to equal {1,2}". No corpus file is in this
    // state today; if one ever is, it gets told what actually happened.
    if (shape.hunks === 0 && shape.edits === 0) {
      expect.fail(
        `"${name}" still mismatches its oracle fixture, but the difference is invisible to ` +
          'toDiffLines: every line is identical, so the mismatch is inside a line the split does ' +
          'not separate (whitespace inside a <pre>, most likely). A `diff` magnitude cannot ' +
          'describe this — pin `output`, or extend toDiffLines so the difference becomes visible. ' +
          'Run `npm run corpus:diff -- ' +
          `${name}\` and compare the raw normalized strings.`,
      )
    }

    if (shape.hunks !== entry.diff.hunks || shape.edits !== entry.diff.edits) {
      // Only build the diagnostic on the failing path: diffHunks re-runs the O(n·m) alignment,
      // and `real-world/hast-util-sanitize` is 1091 x 1390 lines. `expect`'s message argument is
      // eager, so this cannot be inlined into the assertion without paying for it on every run.
      expect(shape, shapeMismatchMessage(name, entry, shape, diffHunks(result.actualLines, result.expectedLines))).toEqual(
        entry.diff,
      )
    }
    expect(shape).toEqual(entry.diff)

    // Direction 3b: the content pin, for entries where 3 degenerates.
    //
    // `{ hunks, edits }` measures how a file's mismatch is SHAPED, which only says something about
    // content while some of the file still matches. When nothing matches — no shared line at all —
    // `hunks` is stuck at 1 and `edits` is just the two line counts, so any rewrite that preserves
    // the line count is completely invisible. Four entries are in that state (the three
    // `frontend/mermaid-*` files and `gfm/tagfilter`, 16 lines in total), and for them the honest
    // pin is not a magnitude at all but the output itself. The rule is enforced in both directions
    // so it maintains itself: an entry that becomes fully blind is forced to add `output`, and one
    // that stops being blind is told to drop it rather than carry a second thing to re-pin.
    //
    // "Told to drop it" is the branch that had to grow a fifth state. Blindness can end at the
    // same moment readit's output changes, with `{ hunks, edits }` preserved across the whole
    // transition — see `contentPinObligation`, which pins that probe — and the deletion message
    // was then the only thing a maintainer read. `content-moved` reports the content change first;
    // `drop-pin` authorizes the deletion only once the content has held still.
    const obligation = contentPinObligation(shape, result.actualLines, result.expectedLines, entry)

    if (obligation === 'must-pin') {
      expect.fail(
        `"${name}" shares no line at all with its oracle, so its \`diff\` magnitude carries no ` +
          'information about content: hunks is pinned at 1 and edits is just the two line counts, ' +
          'and rewriting any line would move neither. This entry must pin `output` (readit\'s exact ' +
          `normalized lines) in test/known-mismatches.json. Run \`npm run corpus:diff -- ${name}\` ` +
          'to print the block to paste.',
      )
    }

    if (obligation === 'pin-must-match') {
      expect(
        result.actualLines,
        `"${name}" pins its output verbatim because its \`diff\` magnitude cannot see content ` +
          '(no line of readit\'s output matches the oracle). readit\'s output has changed. This is ' +
          'the regression signal the magnitude pin structurally cannot give for this file — ' +
          'diagnose it before re-pinning, exactly as you would a `diff` change. Run ' +
          `\`npm run corpus:diff -- ${name}\` for the full listing and the block to paste.`,
      ).toEqual(entry.output)
    }

    // The content change gets reported BEFORE the pin is retired. Both of this entry's conditions
    // moved at once — it stopped being blind AND readit's output changed — and only one of those
    // two is bookkeeping. See `contentPinObligation` for the probe that makes this state reachable
    // with `diff` held completely still, which is what makes the deletion message dangerous here.
    if (obligation === 'content-moved') {
      expect(
        result.actualLines,
        `"${name}" no longer needs its \`output\` pin — it now shares at least one line with its ` +
          'oracle, so `diff` measures its content again. Do NOT delete the pin yet: readit\'s ' +
          `output ALSO changed, and \`diff\` did not move (still ${JSON.stringify(entry.diff)}), so ` +
          'this pin is the only thing that saw it. Diagnose the content change first — ' +
          `\`npm run corpus:diff -- ${name}\`. Deleting \`output\` now retires the pin and the ` +
          'evidence in one edit, which is exactly the reflex direction 3b exists to prevent.',
      ).toEqual(entry.output)
    }

    if (obligation === 'drop-pin') {
      expect.fail(
        `"${name}" carries an \`output\` pin but no longer needs one: it now shares at least one ` +
          'line with its oracle, so `diff` measures its content again — and readit\'s output is ' +
          'byte-identical to the pin, so nothing about this file\'s rendering changed; what moved ' +
          'is the oracle, or the line counts. Delete `output` from its entry in ' +
          'test/known-mismatches.json rather than maintaining two pins for one file.',
      )
    }
  })
})
