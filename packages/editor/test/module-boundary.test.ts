import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 找到 `entryFile` 所在包（`pkgName`）的 package.json，从 entryFile 所在目录
 * 逐级向上走，而不是走 `require.resolve('<pkg>/package.json')`。
 *
 * 原因（任务书原文用的是后者，实测会红）：真实安装的 style-mod@4.1.2 自己的
 * package.json 有 `"exports": { "import": ..., "require": ... }`，**没有列
 * `"./package.json"` 子路径**——Node 的 exports 映射会拒绝这次解析，报
 * `Package subpath './package.json' is not defined by "exports"`，与谁在
 * require 它、装在哪一层 node_modules 无关。用 fs 直接按目录找则不受
 * exports 字段约束（那是模块解析器的限制，不是文件系统的）。
 */
function packageJsonNear(entryFile: string, pkgName: string): string {
  let dir = dirname(entryFile)
  for (;;) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string }
      if (pkg.name === pkgName) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`package.json for ${pkgName} not found above ${entryFile}`)
    dir = parent
  }
}

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2023, true)
}

/** 顶层的、会在运行时产生一条边的 import（`import type` 不算）。 */
function staticRuntimeImports(sf: ts.SourceFile): string[] {
  const out: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (stmt.importClause?.isTypeOnly === true) continue
    if (ts.isStringLiteral(stmt.moduleSpecifier)) out.push(stmt.moduleSpecifier.text)
  }
  return out
}

function dynamicImports(sf: ts.SourceFile): string[] {
  const out: string[] = []
  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0]
      if (arg !== undefined && ts.isStringLiteral(arg)) out.push(arg.text)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}

describe('@readit/editor 的 . 入口没有任何静态运行时 import', () => {
  const index = parse('../src/index.ts')

  it('index.ts 的顶层 import 全是 type-only', () => {
    expect(staticRuntimeImports(index)).toEqual([])
  })

  it('两个实现都只经由 import() 到达', () => {
    expect(dynamicImports(index).sort()).toEqual(['./codemirror.js', './plain.js'])
  })

  it('index.ts / types.ts / plain.ts 的源码里出现不了 @codemirror', () => {
    for (const rel of ['../src/index.ts', '../src/types.ts', '../src/plain.ts']) {
      expect(read(rel), `${rel} 不得提到 @codemirror`).not.toContain('@codemirror')
    }
  })

  it('codemirror.ts 是唯一 import @codemirror/* 的文件', () => {
    const specs = staticRuntimeImports(parse('../src/codemirror.ts'))
    expect(specs.filter((s) => s.startsWith('@codemirror/')).sort()).toEqual([
      '@codemirror/commands',
      '@codemirror/lang-markdown',
      '@codemirror/language',
      '@codemirror/state',
      '@codemirror/view',
    ])
  })
})

describe('style-mod 的解析版本 ≥ 4.1.2', () => {
  /**
   * SPEC §5 把 style-mod >=4.1.2 单独列进 @readit/editor 的关键依赖，
   * 理由是同页两个实例的样式注入 bug 只在低版本上现形，而它是
   * @codemirror/view 的传递依赖——直接依赖不写死，装到哪个版本全看运气。
   * 这里断言的是 @codemirror/view **自己**解析到的那份，不是被提升的那份。
   */
  it('从 @codemirror/view 的解析路径看过去也满足', () => {
    const here = createRequire(import.meta.url)
    const viewEntry = here.resolve('@codemirror/view')
    const fromView = createRequire(viewEntry)
    const styleModEntry = fromView.resolve('style-mod')
    const pkgPath = packageJsonNear(styleModEntry, 'style-mod')
    const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version
    const cmp = (a: string, b: string): number => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0)
        if (d !== 0) return d
      }
      return 0
    }
    expect(cmp(version, '4.1.2'), `style-mod resolved to ${version}`).toBeGreaterThanOrEqual(0)
  })
})
