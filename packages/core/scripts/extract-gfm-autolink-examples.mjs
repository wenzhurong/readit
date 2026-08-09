// Extract the 11 "example autolink" cases from the GFM 0.29 spec.
// Pinned tag, not master: the file must not drift under the test suite.
// 2026-08-06 measured: sha256(spec.txt) =
//   7d8e5814befec287ac116786d81ff14e0adc9b13295b4494649e995408fd871c
import fs from 'node:fs'

const URL_ =
  'https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/spec.txt'

const res = await fetch(URL_)
if (res.status !== 200) throw new Error('HTTP ' + res.status + ' from ' + URL_)
const ct = res.headers.get('content-type') || ''
if (!ct.startsWith('text/plain')) throw new Error('unexpected content-type: ' + ct)
const spec = await res.text()

const re = /^`{32} example autolink\n([\s\S]*?)^\.\n([\s\S]*?)^`{32}$/gm
const out = []
let m
while ((m = re.exec(spec))) {
  out.push({
    markdown: m[1].replace(/→/g, '\t'),
    html: m[2].replace(/→/g, '\t'),
  })
}
if (out.length !== 11) throw new Error('expected 11 examples, got ' + out.length)

fs.mkdirSync('packages/core/test/fixtures', { recursive: true })
fs.writeFileSync(
  'packages/core/test/fixtures/gfm-autolink.json',
  JSON.stringify(out, null, 2) + '\n',
)
console.log('examples:', out.length)
