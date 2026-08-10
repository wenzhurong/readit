import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 批次 1 评审的 carry-forward（progress.md「Important 1」）：set-html.ts 第三级
 * 那句注释——「已消毒内容用 innerHTML」——此前零代码层强制：没有品牌类型、没有
 * 运行时校验、仓库没有 ESLint、也没有 AST 断言。task-2-brief 的「新增契约提案」
 * 第 1 条自己承诺过要补一条源码级断言，钉住 `packages/element/src` 下只有
 * set-html.ts 出现 `innerHTML =`，当时因为 setHtml() 还没有调用方而搁置。
 * Task 4 把 mount() 接到 setHtml() 上、kernel.ts 有了第一个真实调用点后，
 * 这条断言不能再推迟——本文件就是它。
 *
 * 用 TypeScript AST 而不是字符串 includes 或正则：跟 test/import-direction.test.ts
 * 同一个理由，字符串匹配对「哪个标识符的 .innerHTML」不敏感，容易漏判
 * （跨行赋值、注释里出现同样的字面文本）或误判。这里精确找「赋值表达式，左边是
 * 以 innerHTML 结尾的属性访问」与「对 insertAdjacentHTML 的调用」——后者是同一类
 * 绕过注入路径唯一化的手段，虽然本批代码没有用到，钉住它比不钉便宜。
 */

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = join(TEST_DIR, '..', 'src')

function tsFilesUnder(dir: string): string[] {
  let out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out = out.concat(tsFilesUnder(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

type OffenseKind = 'innerHTML=' | 'insertAdjacentHTML()'

interface Offense {
  line: number
  kind: OffenseKind
}

export function scanSource(fileName: string, source: string): Offense[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const offenses: Offense[] = []
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const walk = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'innerHTML'
    ) {
      offenses.push({ line: lineOf(node), kind: 'innerHTML=' })
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'insertAdjacentHTML'
    ) {
      offenses.push({ line: lineOf(node), kind: 'insertAdjacentHTML()' })
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return offenses
}

describe('setHtml() 是 element 里唯一把 HTML 写进 DOM 的入口', () => {
  it('扫描器认得出 innerHTML = 与 insertAdjacentHTML()，也不会被 textContent 迷惑', () => {
    // 探针自检：先证明扫描器真的看得懂目标形态，再拿它去扫真实源码——
    // 一条测不到真东西的断言比没有断言更糟（同一条纪律 leak.test.ts 也用）。
    const offenses = scanSource(
      'probe.ts',
      [
        'el.innerHTML = html',
        "el.insertAdjacentHTML('beforeend', html)",
        'el.textContent = html',
        "const x = { innerHTML: 'not an assignment' }",
      ].join('\n'),
    )
    expect(offenses.map((o) => o.kind)).toEqual(['innerHTML=', 'insertAdjacentHTML()'])
  })

  it('set-html.ts 自己确实用了 innerHTML =（否则下面那条判据毫无意义）', () => {
    const file = join(SRC_ROOT, 'set-html.ts')
    const offenses = scanSource(file, readFileSync(file, 'utf8'))
    expect(offenses.some((o) => o.kind === 'innerHTML=')).toBe(true)
  })

  it('src/ 下除 set-html.ts 外，没有任何文件出现 innerHTML = 或 insertAdjacentHTML()', () => {
    const offenders: string[] = []
    for (const file of tsFilesUnder(SRC_ROOT)) {
      const rel = file.slice(SRC_ROOT.length + 1)
      if (rel === 'set-html.ts') continue
      const offenses = scanSource(file, readFileSync(file, 'utf8'))
      for (const offense of offenses) offenders.push(`${rel}:${offense.line} ${offense.kind}`)
    }
    expect(offenders).toEqual([])
  })
})
