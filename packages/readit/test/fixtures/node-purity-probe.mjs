// 在一个干净的 Node realm 里跑：没有 vitest 的 transform，没有 setupFiles，
// 就是一个 SSR 宿主 import 'readit' 时会得到的东西。
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const touched = []
for (const name of ['document', 'window', 'navigator']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      touched.push({ name, stack: new Error(`read ${name}`).stack ?? '' })
      return undefined
    },
    set() {
      touched.push({ name: `${name} (write)`, stack: new Error(`write ${name}`).stack ?? '' })
    },
  })
}

const [, , esmPath, cjsPath] = process.argv

const SRC = [
  '# Title',
  '',
  'hello **world** :shipit: and <span>raw html</span>',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  'Inline $x^2$ math, degraded because math is null.',
  '',
  '<div align="center"><img src="a.png" height="150"></div>',
  '',
].join('\n')

const esm = await import(pathToFileURL(esmPath).href)
// 只调 render/scan，不调 prepare：prepare 会动态 import 数学包，那不是 '.' 的急加载图，
// 把它算进来测的就不是这条边界了。
const esmHtml = esm.render(SRC)
const scanned = esm.scan(SRC, 'github')

const require = createRequire(pathToFileURL(cjsPath).href)
const cjsHtml = require(cjsPath).render(SRC)

process.stdout.write(JSON.stringify({ touched, esmHtml, cjsHtml, scanned }))
