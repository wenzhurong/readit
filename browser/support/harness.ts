import { expect, test as base, type Page } from '@playwright/test'

export { expect }

export interface MountFixtureOptions {
  readonly value: string
  readonly mode?: 'read' | 'source' | 'split' | 'plain'
  readonly theme?: 'auto' | 'light' | 'dark'
  readonly shadow?: boolean
  readonly baseUrl?: string
}

/**
 * 页面里的仪表。三件事，都必须在任何页面脚本之前装好：
 *  1. 长命目标（window / document / MediaQueryList）上的事件监听器计数——只数这三种，
 *     因为 shadow 树内部节点上的监听器随树一起死，数它们只会制造噪声。
 *  2. ResizeObserver / MutationObserver 的存活实例计数。
 *  3. CSP violation 采集（Trusted Types 那一级唯一的可观测证据）。
 */
export const INSTRUMENT = `(() => {
  const leaks = { listeners: 0, resizeObservers: 0, mutationObservers: 0 };
  const violations = [];
  Object.defineProperty(window, '__leaks', { value: leaks });
  Object.defineProperty(window, '__cspViolations', { value: violations });

  const addEL = EventTarget.prototype.addEventListener;
  const removeEL = EventTarget.prototype.removeEventListener;
  const registry = new WeakMap();
  const longLived = (t) => t === window || t === document ||
    (typeof MediaQueryList !== 'undefined' && t instanceof MediaQueryList);
  const keyOf = (type, opts) => type + '\\u0000' +
    ((typeof opts === 'object' && opts !== null ? !!opts.capture : !!opts) ? '1' : '0');

  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (fn && longLived(this)) {
      let byKey = registry.get(this);
      if (!byKey) { byKey = new Map(); registry.set(this, byKey); }
      const k = keyOf(type, opts);
      let set = byKey.get(k);
      if (!set) { set = new Set(); byKey.set(k, set); }
      if (!set.has(fn)) { set.add(fn); leaks.listeners += 1; }
    }
    return addEL.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (fn && longLived(this)) {
      const byKey = registry.get(this);
      const set = byKey ? byKey.get(keyOf(type, opts)) : undefined;
      if (set && set.delete(fn)) { leaks.listeners -= 1; }
    }
    return removeEL.call(this, type, fn, opts);
  };

  if (typeof MediaQueryList !== 'undefined' && MediaQueryList.prototype.addListener) {
    const addL = MediaQueryList.prototype.addListener;
    const remL = MediaQueryList.prototype.removeListener;
    MediaQueryList.prototype.addListener = function (fn) { leaks.listeners += 1; return addL.call(this, fn); };
    MediaQueryList.prototype.removeListener = function (fn) { leaks.listeners -= 1; return remL.call(this, fn); };
  }

  const wrap = (Ctor, key) => {
    if (typeof Ctor !== 'function') return Ctor;
    const open = new WeakSet();
    const Wrapped = function (...args) {
      const inst = new Ctor(...args);
      open.add(inst);
      leaks[key] += 1;
      const disconnect = inst.disconnect.bind(inst);
      inst.disconnect = () => { if (open.delete(inst)) { leaks[key] -= 1; } return disconnect(); };
      return inst;
    };
    Wrapped.prototype = Ctor.prototype;
    return Wrapped;
  };
  window.ResizeObserver = wrap(window.ResizeObserver, 'resizeObservers');
  window.MutationObserver = wrap(window.MutationObserver, 'mutationObservers');

  addEL.call(document, 'securitypolicyviolation', (e) => {
    violations.push(e.violatedDirective + ' :: ' + (e.sourceFile || '?') + ':' + e.lineNumber);
  });
})();`

interface Fixtures {
  readonly egressGuard: void
}

/**
 * 所有 spec 必须从这里取 test，不许直接 import '@playwright/test'（有 vitest 守卫钉住）。
 * 原因是这个 auto fixture 顺带装上了离线守卫：starry-night 默认去 esm.sh 拉 onig.wasm
 * 这类事，只有在真浏览器里、在一台联网的开发机上才会静默通过。这里让它变成红灯。
 */
export const test = base.extend<Fixtures>({
  egressGuard: [
    async ({ page }, use) => {
      const offenders: string[] = []
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
          await route.continue()
          return
        }
        offenders.push(url.href)
        await route.abort('blockedbyclient')
      })
      await page.addInitScript(INSTRUMENT)
      await use()
      expect(offenders, '浏览器里出现了非本机请求；离线约束被打破').toEqual([])
    },
    { auto: true },
  ],
})

export async function mountDoc(page: Page, hostId: string, opts: MountFixtureOptions): Promise<string> {
  return await page.evaluate(
    ([id, o]) => window.readitFixture.mount(id, { ...o }),
    [hostId, opts] as const,
  )
}

export async function readLeaks(page: Page): Promise<LeakCounters> {
  return await page.evaluate(() => ({ ...window.__leaks }))
}
