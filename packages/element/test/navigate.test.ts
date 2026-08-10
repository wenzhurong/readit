import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKernel, resolveMountOptions, type Kernel } from '../src/kernel.js'
import { classifyHref, findAnchorTarget, resolveRelative } from '../src/navigate.js'
import { render } from '@readit/core'

const DOC = [
  '# Hello World',
  '',
  'See [rel](./other.md), [deep](sub/deep.md#part-two), [up](../up.md),',
  '[hash](#hello-world), [ext](https://example.com/a), [mail](mailto:a@b.c).',
  '',
  '## Part Two',
  '',
  'tail',
  '',
].join('\n')

let kernels: Kernel[] = []

function makeKernel(opts: { baseUrl?: string; onNavigate?: ((path: string) => void) | null } = {}): Kernel {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const kernel = createKernel(
    host,
    resolveMountOptions({
      value: DOC,
      baseUrl: opts.baseUrl ?? 'docs/README.md',
      onNavigate: opts.onNavigate === undefined ? (): void => {} : opts.onNavigate,
    }),
  )
  kernels.push(kernel)
  return kernel
}

function click(kernel: Kernel, text: string): MouseEvent {
  const anchor = [...kernel.content.querySelectorAll('a')].find((a) => a.textContent === text)
  if (anchor === undefined) throw new Error(`没有文本为 ${text} 的链接`)
  const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true })
  anchor.dispatchEvent(event)
  return event
}

function key(kernel: Kernel, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init })
  kernel.content.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const kernel of kernels) {
    kernel.destroy()
    kernel.host.remove()
  }
  kernels = []
})

describe('classifyHref', () => {
  it.each([
    ['#slug', 'hash'],
    ['./other.md', 'relative'],
    ['sub/deep.md', 'relative'],
    ['../up.md', 'relative'],
    ['/abs/x.md', 'relative'],
    ['https://example.com', 'external'],
    ['HTTP://EXAMPLE.COM', 'external'],
    ['mailto:a@b.c', 'external'],
    ['//cdn.example.com/x', 'external'],
    ['', 'ignore'],
  ] as const)('%s → %s', (href, kind) => {
    expect(classifyHref(href)).toBe(kind)
  })

  /** 单字母 scheme 不存在，但 Windows 盘符看起来一模一样。 */
  it('C:\\docs\\a.md 不是外链', () => {
    expect(classifyHref('C:\\docs\\a.md')).toBe('relative')
  })
})

describe('resolveRelative', () => {
  it.each([
    ['docs/README.md', './other.md', 'docs/other.md', ''],
    ['docs/README.md', '../up.md', 'up.md', ''],
    ['docs/README.md', 'sub/deep.md#part-two', 'docs/sub/deep.md', '#part-two'],
    ['/docs/README.md', './other.md', '/docs/other.md', ''],
    ['', './other.md', 'other.md', ''],
    ['file:///U/docs/README.md', './other.md', 'file:///U/docs/other.md', ''],
    ['file:///U/docs/README.md', '../x.md#a', 'file:///U/x.md', '#a'],
    ['docs/README.md', 'a%20b.md', 'docs/a b.md', ''],
    // RFC 3986 §5.3：参照路径本身以 '/' 开头时不与 base 目录合并，直接就是目标路径。
    // classifyHref('/abs/x.md') 把这类 href 分类成 'relative'，会真的喂进这个函数
    // （见下面「链接拦截」一节，不是只在这里测个纸面上的角落）。
    ['docs/README.md', '/img/a.md', '/img/a.md', ''],
    ['/docs/README.md', '/img/a.md', '/img/a.md', ''],
    ['file:///U/docs/README.md', '/img/a.md', 'file:///img/a.md', ''],
  ])('%s + %s → %s %s', (base, href, path, hash) => {
    expect(resolveRelative(base, href)).toEqual({ path, hash })
  })
})

