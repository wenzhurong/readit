/**
 * Vendors third-party corpus inputs. Run once, then the results are committed and `npm test`
 * stays offline. Uses raw.githubusercontent.com, which is not on the REST API rate limit.
 *
 * LICENCE GATE: only permissive sources. `michelf/mdtest` is GPL-2.0 and must never be vendored
 * into this repo — readit is meant to be embedded by other projects and downstream legal will
 * block a GPL test corpus.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface VendorSource {
  /** Destination path relative to test/corpus/. */
  dest: string
  repo: string
  /** Full 40-char commit SHA. */
  ref: string
  path: string
  license: string
}

const DENIED_REPOS = ['michelf/mdtest']

export const REAL_WORLD_SOURCES: readonly VendorSource[] = [
  { dest: 'real-world/sindresorhus-is.md', repo: 'sindresorhus/is', ref: '7821031c66cdeb7256a0feb2d506535f9e84fcaf', path: 'readme.md', license: 'MIT' },
  { dest: 'real-world/tauri.md', repo: 'tauri-apps/tauri', ref: 'c0bd0d5a61eedba5c4783add24455c5028c6f390', path: 'README.md', license: 'Apache-2.0 OR MIT' },
  { dest: 'real-world/mermaid.md', repo: 'mermaid-js/mermaid', ref: '3d521b1ee5fc9079fe0659e776a1b2cdc37174b1', path: 'README.md', license: 'MIT' },
  { dest: 'real-world/markdown-it.md', repo: 'markdown-it/markdown-it', ref: '66ff3ada0c59d11819ca7ab40575d66f9c823fd2', path: 'README.md', license: 'MIT' },
  { dest: 'real-world/gitignore.md', repo: 'github/gitignore', ref: '57286c3887203259752b747db94e6c3ad10ec53d', path: 'README.md', license: 'CC0-1.0' },
  { dest: 'real-world/hast-util-sanitize.md', repo: 'syntax-tree/hast-util-sanitize', ref: '7f30d9e6261583efc544ff6a93ba54ca6e53e1b5', path: 'readme.md', license: 'MIT' },
]

export interface KarlcowSource {
  repo: string
  /** Full 40-char commit SHA. */
  ref: string
  /** Directory inside the repo holding the `.md` inputs. */
  dir: string
  license: string
}

export const KARLCOW: KarlcowSource = {
  repo: 'karlcow/markdown-testsuite',
  ref: '92d125d8d97f1c01191c84404b13319f60b38502',
  dir: 'tests',
  license: 'MIT',
}

export class LicenseError extends Error {}

export function assertLicenceAllowed(repo: string): void {
  if (DENIED_REPOS.includes(repo)) {
    throw new LicenseError(
      `refusing to vendor ${repo}: GPL-2.0. readit is embedded by third parties; a GPL test corpus is a downstream blocker.`,
    )
  }
}

