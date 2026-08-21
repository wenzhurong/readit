import { describe, expect, it, vi } from 'vitest'
import {
  observeLocalResources,
  resourceProtocolBase,
  rewriteLocalResources,
  toReaditResourceUrl,
} from '../src/resources.js'

describe('readit resource URLs', () => {
  it('uses the WebView2 mapped origin on Windows and the custom scheme elsewhere', () => {
    expect(resourceProtocolBase('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      'http://readit.localhost/',
    )
    expect(resourceProtocolBase('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(
      'readit://localhost/',
    )
  })

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

  it('uses one injected protocol base for every supported resource attribute', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<img src="images/a.png"><video src="movie.mp4" poster="cover.png">' +
      '<source src="movie.webm"></video><audio src="sound.mp3"></audio>'

    rewriteLocalResources(root, 'http://readit.localhost/')

    expect([
      root.querySelector('img')?.getAttribute('src'),
      root.querySelector('video')?.getAttribute('src'),
      root.querySelector('video')?.getAttribute('poster'),
      root.querySelector('source')?.getAttribute('src'),
      root.querySelector('audio')?.getAttribute('src'),
    ]).toEqual([
      'http://readit.localhost/images/a.png',
      'http://readit.localhost/movie.mp4',
      'http://readit.localhost/cover.png',
      'http://readit.localhost/movie.webm',
      'http://readit.localhost/sound.mp3',
    ])
  })

  it('rewrites resources added by an asynchronous element repaint', async () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    const stop = observeLocalResources(host, 'http://readit.localhost/')
    const image = document.createElement('img')
    image.setAttribute('src', 'after-render.png')

    shadow.append(image)
    await Promise.resolve()

    expect(image.getAttribute('src')).toBe('http://readit.localhost/after-render.png')
    stop()
  })
})
