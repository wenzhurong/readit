import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OracleProvenance } from '../scripts/oracle-refresh.js'
import { normalize, toDiffLines } from './normalize.js'

// fileURLToPath, never `.pathname`: on Windows `new URL(...).pathname` yields
// `/D:/a/readit/...` — a leading slash before the drive letter — and joining that
// produces `D:\D:\a\...`. Measured on windows-latest CI 2026-08-08, where it took
// out four test files with ENOENT before anyone had run the suite on Windows.
export const CORPUS_DIR = fileURLToPath(new URL('./corpus/', import.meta.url))
export const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))

/**
 * Directories directly under CORPUS_DIR that carry no oracle fixture and must not be discovered
 * as snapshot corpus:
 *  - `adversarial`: a timing gate, not a snapshot (see corpus-adversarial.ts / pathological.ts).
 *  - `inline-math`: listed defensively. The 159-case dollar-guard corpus (SPEC §13.3) lives at
 *    `test/inline-math/corpus.json`, outside CORPUS_DIR entirely, so it is never actually reached
 *    by the walk below — it is asserted by a separate mechanism (see smoke.test.ts) and would blow
 *    through the 45-60 file band if it were ever folded in here. The entry stays so that co-locating
 *    it under `test/corpus/inline-math/` in the future does not silently re-enable discovery.
 */
export const NON_SNAPSHOT_DIRS = ['adversarial', 'inline-math']

/** Corpus names, e.g. `gfm/table-alignment`. Sorted, so the test order is stable. */
export function discoverCorpus(dir: string = CORPUS_DIR): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (!NON_SNAPSHOT_DIRS.includes(next)) walk(next)
        continue
      }
      if (entry.name.endsWith('.md')) out.push(next.slice(0, -3).split(sep).join(posix.sep))
    }
  }
  walk('')
  return out.sort()
}

export function readProvenance(fixturesDir: string = FIXTURES_DIR): OracleProvenance {
  return JSON.parse(readFileSync(join(fixturesDir, 'oracle-provenance.json'), 'utf8')) as OracleProvenance
}

export function readCorpus(name: string, dir: string = CORPUS_DIR): string {
  return readFileSync(join(dir, `${name}.md`), 'utf8')
}

export function readFixture(name: string, fixturesDir: string = FIXTURES_DIR): string {
  return readFileSync(join(fixturesDir, `${name}.html`), 'utf8')
}

export interface FixtureComparison {
  equal: boolean
  actual: string
  expected: string
  actualLines: string[]
  expectedLines: string[]
}

export function compareToFixture(
  actualHtml: string,
  fixtureHtml: string,
  opts: { repo: string; ref: string; dir: string },
): FixtureComparison {
  const actual = normalize(actualHtml, opts)
  const expected = normalize(fixtureHtml, opts)
  return {
    equal: actual === expected,
    actual,
    expected,
    actualLines: toDiffLines(actual),
    expectedLines: toDiffLines(expected),
  }
}

/**
 * The magnitude of a mismatch, expressed as a *shape* rather than a raw count of differing
 * line positions.
 *
 *  - `edits` is `|actual| + |expected| - 2 * LCS(actual, expected)`: the number of lines you
 *    would have to delete from one side plus insert on the other to turn readit's output into
 *    the oracle's. It is a canonical quantity — it does not depend on which optimal alignment
 *    happens to be chosen — and it is immune to index cascade.
 *  - `hunks` is the number of maximal contiguous runs of change in that alignment: how many
 *    *separate places* in the file are wrong.
 *
 * Why not the naive positional count (compare line i to line i, count the mismatches)? Because
 * it is dominated by cascade. `real-world/hast-util-sanitize` reports 1131 differing positions
 * out of 1390 lines but is really 3 changed regions totalling 305 lines: one unflattened
 * highlight block early in the file shifts every subsequent index. That number is both coarser
 * (it hides the structure) and far *less* stable (a one-line insertion near the top rewrites it
 * completely) than the pair recorded here. The "N of M lines" figures quoted in the prose of
 * `known-mismatches.json` are those older positional counts, kept as written because they are
 * what the original diagnoses were verified against; the numbers pinned in each entry's `diff`
 * are these shape figures, and the two are not expected to agree.
 */
