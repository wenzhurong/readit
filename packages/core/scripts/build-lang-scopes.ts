/**
 * Regenerates `packages/core/data/lang-scopes.json`: fence info string ->
 * TextMate scope name.
 *
 * GitHub's blob-view code wrapper class is `highlight-` + the grammar's
 * TextMate scope with dots turned into dashes (`source.js` ->
 * `highlight-source-js`, `text.html.basic` -> `highlight-text-html-basic`).
 * `@wooorm/starry-night` ships exactly the grammar set GitHub uses, so its
 * `all` export is the offline source of truth for the mapping.
 *
 * Network-free. Requires the devDependency `@wooorm/starry-night@3.10.0`.
 *
 *   npx tsx packages/core/scripts/build-lang-scopes.ts
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { all } from '@wooorm/starry-night'

const OUT = path.resolve(fileURLToPath(new URL('../data/lang-scopes.json', import.meta.url)))

const map: Record<string, string> = {}
for (const grammar of all) {
  for (const name of grammar.names ?? []) {
    if (!(name in map)) map[name] = grammar.scopeName
  }
}

const sorted: Record<string, string> = {}
// map[key] is always present here (key comes from Object.keys(map)); the
// assertion exists only to satisfy noUncheckedIndexedAccess.
for (const key of Object.keys(map).sort()) sorted[key] = map[key]!

await writeFile(OUT, `${JSON.stringify(sorted, null, 0)}\n`)
console.error(`wrote ${Object.keys(sorted).length} names to ${OUT}`)
