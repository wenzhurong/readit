import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIONS,
  prepare,
  readFrontmatterOptions,
  render,
  renderWithExplain,
} from '../src/index.js'

describe('core skeleton', () => {
  it('renders an ATX heading', () => {
    expect(render('# hi')).toBe('<h1>hi</h1>\n')
  })

  it('renderWithExplain returns html plus an empty explain log by default', () => {
    expect(renderWithExplain('# hi')).toEqual({
      html: '<h1>hi</h1>\n',
      explain: [],
    })
  })

  it('escapes raw HTML unless allowDangerousHtml is set', () => {
    expect(render('<b>x</b>')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>\n')
    expect(render('<b>x</b>', { allowDangerousHtml: true })).toBe(
      '<p><b>x</b></p>\n',
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
