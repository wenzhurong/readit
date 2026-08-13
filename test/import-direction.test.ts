import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * P1 的 import 方向守卫。
 *
 * 为什么用 TypeScript 的 AST 而不是正则：方向的判定完全取决于「值 / 仅类型 / 仅动态」
 * 这三分，而这三分在语法上分散在 `import type`、`import { type X }`、`export type … from`、
 * `import()` 五六种形态里。正则要么漏判（`import { type A, B }` 里有值导入）、要么误判
 * （字符串里出现 "import"）。ts 已经是本仓库的 devDependency，用它零新增依赖。
 *
 * 扫描面是 packages/star/src —— 会被打进发布产物的那部分。测试与脚本不进这张图，
 * 因为它们不发布；边界是关于「装进宿主的模块图」的。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const PACKAGES = [
  '@readit/core',
  '@readit/math',
  '@readit/element',
  '@readit/highlight',
  '@readit/editor',
  '@readit/mermaid',
  '@readit/find',
  // §0 A7：Task 9 建的发布外观包，此刻还没有目录，这里先占位。
  // 不占位的话，Task 9 一落地 packages/readit，"a new package cannot slip past the
  // table" 那条断言就会因为磁盘上突然多出一个未登记目录而变红——而 Task 9 的任务书
  // 并不知道要回头改这份表。`packageOf()` 的现有实现（裸 specifier 走 else 分支）
  // 已经能匹配无斜杠的包名，不用改代码，只需要把 'readit' 填进这三张表。
  'readit',
] as const
type PackageName = (typeof PACKAGES)[number]

const DIRECTORY: Record<PackageName, string> = {
  '@readit/core': 'packages/core',
  '@readit/math': 'packages/math',
  '@readit/element': 'packages/element',
  '@readit/highlight': 'packages/highlight',
  '@readit/editor': 'packages/editor',
  '@readit/mermaid': 'packages/mermaid',
  '@readit/find': 'packages/find',
  readit: 'packages/readit',
}

// 只扫描已经在磁盘上落地的包。'readit' 现在只是表里的占位，Task 9 创建
// packages/readit 之后，这个集合会自动把它纳入——不用回头改这份测试。
const MATERIALIZED = PACKAGES.filter((name) => existsSync(join(ROOT, DIRECTORY[name])))

type ImportKind = 'value' | 'type' | 'dynamic'

/**
 * P1 的方向表，唯一真源。没列出的组合 = 完全禁止。
 *
 * core -> math 是既有的运行时动态 import（prepare.ts 的 DEFAULT_LOADERS），真实且允许。
 * math -> core 只允许 type：这就是 D2-9。它今天在源码层面已经成立（`import type`），
 * 错的是 package.json 把它声明成了运行时依赖 —— 见下面的 manifest 断言。
 *
 * element -> editor 含 'type'：§0 A7 把 P1 原文「仅动态 import」明确为「运行时仅动态；
 * import type 允许」。禁掉 import type 的唯一替代是在 element 里重抄一遍 P2 的类型，
 * 那正是这份契约要防的漂移。
 */
const ALLOWED: Record<PackageName, Partial<Record<PackageName, readonly ImportKind[]>>> = {
  '@readit/core': { '@readit/math': ['dynamic'] },
  '@readit/math': { '@readit/core': ['type'] },
  '@readit/highlight': { '@readit/core': ['type'] },
  '@readit/editor': { '@readit/core': ['type'] },
  '@readit/mermaid': {},
  '@readit/find': {},
  '@readit/element': {
    '@readit/core': ['value', 'type', 'dynamic'],
    '@readit/highlight': ['type'],
    '@readit/mermaid': ['type'],
    '@readit/editor': ['type', 'dynamic'],
  },
  // Task 9 落地：readit 是发布外观包，src/{core,element,editor,plugins/math,
  // plugins/highlight,plugins/mermaid}.ts 各自对应一个 `export * from '@readit/…'`，
  // 是静态值导出（esbuild 在构建期整体内联，不是运行时的裸 import）。
  readit: {
    '@readit/core': ['value'],
    '@readit/element': ['value'],
    '@readit/editor': ['value'],
    '@readit/highlight': ['value'],
    '@readit/math': ['value'],
    '@readit/mermaid': ['value'],
  },
}

