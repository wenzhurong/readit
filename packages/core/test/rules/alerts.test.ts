import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { applyAlerts, ALERT_ICON_PATHS } from '../../src/rules/alerts.js'

function md() {
  const m = new MarkdownIt({ html: true })
  applyAlerts(m)
  return m
}

const stripPaths = (s: string) => s.replace(/(<path d=")[^"]+/g, '$1PATH')

describe('alerts', () => {
  it('renders a note alert with GitHub blob-view DOM', () => {
    expect(md().render('> [!NOTE]\n> Useful information.\n')).toBe(
      '<div class="markdown-alert markdown-alert-note" dir="auto">' +
        '<p class="markdown-alert-title" dir="auto">' +
        '<svg data-component="Octicon" class="octicon octicon-info mr-2" viewBox="0 0 16 16" ' +
        'version="1.1" width="16" height="16" aria-hidden="true">' +
        `<path d="${ALERT_ICON_PATHS.note}"></path></svg>Note</p>` +
        '<p>Useful information.</p>\n' +
        '</div>\n',
    )
  })

  it('maps all five types to the right octicon and Title-Case label', () => {
    const got = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map((t) =>
      stripPaths(md().render(`> [!${t}]\n> x\n`)).split('<p>x')[0],
    )
    expect(got).toEqual([
      '<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto"><svg data-component="Octicon" class="octicon octicon-info mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="PATH"></path></svg>Note</p>',
      '<div class="markdown-alert markdown-alert-tip" dir="auto"><p class="markdown-alert-title" dir="auto"><svg data-component="Octicon" class="octicon octicon-light-bulb mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="PATH"></path></svg>Tip</p>',
      '<div class="markdown-alert markdown-alert-important" dir="auto"><p class="markdown-alert-title" dir="auto"><svg data-component="Octicon" class="octicon octicon-report mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="PATH"></path></svg>Important</p>',
      '<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg data-component="Octicon" class="octicon octicon-alert mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="PATH"></path></svg>Warning</p>',
      '<div class="markdown-alert markdown-alert-caution" dir="auto"><p class="markdown-alert-title" dir="auto"><svg data-component="Octicon" class="octicon octicon-stop mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="PATH"></path></svg>Caution</p>',
    ])
  })

  it('accepts a lowercase type name', () => {
    expect(md().render('> [!note]\n> x\n')).toContain('markdown-alert-note')
  })

  it('drops the marker paragraph when the marker is alone on its own paragraph', () => {
    expect(md().render('> [!NOTE]\n>\n> body after blank\n')).toBe(
      '<div class="markdown-alert markdown-alert-note" dir="auto">' +
        '<p class="markdown-alert-title" dir="auto">' +
        '<svg data-component="Octicon" class="octicon octicon-info mr-2" viewBox="0 0 16 16" ' +
        'version="1.1" width="16" height="16" aria-hidden="true">' +
        `<path d="${ALERT_ICON_PATHS.note}"></path></svg>Note</p>\n` +
        '<p>body after blank</p>\n' +
        '</div>\n',
    )
  })

  const negatives: [string, string][] = [
    ['title on the same line', '> [!NOTE] with title\n> body\n'],
    ['nested in another blockquote', '> > [!NOTE]\n> > nested\n'],
    ['inside a list item', '- > [!NOTE]\n  > in list\n'],
    ['not the first line', '> text first\n> [!NOTE]\n'],
    ['no body at all', '> [!NOTE]\n'],
    ['unknown type', '> [!BOGUS]\n> x\n'],
  ]
  for (const [name, src] of negatives) {
    it(`does not fire: ${name}`, () => {
      expect(md().render(src)).not.toContain('markdown-alert')
    })
  }

  it('leaves plain blockquotes alone', () => {
    expect(md().render('> just a quote\n')).toBe(
      '<blockquote>\n<p>just a quote</p>\n</blockquote>\n',
    )
  })
})