describe('findAnchorTarget：GitHub 的锚点 DOM', () => {
  /**
   * GitHub 把 id 放在兄弟 <a id="user-content-<slug>"> 上、href 却是不带前缀的
   * #<slug>；而 fragment 本来就不跨 shadow 边界。这条同时守着 core 的
   * CLOBBER_PREFIX——那边一改，这里立刻红。
   */
  it('从真实的 render() 输出里按裸 slug 找到带前缀的锚点', () => {
    const scope = document.createElement('div')
    scope.innerHTML = render('# Hello World\n')
    const target = findAnchorTarget(scope, 'hello-world')
    expect(target?.id).toBe('user-content-hello-world')
  })

  it('作者手写 HTML 里的裸 id 也认', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<div id="plain-id"></div>'
    expect(findAnchorTarget(scope, 'plain-id')?.id).toBe('plain-id')
  })

  it('slug 里有 CSS 选择器元字符也不炸', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<a id="user-content-a.b:c"></a>'
    expect(findAnchorTarget(scope, 'a.b:c')).not.toBeNull()
  })

  it('找不到就是 null', () => {
    expect(findAnchorTarget(document.createElement('div'), 'nope')).toBeNull()
  })
})

describe('链接拦截', () => {
  it('相对链接被拦下，onNavigate 收到解析后的路径（不含 #）', () => {
    const onNavigate = vi.fn()
    const kernel = makeKernel({ onNavigate })
    const event = click(kernel, 'rel')
    expect(event.defaultPrevented).toBe(true)
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('docs/other.md')
  })

  it('带 #frag 的相对链接：路径给宿主，锚点留着等内容回来', () => {
    const onNavigate = vi.fn()
    const kernel = makeKernel({ onNavigate })
    click(kernel, 'deep')
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('docs/sub/deep.md')
    kernel.setValue('# Part Two\n\nbody\n')
    expect(kernel.content.querySelector('#user-content-part-two')?.getAttribute('tabindex')).toBe('-1')
  })

  it('外链不拦截，但补上 target=_blank 与 noopener，绝不让它把嵌入页面导航走', () => {
    const kernel = makeKernel()
    const anchor = [...kernel.content.querySelectorAll('a')].find((a) => a.textContent === 'ext')
    expect(anchor?.getAttribute('target')).toBe('_blank')
    expect(anchor?.getAttribute('rel')?.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer'])
    expect(click(kernel, 'ext').defaultPrevented).toBe(false)
  })

  it('mailto 同样交出去', () => {
    expect(click(makeKernel(), 'mail').defaultPrevented).toBe(false)
  })

  it('带修饰键的点击不拦（宿主的「新窗口打开」照常）', () => {
    const onNavigate = vi.fn()
    const kernel = makeKernel({ onNavigate })
    const anchor = [...kernel.content.querySelectorAll('a')].find((a) => a.textContent === 'rel')
    const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, metaKey: true })
    anchor?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('#slug 桥接', () => {
  it('同页锚点被拦下，跳到 user-content- 前缀的那个元素上', () => {
    const kernel = makeKernel()
    const event = click(kernel, 'hash')
    expect(event.defaultPrevented).toBe(true)
    const target = kernel.content.querySelector('#user-content-hello-world')
    expect(target?.getAttribute('tabindex')).toBe('-1')
    expect(kernel.root.container instanceof ShadowRoot ? kernel.root.container.activeElement : document.activeElement).toBe(target)
  })

  it('同页锚点不触发 onNavigate', () => {
    const onNavigate = vi.fn()
    click(makeKernel({ onNavigate }), 'hash')
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('历史栈是元素的能力', () => {
  it('前进后退按路径重新问宿主要内容', () => {
    const seen: string[] = []
    const kernel = makeKernel({ onNavigate: (path) => seen.push(path) })
    click(kernel, 'rel')
    kernel.setValue('# other\n\n[up](../up.md)\n')
    click(kernel, 'up')
    expect(seen).toEqual(['docs/other.md', 'up.md'])

    expect(kernel.navigation.back()).toBe(true)
    expect(seen).toEqual(['docs/other.md', 'up.md', 'docs/other.md'])
    expect(kernel.navigation.back()).toBe(true)
    expect(seen.at(-1)).toBe('docs/README.md')
    expect(kernel.navigation.back()).toBe(false)

    expect(kernel.navigation.forward()).toBe(true)
    expect(seen.at(-1)).toBe('docs/other.md')
  })

  it('新的跳转截断前进分支', () => {
    const kernel = makeKernel()
    click(kernel, 'rel')
    kernel.navigation.back()
    expect(kernel.navigation.canForward()).toBe(true)
    kernel.setValue(DOC)
    click(kernel, 'up')
    expect(kernel.navigation.canForward()).toBe(false)
  })

  it('Alt+ArrowLeft 后退，Alt+ArrowRight 前进', () => {
    const kernel = makeKernel()
    click(kernel, 'rel')
    expect(key(kernel, { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true)
    expect(kernel.navigation.index()).toBe(0)
    expect(key(kernel, { key: 'ArrowRight', altKey: true }).defaultPrevented).toBe(true)
    expect(kernel.navigation.index()).toBe(1)
  })

  it('没得退时不吞按键', () => {
    expect(key(makeKernel(), { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(false)
  })
})

describe('相对跳转失败的错误态（设计文档 §8）', () => {
  it('宿主返回被拒绝的 Promise → 窗口内错误态，显示解析后的完整路径', async () => {
    const kernel = makeKernel({
      onNavigate: () => Promise.reject(new Error('ENOENT')) as unknown as void,
    })
    click(kernel, 'rel')
    await Promise.resolve()
    await Promise.resolve()
    const error = kernel.root.root.querySelector('.readit-error')
    expect(error?.hasAttribute('hidden')).toBe(false)
    expect(error?.querySelector('.readit-error-path')?.textContent).toBe('docs/other.md')
    expect(error?.querySelector('.readit-error-detail')?.textContent).toContain('ENOENT')
  })

  it('错误态下后退键仍然可用', async () => {
    const kernel = makeKernel({
      onNavigate: () => Promise.reject(new Error('ENOENT')) as unknown as void,
    })
    click(kernel, 'rel')
    await Promise.resolve()
    await Promise.resolve()
    expect(key(kernel, { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true)
    expect(kernel.navigation.index()).toBe(0)
  })

  it('宿主同步抛出也进错误态', () => {
    const kernel = makeKernel({
      onNavigate: () => {
        throw new Error('boom')
      },
    })
    click(kernel, 'rel')
    expect(kernel.root.root.querySelector('.readit-error-path')?.textContent).toBe('docs/other.md')
  })

  it('没有 onNavigate 时点相对链接：拦住 + 说清为什么，而不是把嵌入页面导航走', () => {
    const kernel = makeKernel({ onNavigate: null })
    expect(click(kernel, 'rel').defaultPrevented).toBe(true)
    expect(kernel.root.root.querySelector('.readit-error-path')?.textContent).toBe('docs/other.md')
    expect(kernel.root.root.querySelector('.readit-error-detail')?.textContent).toContain('onNavigate')
  })

  /**
   * 评审 Important/M5 的回归用例。onNavigate === null 那条失败路径在更新
   * loadedPath 之前就 return（元素没法知道该失败的「文件」该被当成加载成功
   * 过，所以有意不改 loadedPath），这意味着失败之后按后退键会精确落在
   * entry.path === loadedPath 的早退分支上——这正是最容易漏掉 clearError()
   * 的那个分支，之前确实漏了：错误角标在按了后退键、回到之前显示正常的内容
   * 之后仍然卡在屏幕上不消失。
   */
  it('onNavigate 为 null 失败后，后退键回到之前的内容会清掉错误角标', () => {
    const kernel = makeKernel({ onNavigate: null })
    click(kernel, 'rel')
    expect(kernel.root.root.querySelector('.readit-error')?.hasAttribute('hidden')).toBe(false)
    expect(key(kernel, { key: 'ArrowLeft', altKey: true }).defaultPrevented).toBe(true)
    expect(kernel.root.root.querySelector('.readit-error')?.hasAttribute('hidden')).toBe(true)
  })

  /**
   * 原版这条测的是另一个全新 kernel2 的错误面板——那本来就是隐藏的，跟
   * kernel 上真的发生过的失败/成功毫无关系，是一条空断言（评审 M6）。改成在
   * 同一个 kernel 上先失败、再对一个不同的路径成功导航，检查错误面板真的
   * 从「显示」变回「隐藏」。
   */
  it('下一次成功的跳转清掉错误态', () => {
    const onNavigate = vi.fn((path: string) => {
      if (path === 'docs/other.md') throw new Error('boom')
    })
    const kernel = makeKernel({ onNavigate })
    click(kernel, 'rel')
    expect(kernel.root.root.querySelector('.readit-error')?.hasAttribute('hidden')).toBe(false)

    kernel.setValue('# other\n\n[up](../up.md)\n')
    click(kernel, 'up')
    expect(onNavigate).toHaveBeenLastCalledWith('up.md')
    expect(kernel.root.root.querySelector('.readit-error')?.hasAttribute('hidden')).toBe(true)
  })
})