export interface DiffShape {
  /**
   * Maximal contiguous runs of change: how many *separate places* in the file are wrong.
   *
   * Read this as fragmentation, NOT as coverage. A regression only adds a hunk if it lands on
   * a line that currently MATCHES the oracle; a regression that lands on a line already inside
   * an existing hunk moves neither number. See `shapeCarriesNoSignal` and the blind-surface
   * note on `diffHunks` for how much of each ledger file that leaves unprotected.
   */
  hunks: number
  /** Lines deleted plus lines inserted: `|a| + |b| - 2 * LCS(a, b)`. */
  edits: number
}

/** One maximal contiguous run of change, with where it sits in each side. */
export interface DiffHunk {
  /** 0-based index into the FULL `actualLines` array where this hunk's removed run begins. */
  actualStart: number
  /** 0-based index into the FULL `expectedLines` array where this hunk's added run begins. */
  expectedStart: number
  /** Lines present in `actual` and absent from `expected`, in document order. */
  removed: string[]
  /** Lines present in `expected` and absent from `actual`, in document order. */
  added: string[]
}

/**
 * Align two line arrays and return the maximal contiguous runs of change, in document order.
 *
 * This is the single alignment implementation in the harness: `diffShape` is derived from it,
 * so the hunks a failure message prints are exactly the hunks the pin counts — they cannot
 * drift apart into two disagreeing views of the same diff.
 *
 * Common prefix and suffix are stripped first — standard for shortest-edit-script problems,
 * where it provably does not change the answer — which keeps the quadratic table small for the
 * common case of a long file with a couple of localized diffs (`real-world/sindresorhus-is` is
 * 3055 lines with 2 changed ones).
 *
 * ## The tie-break is load-bearing, and only `hunks` depends on it
 *
 * `edits` is canonical: it is a function of LCS *length* alone, so every optimal alignment
 * yields the same number. `hunks` is not — it depends on WHICH optimal alignment gets walked,
 * and when the two backtrack directions are equally good, the comparison below is what picks
 * one. Flipping it to its mirror (`table[i - 1][j] >= table[i][j - 1]`, preferring to consume
 * `a`) is a silent re-pin: measured on this corpus it takes `real-world/mermaid` from 22 hunks
 * to 12 with `edits` unchanged at 84, while every other entry holds still.
 *
 * That asymmetry is the diagnostic the ledger's failure message leans on — `edits` unchanged
 * while `hunks` moves means the ALIGNER changed, not the renderer — so the tie-break is pinned
 * by name in `corpus-harness.test.ts` ("the LCS tie-break is load-bearing…"), against a case
 * brute-forced to distinguish it from its mirror. Do not "simplify" this comparison.
 *
 * ## What the shape cannot see
 *
 * A hunk records only that a run of lines differs, not what they say. Changing a line that is
 * already inside a hunk leaves both numbers untouched, so the pin's blind surface on any file is
 * exactly the removed side of its hunks — the lines of readit's output that already fail to match.
 * The size of that surface across the ledger is not quoted here; `corpus.test.ts` recomputes it
 * every run ("the magnitude pin's blind surface is measured and pinned"). Four entries
 * (`frontend/mermaid-large`, `-syntax-error`, `-valid`, `gfm/tagfilter`) share no line at all with
 * their oracle and are therefore 100% blind — `shapeCarriesNoSignal` detects exactly that case,
 * and `corpus.test.ts` requires those entries to pin their `output` verbatim instead.
 */
