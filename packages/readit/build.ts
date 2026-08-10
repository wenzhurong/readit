import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { LIGHT_DOM_CSS } from '@readit/element/styles'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, 'dist')
const req = createRequire(import.meta.url)

const ESM_ENTRIES = [
  { out: 'core', in: join(HERE, 'src/core.ts') },
  { out: 'element', in: join(HERE, 'src/element.ts') },
  { out: 'editor', in: join(HERE, 'src/editor.ts') },
  { out: 'plugins/math', in: join(HERE, 'src/plugins/math.ts') },
  { out: 'plugins/highlight', in: join(HERE, 'src/plugins/highlight.ts') },
] as const

/**
 * tsc 发出来的 .d.ts 里仍然写着 `@readit/core` 这类工作区说明符，而装包方那边不存在
 * 这些包（一切都被 esbuild 内联了）。这张表把它们改写成 dist/types 内的相对路径。
 * 表是封闭的：出现表外的说明符就抛错，因为「静默留一个解析不了的类型 import」
 * 恰好是 @arethetypeswrong 存在的理由。
 */
const WORKSPACE_TYPE_TARGETS: Readonly<Record<string, string>> = {
  '@readit/core': 'packages/core/src/index.js',
  '@readit/core/types': 'packages/core/src/types.js',
  '@readit/math': 'packages/math/src/index.js',
  '@readit/math/stylesheet': 'packages/math/src/svg-stylesheet.js',
  '@readit/math/introspect': 'packages/math/src/introspect.js',
  '@readit/element': 'packages/element/src/index.js',
  '@readit/element/styles': 'packages/element/src/styles.js',
  '@readit/highlight': 'packages/highlight/src/index.js',
  '@readit/editor': 'packages/editor/src/index.js',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function upTo(out: string): string {
  const depth = out.split('/').length - 1
  return depth === 0 ? '.' : new Array(depth).fill('..').join('/')
}

function rewriteWorkspaceSpecifiers(typesRoot: string): void {
  const unknown = new Set<string>()
  for (const file of walk(typesRoot)) {
    if (!file.endsWith('.d.ts')) continue
    const before = readFileSync(file, 'utf8')
    const after = before.replace(/(["'])(@readit\/[^"']+)\1/g, (whole, quote: string, spec: string) => {
      const target = WORKSPACE_TYPE_TARGETS[spec]
      if (target === undefined) {
        unknown.add(spec)
        return whole
      }
      const rel = relative(dirname(file), join(typesRoot, ...target.split('/'))).split(sep).join('/')
      return `${quote}${rel.startsWith('.') ? rel : `./${rel}`}${quote}`
    })
    if (after !== before) writeFileSync(file, after, 'utf8')
  }
  if (unknown.size > 0) {
    throw new Error(
      `未登记的工作区说明符出现在 .d.ts 里：${[...unknown].join(', ')}。` +
        '把它加进 build.ts 的 WORKSPACE_TYPE_TARGETS——否则装包方拿到的类型解析不了。',
    )
  }
}

/**
 * 从 esbuild 的 metafile 里收集它自己判定为「外部、没有内联」的说明符——这是权威来源，
 * 不是从产物文本里猜。`bundle:true` 且没有传 `external`，esbuild 在解析不了一个说明符时
 * 会直接让 build() 抛错；它能走到 metafile 里、还被标 external:true 的，只有一种情况：
 * platform:'node' 对 Node 内置模块（`node:*`）的自动外部化。那些在任何 Node 运行时里
 * 天生可解析，不需要再核实；除此之外出现的任何一条都是真问题。
 */
function collectExternalImports(metafile: esbuild.Metafile): string[] {
  const out = new Set<string>()
  for (const output of Object.values(metafile.outputs)) {
    for (const imp of output.imports) {
      if (imp.external === true) out.add(imp.path)
    }
  }
  return [...out]
}

/** .d.ts 里 `from "..."` 系列引用的目标说明符，仅取相对路径那些（用于往下爬闭包）。 */
function relativeSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)].map((m) => m[1]!)
}

/** 同一路正则，但只要非相对（裸）说明符——那些才是「装包方解析不了」的候选。 */
function bareSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+["']([^"'.][^"']*)["']/g)].map((m) => m[1]!)
}

/**
 * 从发布入口出发，顺着 .d.ts 的相对 `from "./x.js"` 说明符爬出真正可达的声明子树。
 *
 * tsc 按 rootDir 镜像了 tsconfig.build.json include 里五个包的整棵 src/——那远大于
 * 「五个入口实际导出的类型用得到的文件」：例如 highlight 内部 serialize.ts 从 'hast'
 * 取类型，但 createShikiHighlighter/createStarryNightHighlighter 的导出签名都不引用它
 * （返回类型显式标注为 core 的 Highlighter），所以它从未被任何发布入口的类型引用到。
 * 对着整棵镜像树做裸说明符扫描会把这类「镜像了、但没人会走到」的内部文件也算进来，
 * 那既不是 attw 会检查的面，也不是任何装包方的类型解析真的会踩到的地方。
 * 只扫这里算出的可达闭包，检查的就正是「宿主 `import { mount } from 'readit/element'`
 * 之后，它的类型检查器会不会走到一个解析不了的说明符」这件事本身。
 */
function typesClosure(entryFiles: readonly string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...entryFiles]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const dir = dirname(file)
    for (const spec of relativeSpecifiers(readFileSync(file, 'utf8'))) {
      queue.push(resolve(dir, spec).replace(/\.js$/, '.d.ts'))
    }
  }
  return seen
}

