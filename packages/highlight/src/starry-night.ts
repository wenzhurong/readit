import type { Highlighter } from '@readit/core/types'
import { common, createStarryNight } from '@wooorm/starry-night'
import { serializeFragment } from './serialize.js'

export interface OnigurumaOptions {
  getOnigurumaUrlFetch: () => URL
  getOnigurumaUrlFs?: () => URL
}

export interface StarryNightOptions {
  /**
   * onig.wasm 的绝对地址。**必填、无默认值**（P3）。
   *
   * starry-night 的默认浏览器路径硬编码 fetch('https://esm.sh/vscode-oniguruma@2
   * /release/onig.wasm')，必填是防这条覆写被忘记的结构手段。打包器场景传
   * `new URL('onig.wasm', import.meta.url).href`；Node 场景传
   * `pathToFileURL(...).href`。必须是绝对 URL，相对路径会在 `onigurumaOptions()`
   * 里当场抛出。
   */
  onigWasmUrl: string
}

/**
 * 把一个 onig.wasm 地址翻成 starry-night 的 Options。
 *
 * starry-night 的默认浏览器路径**硬编码** fetch('https://esm.sh/vscode-oniguruma@2
 * /release/onig.wasm')。不覆写就直接违反离线约束，而 Node 档走的是文件系统加载器，
 * 所以在联网开发机上、甚至在纯 Node 测试里都永远测不出来。P3 把 onigWasmUrl 设成
 * 必填就是防它被忘记的结构手段；test/onig-wasm-offline.test.ts 是防它被写错的那层。
 *
 * 单独导出（不进 index.ts）是为了让那条测试能把这个对象喂给 starry-night 自己的
 * 浏览器加载器，验证的是它真正消费的形状，而不是我们对键名的猜测。
 */
export function onigurumaOptions(onigWasmUrl: string): OnigurumaOptions {
  let url: URL
  try {
    url = new URL(onigWasmUrl)
  } catch {
    throw new TypeError(
      `createStarryNightHighlighter: onigWasmUrl must be an absolute URL, got ${JSON.stringify(onigWasmUrl)}. ` +
        "In a bundler: new URL('onig.wasm', import.meta.url).href. In Node: pathToFileURL(...).href.",
    )
  }
  const options: OnigurumaOptions = { getOnigurumaUrlFetch: () => url }
  // Node 档的加载器走 fs.readFile(url)，只吃 file:。非 file: 时留空，让它落回
  // starry-night 自带的默认值（node_modules 里那份），那条路径本来就是本地且离线的。
  if (url.protocol === 'file:') options.getOnigurumaUrlFs = () => url
  return options
}

/**
 * 桌面壳默认：starry-night 3.10.0，发 GitHub 真实的 pl-* class + Primer 变量。
 *
 * 语法集固定为 `common`（34 条，实测 269.1 KB gzip，桌面壳从本地磁盘读，带宽成本≈0）。
 * 不做按需注册：register() 是 async，而 P3 要求 highlight() 纯同步，所以语法集只能
 * 在工厂期定死。要更大的集合是 M6 的事，见「新增契约提案」。
 */
export async function createStarryNightHighlighter(opts: StarryNightOptions): Promise<Highlighter> {
  const starryNight = await createStarryNight(common, onigurumaOptions(opts.onigWasmUrl))

  // 唯一的判定来源：highlight() 通过调它而不是重算 flagToScope() 来决定要不要
  // 返回 null，这样「highlight() 返回 null 当且仅当 !supports()」由构造保证。
  function scopeFor(lang: string): string | undefined {
    return starryNight.flagToScope(lang)
  }

  return {
    supports(lang: string): boolean {
      return scopeFor(lang) !== undefined
    },
    highlight(code: string, lang: string): string | null {
      const scope = scopeFor(lang)
      if (scope === undefined) return null
      return serializeFragment(starryNight.highlight(code, scope).children)
    },
  }
}
