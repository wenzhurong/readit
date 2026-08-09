/**
 * Regenerates `packages/core/data/emoji.json` and `packages/core/data/emoji/*.png`.
 *
 * Network-only. NEVER run from the test path — the committed artefacts are the
 * contract; this script only refreshes them.
 *
 *   npx tsx packages/core/scripts/build-emoji.ts
 *
 * Why the `/emojis` PNG filename is not enough (measured 2026-08-06): deriving
 * the character from `unicode/<hex>.png` reproduces only 1690 of 1913 standard
 * shortcodes. The filename elides U+200D and U+FE0F, so `man_technologist`
 * (`1f468-1f4bb.png`) is really U+1F468 U+200D U+1F4BB, and `airplane`
 * (`2708.png`) is really U+2708 U+FE0F. 29 shortcodes are additionally wrapped
 * by GitHub in `<g-emoji class="g-emoji" alias="...">`. Both facts are only
 * observable in rendered output, so the character comes from POST /markdown.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.resolve(fileURLToPath(new URL('../data', import.meta.url)))
const IMG_DIR = path.join(DATA_DIR, 'emoji')
const BATCH = 300

interface EmojiData {
  source: string
  /**
   * shortcode -> the exact markup GitHub emits. Almost always the bare
   * character; for the shortcodes listed in `gEmoji` it also carries GitHub's
   * `<g-emoji class="g-emoji" alias="...">` wrapper, which GitHub applies to
   * *parts* of a sequence too (`:man_pilot:` -> `👨‍<g-emoji …>✈️</g-emoji>`).
   */
  unicode: Record<string, string>
  /** shortcodes whose markup contains at least one `<g-emoji>` wrapper */
  gEmoji: string[]
  /** shortcodes served as a bundled PNG under data/emoji/<name>.png */
  custom: string[]
}

async function getJson(url: string): Promise<Record<string, string>> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new Error(`GET ${url} -> Content-Type ${type}`)
  return (await res.json()) as Record<string, string>
}

/** Renders `:name:` for every name in `batch` and returns the emitted markup. */
async function renderShortcodes(batch: string[]): Promise<string[]> {
  const text = batch.map((n, i) => `MARK${i}END\n\n:${n}:`).join('\n\n')
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode: 'gfm' }),
  })
  if (!res.ok) throw new Error(`POST /markdown -> HTTP ${res.status}`)
  const html = await res.text()
  return batch.map((_, i) => {
    const from = html.indexOf(`MARK${i}END`)
    const to = i + 1 < batch.length ? html.indexOf(`MARK${i + 1}END`) : html.length
    const m = /<p>([\s\S]*?)<\/p>/.exec(html.slice(from, to))
    if (!m) throw new Error(`no paragraph for :${batch[i]}:`)
    return m[1]!
  })
}

const raw = await getJson('https://api.github.com/emojis')
const standard: string[] = []
const custom: string[] = []
for (const [name, url] of Object.entries(raw)) {
  ;(/\/unicode\/[0-9a-f-]+\.png/.test(url) ? standard : custom).push(name)
}
standard.sort()
custom.sort()
console.error(`standard=${standard.length} custom=${custom.length}`)

const unicode: Record<string, string> = {}
const gEmoji: string[] = []
for (let i = 0; i < standard.length; i += BATCH) {
  const batch = standard.slice(i, i + BATCH)
  const rendered = await renderShortcodes(batch)
  for (const [j, name] of batch.entries()) {
    const cell = rendered[j]!
    const bare = cell.replace(/<g-emoji class="g-emoji" alias="[^"]*">|<\/g-emoji>/g, '')
    if (bare.length === 0 || /[<>&]/.test(bare)) {
      throw new Error(`unexpected markup for :${name}: ${cell}`)
    }
    unicode[name] = cell
    if (cell !== bare) gEmoji.push(name)
  }
  console.error(`resolved ${Object.keys(unicode).length}/${standard.length}`)
}

await mkdir(IMG_DIR, { recursive: true })
for (const name of custom) {
  const url = raw[name]
  if (url === undefined) throw new Error(`missing url for custom emoji :${name}:`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`GET ${url} -> Content-Type ${type}`)
  await writeFile(path.join(IMG_DIR, `${name}.png`), Buffer.from(await res.arrayBuffer()))
}

const data: EmojiData = { source: 'https://api.github.com/emojis', unicode, gEmoji, custom }
await writeFile(path.join(DATA_DIR, 'emoji.json'), `${JSON.stringify(data, null, 0)}\n`)
console.error(`wrote ${path.join(DATA_DIR, 'emoji.json')}`)
