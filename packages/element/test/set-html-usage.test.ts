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
 * （跨行赋值、注释里出现同样的字面文本）或误判。
 *
 * ## 覆盖边界（批次 2 评审 Important 3 之后）
 *
 * 第一版只认「`.innerHTML =`（纯等号）」与「`.insertAdjacentHTML(...)`」两种形态。
 * 评审拿 15 种「一个字符之差」的等价写法跑了一遍，13 种漏判：`+=` 这类复合赋值、
 * `el['innerHTML'] =` 这种下标访问、`outerHTML`（跟 innerHTML 同等危险，同样能
 * 把任意字符串当 HTML 解析）、`setHTMLUnsafe()`（Sanitizer API 的不消毒版本）、
 * `Object.assign(el, {innerHTML: x})` 这类间接赋值，都能不留痕迹地绕过第一版。
 *
 * 现在这版覆盖：
 *  - 赋值目标是 `.innerHTML`/`.outerHTML` 或 `['innerHTML']`/`['outerHTML']`
 *    （下标访问要求下标是字符串字面量——变量下标 `el[key] = x` 静态分析不出
 *    `key` 的值，这是下面「已知仍然测不到的」那条要如实承认的地方），赋值算子
 *    不限于纯 `=`，覆盖全部复合赋值（`+=`、`??=`、`||=`……）——`ts.isAssignmentOperator`
 *    是编译器内部函数，5.9.3 的公开 `.d.ts` 不导出它，改用 SyntaxKind 的数值区间
 *    （`EqualsToken` 到 `CaretEqualsToken` 连续 16 个，跟编译器自己判定的方式一致）。
 *  - 方法调用 `insertAdjacentHTML` / `setHTMLUnsafe` / `setHTML`（后者是 tier 1
 *    该走的正经 API，但只准 set-html.ts 自己调；别处出现说明绕过了三级判定，
 *    直接拿 tier-1 API 自己上）。
 *  - `Object.assign(target, {innerHTML: …})`、`Object.defineProperty(target,
 *    'innerHTML', …)`、`Object.defineProperties(target, {innerHTML: …})`——
 *    三种不通过赋值表达式本身、但效果等价的间接写入。
 *  - `Reflect.set(target, 'innerHTML', value)`——同上，Reflect 版本。
 *
 * ## 已知仍然测不到的（如实写在这里，不是留给人猜）
 *
 *  - **动态属性名**：`el[someVariable] = html`，其中 `someVariable` 在编译期
 *    求不出值。静态 AST 分析的天花板，没有类型系统的品牌类型或运行时 Proxy
 *    钉不死这条——本文件只是第一道网，不是唯一的一道。
 *  - **完全绕开属性系统的间接层**：`new DOMParser().parseFromString(html,
 *    'text/html')` 之后手动搬运节点、`Range.prototype.createContextualFragment`、
 *    `document.write()`/`document.writeln()`。这些不直接对某个已知元素的
 *    `innerHTML`/`outerHTML` 赋值，抓它们需要另一套完全不同的调用图分析，
 *    本文件的扫描面（单文件 AST、无跨函数数据流）做不到，留给以后需要时再补。
 *  - **解构赋值**等更罕见的写法（`;({innerHTML: x} = obj)` 之类）：语法上存在，
 *    实际代码里几乎不会有人这样写来注入 HTML，权衡后没有专门处理。
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

interface Offense {
  line: number
  /** 人可读的判定形态，用于失败信息与自检断言，不是一个封闭的枚举。 */
  kind: string
}

/** 能把任意字符串当 HTML/属性解析进 DOM 的属性名——不止 innerHTML 一个。 */
const DANGEROUS_PROPERTIES: ReadonlySet<string> = new Set(['innerHTML', 'outerHTML'])

/** 同一类风险的方法版本。setHTML 本身是 tier 1 该走的 API，但只准 set-html.ts 调。 */
const DANGEROUS_METHODS: ReadonlySet<string> = new Set(['insertAdjacentHTML', 'setHTMLUnsafe', 'setHTML'])

/** `.prop` 或 `['prop']`（下标必须是字符串字面量，变量下标测不出来，见文件头注释）。 */
function propertyNameOf(expr: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  if (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression)) {
    return expr.argumentExpression.text
  }
  return null
}

/** 对象字面量成员的 key：`{ innerHTML: x }` 或 `{ 'innerHTML': x }`。 */
function memberNameOf(member: ts.ObjectLiteralElementLike): string | null {
  const name = member.name
  if (name === undefined) return null
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  return null
}

/** `obj.prop` 形态里 `prop` 是不是某个固定名字（用于识别 `Object.xxx` / `Reflect.xxx`）。 */
function calleeMemberName(callee: ts.Expression, objectName: string): string | null {
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== objectName) return null
  return callee.name.text
}

/**
 * `=`、`+=`、`??=`……全部赋值算子。`ts.isAssignmentOperator` 是编译器内部函数，
 * TypeScript 5.9.3 的公开 `.d.ts` 不导出它——`EqualsToken`(64) 到
 * `CaretEqualsToken`(79) 在 SyntaxKind 里是连续的 16 个值，跟编译器自己判定
 * 「是不是赋值算子」的方式一致，用数值区间顶上不导出的那个函数。
 */
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.EqualsToken && kind <= ts.SyntaxKind.CaretEqualsToken
}

