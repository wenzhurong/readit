import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ELEMENT_CSS, LIGHT_DOM_CSS } from '@readit/element/styles'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(PKG_DIR, 'dist')
const read = (rel: string): string => readFileSync(join(DIST, rel), 'utf8')

interface Manifest {
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
  files: string[]
  sideEffects: string[]
  type: string
}
const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as Manifest

/** 从 exports 映射里收集所有 "./..." 形态的目标路径。 */
function exportTargets(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (node.startsWith('./')) out.push(node)
    return out
  }
  if (node !== null && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) exportTargets(v, out)
  }
  return out
}

/**
 * 顺着相对 import 把一个入口的产物闭包全读出来——只跟静态边（`from "..."` / 裸的
 * `import "..."`），不跟动态 `import(...)`。
 *
 * 这不是疏漏：`prepare()` 对 `@readit/math` 的加载本来就是动态 import
 * （`packages/core/src/prepare.ts` 的 `DEFAULT_LOADERS.math`），MathJax 的同构入口
 * 自带浏览器/Node 双适配器探测，字面出现 `typeof HTMLElement` 这种特征探测代码完全
 * 正常——但它只在调用方显式调用 `prepare()` 时才会被加载，不在 `render()` / `scan()`
 * 的急加载图里。Task 10 的 `node-purity-probe.mjs` 就是按这条边界设计的（它的注释
 * 明确写「只调 render/scan，不调 prepare：prepare 会动态 import 数学包，那不是 '.'
 * 的急加载图」）；这里的正则要求 `\s+`（keyword 与引号之间必须有空白）且不带 `\(?`，
 * 与那条边界对齐——否则这条结构面检查测的就不是 Task 10 那条行为面检查所说的同一件事。
 *
 * 压缩后的静态边（`export{...}from"./x.js"`、裸的 `import"./x.js"`）关键字与引号之间
 * 是零空白，所以不能用「必须有空白」去分辨；真正的分界是 `(`——动态 `import(...)` 在
 * 关键字后紧跟一个左括号，静态形式后面直接是引号。正则里不留 `\(?`，`\s*` 只吃空白不吃
 * 括号，`import("...")` 因此在「下一个字符必须是引号」这一步天然匹配失败。
 */
function bundleClosure(entryRel: string): string {
  const seen = new Set<string>()
  const queue = [entryRel]
  let text = ''
  while (queue.length > 0) {
    const rel = queue.pop()!
    if (seen.has(rel)) continue
    seen.add(rel)
    const body = read(rel)
    text += body
    for (const m of body.matchAll(/\b(?:from|import)\s*["'](\.[^"']*)["']/g)) {
      const dir = dirname(rel)
      queue.push(dir === '.' ? m[1]!.replace(/^\.\//, '') : `${dir}/${m[1]!.replace(/^\.\//, '')}`)
    }
  }
  return text
}

describe('exports 映射就是 SPEC §9.3 的那张表', () => {
  it('逐字段等于契约形状', () => {
    expect(manifest.exports).toEqual({
      '.': {
        types: './dist/core.d.ts',
        'module-sync': './dist/core.js',
        import: './dist/core.js',
        require: { types: './dist/cjs/core.d.ts', default: './dist/core.cjs' },
      },
      './element': { types: './dist/element.d.ts', import: './dist/element.js' },
      './editor': { types: './dist/editor.d.ts', import: './dist/editor.js' },
      './plugins/math': { types: './dist/plugins/math.d.ts', import: './dist/plugins/math.js' },
      './plugins/highlight': { types: './dist/plugins/highlight.d.ts', import: './dist/plugins/highlight.js' },
      './styles.css': './dist/readit.css',
      './package.json': './package.json',
    })
    expect(manifest.type).toBe('module')
    expect(manifest.sideEffects).toEqual(['*.css'])
    expect(manifest.files).toEqual(['dist'])
  })

  it('每一条目标路径都真的在磁盘上', () => {
    for (const target of exportTargets(manifest.exports)) {
      expect(existsSync(join(PKG_DIR, target)), target).toBe(true)
    }
  })

  it('发布产物运行时零依赖——宿主 fixture 要能在无出网环境里装上它', () => {
    expect(manifest.dependencies ?? {}).toEqual({})
  })
})

describe('CSS 双形态：一个源，两种交付', () => {
  it('./styles.css 与 LIGHT_DOM_CSS 逐字节相同', () => {
    expect(read('readit.css')).toBe(LIGHT_DOM_CSS)
  })

  it('shadow 那一份被内联成 JS 字符串，不是外部文件', () => {
    const element = bundleClosure('element.js')
    // 类字符串在字符串字面量里不会被 minify 改写，也不需要转义，是稳定的探针。
    const selectors = [...new Set([...ELEMENT_CSS.matchAll(/\.([a-zA-Z][\w-]{2,})/g)].map((m) => m[1]!))].slice(0, 20)
    expect(selectors.length, 'ELEMENT_CSS 里一个类选择器都没有，探针失效').toBeGreaterThan(0)
    for (const sel of selectors) expect(element, `.${sel} 不在 dist/element.js 里`).toContain(`.${sel}`)
  })

  it('全 dist 不出现 CSS module script —— 那会把 CSS import 属性的支持强加给每个宿主打包器', () => {
    for (const rel of ['core.js', 'element.js', 'editor.js', 'plugins/math.js', 'plugins/highlight.js']) {
      const text = read(rel)
      expect(text, rel).not.toMatch(/with\s*\{\s*type\s*:\s*["']css["']\s*\}/)
      expect(text, rel).not.toMatch(/(?<![@\w])(?:from|import)\s*\(?\s*["'][^"']*\.css["']/)
    }
  })
})

describe("'.' 入口不含任何浏览器专属内容（结构面；行为面见 Task 10 第三条门）", () => {
  it.each(['customElements', 'HTMLElement', 'adoptedStyleSheets', 'attachShadow'])(
    'core.js 的产物闭包里不出现 %s',
    (ident) => {
      expect(bundleClosure('core.js')).not.toContain(ident)
    },
  )
})

describe('CJS 只在 require 条件下存在，且带自己那一味的类型', () => {
  it('dist/cjs 用嵌套 package.json 声明 commonjs，而不是靠改扩展名', () => {
    expect(JSON.parse(read('cjs/package.json'))).toEqual({ type: 'commonjs' })
    expect(existsSync(join(DIST, 'cjs/core.d.ts'))).toBe(true)
  })

  it('CJS 产物带 esbuild 的具名导出注解，cjs-module-lexer 才看得见它们', () => {
    // platform:'node' 才会发这段注解；漏掉它，宿主的 `import { render } from 'readit'`
    // 在走 require 条件的打包器里只能拿到 default。压缩后关键字周围没有空格
    // （`0&&(module.exports=` 而不是 `0 && (module.exports =`），所以用容许空白的正则，
    // 不用逐字子串。
    expect(read('core.cjs')).toMatch(/0\s*&&\s*\(module\.exports\s*=/)
  })
})

describe('D2-9：@readit/core ↔ @readit/math 的循环工作区依赖', () => {
  it('math 对 core 是纯类型依赖，声明在 devDependencies 里', () => {
    const math = JSON.parse(
      readFileSync(join(PKG_DIR, '../math/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
    expect(math.dependencies['@readit/core']).toBeUndefined()
    expect(math.devDependencies['@readit/core']).toBe('0.0.0')
  })
})
