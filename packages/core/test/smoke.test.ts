import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIONS,
  prepare,
  readFrontmatterOptions,
  render,
  renderWithExplain,
} from '../src/index.js'

/**
 * Written in Task 2, when SEMANTIC_RULES and SHAPE_RULES were both still empty
 * arrays, so render() was bare markdown-it and these assertions expected bare
 * CommonMark output. Task 32a wired all 16 rules — render() now produces
 * GitHub's actual shape end to end, so the expectations below were rewritten
 * to the real, exact output (not toContain/toMatch) precisely because this is
 * the first place a full render() result can be pinned byte for byte.
 */
describe('core skeleton', () => {
  it('renders an ATX heading with the full GitHub shape (wrapper div, anchor link, dir/data-line)', () => {
    expect(render('# hi')).toBe(
      '<div class="markdown-heading" dir="auto">' +
        '<h1 class="heading-element" dir="auto" data-line="0">hi</h1>' +
        '<a id="user-content-hi" class="anchor" aria-label="Permalink: hi" href="#hi">' +
        '<svg data-component="Octicon" class="octicon octicon-link" viewBox="0 0 16 16" ' +
        'version="1.1" width="16" height="16" aria-hidden="true">' +
        '<path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 ' +
        '.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 ' +
        '2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 ' +
        '9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l' +
        '-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751' +
        '.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z">' +
        '</path></svg></a></div>\n',
    )
  })

  it('renderWithExplain returns the same html plus an empty explain log by default', () => {
    const { html, explain } = renderWithExplain('# hi')
    expect(html).toBe(render('# hi'))
    expect(explain).toEqual([])
  })

  it('renderWithExplain returns a non-empty log end to end when explain is true', () => {
    // Closes the plumbing gap flagged by Task 27: render()/renderWithExplain()
    // must build env = { readit: resolvedOptions }, pass it into md.render(src,
    // env), and read env.readitExplain back out — math-inline.ts's core rule is
    // the only thing that ever writes to env.readitExplain, so a non-empty
    // result here proves the env object created in index.ts is the *same*
    // object instance math-inline.ts's rule mutates, not a copy.
    const { explain } = renderWithExplain('costs $5 or $10, not math', {
      explain: true,
    })
    expect(explain.length).toBeGreaterThan(0)
    expect(explain[0]).toMatchObject({ ruleId: expect.any(String) })
  })

  it('sanitizes raw HTML against the GitHub whitelist by default; passes it through (tagfilter-escaped) with allowDangerousHtml', () => {
    // <script> is not on hast-util-sanitize's default schema, so the default
    // path drops the whole disallowed element (and its content) rather than
    // escaping it — sanitizeTree(), not a blanket text escape. See sanitize.ts.
    expect(render('<script>x</script>')).toBe('')
    // allowDangerousHtml disables the sanitizer, but applyTagfilter is a
    // SEMANTIC rule (always on, matches GFM spec) and still escapes the
    // leading '<' of the 9 filtered tag names — script included.
    expect(render('<script>x</script>', { allowDangerousHtml: true })).toBe(
      '&lt;script>x&lt;/script>',
    )
  })

  it('prepare merges partial options over the defaults', async () => {
    await expect(prepare('# hi', { inlineMath: 'off' })).resolves.toEqual({
      ...DEFAULT_OPTIONS,
      inlineMath: 'off',
    })
  })

  it('readFrontmatterOptions returns an empty object', () => {
    expect(readFrontmatterOptions('---\nreadit-inline-math: off\n---\n')).toEqual(
      {},
    )
  })
})
