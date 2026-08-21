import { describe, expect, it, vi } from 'vitest'
import { connectExternalLinks } from '../src/external-links.js'
import { routeDocumentOpen } from '../src/navigation.js'

interface LinkFixture {
  readonly host: HTMLElement
  readonly anchor: HTMLAnchorElement
  readonly status: HTMLElement
  readonly openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>
  click(preventDefault?: boolean): MouseEvent
}

function fixture(href: string): LinkFixture {
  document.body.innerHTML = '<main><div id="reader"></div><p id="status" hidden></p></main>'
  const host = document.querySelector<HTMLElement>('#reader')!
  const status = document.querySelector<HTMLElement>('#status')!
  const root = host.attachShadow({ mode: 'open' })
  const anchor = document.createElement('a')
  anchor.setAttribute('href', href)
  anchor.setAttribute('target', '_blank')
  anchor.innerHTML = '<span>link</span>'
  root.append(anchor)
  const openExternal = vi.fn(async (_url: string) => {})
  connectExternalLinks(host, {
    openExternal,
    showFeedback(message) {
      status.hidden = false
      status.textContent = message
    },
  })
  return {
    host,
    anchor,
    status,
    openExternal,
    click(preventDefault = false) {
      const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
      if (preventDefault) event.preventDefault()
      anchor.querySelector('span')!.dispatchEvent(event)
      return event
    },
  }
}

function blockedResult(href: string): readonly [number, boolean, boolean, boolean] {
  const view = fixture(href)
  const event = view.click()
  return [
    view.openExternal.mock.calls.length,
    event.defaultPrevented,
    view.status.hidden,
    view.status.textContent?.includes('已阻止') ?? false,
  ]
}

describe('external link allowlist', () => {
  it('blocks javascript: without calling opener and shows feedback', () => {
    expect(blockedResult('javascript:alert(1)')).toEqual([0, true, false, true])
  })

  it('blocks file: without calling opener and shows feedback', () => {
    expect(blockedResult('file:///etc/passwd')).toEqual([0, true, false, true])
  })

  it('blocks data: without calling opener and shows feedback', () => {
    expect(blockedResult('data:text/html,<h1>bad</h1>')).toEqual([0, true, false, true])
  })

  it('blocks vscode: without calling opener and shows feedback', () => {
    expect(blockedResult('vscode://file/etc/passwd')).toEqual([0, true, false, true])
  })

  it('blocks mixed-case JavaScript: without calling opener and shows feedback', () => {
    expect(blockedResult('JavaScript:alert(1)')).toEqual([0, true, false, true])
  })

  it('also blocks mailto: and protocol-relative URLs because the product grants only http(s)', () => {
    expect([blockedResult('mailto:reader@example.com'), blockedResult('//example.com/path')]).toEqual([
      [0, true, false, true],
      [0, true, false, true],
    ])
  })

  it('opens http and https through the injected opener while retaining the current document', async () => {
    const http = fixture('http://example.com/a')
    const https = fixture('HTTPS://example.com/b')
    const httpEvent = http.click()
    const httpsEvent = https.click()
    await Promise.resolve()

    expect({
      opened: [http.openExternal.mock.calls[0]?.[0], https.openExternal.mock.calls[0]?.[0]],
      prevented: [httpEvent.defaultPrevented, httpsEvent.defaultPrevented],
      feedbackHidden: [http.status.hidden, https.status.hidden],
    }).toEqual({
      opened: ['http://example.com/a', 'https://example.com/b'],
      prevented: [true, true],
      feedbackHidden: [true, true],
    })
  })

  it('does not intercept relative paths or document hashes', () => {
    const relative = fixture('./other.md')
    const hash = fixture('#section')
    relative.click(true)
    hash.click(true)

    expect({
      opened: [relative.openExternal.mock.calls.length, hash.openExternal.mock.calls.length],
      feedbackHidden: [relative.status.hidden, hash.status.hidden],
    }).toEqual({ opened: [0, 0], feedbackHidden: [true, true] })
  })

  it('does not classify Windows drive paths as external schemes', () => {
    const slash = fixture('D:/docs/next.md')
    const backslash = fixture('C:\\docs\\next.md')
    // Pre-cancel the browser default so happy-dom does not try to navigate to a
    // drive-letter scheme. The shell capture listener still runs, so feedback
    // distinguishes the old misclassification from the fixed pass-through.
    slash.click(true)
    backslash.click(true)

    expect({
      opened: [slash.openExternal.mock.calls.length, backslash.openExternal.mock.calls.length],
      feedbackHidden: [slash.status.hidden, backslash.status.hidden],
    }).toEqual({ opened: [0, 0], feedbackHidden: [true, true] })
  })

  it('lets a second-instance drive path reach the element navigation contract', () => {
    document.body.innerHTML = '<main><div id="reader"></div><p id="status" hidden></p></main>'
    const host = document.querySelector<HTMLElement>('#reader')!
    const status = document.querySelector<HTMLElement>('#status')!
    const openExternal = vi.fn(async (_url: string) => {})
    connectExternalLinks(host, {
      openExternal,
      showFeedback(message) {
        status.hidden = false
        status.textContent = message
      },
    })
    let routed = ''
    host.addEventListener('click', (event) => {
      if (event.defaultPrevented) return
      routed = (event.target as HTMLAnchorElement).getAttribute('href') ?? ''
      event.preventDefault()
    })

    routeDocumentOpen(host, '\\\\?\\D:\\docs\\next.md')

    expect({ routed, opened: openExternal.mock.calls.length, feedbackHidden: status.hidden }).toEqual({
      routed: 'D:/docs/next.md', opened: 0, feedbackHidden: true,
    })
  })
})
