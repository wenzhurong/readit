import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyFrontmatter, renderFrontmatterTable } from '../../src/rules/frontmatter.js'

function md() {
  const m = new MarkdownIt({ html: true })
  applyFrontmatter(m)
  return m
}

/**
 * Byte-for-byte oracle, captured 2026-08-06 from
 * GET /repos/gohugoio/hugoDocs/contents/content/en/getting-started/quick-start.md
 * with `Accept: application/vnd.github.html`.
 */
const HUGO_QUICKSTART_ORACLE =
  '<markdown-accessiblity-table><table>\n' +
  '  <tbody>\n' +
  '  <tr>\n    <th>title</th>\n    <td>Quick start</td>\n  </tr>\n' +
  '  <tr>\n    <th>description</th>\n    <td>Create your first Hugo project.</td>\n  </tr>\n' +
  '  <tr>\n    <th>categories</th>\n    <td><table>\n  <tbody>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
  '  <tr>\n    <th>keywords</th>\n    <td><table>\n  <tbody>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
  '  <tr>\n    <th>params</th>\n    <td><table>\n' +
  '  <thead>\n  <tr>\n  <th>minVersion</th>\n  </tr>\n  </thead>\n' +
  '  <tbody>\n  <tr>\n  <td><div dir="auto">v0.158.0</div></td>\n  </tr>\n  </tbody>\n' +
  '</table>\n</td>\n  </tr>\n' +
  '  <tr>\n    <th>weight</th>\n    <td>10</td>\n  </tr>\n' +
  '  <tr>\n    <th>aliases</th>\n    <td><table>\n  <tbody>\n  <tr>\n' +
  '  <td><div dir="auto">/quickstart/</div></td>\n' +
  '  <td><div dir="auto">/overview/quickstart/</div></td>\n' +
  '  </tr>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
  '  </tbody>\n</table></markdown-accessiblity-table>'

const HUGO_QUICKSTART_YAML = [
  'title: Quick start',
  'description: Create your first Hugo project.',
  'categories: []',
  'keywords: []',
  'params:',
  '  minVersion: v0.158.0',
  'weight: 10',
  'aliases: [/quickstart/,/overview/quickstart/]',
].join('\n')

