import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPTIONS } from '../src/types.js'
import { prepare, scan, DEFAULT_LOADERS, type Loaders } from '../src/prepare.js'

const noLoaders: Loaders = {
  math: () => { throw new Error('math loader must not be called') },
  highlighter: null,
}

describe('scan', () => {
  it('finds no math in a document with no dollars and no math fence', () => {
    const s = scan('# Title\n\nSome prose with a `code span`.\n', 'github')
    expect(s.needsMath).toBe(false)
    expect(s.needsMermaid).toBe(false)
    expect(s.needsHighlight).toBe(false)
    expect(s.languages).toEqual([])
  })

  it('finds math from a single dollar in github mode', () => {
    expect(scan('cost is $5', 'github').needsMath).toBe(true)
  })

  it('ignores single dollars when inlineMath is off, but still sees $$ and ```math', () => {
    expect(scan('cost is $5', 'off').needsMath).toBe(false)
    expect(scan('$$x^2$$', 'off').needsMath).toBe(true)
    expect(scan('```math\nx^2\n```', 'off').needsMath).toBe(true)
    expect(scan('~~~math\nx^2\n~~~', 'off').needsMath).toBe(true)
  })

  it('finds mermaid and fence languages, excluding math and mermaid from languages', () => {
    const s = scan('```mermaid\ngraph TD;\n```\n\n```ts\nlet a = 1\n```\n\n```math\nx\n```\n', 'github')
    expect(s.needsMermaid).toBe(true)
    expect(s.needsHighlight).toBe(true)
    expect(s.languages).toEqual(['ts'])
  })

  it('does not treat a bare fence as a language', () => {
    const s = scan('```\nplain\n```\n', 'github')
    expect(s.needsHighlight).toBe(false)
    expect(s.languages).toEqual([])
  })

  it('deduplicates languages and keeps first-seen order', () => {
    expect(scan('```js\na\n```\n```py\nb\n```\n```js\nc\n```\n', 'github').languages).toEqual(['js', 'py'])
  })
})

describe('prepare', () => {
  it('leaves math null and never touches the loader for a document with no math', async () => {
    const opts = await prepare('# Hello\n\nno math here\n', {}, noLoaders)
    expect(opts.math).toBeNull()
    expect(opts).toEqual({ ...DEFAULT_OPTIONS })
  })

  it('loads a math renderer for a document that has math', async () => {
    const opts = await prepare('inline $x^2$ math\n')
    expect(opts.math).not.toBeNull()
    expect(opts.math!.render('x^2', false).startsWith('<mjx-container')).toBe(true)
  })

  it('calls the math loader exactly once', async () => {
    const math = vi.fn(DEFAULT_LOADERS.math)
    const opts = await prepare('$a$ and $b$ and $$c$$\n', {}, { math, highlighter: null })
    expect(math).toHaveBeenCalledTimes(1)
    expect(opts.math).not.toBeNull()
  })

  it('respects an explicitly supplied math renderer and does not load another', async () => {
    const injected = { render: () => '<stub/>' }
    const opts = await prepare('$x$', { math: injected }, noLoaders)
    expect(opts.math).toBe(injected)
  })

  it('does not load math when inlineMath is off and only single dollars are present', async () => {
    const opts = await prepare('it costs $5 and $6', { inlineMath: 'off' }, noLoaders)
    expect(opts.math).toBeNull()
    expect(opts.inlineMath).toBe('off')
  })

  it('carries the remaining option fields through unchanged', async () => {
    const opts = await prepare('plain', { allowDangerousHtml: true, explain: true }, noLoaders)
    expect(opts.allowDangerousHtml).toBe(true)
    expect(opts.explain).toBe(true)
    expect(opts.inlineMath).toBe('github')
    expect(opts.highlighter).toBeNull()
  })

  it('leaves highlighter null while no highlighter loader is registered', async () => {
    expect(DEFAULT_LOADERS.highlighter).toBeNull()
    const opts = await prepare('```ts\nlet a = 1\n```\n')
    expect(opts.highlighter).toBeNull()
  })
})