export function diffHunks(actualLines: readonly string[], expectedLines: readonly string[]): DiffHunk[] {
  let lo = 0
  while (lo < actualLines.length && lo < expectedLines.length && actualLines[lo] === expectedLines[lo]) lo += 1
  let aHi = actualLines.length
  let bHi = expectedLines.length
  while (aHi > lo && bHi > lo && actualLines[aHi - 1] === expectedLines[bHi - 1]) {
    aHi -= 1
    bHi -= 1
  }
  const a = actualLines.slice(lo, aHi)
  const b = expectedLines.slice(lo, bHi)
  if (a.length === 0 && b.length === 0) return []
  if (a.length === 0 || b.length === 0) {
    return [{ actualStart: lo, expectedStart: lo, removed: [...a], added: [...b] }]
  }

  const n = a.length
  const m = b.length
  const table: Uint32Array[] = []
  for (let i = 0; i <= n; i += 1) table.push(new Uint32Array(m + 1))
  for (let i = 1; i <= n; i += 1) {
    // Every index below is in range by construction (the loops are bounded by n/m and the table
    // is allocated to n+1 by m+1); the `!`s document that for noUncheckedIndexedAccess.
    const row = table[i]!
    const prev = table[i - 1]!
    const ai = a[i - 1]
    for (let j = 1; j <= m; j += 1) {
      row[j] = ai === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!)
    }
  }

  // Walk one optimal alignment back to front, collecting maximal runs of change. Because the
  // walk is backwards, each run is accumulated in reverse and flipped when it is closed; the
  // hunk list itself is reversed at the end so callers see document order.
  const reversed: DiffHunk[] = []
  let removedRev: string[] = []
  let addedRev: string[] = []
  let inHunk = false
  let i = n
  let j = m
  const close = (): void => {
    // `i`/`j` have already been walked back past the whole run, so they are its start.
    reversed.push({
      actualStart: lo + i,
      expectedStart: lo + j,
      removed: removedRev.reverse(),
      added: addedRev.reverse(),
    })
    removedRev = []
    addedRev = []
    inHunk = false
  }
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      if (inHunk) close()
      i -= 1
      j -= 1
      continue
    }
    inHunk = true
    // The tie-break. See the "load-bearing" note above before touching this comparison.
    if (j > 0 && (i === 0 || table[i]![j - 1]! >= table[i - 1]![j]!)) {
      j -= 1
      addedRev.push(b[j]!)
    } else {
      i -= 1
      removedRev.push(a[i]!)
    }
  }
  if (inHunk) close()
  return reversed.reverse()
}

/**
 * Measure the shape of the difference between two line arrays: how many separate places differ,
 * and by how many line insertions/deletions in total.
 */
export function diffShape(actualLines: readonly string[], expectedLines: readonly string[]): DiffShape {
  const hunks = diffHunks(actualLines, expectedLines)
  let edits = 0
  for (const h of hunks) edits += h.removed.length + h.added.length
  return { hunks: hunks.length, edits }
}

/**
 * True when the pinned shape carries no information about this file's CONTENT at all.
 *
 * `edits === |actual| + |expected|` says LCS is zero: not one line of readit's output matches
 * any line of the oracle's. The alignment then has nothing to anchor on — `hunks` is stuck at 1
 * and `edits` degenerates into the two line counts — so any change that rewrites a line without
 * changing how many lines there are is completely invisible to the pin.
 *
 * Four ledger entries are in this state today (the three `frontend/mermaid-*` files, whose
 * `div.highlight` wrapper shares nothing with GitHub's `<section data-type="mermaid">`, and
 * `gfm/tagfilter`, whose entire normalized output is one line). For those, `corpus.test.ts`
 * requires the entry to pin `output` verbatim — a magnitude cannot protect a file whose
 * magnitude is a constant.
 */
export function shapeCarriesNoSignal(
  shape: DiffShape,
  actualLines: readonly string[],
  expectedLines: readonly string[],
): boolean {
  return shape.edits > 0 && shape.edits === actualLines.length + expectedLines.length
}

/**
 * What direction 3b requires of one ledger entry right now, given its measured shape and readit's
 * current output. Five states, and the ORDER they are decided in is the point.
 *
 *  - `must-pin`        blind, no `output`. Add one; the magnitude protects nothing here.
 *  - `pin-must-match`  blind, has `output`. The pin is the only content protection; compare it.
 *  - `content-moved`   NOT blind any more, has `output`, and the output has ALSO changed.
 *  - `drop-pin`        NOT blind any more, has `output`, and the output is byte-identical.
 *                      Only here is deleting the pin the whole story.
 *  - `no-pin`          NOT blind, no `output`. The normal state of the other 11 entries.
 *
 * `content-moved` exists because the previous version of this decision had only four states and
 * collapsed it into `drop-pin`, whose message tells a maintainer to delete the pin. That state is
 * reachable with the shape held still, so the instruction fired over an undiagnosed rendering
 * change. A reviewer's probe, pinned in `corpus-harness.test.ts`:
 *
 *     oracle  ['<section data-type="mermaid">', 'SRC', '</section>']            (3 lines)
 *     today   5 lines, none matching            -> {hunks:1, edits:8}, blind
 *     after   ['<section data-type="mermaid">', 'a','b','c','d','e','f']
 *                                               -> {hunks:1, edits:8}, NOT blind
 *
 * `{1,8}` is preserved, so direction 3 passes; blindness ends because the new first line happens
 * to match the oracle's. Every one of readit's lines changed, and the only guidance the entry got
 * was "delete `output`". Narrow, but it is precisely the reflexive re-pin 3b exists to prevent,
 * and the message was what caused it. The content is compared FIRST now, and deletion is
 * authorized only once it has held still.
 */
