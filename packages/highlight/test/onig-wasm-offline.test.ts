import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { onigurumaOptions } from '../src/starry-night.js'

const require_ = createRequire(import.meta.url)

/** vscode-oniguruma 2.0.1 的 onig.wasm 绝对路径（starry-night 3.10.0 期望的正是这一版）。 */
const WASM_PATH = require_.resolve('vscode-oniguruma/release/onig.wasm')

/**
 * starry-night 的浏览器档 WASM 加载器。
 *
 * 它进不了包的 exports map（"./*" 映射到 "./lang/*.js"），所以只能按文件路径 import。
 * 必须按文件路径拿到它：Node 条件下 `#get-oniguruma` 解析到 get-oniguruma.fs.js，
 * 从磁盘读 wasm，**永远不会** fetch——这正是「在联网开发机上永远测不出来」的机制层
 * 解释，也是为什么单跑 createStarryNightHighlighter 证明不了任何事。
 */
async function loadBrowserLoader(): Promise<{
  getOniguruma: (options?: { getOnigurumaUrlFetch?: () => URL | Promise<URL> }) => Promise<Response>
}> {
  const root = path.dirname(require_.resolve('@wooorm/starry-night'))
  const href = pathToFileURL(path.join(root, 'lib', 'get-oniguruma.default.js')).href
  return (await import(/* @vite-ignore */ href)) as Awaited<ReturnType<typeof loadBrowserLoader>>
}

describe('starry-night 的 onig.wasm 默认浏览器路径', () => {
  it('不覆写就伸手去 esm.sh，且离线门当场把它按住', async () => {
    const { getOniguruma } = await loadBrowserLoader()
    await expect(getOniguruma()).rejects.toThrowError(
      /offline gate: fetch tried to reach https:\/\/esm\.sh\/vscode-oniguruma@2\/release\/onig\.wasm/,
    )
  })

  it('覆写后走本地地址，拿回的就是本地那份 onig.wasm 的字节', async () => {
    // 用 data: URL 而不是起本地服务器：hostname 为空串，离线门放行（isLocal('')），
    // 在 CI 的 `unshare --net` 空网络命名空间里也一样能跑。
    const bytes = readFileSync(WASM_PATH)
    const dataUrl = `data:application/wasm;base64,${bytes.toString('base64')}`
    const { getOniguruma } = await loadBrowserLoader()
    const res = await getOniguruma(onigurumaOptions(dataUrl))
    expect(res.ok).toBe(true)
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(bytes.byteLength)
  })
})

describe('onigurumaOptions', () => {
  it('永远设 getOnigurumaUrlFetch', () => {
    const opts = onigurumaOptions('https://cdn.example.test/onig.wasm')
    expect(opts.getOnigurumaUrlFetch().href).toBe('https://cdn.example.test/onig.wasm')
  })

  it('只有 file: 才顺带设 getOnigurumaUrlFs', () => {
    // Node 档的 fs.readFile(url) 只吃 file:。给它一个 https: 会炸，而 starry-night
    // 自带的 fs 默认值（resolve('vscode-oniguruma') 旁边那份）本来就是本地且离线的，
    // 所以非 file: 时让它落回默认值，比强塞一个读不了的 URL 正确。
    expect(onigurumaOptions('https://cdn.example.test/onig.wasm').getOnigurumaUrlFs).toBeUndefined()
    const fileUrl = pathToFileURL(WASM_PATH).href
    expect(onigurumaOptions(fileUrl).getOnigurumaUrlFs?.().href).toBe(fileUrl)
  })

  it('相对路径当场报错，而不是等到运行时拿不到 WASM', () => {
    expect(() => onigurumaOptions('/onig.wasm')).toThrowError(/must be an absolute URL/)
  })
})