export function rawUrl(repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path}`
}

export type TextFetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>

export async function vendorOne(source: VendorSource, corpusDir: string, fetchImpl: TextFetch): Promise<string> {
  assertLicenceAllowed(source.repo)
  const res = await fetchImpl(rawUrl(source.repo, source.ref, source.path))
  if (res.status !== 200) throw new Error(`${source.repo}/${source.path}: HTTP ${res.status}`)
  const body = await res.text()
  const file = join(corpusDir, source.dest)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, body, 'utf8')
  return file
}

export async function vendorRealWorld(corpusDir: string, fetchImpl: TextFetch): Promise<string[]> {
  const written: string[] = []
  for (const source of REAL_WORLD_SOURCES) written.push(await vendorOne(source, corpusDir, fetchImpl))
  await writeFile(
    join(corpusDir, 'real-world', 'PROVENANCE.json'),
    JSON.stringify(REAL_WORLD_SOURCES, null, 2) + '\n',
    'utf8',
  )
  return written
}

/** One entry of a GitHub `contents` API directory listing — only the fields this module reads. */
interface ContentsEntry {
  name: string
}

function isContentsEntry(value: unknown): value is ContentsEntry {
  return typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string'
}

/**
 * Vendors karlcow/markdown-testsuite's `tests/*.md` inputs (the adversarial corpus) through the
 * SAME assertLicenceAllowed() gate as vendorOne/vendorRealWorld, instead of the standalone
 * `vendor-karlcow.sh` git-clone script this replaces. That script hardcoded its GPL-2.0 avoidance
 * in a comment; a second, code-enforced vendoring path is exactly the parallel machinery the plan
 * forbids ("必须复用 Task 22 的 vendor-corpus.ts / oracle-refresh.ts 机制，不得另写并行机制") — and
 * the gap was live: if `DENIED_REPOS` is ever extended, the script would not have noticed.
 *
 * Lists `source.dir` via the `contents` API (a JSON directory listing, not the
 * `application/vnd.github.html` media type oracle-refresh.ts uses), then downloads each `.md`
 * entry plus the repo's `LICENSE.md` via `rawUrl`, mirroring vendorOne's fetch-injection shape so
 * this stays testable without the network. The pinned `?ref=` on both requests makes a
 * post-checkout SHA reconciliation (which the shell script needed, since git resolves refs
 * client-side) unnecessary here — GitHub resolves the ref server-side before this code ever runs.
 *
 * `source` defaults to `KARLCOW` — the real, only-ever-used-for-real value — and exists as a
 * parameter (rather than reading the module constant directly, the way vendorRealWorld reads
 * REAL_WORLD_SOURCES) purely so the licence gate can be exercised the same way vendorOne's is:
 * by calling this with a denied `source.repo` and asserting it refuses before `fetchImpl` runs.
 */
export async function vendorKarlcow(corpusDir: string, fetchImpl: TextFetch, source: KarlcowSource = KARLCOW): Promise<string[]> {
  assertLicenceAllowed(source.repo)

  const listRes = await fetchImpl(`https://api.github.com/repos/${source.repo}/contents/${source.dir}?ref=${source.ref}`)
  if (listRes.status !== 200) throw new Error(`${source.repo}/${source.dir}: HTTP ${listRes.status}`)
  const listing: unknown = JSON.parse(await listRes.text())
  if (!Array.isArray(listing)) throw new Error(`${source.repo}/${source.dir}: expected a directory listing array`)
  const mdNames = listing
    .filter(isContentsEntry)
    .map((e) => e.name)
    .filter((n) => n.endsWith('.md'))
    .sort()

  const destDir = join(corpusDir, 'adversarial', 'karlcow')
  await mkdir(destDir, { recursive: true })

  const written: string[] = []
  for (const name of mdNames) {
    const res = await fetchImpl(rawUrl(source.repo, source.ref, `${source.dir}/${name}`))
    if (res.status !== 200) throw new Error(`${source.repo}/${source.dir}/${name}: HTTP ${res.status}`)
    const file = join(destDir, name)
    await writeFile(file, await res.text(), 'utf8')
    written.push(file)
  }
  if (written.length !== 103) {
    throw new Error(`vendorKarlcow: expected 103 karlcow *.md inputs under ${source.dir}/, got ${written.length}`)
  }

  const licenseRes = await fetchImpl(rawUrl(source.repo, source.ref, 'LICENSE.md'))
  if (licenseRes.status !== 200) throw new Error(`${source.repo}/LICENSE.md: HTTP ${licenseRes.status}`)
  const licenseFile = join(destDir, 'LICENSE.txt')
  await writeFile(licenseFile, await licenseRes.text(), 'utf8')
  written.push(licenseFile)

  const provenanceFile = join(destDir, 'PROVENANCE.json')
  await writeFile(
    provenanceFile,
    JSON.stringify(
      { repo: source.repo, ref: source.ref, license: source.license, vendored: 'tests/*.md inputs only; .out expectations excluded' },
      null,
      2,
    ) + '\n',
    'utf8',
  )
  written.push(provenanceFile)

  return written
}
