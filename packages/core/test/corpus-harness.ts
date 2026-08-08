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
 */
export type MismatchCategory = 'readit-bug' | 'deviation' | 'normalizer-gap'

export interface MismatchCause {
  category: MismatchCategory
  /** One-line, human-readable explanation of what's wrong and why, verified against the actual diff. */
  explanation: string
  /** Where this finding was verified — a task report section, a file:line, or both. */
  source: string
}

export type KnownMismatches = Record<string, MismatchCause[]>

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
 * Enforces the "every entry must be named and explained" rule: at least one cause, each with a
 * category from the fixed three-value enum, a non-empty explanation, and a non-empty source
 * reference. A bare path with no explanation is not acceptable — this is what keeps that true.
 */
export function validateKnownMismatches(known: KnownMismatches): MismatchValidationError[] {
  const errors: MismatchValidationError[] = []
  for (const [name, causes] of Object.entries(known)) {
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
