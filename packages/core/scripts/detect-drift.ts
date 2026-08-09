/**
 * Reports whether a fixture refresh changed anything GitHub actually renders,
 * ignoring the three per-request salts. Drives `oracle-drift.yml`'s Detect-drift step.
 *
 * Usage:  tsx packages/core/scripts/detect-drift.ts
 *
 * Reads the pre-refresh bytes from git (`git show HEAD:<path>`) and compares them
 * against the working tree, salt-masked on both sides. Prints a per-file report and
 * exits 0 when there is no real drift, 1 when there is — so the workflow can branch
 * on the exit code instead of on `git diff`, which is non-empty every run.
 *
 * See salt-mask.ts for why this is masked rather than normalized.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { maskSalts } from './salt-mask.js'

const FIXTURES = 'packages/core/test/fixtures'

function changedFixturePaths(): string[] {
  const out = execFileSync('git', ['diff', '--name-only', '--', FIXTURES], { encoding: 'utf8' })
  return out.split('\n').filter((l) => l.endsWith('.html'))
}

function committedBytes(path: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' })
  } catch {
    return null // new fixture: no committed version to compare against
  }
}

function main(): number {
  const changed = changedFixturePaths()
  if (changed.length === 0) {
    process.stdout.write('no fixture bytes changed at all\n')
    return 0
  }

  const real: string[] = []
  const saltOnly: string[] = []
  const added: string[] = []

  for (const path of changed) {
    const before = committedBytes(path)
    if (before === null) {
      added.push(path)
      continue
    }
    const after = readFileSync(path, 'utf8')
    if (maskSalts(before) === maskSalts(after)) saltOnly.push(path)
    else real.push(path)
  }

  process.stdout.write(
    `${changed.length} fixture(s) changed raw bytes: ` +
      `${real.length} real drift, ${saltOnly.length} salt-only, ${added.length} new\n`,
  )
  for (const p of saltOnly) process.stdout.write(`  salt-only  ${p}\n`)
  for (const p of added) process.stdout.write(`  new        ${p}\n`)
  for (const p of real) process.stdout.write(`  DRIFT      ${p}\n`)

  // New fixtures are not drift — they arrive with a deliberate corpus addition, which
  // is a human action on a branch, not something the nightly refresh can produce.
  return real.length > 0 ? 1 : 0
}

process.exit(main())
