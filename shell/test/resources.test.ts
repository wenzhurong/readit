import { describe, expect, it, vi } from 'vitest'
import {
  observeLocalResources,
  rewriteLocalResources,
  toReaditResourceUrl,
} from '../src/resources.js'

describe('readit resource URLs', () => {
  it('encodes local paths without double-encoding existing escapes', () => {
    expect(toReaditResourceUrl('images/hello world.png?raw=1#preview')).toBe(
      'readit://localhost/images/hello%20world.png?raw=1#preview',
    )
    expect(toReaditResourceUrl('images/already%20encoded.png')).toBe(
      'readit://localhost/images/already%20encoded.png',
    )
    expect(toReaditResourceUrl('/root image.png')).toBe(
      'readit://localhost/root%20image.png',
    )
  })

  it('does not rewrite remote, embedded, fragment, or escaping paths', () => {
    for (const value of [
      'https://example.com/a.png',
      '//example.com/a.png',
      'data:image/png;base64,AA==',
      'blob:https://example.com/id',
      '#fragment',
      '../outside.png',
      'nested/../../outside.png',
    ]) {
      expect(toReaditResourceUrl(value)).toBeNull()
    }
  })

  it('rewrites supported resource attributes in a rendered subtree', () => {
    const root = document.createElement('div')
    const selectors: string[] = []
    const querySelectorAll = root.querySelectorAll.bind(root)
    vi.spyOn(root, 'querySelectorAll').mockImplementation((selector: string) => {
      selectors.push(selector)
      return querySelectorAll(selector)
    })
    root.innerHTML =
      '<img src="images/a b.png"><video poster="cover.png"><source src="movie.webm"></video>' +
      '<img src="https://example.com/remote.png">'

    rewriteLocalResources(root)

    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      'readit://localhost/images/a%20b.png',
    )
    expect(root.querySelector('video')?.getAttribute('poster')).toBe(
      'readit://localhost/cover.png',
    )
    expect(root.querySelector('source')?.getAttribute('src')).toBe(
      'readit://localhost/movie.webm',
    )
    expect(root.querySelectorAll('img')[1]?.getAttribute('src')).toBe(
      'https://example.com/remote.png',
    )
    expect(selectors.slice(0, 5)).toEqual([
      'img[src]',
      'source[src]',
      'audio[src]',
      'video[src]',
      'video[poster]',
    ])
  })

  it('rewrites resources added by an asynchronous element repaint', async () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const stop = observeLocalResources(host)
    const image = document.createElement('img')
    image.setAttribute('src', 'after-render.png')

    shadow.append(image)
    await Promise.resolve()

    expect(image.getAttribute('src')).toBe('readit://localhost/after-render.png')
    stop()
  })
})
