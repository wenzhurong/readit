import { afterEach, describe, expect, it } from 'vitest'
import { connectModifierClicks } from '../src/modifier-clicks.js'

function setup(href: string) {
  const reader = document.createElement('div')
  const host = document.createElement('div')
  reader.append(host)
  document.body.append(reader)
  const shadow = host.attachShadow({ mode: 'open' })
  const anchor = document.createElement('a')
  anchor.setAttribute('href', href)
  anchor.textContent = 'link'
  shadow.append(anchor)
  // 代替元素的点击监听：记下它收到的每一次点击带不带修饰键。
  const received: boolean[] = []
  shadow.addEventListener('click', (event) => {
    received.push((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey)
    event.preventDefault()
  })
  const stop = connectModifierClicks(reader)
  return { anchor, received, stop }
}

function modifierClick(anchor: HTMLAnchorElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0, ctrlKey: true })
  anchor.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('modifier clicks', () => {
  it('turns a modifier click on a relative link into a plain click', () => {
    const { anchor, received, stop } = setup('other.md')
    const event = modifierClick(anchor)
    expect({ prevented: event.defaultPrevented, received }).toEqual({ prevented: true, received: [false] })
    stop()
  })

  it('does the same for #anchors', () => {
    const { anchor, received, stop } = setup('#part-two')
    modifierClick(anchor)
    expect(received).toEqual([false])
    stop()
  })

  it('blocks a modifier click on an empty href and does nothing else', () => {
    const { anchor, received, stop } = setup('')
    const event = modifierClick(anchor)
    expect({ prevented: event.defaultPrevented, received }).toEqual({ prevented: true, received: [] })
    stop()
  })

  it('leaves external links to external-links.ts', () => {
    const { anchor, received, stop } = setup('https://example.com/')
    const event = modifierClick(anchor)
    expect({ prevented: event.defaultPrevented, received }).toEqual({ prevented: true, received: [true] })
    stop()
  })

  it('ignores clicks without modifiers', () => {
    const { anchor, received, stop } = setup('other.md')
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, button: 0 }))
    expect(received).toEqual([false])
    stop()
  })
})
