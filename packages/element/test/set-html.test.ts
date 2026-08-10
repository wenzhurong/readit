import { describe, expect, it } from 'vitest'
import {
  createSetHtml,
  readEnv,
  selectTier,
  setHtml,
  type DomPurifyLike,
  type HtmlSink,
  type InjectionEnv,
  type SanitizerConfigLike,
  type SanitizerCtorLike,
  type SanitizerInstanceLike,
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
  receivedOptions: Array<{ sanitizer?: SanitizerConfigLike | SanitizerInstanceLike } | undefined> = []
  setHTML(html: string, options?: { sanitizer?: SanitizerConfigLike | SanitizerInstanceLike }): void {
    this.calls.push(html)
    this.receivedOptions.push(options)
  }
}

/**
 * 桩浏览器 Sanitizer 构造器：真实浏览器里 `new Sanitizer().get()` 返回的是宿主
 * 自己的默认允许名单；这里给一个刻意精简、可辨识的假默认值（只有一个元素、
 * 一个属性），用来证明 buildTier1Sanitizer() 是在它基础上「加」而不是彻底
 * 替换掉——真实浏览器里那份默认值里的东西（比如 <a>、<p>）不会凭空消失。
 */
class FakeSanitizer implements SanitizerInstanceLike {
  static readonly defaultConfig: SanitizerConfigLike = {
    elements: [{ name: 'p' }],
    attributes: [{ name: 'lang' }],
  }

  static builtWith: Array<SanitizerConfigLike | undefined> = []

  private readonly config: SanitizerConfigLike

  constructor(config?: SanitizerConfigLike) {
    this.config = config ?? FakeSanitizer.defaultConfig
    FakeSanitizer.builtWith.push(config)
  }

  get(): SanitizerConfigLike {
    return this.config
  }
}
const FakeSanitizerCtor: SanitizerCtorLike = FakeSanitizer

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
  return { hasSetHtml, hasTrustedTypes, purify, sanitizerCtor: undefined }
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

  /**
   * 没有 sanitizerCtor（老浏览器有 setHTML 但没有暴露 Sanitizer 构造器，规范上
   * 不该发生，但防御性地允许）时退回不传配置的调用——不抛错把组件搞挂，
   * 只是回到浏览器自己更严格的默认名单。这与上一条断言的其实是同一件事，
   * 这里换个角度：sink.receivedOptions 里第二个参数确实是 undefined。
   */
  it('without a Sanitizer constructor, falls back to setHTML(html) with no options', () => {
    const sink = new SanitizerSink()
    const env: InjectionEnv = { hasSetHtml: true, hasTrustedTypes: false, purify: spyPurify(), sanitizerCtor: undefined }
    createSetHtml(env)(sink, HTML)
    expect(sink.receivedOptions).toEqual([undefined])
  })

  /**
   * §0.1 追加：一级实测比 Phase A 严格（L3b-element 发现，见 batch-5-report.md）。
   * 这里不重新用真浏览器验证那次实测——那条证据已经在真浏览器里；这条测试守的是
   * buildTier1Sanitizer() 的机制本身：在**浏览器自己的默认配置**基础上做加法，
   * 不是从零替换掉它。用一个刻意精简的桩默认值（只有 <p> 与 lang）证明：
   *   1. 桩默认值里的东西（p、lang）原样保留——不是被完全替换掉的新表。
   *   2. EXTRA_ELEMENTS/EXTRA_ATTRIBUTES 里的东西（img、id……）被加了进去。
   *   3. dataAttributes 被打开。
   *   4. 只构造了一次「拿默认值」+ 一次「建最终实例」，且只发生一次
   *      （env 在整个页面生命周期内不变，见 createSetHtml 的顶部注释）。
   */
  it('builds the sanitizer as browser-default-plus-extras, once, and passes it as the second argument', () => {
    FakeSanitizer.builtWith.length = 0
    const sink = new SanitizerSink()
    const env: InjectionEnv = {
      hasSetHtml: true,
      hasTrustedTypes: false,
      purify: spyPurify(),
      sanitizerCtor: FakeSanitizerCtor,
    }
    const inject = createSetHtml(env)
    inject(sink, HTML)
    inject(sink, HTML) // 第二次调用同一个 injector：sanitizer 只应该建一次。

    // 第一次构造：new ctor()（读默认值用，config 是 undefined）。
    // 第二次构造：new ctor(augmented)（真正要用的实例）。只发生这两次，不随
    // 调用次数增长。
    expect(FakeSanitizer.builtWith).toEqual([undefined, expect.objectContaining({})])
    const augmented = FakeSanitizer.builtWith[1]
    if (augmented === undefined) throw new Error('sanitizer 没有被构造')

    const elementNames = augmented.elements.map((e) => e.name)
    const attributeNames = augmented.attributes.map((a) => a.name)
    expect(elementNames).toContain('p') // 桩默认值里的，原样保留
    expect(elementNames).toContain('img') // EXTRA_ELEMENTS 加的
    expect(elementNames).toContain('details')
    expect(elementNames).toContain('summary')
    expect(elementNames).toContain('markdown-accessiblity-table')
    expect(elementNames).toContain('math-renderer')
    expect(attributeNames).toContain('lang') // 桩默认值里的，原样保留
    expect(attributeNames).toContain('id') // EXTRA_ATTRIBUTES 加的
    expect(attributeNames).toContain('class')
    expect(augmented.dataAttributes).toBe(true)

    // sink.setHTML 拿到的第二个参数就是那个（唯一的）实例，两次调用同一个对象。
    expect(sink.receivedOptions).toHaveLength(2)
    const first = sink.receivedOptions[0]
    const second = sink.receivedOptions[1]
    expect(first?.sanitizer).toBeInstanceOf(FakeSanitizer)
    expect(first?.sanitizer).toBe(second?.sanitizer)
  })

  it('img 拿到的是 src/alt/height/width/align，不是浏览器默认里没有的东西', () => {
    // 精确到「加了什么」而不是只看有没有 img——之前 title 曾经因为跟全局属性
    // 重复而让 Sanitizer 构造直接抛 InvalidConfiguration（实测记录见
    // batch-5-report.md），这条钉住最终形态不再包含重复项。
    FakeSanitizer.builtWith.length = 0
    const sink = new SanitizerSink()
    const env: InjectionEnv = {
      hasSetHtml: true,
      hasTrustedTypes: false,
      purify: spyPurify(),
      sanitizerCtor: FakeSanitizerCtor,
    }
    createSetHtml(env)(sink, HTML)
    const augmented = FakeSanitizer.builtWith[1]
    if (augmented === undefined) throw new Error('sanitizer 没有被构造')
    const img = augmented.elements.find((e) => e.name === 'img')
    expect(img?.attributes?.map((a) => a.name).sort()).toEqual(['align', 'alt', 'height', 'src', 'width'])
    expect(augmented.attributes.filter((a) => a.name === 'id')).toHaveLength(1) // 不重复
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
