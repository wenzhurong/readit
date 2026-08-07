/**
 * Refreshes test/fixtures/**.html from the GitHub oracle (SPEC 4.2).
 *
 * NEVER runs on the normal test path. `npm test` is offline and asserts against the committed
 * fixtures only. This script is invoked by hand or by the nightly drift workflow.
 *
 *   GITHUB_TOKEN=ghp_… npx tsx packages/core/scripts/oracle-refresh.ts
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface OracleTarget {
  /** Fixture name; the fixture lands at test/fixtures/<name>.html */
  name: string
  /** owner/repo holding the committed source file */
  repo: string
  /** A full 40-char commit SHA. Branch names are forbidden: they are not reproducible. */
  ref: string
  /** Path of the source file inside the repo. */
  path: string
}

export interface OracleManifestEntry extends OracleTarget {
  /** Directory of `path`, used by the normaliser to canonicalise relative URLs. */
  dir: string
}

const SHA40 = /^[0-9a-f]{40}$/

export class OracleError extends Error {}

export function oracleUrl(target: OracleTarget): string {
  if (!SHA40.test(target.ref)) {
    throw new OracleError(
      `target "${target.name}": ref must be a full 40-char commit SHA, got "${target.ref}". ` +
        'Branch refs make the oracle non-reproducible.',
    )
  }
  const path = target.path.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${target.repo}/contents/${path}?ref=${target.ref}`
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/**
 * The guard that stops a 277-byte rate-limit JSON body being committed as expected output.
 * Checks status, media type and the shape of the body, in that order.
 */
export function assertOracleResponse(
  target: OracleTarget,
  status: number,
  contentType: string | null,
  body: string,
): void {
  if (status !== 200) {
    throw new OracleError(
      `target "${target.name}": expected HTTP 200, got ${status}. Body (first 200 chars): ${body.slice(0, 200)}`,
    )
  }
  // `split(';')` on any string (including '') always yields a non-empty array, so `[0]` is never
  // actually undefined here — but noUncheckedIndexedAccess cannot know that. The `?? ''` is a
  // guard the compiler requires, not a behavioral fallback: it can never fire in practice.
  const media = ((contentType ?? '').split(';')[0] ?? '').trim().toLowerCase()
  if (media !== 'application/vnd.github.html') {
    throw new OracleError(
      `target "${target.name}": expected Content-Type application/vnd.github.html, got "${contentType ?? '<none>'}". ` +
        `Body (first 200 chars): ${body.slice(0, 200)}`,
    )
  }
  if (!/^<div id="(file|readme)"/.test(body.trimStart())) {
    throw new OracleError(
      `target "${target.name}": body does not start with the <div id="file|readme"> shell. ` +
        `First 200 chars: ${body.slice(0, 200)}`,
    )
  }
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

export async function fetchOracle(target: OracleTarget, token: string, fetchImpl: FetchLike): Promise<string> {
  const res = await fetchImpl(oracleUrl(target), {
    headers: {
      Accept: 'application/vnd.github.html',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'readit-oracle-refresh',
    },
  })
  const body = await res.text()
  assertOracleResponse(target, res.status, res.headers.get('content-type'), body)
  return body
}

/**
 * The provenance record committed next to the fixtures. corpus.test.ts reads it to learn the
 * repo/ref/dir the normaliser needs for D-LINK / D-CAMO. Deliberately carries no timestamp:
 * a timestamp would churn on every refresh and make `git diff --exit-code` useless.
 */
export type OracleProvenance = Record<string, { repo: string; ref: string; path: string; dir: string }>

/**
 * All-or-nothing: every target is fetched and validated (via fetchOracle/assertOracleResponse)
 * before anything at all is written to `fixturesDir`. If any target fails, nothing lands on disk
 * — not even the fixtures for targets that already succeeded. The alternative (write each fixture
 * as it succeeds, provenance only at the end) leaves a batch that fails partway through with
 * fixtures on disk that oracle-provenance.json does not describe: a fixture with no matching
 * provenance entry is exactly the inconsistency the downstream corpus assertions would trip over.
 * Trading some wasted quota on a retry after a partial failure for that guarantee is the right
 * side of this task's core safety property to be strict about.
 */
export async function refreshAll(
  targets: readonly OracleTarget[],
  token: string,
  fixturesDir: string,
  fetchImpl: FetchLike,
): Promise<string[]> {
  const fetched: { target: OracleTarget; file: string; body: string }[] = []
  for (const target of targets) {
    const body = await fetchOracle(target, token, fetchImpl)
    fetched.push({ target, file: join(fixturesDir, `${target.name}.html`), body })
  }

  const written: string[] = []
  const provenance: OracleProvenance = {}
  for (const { target, file, body } of fetched) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, body, 'utf8')
    written.push(file)
    provenance[target.name] = { repo: target.repo, ref: target.ref, path: target.path, dir: dirOf(target.path) }
  }
  const sorted: OracleProvenance = {}
  for (const key of Object.keys(provenance).sort()) {
    // Every `key` here comes from Object.keys(provenance) itself, so the entry is always present;
    // the `!` documents that invariant for noUncheckedIndexedAccess rather than papering over a
    // real possibility of a missing entry (which would silently drop a fixture's provenance).
    sorted[key] = provenance[key]!
  }
  const provenanceFile = join(fixturesDir, 'oracle-provenance.json')
  await mkdir(fixturesDir, { recursive: true })
  await writeFile(provenanceFile, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
  written.push(provenanceFile)
  return written
}

/**
 * Chicken-and-egg resolution: the contents endpoint only serves committed files, so the authored
 * corpus can only be fetched after it is pushed. The refresh runbook passes the merged commit SHA
 * and this derives one target per corpus file.
 */
export function buildSelfTargets(
  corpusNames: readonly string[],
  repo: string,
  ref: string,
  prefix: string,
): OracleTarget[] {
  return corpusNames.map((name) => ({ name, repo, ref, path: `${prefix}/${name}.md` }))
}

/** Runtime shape check for one manifest entry — see the comment on `readManifest`. */
function isOracleTarget(value: unknown): value is OracleTarget {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.name === 'string' && typeof v.repo === 'string' && typeof v.ref === 'string' && typeof v.path === 'string'
}

/**
 * Task 23 hand-edits this manifest, so a malformed entry (typo'd or missing field) is validated
 * here, at the point where the file path and the bad entry's index are both still known —
 * `JSON.parse(...) as OracleTarget[]` would let a malformed entry through silently (TypeScript's
 * `as` is a compile-time-only assertion) and it would instead surface later as an obscure
 * `oracleUrl`/SHA40 failure, or not at all if the missing field happened not to be read.
 */
export async function readManifest(manifestPath: string): Promise<OracleManifestEntry[]> {
  const raw: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!Array.isArray(raw)) {
    throw new OracleError(`manifest "${manifestPath}": expected a JSON array of targets, got ${typeof raw}.`)
  }
  return raw.map((entry: unknown, i: number) => {
    if (!isOracleTarget(entry)) {
      throw new OracleError(
        `manifest "${manifestPath}": entry ${i} is not a valid OracleTarget ` +
          `(needs string name/repo/ref/path). Got: ${JSON.stringify(entry)}`,
      )
    }
    return { ...entry, dir: dirOf(entry.path) }
  })
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const token = process.env.GITHUB_TOKEN ?? ''
  if (token === '') {
    process.stderr.write(
      'GITHUB_TOKEN is required. Unauthenticated is 60 requests/hour and a burnt budget means a\n' +
        '403 lockout for 42 minutes. Create a fine-grained PAT with public read access.\n',
    )
    return 2
  }
  // Everything below can reject: a malformed manifest (readManifest), a non-200/wrong-media-type/
  // malformed-body response (refreshAll, via assertOracleResponse — precisely the scenario this
  // whole task exists to guard against), or a filesystem error. Without this try/catch, main()'s
  // caller sees a raw unhandled-rejection stack dump instead of an operator-facing message, on
  // the single most likely real failure this tool will hit. The corpus is still safe either way
  // (nothing is written on a rejection — see refreshAll) but the operator experience is not.
  try {
    const root = argv[0] ?? new URL('../test', import.meta.url).pathname
    const targets = await readManifest(join(root, 'oracle-manifest.json'))
    const written = await refreshAll(targets, token, join(root, 'fixtures'), globalThis.fetch as unknown as FetchLike)
    process.stdout.write(`refreshed ${written.length} fixtures\n`)
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`oracle refresh failed: ${message}\n`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code))
}