export type ContentPinObligation = 'must-pin' | 'pin-must-match' | 'content-moved' | 'drop-pin' | 'no-pin'

export function contentPinObligation(
  shape: DiffShape,
  actualLines: readonly string[],
  expectedLines: readonly string[],
  entry: Pick<MismatchEntry, 'output'>,
): ContentPinObligation {
  if (shapeCarriesNoSignal(shape, actualLines, expectedLines)) {
    return entry.output === undefined ? 'must-pin' : 'pin-must-match'
  }
  if (entry.output === undefined) return 'no-pin'
  const pinned = entry.output
  const same = pinned.length === actualLines.length && pinned.every((l, i) => l === actualLines[i])
  return same ? 'drop-pin' : 'content-moved'
}

/**
 * Render hunks as a localized `-`/`+` listing for a failure message.
 *
 * Capped, because a ledger file's diff can be large by design (`real-world/hast-util-sanitize`
 * is 305 edits) and a wall of that in a test failure is as unreadable as the two bare integers
 * it replaces. The caps are on the number of hunks and the number of lines shown per hunk, never
 * on the width of a line — `chaiConfig.truncateThreshold: 0` is set repo-wide precisely so that
 * a long attribute list is not cut off mid-diff. `npm run corpus:diff -- <name>` prints the
 * uncapped version.
 */
export function formatDiffHunks(
  hunks: readonly DiffHunk[],
  opts: { maxHunks?: number; maxLinesPerHunk?: number } = {},
): string {
  const maxHunks = opts.maxHunks ?? 6
  const maxLines = opts.maxLinesPerHunk ?? 6
  if (hunks.length === 0) return '  (no line-level difference)'
  const out: string[] = []
  hunks.slice(0, maxHunks).forEach((h, idx) => {
    out.push(
      `  hunk ${idx + 1}/${hunks.length} — actual line ${h.actualStart + 1}, oracle line ${h.expectedStart + 1} ` +
        `(-${h.removed.length} +${h.added.length})`,
    )
    const shown: string[] = [
      ...h.removed.slice(0, maxLines).map((l) => `    - ${l}`),
      ...h.added.slice(0, maxLines).map((l) => `    + ${l}`),
    ]
    out.push(...shown)
    const hidden = Math.max(0, h.removed.length - maxLines) + Math.max(0, h.added.length - maxLines)
    if (hidden > 0) out.push(`    … ${hidden} more line(s) in this hunk`)
  })
  if (hunks.length > maxHunks) out.push(`  … ${hunks.length - maxHunks} more hunk(s)`)
  return out.join('\n')
}

/**
 * Task 36 — the corpus's two-way mismatch ratchet, mirroring `test/spec/harness.ts`'s
 * `known-failures.json` anti-rot mechanism rather than inventing a parallel one (see that file's
 * `runSpecSuite` for the pattern this copies).
 *
 * `known-mismatches.json` is a named, categorized debt ledger, not a mute switch: every entry
 * records why a corpus file currently fails, so a mismatch there is expected and must NOT break
 * the build, but a mismatch anywhere else is new/unrecorded and MUST break the build. The second,
 * less obvious direction is what keeps the ledger honest — a whitelisted file that starts matching
 * the oracle has had its debt paid off, and the build must break until the stale entry is deleted,
 * or the list could silently rot into a permanent excuse.
 *
 * A third direction closes the over-match hole: "still failing" is not enough, because it made a
 * listed file exempt from ALL regression detection — a new, unrelated bug could land inside one of
 * the listed files and nothing would notice. Each entry therefore also pins the *magnitude* of
 * its mismatch (`diff`), so the ratchet asserts "still failing, and still failing exactly this
 * much". A ledger entry excuses only the causes it names, not the whole file.
 *
 * The magnitude pin has a measured blind surface, and it is disclosed rather than glossed: it can
 * only see a regression that changes a line's MATCH STATUS, so the lines it cannot see are exactly
 * the ones already inside a hunk. `corpus.test.ts` recomputes that figure from the committed
 * corpus on every run rather than restating it here. Where the blind surface is the whole file
 * (`shapeCarriesNoSignal`), the entry pins `output` verbatim instead; see that function and
 * `DiffShape.hunks`.
 */
