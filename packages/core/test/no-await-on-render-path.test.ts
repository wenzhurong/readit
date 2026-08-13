import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOADERS } from '../src/prepare.js'
import { DEFAULT_OPTIONS } from '../src/types.js'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
/** prepare.ts is the one and only place allowed to await or dynamic-import (SPEC §3.1). */
const ALLOWED = new Set(['prepare.ts'])

/**
 * Phase A's non-I/O purity guard deliberately has a stated static boundary:
 *
 * - nondeterminism: direct `Date.now`, `Math.random`, and `new Date` syntax;
 * - synchronous I/O: runtime imports/requires of fs and child_process;
 * - module state: top-level let/var plus direct assignment, update, delete, or a
 *   known mutating method call rooted at a top-level binding.
 *
 * This does not prove away aliases, computed/eval access, mutation hidden in an
 * opaque library call, or state held inside a factory result. Public default
 * containers are therefore checked at runtime below. The scan covers all of
 * `src/`, including prepare.ts; its await exemption does not permit time, I/O,
 * randomness, or shared mutable state.
 */
const IO_MODULES = new Set(['node:fs', 'fs', 'node:child_process', 'child_process'])
const MUTATING_METHODS = new Set([
  'add',
  'set',
  'delete',
  'clear',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'copyWithin',
  'fill',
])

interface PurityFindings {
  nondeterminism: string[]
  syncIo: string[]
  moduleState: string[]
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  )
}

function rootIdentifier(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return rootIdentifier(expression.expression)
  }
  return undefined
}

function propertyName(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression
    if (argument && ts.isStringLiteralLike(argument)) return argument.text
  }
  return undefined
}

function isDirectProperty(
  expression: ts.Expression,
  owner: string,
  property: string,
): boolean {
  return (
    rootIdentifier(expression) === owner &&
    propertyName(expression as ts.LeftHandSideExpression) === property
  )
}

function importHasRuntimeValue(clause: ts.ImportClause | undefined): boolean {
  if (clause === undefined) return true
  if (clause.isTypeOnly) return false
  if (clause.name !== undefined) return true
  const bindings = clause.namedBindings
  if (!bindings || ts.isNamespaceImport(bindings)) return true
  return !bindings.elements.every((element) => element.isTypeOnly)
}

function scanPurity(source: string, fileName: string): PurityFindings {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )
  const findings: PurityFindings = { nondeterminism: [], syncIo: [], moduleState: [] }
  const moduleBindings = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    for (const declaration of statement.declarationList.declarations) {
      for (const name of bindingNames(declaration.name)) moduleBindings.add(name)
      if (!isConst) {
        findings.moduleState.push(`line ${lineOf(sourceFile, declaration)}: top-level let/var`)
      }
    }
  }

  const recordModuleWrite = (node: ts.Node, target: ts.Expression): void => {
    const root = rootIdentifier(target)
    if (root && moduleBindings.has(root)) {
      findings.moduleState.push(`line ${lineOf(sourceFile, node)}: write through ${root}`)
    }
  }

  const walk = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      if (importHasRuntimeValue(node.importClause) && IO_MODULES.has(node.moduleSpecifier.text)) {
        findings.syncIo.push(`line ${lineOf(sourceFile, node)}: import ${node.moduleSpecifier.text}`)
      }
    } else if (ts.isCallExpression(node)) {
      const arg0 = node.arguments[0]
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        arg0 &&
        ts.isStringLiteralLike(arg0) &&
        IO_MODULES.has(arg0.text)
      ) {
        findings.syncIo.push(`line ${lineOf(sourceFile, node)}: import ${arg0.text}`)
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        arg0 &&
        ts.isStringLiteralLike(arg0) &&
        IO_MODULES.has(arg0.text)
      ) {
        findings.syncIo.push(`line ${lineOf(sourceFile, node)}: require ${arg0.text}`)
      }
      if (isDirectProperty(node.expression, 'Date', 'now')) {
        findings.nondeterminism.push(`line ${lineOf(sourceFile, node)}: Date.now`)
      } else if (isDirectProperty(node.expression, 'Math', 'random')) {
        findings.nondeterminism.push(`line ${lineOf(sourceFile, node)}: Math.random`)
      }
      const method = propertyName(node.expression)
      if (method && MUTATING_METHODS.has(method)) recordModuleWrite(node, node.expression)
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date'
    ) {
      findings.nondeterminism.push(`line ${lineOf(sourceFile, node)}: new Date`)
    } else if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind
      if (kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment) {
        recordModuleWrite(node, node.left)
      }
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      recordModuleWrite(node, node.operand)
    } else if (ts.isDeleteExpression(node)) {
      recordModuleWrite(node, node.expression)
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return findings
}

function walk(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, rel + name + '/'))
    } else if (name.endsWith('.ts')) {
      out.push(rel + name)
    }
  }
  return out
}

describe('the synchronous render path', () => {
  const files = walk(SRC)

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const rel of files) {
    if (ALLOWED.has(rel)) continue
    it(`packages/core/src/${rel} contains no await and no dynamic import`, () => {
      const text = readFileSync(join(SRC, rel), 'utf8')
      expect(text).not.toMatch(/\bawait\b/)
      expect(text).not.toMatch(/\basync\b/)
      expect(text).not.toMatch(/\bimport\s*\(/)
    })
  }
})

describe('Phase A non-I/O purity', () => {
  const files = walk(SRC)

  for (const rel of files) {
    const findings = scanPurity(readFileSync(join(SRC, rel), 'utf8'), rel)

    it(`packages/core/src/${rel} contains no time or randomness`, () => {
      expect(findings.nondeterminism).toEqual([])
    })

    it(`packages/core/src/${rel} contains no synchronous I/O capability`, () => {
      expect(findings.syncIo).toEqual([])
    })

    it(`packages/core/src/${rel} contains no direct module-state writes`, () => {
      expect(findings.moduleState).toEqual([])
    })
  }

  it.each([
    ['DEFAULT_OPTIONS', DEFAULT_OPTIONS],
    ['DEFAULT_LOADERS', DEFAULT_LOADERS],
  ])('%s is frozen public module state', (_name, value) => {
    expect(Object.isFrozen(value)).toBe(true)
  })
})