describe('frontmatter', () => {
  it('reproduces the GitHub blob-view table byte-for-byte', () => {
    expect(renderFrontmatterTable(HUGO_QUICKSTART_YAML)).toBe(HUGO_QUICKSTART_ORACLE)
  })

  it('nests object-in-object and array-in-object like the oracle', () => {
    // From GET /repos/gohugoio/hugoDocs/contents/content/en/functions/collections/Apply.md
    const yaml = [
      'params:',
      '  functions_and_methods:',
      '    aliases: [apply]',
      "    returnType: '[]any'",
      '    signatures: [collections.Apply SLICE FUNCTION PARAM...]',
    ].join('\n')
    expect(renderFrontmatterTable(yaml)).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>params</th>\n    <td><table>\n' +
        '  <thead>\n  <tr>\n  <th>functions_and_methods</th>\n  </tr>\n  </thead>\n' +
        '  <tbody>\n  <tr>\n  <td><div dir="auto"><table>\n' +
        '  <thead>\n  <tr>\n  <th>aliases</th>\n  <th>returnType</th>\n  <th>signatures</th>\n  </tr>\n  </thead>\n' +
        '  <tbody>\n  <tr>\n' +
        '  <td><div dir="auto"><table>\n  <tbody>\n  <tr>\n  <td><div dir="auto">apply</div></td>\n  </tr>\n  </tbody>\n</table>\n</div></td>\n' +
        '  <td><div dir="auto">[]any</div></td>\n' +
        '  <td><div dir="auto"><table>\n  <tbody>\n  <tr>\n  <td><div dir="auto">collections.Apply SLICE FUNCTION PARAM...</div></td>\n  </tr>\n  </tbody>\n</table>\n</div></td>\n' +
        '  </tr>\n  </tbody>\n</table>\n</div></td>\n' +
        '  </tr>\n  </tbody>\n</table>\n</td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>',
    )
  })

  it('escapes &, < and > in keys and scalar values but leaves quotes alone', () => {
    expect(renderFrontmatterTable('a<b: "x & <y> \'q\'"')).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>a&lt;b</th>\n    <td>x &amp; &lt;y&gt; \'q\'</td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>',
    )
  })

  it('is wired as a block rule that only fires on line 0 of the document', () => {
    expect(md().render('---\ntitle: T\n---\n\ntext\n')).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>title</th>\n    <td>T</td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>\n' +
        '<p>text</p>\n',
    )
  })

  it('does not fire when the fence is not the first line', () => {
    expect(md().render('x\n\n---\ntitle: T\n---\n')).not.toContain('markdown-accessiblity-table')
  })

  it('does not fire inside a blockquote', () => {
    expect(md().render('> ---\n> title: T\n> ---\n')).not.toContain('markdown-accessiblity-table')
  })

  /**
   * ## Malformed YAML: GitHub's error banner, not a fall-through to CommonMark
   *
   * This used to assert `<hr>` — readit had no fallback, so `---` became a rule and
   * `title: [unclosed` became an `<h2>` with its own anchor. GitHub instead prints a
   * `flash flash-error` banner and re-shows the whole block as a
   * `highlight-source-yaml` snippet. Shape taken verbatim from the committed oracle
   * `test/fixtures/github-only/frontmatter-malformed.html`.
   *
   * ### The banner TEXT is not fully reproducible, and that is recorded here
   *
   * GitHub parses YAML with Psych/libyaml. For `title: [unclosed` it says
   *
   *     (<unknown>): did not find expected ',' or ']' while parsing a flow sequence
   *     at line 1 column 8
   *
   * where line/column point at the `[` that OPENED the flow sequence. js-yaml, which
   * readit uses, diagnoses the same input as
   *
   *     unexpected end of the stream within a flow collection   (mark 1:0, 0-based)
   *
   * — a different problem string, a different context, and a different mark (the end
   * of the stream rather than the opening bracket). No formatting of js-yaml's output
   * can produce libyaml's, so readit reproduces GitHub's FRAME
   * (`(<unknown>): <problem> at line L column C`, 1-based) and fills it with its own
   * parser's diagnosis. The residual is one line of the corpus diff and stays on the
   * ledger, named.
   */
  describe('malformed YAML', () => {
    const MALFORMED = '---\ntitle: [unclosed\n---\n\nBody text.\n'

    it('emits the flash-error banner and the raw block, not <hr> plus a heading', () => {
      const out = md().render(MALFORMED)
      expect(out).not.toContain('<hr>')
      expect(out).not.toContain('markdown-accessiblity-table')
      expect(out).toBe(
        '<div class="flash flash-error mb-3">Error in user YAML: (&lt;unknown&gt;): ' +
          'unexpected end of the stream within a flow collection at line 2 column 1</div>' +
          '<div class="highlight highlight-source-yaml notranslate position-relative overflow-auto"' +
          ' dir="auto" data-snippet-clipboard-copy-content="\n---\ntitle: [unclosed\n---\n">' +
          '<pre>---\ntitle: [unclosed\n---\n</pre></div>\n' +
          '<p>Body text.</p>\n',
      )
    })

    /** The two halves GitHub's oracle pins, isolated so a shape change is legible. */
    it('reproduces the oracle wrapper exactly: banner class, snippet class, dir, copy content', () => {
      const out = md().render(MALFORMED)
      expect(out).toContain('<div class="flash flash-error mb-3">Error in user YAML: ')
      expect(out).toContain(
        '<div class="highlight highlight-source-yaml notranslate position-relative overflow-auto"' +
          ' dir="auto" data-snippet-clipboard-copy-content="',
      )
      // The clipboard payload carries a LEADING newline the <pre> does not. Measured,
      // not inferred: it is in the oracle fixture and nowhere else in readit.
      expect(out).toContain('data-snippet-clipboard-copy-content="\n---\ntitle: [unclosed\n---\n"')
      expect(out).toContain('<pre>---\ntitle: [unclosed\n---\n</pre>')
    })

    it('escapes the banner text and the block the way GitHub does', () => {
      const out = md().render('---\na: "<b> & </b>\nx: [1,\n---\n')
      expect(out).toContain('Error in user YAML: (&lt;unknown&gt;): ')
      // Text position escapes &, < and > and leaves the quote alone — the same rule
      // codeblock.ts verified against the oracle for a fenced block's <pre>.
      expect(out).toContain('<pre>---\na: "&lt;b&gt; &amp; &lt;/b&gt;\nx: [1,\n---\n</pre>')
      // Attribute position additionally escapes the double quote.
      expect(out).toContain(
        'data-snippet-clipboard-copy-content="\n---\na: &quot;&lt;b&gt; &amp; &lt;/b&gt;\nx: [1,\n---\n"',
      )
      expect(out).not.toContain('<b>')
    })

    /**
     * The banner is for a PARSE failure only. YAML that parses cleanly but is not a
     * mapping (a sequence, a bare scalar) is not an error, and readit's behaviour
     * there is unchanged: fall through to CommonMark. No oracle covers it, so it is
     * deliberately left alone rather than folded into the error path.
     */
    it('does not fire for valid YAML that simply is not a mapping', () => {
      for (const src of ['---\n- a\n- b\n---\n', '---\njust a scalar\n---\n']) {
        const out = md().render(src)
        expect(out, src).not.toContain('flash-error')
        expect(out, src).not.toContain('markdown-accessiblity-table')
        expect(out, src).toContain('<hr>')
      }
    })

    /** Still a block rule: it only fires on line 0, error path included. */
    it('does not fire on a malformed block that is not at the top of the document', () => {
      const out = md().render('x\n\n---\ntitle: [unclosed\n---\n')
      expect(out).not.toContain('flash-error')
    })
  })

  it('renders booleans and nulls as their YAML core-schema text', () => {
    expect(renderFrontmatterTable('draft: true\nempty:')).toBe(
      '<markdown-accessiblity-table><table>\n  <tbody>\n' +
        '  <tr>\n    <th>draft</th>\n    <td>true</td>\n  </tr>\n' +
        '  <tr>\n    <th>empty</th>\n    <td></td>\n  </tr>\n' +
        '  </tbody>\n</table></markdown-accessiblity-table>',
    )
  })

  // DETERMINISM PIN — not a GitHub oracle assertion, and not a trivial scalar
  // case to be "simplified" away. js-yaml's *default* schema resolves a plain
  // YAML date scalar into a JS `Date`, and `String(date)` is timezone-dependent:
  // the same input would render differently on two machines (or the same
  // machine with TZ set differently), silently breaking the byte-exact
  // snapshot suite. `renderFrontmatterTable` must parse with `CORE_SCHEMA`
  // (which has no timestamp resolver) so the value stays the plain string
  // "2020-01-01" everywhere. This needs no oracle — it pins readit's own
  // determinism, which is entirely within our control — and it fails
  // immediately if the `{ schema: CORE_SCHEMA }` option is ever dropped.
  it('parses a YAML date as a CORE_SCHEMA string, not a timezone-dependent Date object', () => {
    expect(renderFrontmatterTable('date: 2020-01-01')).toContain('<td>2020-01-01</td>')
  })

  /**
   * B3（docs/plans/2026-08-08-plan2-debt.md 批次 8 派单）：CORE_SCHEMA 是为匹配
   * GitHub 的 YAML 行为选的，不是为了安全——但计划一实测过它顺带关掉了 js-yaml
   * 4 条 high 通告向量里的 2 条（merge key `<<`、`!!omap`）。**这份安全此前是无
   * 保护的副作用**：没有任何测试断言 frontmatter.ts 用的是 CORE_SCHEMA，谁哪天
   * 为了修 `<<` 的保真度差异换成 DEFAULT_SCHEMA，这两条会静默重新打开而不会有
   * 任何东西报警。这里补上。
   *
   * 只测这两条，不是偷懒漏了另外两条（原型污染 / 别名链深度）——本轮复核时
   * 直接用 CORE_SCHEMA 与 DEFAULT_SCHEMA 分别跑过这两个探针（见批次 8 报告），
   * 结果**两个 schema 下完全一致**：js-yaml 从不把 `__proto__` 键写上真正的
   * `Object.prototype`（这是加载器自身的防护，不是 schema 的分支），别名链在
   * 深度 8/10/12/14 上两个 schema 都是次毫秒级、平坦无爆炸（js-yaml 对别名图
   * 有内置的资源限制，同样不分 schema）。也就是说，若真的换成 DEFAULT_SCHEMA，
   * 这两条其实**不会**重新打开——把它们也写进这条"换 schema 就会重新打开"的
   * 守卫测试里会是一条测不出真实回归的假心理安慰。**真正随 schema 摆动的只有
   * merge 与 omap 这两条**，守卫应该只钉这两条。
   */
  describe('CORE_SCHEMA 安全副作用守卫（B3）', () => {
    it('merge key `<<` 能解析但不合并——CORE_SCHEMA 没有注册 merge 类型', () => {
      const yaml = ['base: &b', '  x: 1', 'values:', '  <<: *b', '  y: 2'].join('\n')
      const out = renderFrontmatterTable(yaml)
      // 若 <<` 生效合并，它会被合并掉、从输出里彻底消失，`x` 会与 `y` 一起
      // 平铺在 values 自己的行里。CORE_SCHEMA 下 `<<` 只是一个普通字符串键，
      // 原样出现在输出里（转义成 &lt;&lt;）——这正是"能解析但不合并"的可观测证据。
      expect(out, '`<<` 字面量作为普通键留在输出里').toContain('&lt;&lt;')
      expect(out, '`y` 仍能正常解析').toContain('<th>y</th>')
    })

    it('`!!omap` 标签被拒绝——CORE_SCHEMA 没有注册这个类型（DEFAULT_SCHEMA 会接受）', () => {
      // parseFrontmatter 内部 load() 抛出「unknown tag」，renderFrontmatterTable
      // 把解析失败折成 null——与 applyFrontmatter 里同一失败会走 flash-error
      // 横幅是同一条路径（见上面「malformed YAML」一组测试）。
      expect(renderFrontmatterTable('!!omap\n- a: 1\n- b: 2\n')).toBeNull()
    })

    it('端到端：frontmatter 里的 `!!omap` 触发 flash-error 横幅，不是静默解析成有序表', () => {
      const out = md().render('---\n!!omap\n- a: 1\n- b: 2\n---\n\nBody text.\n')
      expect(out).toContain('<div class="flash flash-error mb-3">Error in user YAML: ')
      expect(out).not.toContain('markdown-accessiblity-table')
    })
  })
})