export type MismatchCategory = 'readit-bug' | 'deviation' | 'normalizer-gap'

export interface MismatchCause {
  category: MismatchCategory
  /** One-line, human-readable explanation of what's wrong and why, verified against the actual diff. */
  explanation: string
  /** Where this finding was verified — a task report section, a file:line, or both. */
  source: string
}

export interface MismatchEntry {
  /**
   * The measured magnitude of this file's current mismatch. Pinning it is what stops a listed
   * file from becoming a blanket exemption; see `diffShape` for why it is a shape and not a
   * differing-line count.
   */
  diff: DiffShape
  /**
   * readit's exact normalized output lines, pinned verbatim.
   *
   * Required — and only required — when `shapeCarriesNoSignal` says the `diff` magnitude
   * degenerates: when readit's output shares no line at all with the oracle's, `hunks` is stuck
   * at 1 and `edits` is just the two line counts, so rewriting a line's content moves neither.
   * A magnitude cannot protect a file whose magnitude is a constant, so those entries pin the
   * content itself. `corpus.test.ts` enforces both halves of the rule: present when needed,
   * and accurate — and, since the rule is enforced in BOTH directions, `output` is not available
   * as a partial pin. A non-blind entry may not carry one at all.
   *
   * Deliberately NOT carried by the other 11 entries. There the magnitude does most of the work
   * already, and a verbatim snapshot of `real-world/sindresorhus-is`'s 3055 lines would be a
   * churn engine that gets re-pinned reflexively — the exact failure mode this ledger exists to
   * avoid.
   *
   * ## What these three mermaid pins cost when M5 lands: nothing
   *
   * Stated on this branch as "the three mermaid `output` pins will need re-pinning when M5
   * lands". They will not. At M5 readit emits `<section data-type="mermaid">`, which is the whole
   * of each entry's recorded diff (its cause records that the mermaid source text is already
   * identical on both sides), so those three entries start MATCHING, direction 2 fires, and the
   * entries are deleted outright — `output` with them. That is a debt payoff, not a re-pin.
   * `real-world/mermaid` is the one that does get re-pinned: 20 of its 22 hunks are the ten
   * fences (two hunks each, a `-5` and a `+3`), and the remaining two are unrelated causes, so
   * that entry survives M5 with a much smaller magnitude.
   *
   * ## The `real-world/mermaid` residual, and why it stops here
   *
   * `real-world/mermaid` is not blind, so it carries no `output`, and it holds 52 of the ledger's
   * 99 blind lines — the largest single residual. The reason previously recorded for leaving it
   * ("closing it would mean snapshotting 904 lines") was wrong by an order of magnitude: the
   * blind surface is the removed side of its hunks, 52 lines / 8,671 bytes, against 904 lines /
   * 43,427 bytes for the whole normalized output. The real reasons, measured:
   *
   *  - 50 of the 52 are the ten D-MERMAID fence wrappers (10 x `<div class="highlight
   *    highlight-source-mermaid …">`, `<pre>`, the source line, `</pre>`, `</div>`) — one named,
   *    recorded cause, whose exact construct is ALREADY pinned verbatim three times over by the
   *    three `frontend/mermaid-*` entries, and which the same M5 event retires. The marginal
   *    content this residual leaves unprotected is 2 lines: one `<img>` and one `<a class=
   *    "anchor">`, each of which is a separately recorded cause on this same entry.
   *  - `output` cannot be used to close it. Direction 3b forbids an `output` pin on a non-blind
   *    entry, and that "forbids it otherwise" half is exactly what makes 3b self-maintaining;
   *    weakening it to allow a partial pin here would cost more than it buys. Closing the
   *    residual properly means a THIRD pin type — a hash of readit's own normalized output,
   *    oracle-independent so an `oracle:refresh` cannot churn it — plus its validator rules, its
   *    both-direction enforcement, and a decision about the other 10 non-blind entries.
   *
   * That is a mechanism, not a data edit, and it is recorded as debt rather than added in a
   * closing round. See the branch-review-fix-6 report.
   */
  output?: string[]
  causes: MismatchCause[]
}

export type KnownMismatches = Record<string, MismatchEntry>

