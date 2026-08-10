import { describe, expect, it } from 'vitest'
import {
  createSetHtml,
  readEnv,
  selectTier,
  setHtml,
  type DomPurifyLike,
  type HtmlSink,
  type InjectionEnv,
} from '../src/set-html.js'

const HTML = '<p data-line="0">hi &amp; bye</p>'

/**
 * TrustedHTML 的替身。Trusted Types 的实现细节这里不关心，关心的只有一件事：
 * 它不是 string —— 而这恰恰是浏览器在 CSP 下唯一在意的事。
 */
class FakeTrustedHTML {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value
  }
}

/**
 * 模拟下发了 `require-trusted-types-for 'script'` 的宿主：innerHTML 的 setter 对
 * 普通字符串抛 TypeError，只接受策略产出的 TrustedHTML。这就是浏览器的行为。
 *
 * 为什么是桩而不是 linkedom：linkedom 根本没有实现 Trusted Types 的强制，
 * 用它写这条测试会得到一个「怎么写都过」的绿灯 —— 而这一级正是靠「不写就硬抛」
 * 才有存在意义的。能证伪它的东西必须自己会抛。
 */
class CspSink implements HtmlSink {
  received: unknown = null

  get innerHTML(): string {
    return this.received === null ? '' : String(this.received)
  }

  set innerHTML(value: string) {
    // 运行时到这里的可能是 TrustedHTML；类型上它被 as string 抹平了，故用 unknown 收。
    const incoming: unknown = value
    if (!(incoming instanceof FakeTrustedHTML)) {
      throw new TypeError(
        "Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment.",
      )
    }
    this.received = incoming
  }
}

class PlainSink implements HtmlSink {
  innerHTML = ''
}

class SanitizerSink implements HtmlSink {
  innerHTML = ''
  calls: string[] = []
  setHTML(html: string): void {
    this.calls.push(html)
  }
}

interface SpyPurify extends DomPurifyLike {
  calls: { dirty: string; cfg: { RETURN_TRUSTED_TYPE: true } }[]
}

function spyPurify(): SpyPurify {
  const calls: { dirty: string; cfg: { RETURN_TRUSTED_TYPE: true } }[] = []
  return {
    calls,
    sanitize(dirty, cfg) {
      calls.push({ dirty, cfg })
      return new FakeTrustedHTML(dirty)
    },
  }
}

function envOf(hasSetHtml: boolean, hasTrustedTypes: boolean, purify: DomPurifyLike): InjectionEnv {
  return { hasSetHtml, hasTrustedTypes, purify }
}

describe('selectTier', () => {
  it.each([
    // hasSetHtml, hasTrustedTypes, tier
    [true, false, 'setHTML'],
    [true, true, 'setHTML'],
    [false, true, 'trusted-types'],
    [false, false, 'innerHTML'],
  ] as const)('setHTML=%s trustedTypes=%s -> %s', (hasSetHtml, hasTrustedTypes, tier) => {
    // 第二行是顺序本身：两者都在时一级赢。Element.setHTML() 自带消毒，
    // 因此它不受 require-trusted-types-for 约束 —— 走它是对的，不是抄近路。
    expect(selectTier(envOf(hasSetHtml, hasTrustedTypes, spyPurify()))).toBe(tier)
  })
})

describe('tier 1 — Element.setHTML()', () => {
  it('hands the string to setHTML and never touches innerHTML', () => {
    const sink = new SanitizerSink()
    const purify = spyPurify()
    createSetHtml(envOf(true, true, purify))(sink, HTML)
    expect(sink.calls).toEqual([HTML])
    expect(sink.innerHTML).toBe('')
    expect(purify.calls).toEqual([])
  })
})

describe('tier 2 — a Trusted Types host', () => {
  /**
   * 反面对照，也是这一组里最重要的一条：同一个桩在三级下必须抛。没有它，
   * 上面那条「二级能过」可能只是因为桩根本没在强制什么。
   */
  it('the CSP sink really does reject a plain string, so tier 3 is fatal there', () => {
    const sink = new CspSink()
    expect(() => createSetHtml(envOf(false, false, spyPurify()))(sink, HTML)).toThrow(TypeError)
    expect(sink.received).toBeNull()
  })

  it('tier 2 gets through the very same sink', () => {
    const sink = new CspSink()
    createSetHtml(envOf(false, true, spyPurify()))(sink, HTML)
    expect(sink.received).toBeInstanceOf(FakeTrustedHTML)
    expect(sink.innerHTML).toBe(HTML)
  })

  it('mints through the sanitizer once, with RETURN_TRUSTED_TYPE', () => {
    const purify = spyPurify()
    createSetHtml(envOf(false, true, purify))(new CspSink(), HTML)
    expect(purify.calls).toEqual([{ dirty: HTML, cfg: { RETURN_TRUSTED_TYPE: true } }])
  })
})

describe('tier 3 — innerHTML on already-sanitized content', () => {
  it('assigns the exact string and leaves the sanitizer alone', () => {
    const sink = new PlainSink()
    const purify = spyPurify()
    createSetHtml(envOf(false, false, purify))(sink, HTML)
    expect(sink.innerHTML).toBe(HTML)
    expect(purify.calls).toEqual([])
  })
})

describe('the real environment', () => {
  it('readEnv() reads the test environment as neither tier 1 nor tier 2, without throwing', () => {
    // §0 A2：本包的 vitest environment 是 happy-dom（不是 node），所以 window 与 Element
    // 确实存在——探测用 typeof 守是为了在纯 Node 里也不炸，不是因为这里没有全局。
    // happy-dom 20.11.2 没有实现 Sanitizer API 也没有实现 Trusted Types，所以两个探测
    // 仍然都读到 false；真正装了这两个特性的宿主由 L3b-element（真浏览器）断言。
    const env = readEnv()
    expect(env.hasSetHtml).toBe(false)
    expect(env.hasTrustedTypes).toBe(false)
    expect(selectTier(env)).toBe('innerHTML')
  })

  it('the module-level setHtml() works off that environment', () => {
    const sink = new PlainSink()
    setHtml(sink, HTML)
    expect(sink.innerHTML).toBe(HTML)
  })
})
