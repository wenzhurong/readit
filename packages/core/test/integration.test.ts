import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { render } from '../src/index.js'
import {
  createSpecEngine,
  SEMANTIC_RULE_BY_EXTENSION,
  SEMANTIC_RULES,
  SHAPE_RULES,
  type Rule,
} from '../src/engine.js'
import { applyCodeBlock } from '../src/rules/codeblock.js'
import { applyRawShape } from '../src/rules/rawshape.js'
import { applyTagfilter } from '../src/rules/tagfilter.js'
import { applyRawHtmlPolicy } from '../src/sanitize.js'
import { DEFAULT_OPTIONS } from '../src/types.js'
import { judgeSpecExample, type SpecExample, type SuiteId } from './spec/harness.js'
import commonmarkExamples from './spec/commonmark-0.31.2.json' with { type: 'json' }
import gfmExamples from './spec/gfm-0.29.json' with { type: 'json' }

const SRC = readFileSync(join(import.meta.dirname, 'integration/kitchen-sink.md'), 'utf8')

// 19, not the 17 this used to say: 4 SEMANTIC + 12 SHAPE + the 3 `createEngine`
// calls outside the arrays. The number is no longer maintained by hand — the
// "rule registry" suite at the bottom of this file asserts it against the
// source, so a stale count here is now a test failure there.
describe('all 19 rules in one engine', () => {
  const html = render(SRC)

  it('frontmatter becomes a table, not an hr', () => {
    expect(html).toContain('<markdown-accessiblity-table>')
    expect(html).not.toMatch(/^<hr>/m)
  })

  it('heading gets the markdown-heading wrapper with class before dir before data-line', () => {
    // class before dir is C2 ordering rule #2 (applyHeadingAnchors before applyDirAuto);
    // data-line trailing is rule #3 (applySourceLine last). data-line is readit's own
    // addition (never emitted by GitHub itself, see sourceline.ts), so it belongs on
    // every block token that carries a source map, heading_open included.
    expect(html).toMatch(/<h1 class="heading-element" dir="auto" data-line="\d+">/)
    expect(html).toContain('id="user-content-')
  })

  it('autolinks www, url with balanced parens, and email; external autolinks get rel="nofollow"', () => {
    // Exact strings, not a bare href substring check: review round 1 found that
    // `toContain('href="...")` passes identically whether or not applyDecorate's
    // rel="nofollow" is present, so it can't actually pin that behavior.
    expect(html).toContain('<a href="http://www.example.com" rel="nofollow">www.example.com</a>')
    expect(html).toContain(
      '<a href="https://example.com/a(b)" rel="nofollow">https://example.com/a(b)</a>',
    )
    // mailto: does not get nofollow — measured GitHub behavior (Task 33 fix round 1,
    // SPEC §17.1 rule #15's "all autolinks" prose was an over-generalization from http(s)).
    expect(html).toContain('<a href="mailto:foo@bar.baz">foo@bar.baz</a>')
  })

  it('decorates images: bare image gets a blank-target wrapper, already-linked image keeps its author href', () => {
    // Discriminates applyDecorate's third behavior (wrap a bare image) from its
    // second (leave an author-linked image alone, just add nofollow to the link) —
    // review round 1 found the fixture had no image markdown at all, so none of
    // style="max-width", the synthetic wrapper, or the already-linked exemption
    // ever ran in this test.
    expect(html).toContain(
      '<a target="_blank" rel="noopener noreferrer" href="preview.png">' +
        '<img src="preview.png" alt="预览图" style="max-width: 100%;"></a>',
    )
    expect(html).toContain(
      '<a href="https://example.com/site" rel="nofollow">' +
        '<img src="logo.png" alt="Logo" style="max-width: 100%;"></a>',
    )
    // The already-linked image's anchor must not also get the bare-image treatment.
    expect(html).not.toContain('target="_blank" rel="noopener noreferrer" href="https://example.com/site"')
  })

  it('renders the alert with its octicon', () => {
    expect(html).toContain('class="markdown-alert markdown-alert-warning"')
    expect(html).toContain('data-component="Octicon"')
  })

  it('table carries align attributes AND the accessibility wrapper', () => {
    expect(html).toContain('align="center"')
    expect(html).toContain('align="right"')
    expect(html).toContain('<markdown-accessiblity-table>')
  })

  it('task list has GitHub attribute order and no dir on the ul', () => {
    // data-line (readit's own addition, see sourceline.ts) is expected to trail;
    // dir="auto" must never appear (dirauto.ts skips contains-task-list lists —
    // ordering rule #1, applyDirAuto after applyTaskList).
    expect(html).toMatch(/<ul class="contains-task-list" data-line="\d+">/)
    expect(html).not.toMatch(/<ul class="contains-task-list"[^>]*\bdir="auto"/)
    expect(html).toContain('aria-label="Completed task"')
  })

  it('strikethrough is del, not s', () => {
    expect(html).toContain('<del>删除线</del>')
    expect(html).not.toContain('<s>')
  })

  it('emoji keeps its class through the sanitize walker', () => {
    expect(html).toContain('class="emoji"')
  })

  it('a dollar inside a code span is never math', () => {
    expect(html).toMatch(/<code[^>]*>代码 \$5 段<\/code>/)
  })

  it('inline math is detected but currency is not', () => {
    expect(html).toContain('js-inline-math')
    expect(html).toContain('costs $5 or $10')
    expect(html.match(/js-inline-math/g)).toHaveLength(1)
  })

  it('fenced code gets the highlight wrapper and data-line', () => {
    expect(html).toContain('class="highlight highlight-source-js')
    expect(html).toContain('data-line=')
  })

  it('tagfilter escapes script but sanitize keeps the div', () => {
    expect(html).not.toContain('<script>')
    expect(html).toContain('id="user-content-custom"')
  })

  it('footnote section is emitted with unsalted ids', () => {
    expect(html).toContain('id="user-content-fn-1"')
    expect(html).not.toMatch(/user-content-fn-1-[0-9a-f]{32}/)
  })

  /**
   * applyRawShape is the one rule `createEngine` registers OUTSIDE the
   * SHAPE_RULES loop — after `applyRawHtmlPolicy`, per engine.ts coupling #4.
   * Nothing here would fail if that call were dropped except the corpus suite,
   * so this asserts the wiring at the engine level, on the same document as
   * every other rule.
   */
  it('decorates elements the author wrote as literal HTML, not just markdown ones', () => {
    expect(html).toContain(
      '<div class="markdown-heading" dir="auto"><h2 class="heading-element" dir="auto">原生标题</h2>',
    )
    expect(html).toContain('href="#原生标题"')
    expect(html).toContain(
      '<p dir="auto"><a target="_blank" rel="noopener noreferrer" href="raw.png">' +
        '<img src="raw.png" alt="raw" style="max-width: 100%;"></a></p>',
    )
  })
})