interface ImportRef {
  specifier: string
  kind: ImportKind
  line: number
}

function allSpecifiersTypeOnly(clause: ts.ImportClause | ts.NamedExportBindings | undefined): boolean {
  if (clause === undefined) return false
  if (ts.isImportClause(clause)) {
    // 有默认导入名 = 有值导入，无论 named 部分怎么写。
    if (clause.name !== undefined) return false
    const bindings = clause.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) return false
    return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)
  }
  if (ts.isNamedExports(clause)) {
    return clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)
  }
  return false
}

export function collectImports(source: string, fileName: string): ImportRef[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const refs: ImportRef[] = []
  const push = (specifier: ts.Expression, kind: ImportKind): void => {
    if (!ts.isStringLiteralLike(specifier)) return
    const line = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1
    refs.push({ specifier: specifier.text, kind, line })
  }
  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const typeOnly = node.importClause?.isTypeOnly === true || allSpecifiersTypeOnly(node.importClause)
      push(node.moduleSpecifier, typeOnly ? 'type' : 'value')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const typeOnly = node.isTypeOnly || allSpecifiersTypeOnly(node.exportClause)
      push(node.moduleSpecifier, typeOnly ? 'type' : 'value')
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      push(node.moduleReference.expression, node.isTypeOnly ? 'type' : 'value')
    } else if (ts.isCallExpression(node)) {
      const arg0 = node.arguments[0]
      if (arg0 !== undefined) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) push(arg0, 'dynamic')
        // 本仓库是 ESM，但 require() 若混进来它同样是运行时边，按 value 记。
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') push(arg0, 'value')
      }
    } else if (ts.isImportTypeNode(node)) {
      // `type X = import('pkg').Foo` / `(x: import('pkg').Foo)` / `typeof import('pkg')`——
      // 内联类型引用，产出 ts.SyntaxKind.ImportType 节点，不是 CallExpression，
      // 上面那个分支完全看不见它。它在语法上只可能是类型位置，运行时不会执行，
      // 一律记 'type'（跟 `import type { … } from …` 同一档）。
      const arg = node.argument
      if (ts.isLiteralTypeNode(arg)) push(arg.literal, 'type')
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return refs
}

function packageOf(specifier: string): PackageName | null {
  const parts = specifier.split('/')
  const name = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  return (PACKAGES as readonly string[]).includes(name) ? (name as PackageName) : null
}

interface FileReport {
  violations: string[]
  crossEdges: number
}

export function inspect(from: PackageName, fileRelPath: string, source: string): FileReport {
  const violations: string[] = []
  let crossEdges = 0
  const ownDir = join(ROOT, DIRECTORY[from]) + sep
  for (const ref of collectImports(source, fileRelPath)) {
    const where = `${fileRelPath}:${ref.line}`
    if (ref.specifier.startsWith('.')) {
      // 相对路径是绕开包名守卫最省事的办法，所以它也要被守。
      const target = resolve(join(ROOT, fileRelPath), '..', ref.specifier)
      if (!target.startsWith(ownDir)) {
        violations.push(`${where} 相对路径 ${ref.specifier} 越出了 ${from} 的包目录——绕开包名等于绕开 P1`)
      }
      continue
    }
    const to = packageOf(ref.specifier)
    if (to === null || to === from) continue
    crossEdges += 1
    const kinds = ALLOWED[from][to] ?? []
    if (!kinds.includes(ref.kind)) {
      const allowed = kinds.length === 0 ? '完全禁止' : kinds.join(' / ')
      violations.push(`${where} ${from} -> ${to} 是 ${ref.kind} 导入，P1 允许的是：${allowed}`)
    }
  }
  return { violations, crossEdges }
}

