import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import type { OracleProvenance } from '../scripts/oracle-refresh.js'
import { normalize, toDiffLines } from './normalize.js'

export const CORPUS_DIR = new URL('./corpus/', import.meta.url).pathname
export const FIXTURES_DIR = new URL('./fixtures/', import.meta.url).pathname

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
  /** Maximal contiguous runs of change. A new, unrelated regression elsewhere adds one. */
  hunks: number
  /** Lines deleted plus lines inserted: `|a| + |b| - 2 * LCS(a, b)`. */
  edits: number
}

/**
 * Measure the shape of the difference between two line arrays.
 *
 * Common prefix and suffix are stripped first — standard for shortest-edit-script problems,
 * where it provably does not change the answer — which keeps the quadratic table small for the
 * common case of a long file with a couple of localized diffs (`real-world/sindresorhus-is` is
 * 3055 lines with 2 changed ones).
 */
export function diffShape(actualLines: readonly string[], expectedLines: readonly string[]): DiffShape {
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
  if (a.length === 0 && b.length === 0) return { hunks: 0, edits: 0 }
  if (a.length === 0 || b.length === 0) return { hunks: 1, edits: a.length + b.length }

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
  const lcs = table[n]![m]!

  // Walk one optimal alignment back to front, counting maximal runs of change. The tie-break
  // (prefer consuming `b` when the two directions are equally good) only decides *which* optimal
  // alignment is walked, and is fixed here so the hunk count is deterministic.
  let i = n
  let j = m
  let hunks = 0
  let inHunk = false
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      i -= 1
      j -= 1
      inHunk = false
      continue
    }
    if (!inHunk) {
      hunks += 1
      inHunk = true
    }
    if (j > 0 && (i === 0 || table[i]![j - 1]! >= table[i - 1]![j]!)) j -= 1
    else i -= 1
  }
  return { hunks, edits: n - lcs + (m - lcs) }
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
 * the 15 listed files and nothing would notice. Each entry therefore also pins the *magnitude* of
 * its mismatch (`diff`), so the ratchet asserts "still failing, and still failing exactly this
 * much". A ledger entry excuses only the causes it names, not the whole file.
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
  causes: MismatchCause[]
}

export type KnownMismatches = Record<string, MismatchEntry>

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