describe('createSpecEngine loads only the semantic slot', () => {
  const md = createSpecEngine()

  it('emits no GitHub shape for a plain heading', () => {
    expect(md.render('# hi')).toBe('<h1>hi</h1>\n')
  })

  it('still applies the semantic rules', () => {
    // <s> -> <del> is SEMANTIC, so the spec engine must still apply it.
    expect(md.render('~~x~~')).toBe('<p><del>x</del></p>\n')
  })

  it('does not apply the shape rules', () => {
    // dir="auto", the markdown-heading wrapper, and data-line are all SHAPE.
    const html = md.render('# hi\n\n| a |\n| - |\n| b |\n')
    expect(html).not.toContain('dir="auto"')
    expect(html).not.toContain('markdown-heading')
    expect(html).not.toContain('markdown-accessiblity-table')
    expect(html).not.toContain('data-line')
  })

  it('still applies the semantic half of the table rule', () => {
    // align belongs to SEMANTIC; the wrapper shell belongs to SHAPE — see
    // cross-rule contract C1's split of Task 7.
    expect(md.render('| a |\n|:-:|\n| b |\n')).toContain('align="center"')
  })
})

/**
 * ## The slot ratchet
 *
 * The plan's C1 promised a ratchet: put a rule in the wrong array and a spec
 * example flips loudly. That held while `createSpecEngine` loaded all of
 * `SEMANTIC_RULES` unconditionally. Task 32a's harness refactor replaced that
 * with a per-example lookup in `SEMANTIC_RULE_BY_EXTENSION`
 * (test/spec/harness.ts), and `harness.ts` now never reads `SEMANTIC_RULES` at
 * all — so a rule pushed into `SEMANTIC_RULES` but absent from the map is
 * invisible to every one of the 1324 spec examples, and the ratchet was gone.
 *
 * "Then let the output assertions catch it" does not work either, and the
 * `SHAPE-slot rules are invisible to the spec suite` test below measures
 * exactly how badly: of the 13 candidates (the 12 `SHAPE_RULES` plus
 * `applyRawShape`, which `createEngine` registers outside the arrays), 7 leave
 * the whole 1324-example suite green even when they are genuinely loaded into
 * the spec engine. An earlier version of this comment said 9 of 13 and named
 * `applyDecorate` and `applyRawShape` among them; re-measured 2026-08-08 with
 * the same injection the test performs, both are in fact caught — 74 and 102
 * not-green examples respectively, the one figure here the test does not itself
 * assert — and the real answer is 7. The 7 and its membership are no longer
 * prose: the test recomputes them.
 *
 * The three tests below restore the ratchet structurally rather than by adding
 * more output assertions:
 *
 *  1. `SEMANTIC_RULES` and the map's values must be the SAME SET. A rule can
 *     then only enter the SEMANTIC slot by also being given a cmark-gfm
 *     extension name, and giving it one is exactly what puts it in front of
 *     the spec examples. Misfiling becomes a failure here even when it would
 *     produce no visible output drift.
 *  2. Every `applyXxx` the source exports must be accounted for by one of the
 *     three wiring sites, so a rule in NEITHER array is caught too. Test 1
 *     alone cannot see that case.
 */
