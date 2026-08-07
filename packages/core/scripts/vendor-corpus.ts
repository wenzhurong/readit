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

export const KARLCOW = {
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
