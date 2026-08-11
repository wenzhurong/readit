// 一个不知道 readit 是 monorepo 的宿主。它只知道自己 npm install 了一个包。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { render, scan } from 'readit'

const SRC = 'hello **world**\n'

const esmHtml = render(SRC)
const scanned = scan(SRC, 'github')

// 只用 --no-experimental-require-module 起这个脚本才走真正的 require 条件解析到
// dist/core.cjs。默认（Node 22.12+）require(esm) 已经稳定打开，'.' 的 exports 映射里
// "module-sync" 排在 "import"/"require" 前面，require('readit') 会命中 "module-sync"
// 同步加载 dist/core.js（ESM 那份），跟上面 esmHtml 拿到的是**同一个模块实例**——
// esmHtml/cjsHtml 的比对因此永远不可能红，这条门就没有真的验过 exports.require 那个
// 分支（也就没验过 Task 9 那次真实抓到的 bug 藏身的地方）。resolvedTo 一并回报，
// 让测试能断言这次真的走了 dist/core.cjs 而不是自我比较。
const require = createRequire(import.meta.url)
const resolvedTo = require.resolve('readit')
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

process.stdout.write(JSON.stringify({ esmHtml, cjsHtml, resolvedTo, scanned, stylesBytes, subpaths }))
