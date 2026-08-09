import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyTaskList } from '../../src/rules/tasklist.js'
import { applyDirAuto } from '../../src/rules/dirauto.js'

function md() {
  return new MarkdownIt('default', { html: true, linkify: false })
    .use(applyTaskList)
    .use(applyDirAuto)
}

/** Verbatim from GET /repos/microsoft/vscode/contents/CONTRIBUTING.md, 2026-08-06. */
const UNCHECKED =
  '<input type="checkbox" id="" disabled="" class="task-list-item-checkbox" aria-label="Incomplete task">'
/** Verbatim from GET /repos/kamiyaa/joshuto/contents/README.md, 2026-08-06. */
const CHECKED =
  '<input type="checkbox" id="" disabled="" class="task-list-item-checkbox" aria-label="Completed task" checked="">'

describe('applyTaskList', () => {
  it('matches the byte-exact GitHub shape for an unchecked item', () => {
    expect(md().render('- [ ] Recreate the issue after disabling all extensions\n')).toBe(
      '<ul class="contains-task-list">\n' +
        '<li class="task-list-item">' +
        UNCHECKED +
        ' Recreate the issue after disabling all extensions</li>\n' +
        '</ul>\n',
    )
  })

  it('matches the byte-exact GitHub shape for a checked item', () => {
    expect(md().render('- [x] Built-in command line\n')).toBe(
      '<ul class="contains-task-list">\n' +
        '<li class="task-list-item">' +
        CHECKED +
        ' Built-in command line</li>\n' +
        '</ul>\n',
    )
  })

  it('emits readit_raw, not html_inline, so the sanitizer never sees its classes', () => {
    const kinds = new MarkdownIt('default', { html: true, linkify: false })
      .use(applyTaskList)
      .parse('- [x] a\n', {})
      .flatMap((t) => t.children ?? [])
      .map((t) => t.type)
    expect(kinds).toContain('readit_raw')
    expect(kinds).not.toContain('html_inline')
  })

  it('emits attributes in GitHub order: type, id, disabled, class, aria-label, checked', () => {
    const html = md().render('- [X] done\n')
    const input = /<input[^>]*>/.exec(html)?.[0] ?? ''
    expect(input).toBe(CHECKED)
    const names = [...input.matchAll(/\s([a-z-]+)=/g)].map((m) => m[1])
    expect(names).toEqual(['type', 'id', 'disabled', 'class', 'aria-label', 'checked'])
  })

  it('suppresses dir="auto" on the task list but keeps it on plain lists', () => {
    expect(md().render('- [ ] a\n')).toContain('<ul class="contains-task-list">')
    expect(md().render('- [ ] a\n')).not.toContain('dir="auto"')
    expect(md().render('- plain\n')).toContain('<ul dir="auto">')
  })

  it('marks only the task items and only the lists that contain one', () => {
    expect(md().render('- [x] Built-in command line\n  - Mostly working\n  - [ ] Tab autocomplete\n')).toBe(
      '<ul class="contains-task-list">\n' +
        '<li class="task-list-item">' +
        CHECKED +
        ' Built-in command line\n' +
        '<ul class="contains-task-list">\n' +
        '<li>Mostly working</li>\n' +
        '<li class="task-list-item">' +
        UNCHECKED +
        ' Tab autocomplete</li>\n' +
        '</ul>\n' +
        '</li>\n' +
        '</ul>\n',
    )
  })

  it('leaves a nested list with no task items as a plain dir="auto" list', () => {
    expect(md().render('- [ ] outer\n  - inner\n')).toBe(
      '<ul class="contains-task-list">\n' +
        '<li class="task-list-item">' +
        UNCHECKED +
        ' outer\n' +
        '<ul dir="auto">\n<li>inner</li>\n</ul>\n' +
        '</li>\n' +
        '</ul>\n',
    )
  })

  it('does not treat a bracket without following whitespace as a checkbox', () => {
    expect(md().render('- [x]nospace\n')).toBe('<ul dir="auto">\n<li>[x]nospace</li>\n</ul>\n')
    expect(md().render('- [y] wrong char\n')).toBe(
      '<ul dir="auto">\n<li>[y] wrong char</li>\n</ul>\n',
    )
  })

  it('does not treat a checkbox outside the first position as a task item', () => {
    expect(md().render('- text [x] more\n')).toBe(
      '<ul dir="auto">\n<li>text [x] more</li>\n</ul>\n',
    )
  })

  it('handles ordered lists the same way', () => {
    expect(md().render('1. [ ] a\n')).toBe(
      '<ol class="contains-task-list">\n' +
        '<li class="task-list-item">' +
        UNCHECKED +
        ' a</li>\n' +
        '</ol>\n',
    )
  })

  it('works in a loose list where the paragraph is rendered', () => {
    expect(md().render('- [ ] a\n\n- [ ] b\n')).toBe(
      '<ul class="contains-task-list">\n' +
        '<li class="task-list-item">\n<p dir="auto">' +
        UNCHECKED +
        ' a</p>\n</li>\n' +
        '<li class="task-list-item">\n<p dir="auto">' +
        UNCHECKED +
        ' b</p>\n</li>\n' +
        '</ul>\n',
    )
  })
})
