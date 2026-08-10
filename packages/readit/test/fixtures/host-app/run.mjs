// 一个不知道 readit 是 monorepo 的宿主。它只知道自己 npm install 了一个包。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, scan } from 'readit'

const SRC = 'hello **world**\n'

const esmHtml = render(SRC)
const scanned = scan(SRC, 'github')

const require = createRequire(import.meta.url)
const cjs = require('readit')
const cjsHtml = cjs.render(SRC)

const stylesUrl = import.meta.resolve('readit/styles.css')
const stylesBytes = readFileSync(fileURLToPath(stylesUrl), 'utf8').length

const subpaths = ['readit/element', 'readit/editor', 'readit/plugins/math', 'readit/plugins/highlight']
  .map((s) => {
    // 只解析不执行：这四条是浏览器专属的，在 Node 里执行没有意义，能解析到就证明映射对。
    try {
      return { subpath: s, resolved: import.meta.resolve(s).startsWith('file:') }
    } catch (err) {
      return { subpath: s, resolved: false, error: String(err) }
    }
  })

process.stdout.write(JSON.stringify({ esmHtml, cjsHtml, scanned, stylesBytes, subpaths }))