export function scanSource(fileName: string, source: string): Offense[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const offenses: Offense[] = []
  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  const record = (node: ts.Node, kind: string): void => {
    offenses.push({ line: lineOf(node), kind })
  }
  const scanObjectLiteralFor = (obj: ts.ObjectLiteralExpression, node: ts.Node, via: string): void => {
    for (const member of obj.properties) {
      const name = memberNameOf(member)
      if (name !== null && DANGEROUS_PROPERTIES.has(name)) record(node, `${via}({${name}})`)
    }
  }

  const walk = (node: ts.Node): void => {
    // 赋值，含复合赋值（+=、??=、||= ……），左边是 .innerHTML/.outerHTML 或
    // ['innerHTML']/['outerHTML']。
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const name = propertyNameOf(node.left)
      if (name !== null && DANGEROUS_PROPERTIES.has(name)) {
        record(node, `${name} ${node.operatorToken.getText(sourceFile)}`)
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression

      // el.insertAdjacentHTML(...) / el.setHTMLUnsafe(...) / el.setHTML(...)
      if (ts.isPropertyAccessExpression(callee) && DANGEROUS_METHODS.has(callee.name.text)) {
        record(node, `${callee.name.text}()`)
      }

      // Object.assign(el, {innerHTML: x}) / Object.defineProperty(el, 'innerHTML', …) /
      // Object.defineProperties(el, {innerHTML: …})
      const objectMethod = calleeMemberName(callee, 'Object')
      if (objectMethod === 'assign') {
        for (const arg of node.arguments.slice(1)) {
          if (ts.isObjectLiteralExpression(arg)) scanObjectLiteralFor(arg, node, 'Object.assign')
        }
      } else if (objectMethod === 'defineProperty') {
        const key = node.arguments[1]
        if (key !== undefined && ts.isStringLiteralLike(key) && DANGEROUS_PROPERTIES.has(key.text)) {
          record(node, `Object.defineProperty(${key.text})`)
        }
      } else if (objectMethod === 'defineProperties') {
        const descriptors = node.arguments[1]
        if (descriptors !== undefined && ts.isObjectLiteralExpression(descriptors)) {
          scanObjectLiteralFor(descriptors, node, 'Object.defineProperties')
        }
      }

      // Reflect.set(el, 'innerHTML', x)
      if (calleeMemberName(callee, 'Reflect') === 'set') {
        const key = node.arguments[1]
        if (key !== undefined && ts.isStringLiteralLike(key) && DANGEROUS_PROPERTIES.has(key.text)) {
          record(node, `Reflect.set(${key.text})`)
        }
      }
    }

    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return offenses
}

describe('setHtml() 是 element 里唯一把 HTML 写进 DOM 的入口', () => {
  /**
   * 探针自检，逐条对着评审实测出来的「一个字符之差」矩阵——覆盖矩阵本身就是
   * 判据的一部分，不是写完实现就当它对：一条测不到真东西的断言比没有断言更糟。
   */
  it.each([
    ['el.innerHTML = html', 'innerHTML ='],
    ['el.innerHTML += html', 'innerHTML +='],
    ["el['innerHTML'] = html", 'innerHTML ='],
    ['el.outerHTML = html', 'outerHTML ='],
    ["el['outerHTML'] = html", 'outerHTML ='],
    ["el.insertAdjacentHTML('beforeend', html)", 'insertAdjacentHTML()'],
    ['el.setHTMLUnsafe(html)', 'setHTMLUnsafe()'],
    ['el.setHTML(html)', 'setHTML()'],
    ['Object.assign(el, { innerHTML: html })', 'Object.assign({innerHTML})'],
    ['Object.assign(el, { outerHTML: html })', 'Object.assign({outerHTML})'],
    ["Object.defineProperty(el, 'innerHTML', { value: html })", 'Object.defineProperty(innerHTML)'],
    ["Object.defineProperties(el, { innerHTML: { value: html } })", 'Object.defineProperties({innerHTML})'],
    ["Reflect.set(el, 'innerHTML', html)", 'Reflect.set(innerHTML)'],
  ])('抓得到：%s', (code, expectedKind) => {
    expect(scanSource('probe.ts', code).map((o) => o.kind)).toEqual([expectedKind])
  })

  it('不会被无关的同名/近形写法迷惑', () => {
    const offenses = scanSource(
      'probe.ts',
      [
        'el.textContent = html',
        'el.innerText = html',
        "const x = { innerHTML: 'not a call, not an assignment target' }",
        'Object.assign(el, { textContent: html })',
        "Object.keys({ innerHTML: 1 })",
        "el.setAttribute('innerHTML', html)",
      ].join('\n'),
    )
    expect(offenses).toEqual([])
  })

  it('set-html.ts 自己确实用了 innerHTML =（否则下面那条判据毫无意义）', () => {
    const file = join(SRC_ROOT, 'set-html.ts')
    const offenses = scanSource(file, readFileSync(file, 'utf8'))
    expect(offenses.some((o) => o.kind === 'innerHTML =')).toBe(true)
  })

  it('src/ 下除 set-html.ts 外，没有任何文件出现上述任一形态', () => {
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