/**
 * The failure message for ratchet direction 3, built where it can be unit-tested rather than
 * inlined into the assertion.
 *
 * Two integers ("expected { hunks: 3, edits: 7 } to deeply equal { hunks: 2, edits: 4 }") told a
 * maintainer to go find a regression and gave them nothing to find it with — no locations, no
 * lines — so the cheap way out was to re-pin and move on. This carries the localized hunk listing,
 * names the tool that prints the uncapped version, and, crucially, distinguishes the one case that
 * is NOT a regression at all.
 *
 * That case: `edits` is canonical (a function of LCS length, identical under every optimal
 * alignment) while `hunks` depends on which optimal alignment `diffHunks` walks, which its
 * tie-break decides. So `edits` unchanged + `hunks` moved is the signature of an ALIGNER change,
 * not a rendering change — flipping the tie-break to its mirror re-pins `real-world/mermaid` from
 * 22 hunks to 12 with `edits` still 84, and without this clause the message would confidently
 * accuse a maintainer of a regression that does not exist.
 *
 * The signature is NOT exclusive to an aligner change, and the clause says so and hands over the
 * mechanical answer instead of leaving the maintainer to eyeball a comparison operator. A real
 * regression can produce it: repair one recorded 1-line hunk while breaking a line adjacent to
 * another and `edits` holds at 4 while `hunks` goes 2 -> 1 (asserted in `corpus-harness.test.ts`
 * as "the aligner signature is a heuristic"). What decides it is that both tie-break tests in
 * `corpus-harness.test.ts` go red under a tie-break change and stay green under a rendering one,
 * so the clause tells the maintainer to run those rather than to read `diffHunks`.
 */
export function shapeMismatchMessage(
  name: string,
  entry: Pick<MismatchEntry, 'diff' | 'causes'>,
  measured: DiffShape,
  hunks: readonly DiffHunk[],
): string {
  const alignerClause =
    measured.edits === entry.diff.edits && measured.hunks !== entry.diff.hunks
      ? 'BUT FIRST — `edits` is UNCHANGED and only `hunks` moved. That is the signature of an ' +
        'ALIGNER change, not a rendering change: `edits` depends only on LCS length and is the ' +
        'same under every optimal alignment, while `hunks` depends on WHICH optimal alignment ' +
        "diffHunks walks, which its tie-break picks. Check corpus-harness.ts's diffHunks (and " +
        'its tie-break comparison in particular) for an edit before you go hunting for a ' +
        'rendering regression — if that is what moved, re-pinning is correct and the prose ' +
        'below does not apply.\n' +
        'You do not have to read that comparison to find out. Run the two tie-break tests in ' +
        'corpus-harness.ts\'s companion, `corpus-harness.test.ts` ("diffHunks: the LCS tie-break ' +
        'is pinned, not incidental"): both were brute-forced to discriminate the committed ' +
        'aligner from its mirror, and both go red under a tie-break change. If they are GREEN, ' +
        'the aligner has not changed and this IS a rendering change — read on. This signature is ' +
        'a heuristic, not a proof: fixing one recorded 1-line hunk while breaking a line adjacent ' +
        'to another leaves `edits` at 4 and moves `hunks` 2 -> 1, so a real regression can ' +
        'produce it too. The tie-break tests are what tell the two apart.\n'
      : ''
  return (
    `"${name}" still mismatches its oracle fixture, but by a different amount than recorded.\n` +
    `  recorded: ${JSON.stringify(entry.diff)}\n  measured: ${JSON.stringify(measured)}\n` +
    `Being on the ledger excuses only the ${entry.causes.length} cause(s) it names ` +
    `(${entry.causes.map((c) => c.category).join(', ')}) — it is NOT a blanket exemption for ` +
    'this file.\n' +
    alignerClause +
    'The current diff, hunk by hunk (capped; run `npm run corpus:diff -- ' +
    `${name}\` for the full listing and a copy-pasteable re-pin block):\n` +
    `${formatDiffHunks(hunks)}\n` +
    'Otherwise the overwhelmingly likely reading of a change here is that a NEW, unrelated ' +
    'regression landed inside an already-failing file: find it above and fix it.\n' +
    'Only once you have confirmed the change genuinely belongs to a cause already listed — or ' +
    'you are adding a new, named, explained cause alongside it — should you re-pin `diff` in ' +
    'test/known-mismatches.json. Re-pinning reflexively to get back to green throws away the ' +
    'only protection the ledgered files have.'
  )
}

const MISMATCH_CATEGORIES: readonly MismatchCategory[] = ['readit-bug', 'deviation', 'normalizer-gap']

