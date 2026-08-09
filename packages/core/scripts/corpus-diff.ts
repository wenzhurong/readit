/**
 * Print the current, uncapped diff between readit's render of a corpus file and its committed
 * oracle fixture — the tool `corpus.test.ts`'s ratchet-direction-3 failure message points at.
 *
 * The pin that direction 3 enforces is two integers. When it fires, a maintainer has to decide
 * whether the change is a new regression (fix it) or belongs to a cause already on the ledger
 * (re-pin it) — and before this existed there was nothing in the repo that could show them the
 * difference. Writing a throwaway script to answer that question is exactly the friction that
 * gets a pin re-pinned reflexively, which is the failure mode `{ hunks, edits }` was chosen to
 * avoid in the first place.
 *
 * Deliberately READ-ONLY. It prints a copy-pasteable block but never edits
 * `known-mismatches.json`: a one-key "make it green" command would restore the reflex this whole
 * mechanism exists to break. Re-pinning stays a deliberate, hand-made edit next to the prose that
 * has to justify it.
 *
 * Zero network — it reads the committed corpus and the committed fixtures, nothing else. Safe to
 * run at any time, including from inside the offline CI namespace.
 *
 *   npm run corpus:diff                        # every ledger entry, with drift flagged
 *   npm run corpus:diff -- real-world/mermaid  # one file, in full
 *   npm run corpus:diff -- --all               # every corpus file, ledger or not
 *
 * ## Exit codes
 *
 *   0  every selected file agrees with the ledger
 *   1  at least one disagreement: a pinned magnitude has drifted, a ledger entry now passes
 *      (direction 2), or a selected file mismatches with no entry at all
 *   2  bad arguments (a name that is not a corpus file)
 *
 * It signals. A diagnostic that prints "3 entr(y/ies) out of sync" and exits 0 is a diagnostic
 * that passes under `set -e`, and this file already had an exit-code contract (the `2` above), so
 * exiting 0 on a finding was the inconsistency rather than the policy. Signalling costs a
 * maintainer inspecting a known drift one line of npm exit-status noise; the alternative costs a
 * pipeline the whole finding. Note that the disagreements counted here are the same ones
 * `corpus.test.ts` fails on, so a non-zero exit is never news the suite did not already have — it
 * just means this tool can be used as a check as well as read as a report.
 */
import { render } from '../src/index.js'
import {
  type KnownMismatches,
  compareToFixture,
  diffHunks,
  diffShape,
  discoverCorpus,
  readCorpus,
  readFixture,
  readProvenance,
  shapeCarriesNoSignal,
} from '../test/corpus-harness.js'
import knownMismatchesJson from '../test/known-mismatches.json' with { type: 'json' }

const KNOWN = knownMismatchesJson as KnownMismatches
const NAMES = discoverCorpus()
const PROVENANCE = readProvenance()

const args = process.argv.slice(2)
const showAll = args.includes('--all')
const requested = args.filter((a) => !a.startsWith('--'))

const selected =
  requested.length > 0
    ? requested
    : showAll
      ? NAMES
      : NAMES.filter((n) => KNOWN[n] !== undefined)

const unknown = selected.filter((n) => !NAMES.includes(n))
if (unknown.length > 0) {
  console.error(`no such corpus file: ${unknown.join(', ')}`)
  console.error('Names look like "real-world/mermaid" or "gfm/tagfilter" (no .md).')
  process.exit(2)
}

let drifted = 0
let unrecorded = 0

for (const name of selected) {
  const provenance = PROVENANCE[name]
  if (provenance === undefined) {
    console.log(`\n### ${name}\n  no oracle provenance; run \`npm run oracle:refresh\` first.`)
    continue
  }
  const result = compareToFixture(
    render(readCorpus(name), { math: null, highlighter: null }),
    readFixture(name),
    provenance,
  )
  const entry = KNOWN[name]
  const measured = diffShape(result.actualLines, result.expectedLines)
  const hunks = diffHunks(result.actualLines, result.expectedLines)

  console.log(`\n${'='.repeat(78)}\n### ${name}`)
  if (result.equal) {
    console.log('  matches the oracle exactly.')
    if (entry !== undefined) {
      console.log('  ON THE LEDGER BUT PASSING — its debt is paid off; delete the entry (direction 2).')
      drifted += 1
    }
    continue
  }

  console.log(`  actual ${result.actualLines.length} lines · oracle ${result.expectedLines.length} lines`)
  console.log(`  measured: ${JSON.stringify(measured)}`)
  if (entry === undefined) {
    console.log('  NOT ON THE LEDGER — an unrecorded mismatch. It must be fixed, not pinned.')
    unrecorded += 1
  } else {
    const pinned = entry.diff
    const same = pinned.hunks === measured.hunks && pinned.edits === measured.edits
    console.log(`  recorded: ${JSON.stringify(pinned)}${same ? '  (in sync)' : '  <-- DRIFT'}`)
    if (!same) {
      drifted += 1
      if (pinned.edits === measured.edits) {
        console.log(
          '  NOTE: `edits` is unchanged and only `hunks` moved. `edits` is the same under every\n' +
            '  optimal alignment; `hunks` is not. Suspect a change to diffHunks\'s tie-break in\n' +
            '  corpus-harness.ts before suspecting the renderer.',
        )
      }
    }
  }

  if (shapeCarriesNoSignal(measured, result.actualLines, result.expectedLines)) {
    console.log(
      '  BLIND: no line of readit\'s output matches the oracle, so { hunks, edits } cannot see\n' +
        '  this file\'s content at all. It must pin `output` verbatim (direction 3b).',
    )
  }

  console.log(`\n  --- ${hunks.length} hunk(s) ---`)
  hunks.forEach((h, idx) => {
    console.log(
      `  hunk ${idx + 1}/${hunks.length} — actual line ${h.actualStart + 1}, oracle line ${h.expectedStart + 1} ` +
        `(-${h.removed.length} +${h.added.length})`,
    )
    for (const l of h.removed) console.log(`    - ${l}`)
    for (const l of h.added) console.log(`    + ${l}`)
  })

  console.log('\n  --- to re-pin, IF you have justified the change in the entry\'s prose ---')
  console.log(`  "diff": ${JSON.stringify(measured)}`)
  if (shapeCarriesNoSignal(measured, result.actualLines, result.expectedLines)) {
    console.log(`  "output": ${JSON.stringify(result.actualLines, null, 2).split('\n').join('\n  ')}`)
  }
}

if (drifted > 0) {
  console.log(`\n${drifted} entr(y/ies) out of sync with test/known-mismatches.json.`)
}
if (unrecorded > 0) {
  console.log(`${unrecorded} selected file(s) mismatch with no ledger entry at all.`)
}
if (drifted > 0 || unrecorded > 0) process.exit(1)