function tsFilesUnder(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out = out.concat(tsFilesUnder(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

interface ScanSummary {
  violations: string[]
  fileCount: number
  crossEdges: number
}

function scanAll(): ScanSummary {
  const summary: ScanSummary = { violations: [], fileCount: 0, crossEdges: 0 }
  for (const from of MATERIALIZED) {
    const srcDir = join(ROOT, DIRECTORY[from], 'src')
    for (const file of tsFilesUnder(srcDir)) {
      summary.fileCount += 1
      const rel = file.slice(ROOT.length)
      const report = inspect(from, rel, readFileSync(file, 'utf8'))
      summary.violations.push(...report.violations)
      summary.crossEdges += report.crossEdges
    }
  }
  return summary
}

describe('the scanner can tell the three import kinds apart', () => {
  // 守卫的全部力量都压在这个分类上。它错了，上面那张表就是装饰。
  it('classifies every import form the language offers', () => {
    const source = [
      "import type { A } from 'a'",
      "import { type B, type C } from 'b'",
      "import { type D, E } from 'c'",
      "import F, { type G } from 'd'",
      "import 'e'",
      "import * as H from 'f'",
      "export type { I } from 'g'",
      "export { type J } from 'h'",
      "export { K } from 'i'",
      "export * from 'j'",
      "const p = import('k')",
      "const q = require('l')",
      "type M = import('m').N",
    ].join('\n')
    expect(collectImports(source, 'probe.ts').map((ref) => `${ref.specifier}:${ref.kind}`)).toEqual([
      'a:type',
      'b:type',
      'c:value',
      'd:value',
      'e:value',
      'f:value',
      'g:type',
      'h:type',
      'i:value',
      'j:value',
      'k:dynamic',
      'l:value',
      'm:type',
    ])
  })

  /**
   * 终审发现的盲区：`type X = import('pkg').Foo` 产出 ts.SyntaxKind.ImportType
   * 节点，不是 CallExpression——上面那条「classifies every import form」加了
   * 一行就够分类，但分类对不等于守卫真的抓得到违规，这里单独钉一条用
   * `inspect()` 走完整路径的场景。用真实 typescript 包解析验证过：改动前
   * `collectImports()` 对这种写法记录零条目，不是分类错，是完全看不见——
   * `packages/core/src/*.ts` 里写 `type X = import('@readit/math').Y`
   * 这种 P1 明令只许 dynamic 的边会被这张网完全漏过。
   */
  it('flags an inline `type X = import(...)` reference the same as a normal import', () => {
    const report = inspect(
      '@readit/core',
      'packages/core/src/probe.ts',
      "type X = import('@readit/math').Foo\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('@readit/core -> @readit/math 是 type 导入，P1 允许的是：dynamic')
  })

  it('also passes an inline `import(...)` type reference on an edge P1 allows', () => {
    const report = inspect(
      '@readit/math',
      'packages/math/src/probe.ts',
      "type X = import('@readit/core').Foo\n",
    )
    expect(report.violations).toEqual([])
    expect(report.crossEdges).toBe(1)
  })

  it('flags a value import where P1 allows only types', () => {
    const report = inspect(
      '@readit/highlight',
      'packages/highlight/src/probe.ts',
      "import { render } from '@readit/core'\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('@readit/highlight -> @readit/core 是 value 导入')
  })

  it('flags a static import where P1 allows only a dynamic one', () => {
    const report = inspect(
      '@readit/element',
      'packages/element/src/probe.ts',
      "import { createEditor } from '@readit/editor'\n",
    )
    expect(report.violations).toHaveLength(1)
    // §0 A7：element -> editor 现在允许 'type' 与 'dynamic' 两种，消息里两个都列出。
    expect(report.violations[0]).toContain('P1 允许的是：type / dynamic')
  })

  it('flags an edge P1 forbids outright, dynamic or not', () => {
    const report = inspect(
      '@readit/editor',
      'packages/editor/src/probe.ts',
      "const m = import('@readit/element')\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('完全禁止')
  })

  it('flags a relative import that climbs out of its own package', () => {
    const report = inspect(
      '@readit/editor',
      'packages/editor/src/probe.ts',
      "import { mount } from '../../element/src/index.js'\n",
    )
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toContain('越出了 @readit/editor 的包目录')
  })

  it('passes the three edges P1 actually permits', () => {
    const source = [
      "import type { Highlighter } from '@readit/highlight'",
      "import { render } from '@readit/core'",
      "const editor = import('@readit/editor')",
      "import { helper } from './helper.js'",
    ].join('\n')
    const report = inspect('@readit/element', 'packages/element/src/probe.ts', source)
    expect(report.violations).toEqual([])
    expect(report.crossEdges).toBe(3)
  })

  it('also passes a type-only import of editor, now that A7 widened the edge', () => {
    const report = inspect(
      '@readit/element',
      'packages/element/src/probe.ts',
      "import type { Editor } from '@readit/editor'\n",
    )
    expect(report.violations).toEqual([])
    expect(report.crossEdges).toBe(1)
  })
})

describe('P1 import directions hold across packages/*/src', () => {
  it('covers every workspace under packages/ — a new package cannot slip past the table', () => {
    const dirs = readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}`)
    const known = new Set(Object.values(DIRECTORY))
    for (const dir of dirs) {
      expect(known.has(dir), `${dir} 不在 DIRECTORY 表里——一个新包漏派了`).toBe(true)
    }
    // 反过来也要保证：磁盘上现存的每个包都确实被纳入了扫描面（不止是「不多」，也不能「漏」）。
    expect(dirs.sort()).toEqual(MATERIALIZED.map((name) => DIRECTORY[name]).sort())
  })

  it.each(MATERIALIZED)('%s has a src/ directory to scan', (name) => {
    expect(statSync(join(ROOT, DIRECTORY[name], 'src')).isDirectory()).toBe(true)
  })

  it('finds no violation', () => {
    expect(scanAll().violations).toEqual([])
  })

  // 一条永远绿的守卫和没有守卫是一回事。这条钉住扫描面确实非空。
  it('actually read the source it claims to guard', () => {
    const summary = scanAll()
    expect(summary.fileCount).toBeGreaterThanOrEqual(30)
    expect(summary.crossEdges).toBeGreaterThanOrEqual(4)
  })
})

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function manifestOf(name: PackageName): Manifest {
  return JSON.parse(readFileSync(join(ROOT, DIRECTORY[name], 'package.json'), 'utf8')) as Manifest
}

describe('P1 directions hold in the manifests too', () => {
  /**
   * 源码守卫看不见 package.json，而打包器看的正是 package.json。一条仅类型的边被声明成
   * dependencies，源码层面全绿，装进宿主时却是一条真实的环 —— 这就是 D2-9 的形状。
   */
  it('puts every @readit/* dependency on the side the direction table implies', () => {
    const problems: string[] = []
    for (const from of MATERIALIZED) {
      const manifest = manifestOf(from)
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        const to = packageOf(dep)
        if (to === null || to === from) continue
        const kinds = ALLOWED[from][to] ?? []
        if (!kinds.includes('value') && !kinds.includes('dynamic')) {
          problems.push(`${DIRECTORY[from]}/package.json: "${dep}" 在 dependencies 里，但 P1 只允许类型导入——类型依赖属 devDependencies`)
        }
      }
      for (const dep of Object.keys(manifest.devDependencies ?? {})) {
        const to = packageOf(dep)
        if (to === null || to === from) continue
        if (ALLOWED[from][to] === undefined) {
          problems.push(`${DIRECTORY[from]}/package.json: "${dep}" 在 devDependencies 里，但 P1 完全禁止 ${from} -> ${to}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('D2-9: math needs core only for a type, so core is not a runtime dependency of it', () => {
    const math = manifestOf('@readit/math')
    expect(Object.keys(math.dependencies ?? {})).not.toContain('@readit/core')
    expect(Object.keys(math.devDependencies ?? {})).toContain('@readit/core')
    // 另一半的方向是真的运行时边（prepare.ts 的 import('@readit/math')），必须留在 dependencies。
    expect(Object.keys(manifestOf('@readit/core').dependencies ?? {})).toContain('@readit/math')
  })
})