/**
 * The ratchet's pure decision, isolated from file I/O and the real 60-file corpus so both
 * directions can be named and asserted directly (see `corpus-harness.test.ts`):
 *
 *  - not whitelisted, matches    -> pass. The normal, expected state.
 *  - not whitelisted, mismatches -> FAIL. A new, unrecorded mismatch breaks the build.
 *  - whitelisted, mismatches     -> pass. A recorded, still-real debt.
 *  - whitelisted, matches        -> FAIL. The debt is paid off; the stale entry must be deleted.
 */
export function ratchetShouldPass(equal: boolean, whitelisted: boolean): boolean {
  return whitelisted ? !equal : equal
}

/** Whitelist keys that name no real corpus file — a typo or a file that was since removed/renamed. */
export function findOrphanWhitelistKeys(known: KnownMismatches, realNames: readonly string[]): string[] {
  const names = new Set(realNames)
  return Object.keys(known).filter((k) => !names.has(k))
}

export interface MismatchValidationError {
  name: string
  message: string
}

/**
 * Enforces the "every entry must be named, explained and measured" rule: a pinned `diff`
 * magnitude, plus at least one cause, each with a category from the fixed three-value enum, a
 * non-empty explanation, and a non-empty source reference. A bare path with no explanation is not
 * acceptable, and neither is an entry with no magnitude — this is what keeps both true, so that
 * adding a file to the ledger cannot be done without also recording how badly it currently fails.
 *
 * KNOWN LIMIT of the `>= 1` floor: a file whose ONLY divergence from its oracle is invisible to
 * `toDiffLines` (say, whitespace inside a `<pre>` that survives normalization but not the line
 * split) would mismatch with a measured shape of `{ hunks: 0, edits: 0 }` and could therefore
 * never be legally pinned here. No corpus file is in that state today — every pin is >= 1 —
 * and the floor is worth keeping, because relaxing it to allow a zero magnitude would also let a
 * genuinely-matching file be pinned as debt, which is direction 2's whole job to prevent. If it
 * ever happens, `corpus.test.ts` catches it by name with a dedicated message rather than letting
 * this validator report a confusing shape error; the fix there is a content pin (`output`), not
 * a zero magnitude.
 */
export function validateKnownMismatches(known: KnownMismatches): MismatchValidationError[] {
  const errors: MismatchValidationError[] = []
  for (const [name, entry] of Object.entries(known)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ name, message: 'must be an object of the form { diff, causes }' })
      continue
    }
    const diff: unknown = entry.diff
    if (
      diff === null ||
      typeof diff !== 'object' ||
      !Number.isInteger((diff as DiffShape).hunks) ||
      !Number.isInteger((diff as DiffShape).edits) ||
      (diff as DiffShape).hunks < 1 ||
      (diff as DiffShape).edits < 1
    ) {
      errors.push({
        name,
        message:
          'must pin diff as { hunks, edits } with both integers >= 1 — a ledger entry describes a ' +
          'file that still mismatches, so a magnitude of zero is never correct',
      })
    }
    // `output` is optional (only the fully-blind entries carry one), but if it is there it has to
    // be a real array of lines — a malformed one would otherwise fail later as a confusing
    // deep-equal against the rendered output rather than as a ledger-shape error here.
    if (entry.output !== undefined) {
      if (!Array.isArray(entry.output) || entry.output.length === 0 || entry.output.some((l) => typeof l !== 'string')) {
        errors.push({ name, message: 'output, when present, must be a non-empty array of strings' })
      }
    }
    const causes = entry.causes
    if (!Array.isArray(causes) || causes.length === 0) {
      errors.push({ name, message: 'must list at least one cause' })
      continue
    }
    causes.forEach((cause, i) => {
      if (!MISMATCH_CATEGORIES.includes(cause.category)) {
        errors.push({
          name,
          message: `cause[${i}].category "${String(cause.category)}" is not one of ${MISMATCH_CATEGORIES.join('|')}`,
        })
      }
      if (typeof cause.explanation !== 'string' || cause.explanation.trim() === '') {
        errors.push({ name, message: `cause[${i}].explanation must be a non-empty string` })
      }
      if (typeof cause.source !== 'string' || cause.source.trim() === '') {
        errors.push({ name, message: `cause[${i}].source must be a non-empty string` })
      }
    })
  }
  return errors
}