describe('rule registry', () => {
  const names = (rules: readonly Rule[]): string[] => rules.map((r) => r.name).sort()

  it('SEMANTIC_RULES is exactly the set SEMANTIC_RULE_BY_EXTENSION maps to', () => {
    expect(names(SEMANTIC_RULES)).toEqual(names(Object.values(SEMANTIC_RULE_BY_EXTENSION)))
  })

  /**
   * The measurement the structural checks exist BECAUSE of, recomputed rather
   * than quoted: how many SHAPE-slot rules a spec engine can load without a
   * single one of the 1324 examples going red. Every one of the 13 candidates
   * is loaded on top of whatever `renderForSpec` would have loaded, and the
   * per-example verdict below is `runSpecSuite`'s own — a whitelisted example
   * is "green" while it keeps failing, and red the moment it starts passing.
   *
   * ~300ms. It is worth that: this figure has now been wrong twice in prose,
   * and it is the entire justification for preferring a set-equality check over
   * output assertions.
   */
  it('SHAPE-slot rules are invisible to the spec suite: 7 of 13 leave it fully green', () => {
    const suites: [SuiteId, SpecExample[]][] = [
      ['commonmark-0.31.2', commonmarkExamples as SpecExample[]],
      ['gfm-0.29', gfmExamples as SpecExample[]],
    ]

    // The per-example verdict is `runSpecSuite`'s own, because it is literally the same function:
    // `judgeSpecExample` in spec/harness.ts. This block used to re-implement it — the extension
    // lookup, the engine construction, the normalisation, and the whitelist rule that a listed
    // example is "green" while it keeps failing — which meant the figure this test reports could
    // drift away from the suite it claims to be measuring without either side noticing.
    //
    // The try/catch stays here rather than moving into the harness: `renderForSpec` throws by
    // design on an extension name nobody recognises (Task 32a), and `runSpecSuite` must see that
    // throw. For THIS test a render that explodes and a render that is wrong are the same answer,
    // so it converts both to "not green" at its own call site.
    const green = (suiteId: SuiteId, e: SpecExample, injected: Rule | null): boolean => {
      try {
        return judgeSpecExample(suiteId, e, injected ? [injected] : []).green
      } catch {
        return false
      }
    }

    // The suite really is green to begin with; otherwise "still green" is empty.
    for (const [id, examples] of suites) {
      expect(examples.filter((e) => !green(id, e, null))).toHaveLength(0)
    }

    const candidates: Rule[] = [...SHAPE_RULES, applyRawShape]
    expect(candidates).toHaveLength(13)
    const sneakPast = candidates
      .filter((rule) => suites.every(([id, exs]) => exs.every((e) => green(id, e, rule))))
      .map((rule) => rule.name)

    expect(sneakPast).toEqual([
      'applyFrontmatter',
      'applyFootnote',
      'applyMathInline',
      'applyMathBlock',
      'applyEmoji',
      'applyAlerts',
      'applyTaskList',
    ])
  })

  /**
   * `createEngine` calls exactly three rules outside the two arrays, and each
   * has a stated reason it cannot live in one — this is the "+3" in the
   * completeness arithmetic below, written out rather than left as a literal:
   *
   *  - `applyCodeBlock(md, opts.highlighter)` and
   *    `applyRawHtmlPolicy(md, opts.allowDangerousHtml)` take a second
   *    argument, so neither matches `Rule = (md: MarkdownIt) => void`. The
   *    arrays are typed `Rule[]`; these two simply do not fit.
   *  - `applyRawShape(md)` fits the signature but must be registered AFTER
   *    `applyRawHtmlPolicy` (engine.ts coupling #4, rules/rawshape.ts's C3(a)
   *    note). Core rules run in push order and every array member runs before
   *    the sanitizer, so membership in `SHAPE_RULES` would silently delete all
   *    five of its decorations.
   *
   * `applyTagfilter` is a fourth CALL but not a fourth rule: it is a member of
   * `SEMANTIC_RULES` and is deliberately registered a SECOND time as
   * `createEngine`'s last step, so the filter is the innermost AND the
   * outermost `html_block`/`html_inline` renderer link at once. The set logic
   * below is by function identity, so the duplicate collapses on its own and
   * the count stays 19 — see rules/tagfilter.ts for why this is free.
   */
  const RULES_CALLED_OUTSIDE_THE_ARRAYS: readonly Rule[] = [
    applyCodeBlock as Rule,
    applyRawHtmlPolicy as unknown as Rule,
    applyRawShape,
    applyTagfilter, // ← also in SEMANTIC_RULES; registered twice on purpose
  ]

  /**
   * Three exported `applyXxx` bindings are NOT engine-level rules and are
   * deliberately excluded from the count. Each is reachable only through one
   * of the wired rules above, never from `createEngine` directly:
   *
   *  - `applyRawHtmlTransform` is the shared combinator in rules/clobber.ts
   *    that the sanitizer, the clobber filter and `applyRawShape` are all
   *    built on. It takes a transform, not just an `md`.
   *  - `applyClobber` and `applySanitize` are the two branches
   *    `applyRawHtmlPolicy` dispatches to on `allowDangerousHtml`.
   */
  const NOT_ENGINE_RULES: ReadonlySet<string> = new Set([
    'applyRawHtmlTransform',
    'applyClobber',
    'applySanitize',
  ])

  /**
   * ## Why this scan is not a regex any more
   *
   * It used to be `/^export (?:function|const) (apply\w+)/gm` over a
   * NON-RECURSIVE `readdirSync(src/rules)` plus the one path `src/sanitize.ts`.
   * Measured blind spots: `export let`, `export var`, `export { applyX }`,
   * `export { a as applyX }`, `export default function applyX`, an indented
   * `export`, anything under `src/rules/<subdir>/`, and any new top-level
   * `src/*.ts`.
   *
   * Those blind spots fail in the WRONG direction. A missed-form rule that IS
   * wired makes the two sides of the comparison disagree and fails loudly; a
   * missed-form rule that is NOT wired simply never appears on either side and
   * passes — which is precisely the case this guard exists to catch.
   *
   * Importing each module and reading its namespace object is agnostic to how
   * the binding was declared, recurses, typechecks under `tsc --noEmit`, and
   * needs no network. `import.meta.glob` would also work but is Vite-only.
   *
   * The self-test below runs this same function over
   * test/integration/rule-forms/, which contains one of each missed form.
   *
   * ## What it still cannot see, stated so the guard does not read as total
   *
   *  1. File extensions. `TS_FILE` below covers `.ts`, `.mts`, `.cts` and
   *     `.tsx`; a rule in a `.js` file, or in any extension not listed there,
   *     is still invisible. (This used to be `.endsWith('.ts')`, so `.mts` /
   *     `.cts` / `.tsx` were blind spots too.)
   *  2. `export default () => {}` — an ANONYMOUS default export has no
   *     recoverable name, so the `apply` prefix test below can never see it.
   *     There is no fix inside the scan: the name simply is not there. It is
   *     closed at the source end instead, by
   *     `no src module has a default export` below.
   *
   * Neither is realistic under this repo's conventions — every rule is
   * `export function applyXxx` in a `.ts` file — but both fail in the
   * silent-pass direction, so both are named rather than assumed away.
   */
  const TS_FILE = /\.(?:m|c)?tsx?$/

  function tsFilesUnder(dir: string): string[] {
    const files: string[] = []
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const p = join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (TS_FILE.test(entry.name)) files.push(p)
      }
    }
    walk(dir)
    return files
  }

  async function exportedApplyRules(dir: string): Promise<Map<string, Rule>> {
    const files = tsFilesUnder(dir)

    const found = new Map<string, Rule>()
    for (const file of files) {
      const mod: Record<string, unknown> = await import(pathToFileURL(file).href)
      for (const [binding, value] of Object.entries(mod)) {
        if (typeof value !== 'function') continue
        // `export default function applyX` binds as `default`; the declared
        // name survives on the function itself.
        const name = binding === 'default' ? ((value as { name?: string }).name ?? '') : binding
        if (!name.startsWith('apply')) continue
        found.set(name, value as Rule)
      }
    }
    return found
  }

  /**
   * Names of exported rules no wiring site reaches. Compared by function
   * IDENTITY, not by name: `export { helper as applyX }` makes the exported
   * spelling and `fn.name` disagree while being the same function, and what
   * this guard means by "wired" is "reachable from `createEngine`", which is an
   * identity question.
   */
  function unwiredNames(exported: ReadonlyMap<string, Rule>): string[] {
    const wired = new Set<Rule>([
      ...SEMANTIC_RULES,
      ...SHAPE_RULES,
      ...RULES_CALLED_OUTSIDE_THE_ARRAYS,
    ])
    return [...exported]
      .filter(([name, fn]) => !NOT_ENGINE_RULES.has(name) && !wired.has(fn))
      .map(([name]) => name)
      .sort()
  }

  const SRC_DIR = join(import.meta.dirname, '../src')

  it('every exported applyXxx is wired by exactly one of the three sites', async () => {
    const exported = await exportedApplyRules(SRC_DIR)
    expect(unwiredNames(exported)).toEqual([])

    // The other direction: nothing is wired that src does not export.
    const exportedFns = new Set(exported.values())
    const wired = new Set<Rule>([
      ...SEMANTIC_RULES,
      ...SHAPE_RULES,
      ...RULES_CALLED_OUTSIDE_THE_ARRAYS,
    ])
    expect(
      [...wired].filter((fn) => !exportedFns.has(fn)).map((fn) => fn.name).sort(),
    ).toEqual([])

    // The count, which the two set checks above do not by themselves pin.
    // Measured 2026-08-08: 22 exported `applyXxx` bindings across all of src/,
    // minus the 3 non-rules above == 19 distinct wired functions.
    const rules = [...exported.keys()].filter((n) => !NOT_ENGINE_RULES.has(n))
    expect(rules).toHaveLength(19)
    expect(wired.size).toBe(rules.length)
  })

  /**
   * The guard's own coverage, pinned so it cannot be "simplified" back into a
   * regex. test/integration/rule-forms/ declares seven `applyXxx` exports, one
   * per blind spot listed above, none of them wired anywhere.
   */
  const MISSED_FORMS = [
    'applyDefaultExport', // export default function applyX
    'applyExportAlias', // export { a as applyX }
    'applyExportBrace', // export { applyX }
    'applyExportLet', // export let applyX
    'applyExportVar', // export var applyX
    'applyIndentedExport', // indented export function applyX
    'applyInsideASubdirectory', // a file the non-recursive readdirSync never saw
  ]

  it('the scan sees every declaration form the regex missed', async () => {
    const dir = join(import.meta.dirname, 'integration/rule-forms')
    expect([...(await exportedApplyRules(dir)).keys()].sort()).toEqual(MISSED_FORMS)

    // What the replaced regex finds in the same tree, given the same
    // non-recursive file list it used to build: nothing at all.
    const topLevel = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f))
    const byRegex = topLevel
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^export (?:function|const) (apply\w+)/gm)])
      .map((m) => m[1] as string)
    expect(byRegex).toEqual([])
  })

  /**
   * Blind spot 1, closed: the file walker now matches every TypeScript
   * extension, not just `.ts`. Asserted directly because the src tree happens
   * to contain only `.ts` files, so nothing else here would notice a
   * regression in the pattern.
   */
  it('the file walker matches every TypeScript extension, not just .ts', () => {
    for (const name of ['a.ts', 'a.mts', 'a.cts', 'a.tsx', 'a.d.ts']) {
      expect(TS_FILE.test(name), name).toBe(true)
    }
    for (const name of ['a.js', 'a.json', 'a.md', 'a.tsbuildinfo', 'ts']) {
      expect(TS_FILE.test(name), name).toBe(false)
    }
    // And it really is the walker's filter: every src file is picked up.
    expect(tsFilesUnder(SRC_DIR).length).toBeGreaterThanOrEqual(20)
  })

  /**
   * Blind spot 2, closed at the source end because it cannot be closed in the
   * scan: `export default () => {}` gives the namespace object a `default`
   * binding whose function has an empty `.name`, so no `apply` prefix is ever
   * recoverable and an unwired rule in that form would pass silently.
   *
   * src/ has no default exports at all — every rule is a named
   * `export function applyXxx` — so the form simply must not appear. Asserting
   * that is what makes the guard above total over src/, and it is a convention
   * worth holding anyway. `test/integration/rule-forms/` deliberately keeps a
   * NAMED `export default function applyDefaultExport`, which the scan does see.
   */
  it('no src module has a default export, so the anonymous-default form cannot hide one', async () => {
    const withDefault: string[] = []
    for (const file of tsFilesUnder(SRC_DIR)) {
      const mod: Record<string, unknown> = await import(pathToFileURL(file).href)
      if ('default' in mod) withDefault.push(file.slice(SRC_DIR.length + 1))
    }
    expect(withDefault).toEqual([])
  })

  /**
   * The failure direction the regex got wrong, exercised end to end: an
   * unwired rule in ANY of those forms is reported, rather than passing
   * silently because the scan never saw it.
   */
  it('reports an unwired rule no matter which form it was declared in', async () => {
    const exported = new Map([
      ...(await exportedApplyRules(SRC_DIR)),
      ...(await exportedApplyRules(join(import.meta.dirname, 'integration/rule-forms'))),
    ])
    expect(unwiredNames(exported)).toEqual(MISSED_FORMS)
  })
})
