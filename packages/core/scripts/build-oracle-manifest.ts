/**
 * Regenerates test/oracle-manifest.json from the current corpus file list plus a pinned self
 * repo/ref (SPEC 4.2 chicken-and-egg: the contents endpoint only serves committed files, so the
 * ref here must always be a merged/pushed commit SHA, never a branch — buildSelfTargets and
 * oracleUrl both enforce that downstream).
 *
 * Hand-run whenever the corpus gains, loses or renames a file. Not run automatically by
 * oracle-refresh.ts itself: keeping manifest generation and fixture fetching as two separate,
 * explicit steps means a corpus rename can be reviewed in a diff before it silently drops or
 * duplicates a fixture.
 *
 *   ORACLE_SELF_REPO=owner/repo ORACLE_SELF_REF=<40-char sha> \
 *     npx tsx packages/core/scripts/build-oracle-manifest.ts
 */
import { writeFile } from 'node:fs/promises'
import { discoverCorpus } from '../test/corpus-harness.js'
import { buildSelfTargets } from './oracle-refresh.js'

/** Path of the corpus directory inside the repo, as it appears in a GitHub `contents` URL. */
const PREFIX = 'packages/core/test/corpus'

export async function main(): Promise<number> {
  const repo = process.env.ORACLE_SELF_REPO ?? ''
  const ref = process.env.ORACLE_SELF_REF ?? ''
  if (repo === '' || ref === '') {
    process.stderr.write('ORACLE_SELF_REPO and ORACLE_SELF_REF are both required.\n')
    return 2
  }
  const names = discoverCorpus()
  const targets = buildSelfTargets(names, repo, ref, PREFIX)
  const manifestPath = new URL('../test/oracle-manifest.json', import.meta.url).pathname
  await writeFile(manifestPath, JSON.stringify(targets, null, 2) + '\n', 'utf8')
  process.stdout.write(`wrote ${targets.length} targets to ${manifestPath}\n`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code))
}
