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