function assertSelfContained(esmMeta: esbuild.Metafile, cjsMeta: esbuild.Metafile): void {
  const runtimeOffenders = [...collectExternalImports(esmMeta), ...collectExternalImports(cjsMeta)].filter(
    (spec) => !spec.startsWith('node:'),
  )

  const typeEntries = [...ESM_ENTRIES.map(({ out }) => join(DIST, `${out}.d.ts`)), join(DIST, 'cjs/core.d.ts')]
  const typeOffenders: string[] = []
  for (const file of typesClosure(typeEntries)) {
    for (const spec of bareSpecifiers(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('node:')) typeOffenders.push(`${relative(DIST, file)} → ${spec}`)
    }
  }

  if (runtimeOffenders.length > 0 || typeOffenders.length > 0) {
    throw new Error(
      '发布产物里残留了裸模块说明符，装包方解析不了（它的 dependencies 是空的）：\n' +
        [...runtimeOffenders.map((s) => `[runtime] ${s}`), ...typeOffenders.map((s) => `[types] ${s}`)].join('\n'),
    )
  }
}

export async function buildDist(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(DIST, { recursive: true })

  // 1. ESM 五入口 + 代码分割。splitting 让 element → editor 的动态 import 落在包内相对
  //    路径上，宿主不需要解析任何裸说明符，四个大件仍是四个互相独立的动态 import（§2.1）。
  const esmResult = await esbuild.build({
    entryPoints: [...ESM_ENTRIES],
    outdir: DIST,
    bundle: true,
    splitting: true,
    format: 'esm',
    // platform:'neutral' 不注入 'browser' 条件：starry-night 因此拿到同构入口，
    // onig.wasm 的位置由 createStarryNightHighlighter 的必填 onigWasmUrl 决定，
    // 而不是由打包条件偷偷决定（SPEC §5.2 的必做项）。
    platform: 'neutral',
    // neutral 会把 mainFields 清空，js-yaml 这类只有 main/module 的包会解析不到。
    mainFields: ['module', 'main'],
    conditions: ['import'],
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    metafile: true,
  })

  // 2. CJS 只有 '.'。platform:'node' 是必须的——只有 node 平台下 esbuild 才追加
  //    `0 && (module.exports = {...})` 注解，cjs-module-lexer 靠它才看得见具名导出。
  const cjsResult = await esbuild.build({
    entryPoints: [{ out: 'core', in: join(HERE, 'src/core.ts') }],
    outdir: DIST,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node22'],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    metafile: true,
  })

  // 3. CSS 的第二形态。第一形态（JS 字符串）已随 src/element.ts 被内联进 dist/element.js。
  writeFileSync(join(DIST, 'readit.css'), LIGHT_DOM_CSS, 'utf8')

  // 4. 声明。用 typescript/lib/tsc.js 而不是 .bin/tsc：Windows 上 spawn .cmd 需要 shell。
  execFileSync(
    process.execPath,
    [req.resolve('typescript/lib/tsc.js'), '-p', join(HERE, 'tsconfig.build.json')],
    { stdio: 'inherit' },
  )
  rewriteWorkspaceSpecifiers(join(DIST, 'types'))

  // 5. 入口 .d.ts 指向 facade 自己那份声明，而不是各包的 index——JS 入口与类型入口
  //    因此永远源自同一个文件，不可能分叉。
  for (const { out } of ESM_ENTRIES) {
    writeFileSync(
      join(DIST, `${out}.d.ts`),
      `export * from '${upTo(out)}/types/packages/readit/src/${out}.js'\n`,
      'utf8',
    )
  }

  // 6. CJS 味的声明树。用嵌套 package.json 标记模块格式，而不是把整棵树改名成 .d.cts +
  //    重写每一个相对说明符的扩展名：改写点越多越容易漏一个。TypeScript、publint、
  //    @arethetypeswrong 三者都按「最近的 package.json」判定格式，这个标记对三者同时生效。
  cpSync(join(DIST, 'types'), join(DIST, 'cjs/types'), { recursive: true })
  writeFileSync(join(DIST, 'cjs/package.json'), '{\n  "type": "commonjs"\n}\n', 'utf8')
  writeFileSync(join(DIST, 'cjs/core.d.ts'), "export * from './types/packages/readit/src/core.js'\n", 'utf8')

  assertSelfContained(esmResult.metafile, cjsResult.metafile)
}

/**
 * `npm run build`（根与本包的 script 都是 `vite-node build.ts`）需要这个模块被直接执行时
 * 真的跑起来——`vite-node` 只是求值这个文件，不会替我们调用具名导出。但
 * `test/global-setup.ts` 也 `import { buildDist } from '../build.js'`，并且自己显式调用
 * 一次；如果这里无条件调用，globalSetup 场景下 buildDist() 会被跑两遍。
 * `process.env.VITEST` 由 vitest 在求值 globalSetup 之前就置为 'true'（经验证，
 * 覆盖 globalSetup 本身运行的那个 Node 进程），直接脚本执行时这个变量不存在，
 * 用它来分辨两条路径，不依赖 `vite-node` 对 `process.argv[1]` 的处理方式
 * （它把入口路径整个吃掉，不落在 argv 里，`import.meta.url === pathToFileURL(argv[1])`
 * 那套惯用法在 vite-node 下不成立）。
 */
if (process.env.VITEST === undefined) {
  await buildDist()
}
