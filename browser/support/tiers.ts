import type { Page } from '@playwright/test'

/**
 * `setHtml()` 三级注入在真浏览器里的**能力探测**，以及"把某一级逼出来"的共享做法。
 *
 * ## 为什么要有这个文件
 *
 * 在它之前，三条 spec 各自用 `browserName === 'chromium'` 写死了引擎名，
 * 而 2026-08-12 一次实测把其中每一条的前提都推翻了：
 *
 * | 引擎 | `setHTML` | `trustedTypes` | `Sanitizer` | 自然落在 |
 * |---|---|---|---|---|
 * | Chromium | ✓ | ✓ | function | 第 1 级 |
 * | WebKit | ✗ | ✓ | undefined | 第 2 级 |
 * | **Firefox** | **✓** | **✓** | **function** | **第 1 级** |
 *
 * 被推翻的三条：
 *
 * 1. `sanitize-raw-html-tags.spec.ts` 只对 chromium 删 `setHTML`，于是 Firefox 上
 *    "前提：这个引擎现在没有原生 setHTML" 直接断言失败。那条 advisory job
 *    自这条 spec 落地起就一直红着，被 `continue-on-error` 盖住没人看见。
 * 2. `sanitize-tier2.spec.ts` 写着 "Firefox 既无原生 setHTML 也无 window.trustedTypes，
 *    走第 3 级" —— **两句都不成立**。D2-17 的第 2 级诊断因此以一个站不住的理由
 *    静默跳过了一整个引擎。
 * 3. `trusted-types.spec.ts` 写着 "只有 Chromium 真的实现了 Trusted Types" ——
 *    三个引擎都实现了。
 *
 * 共同的病根不是"哪个引擎支持什么"记错了，是**按引擎名判而不是按能力判**：
 * 引擎名是稳定的，能力不是。浏览器会在项目脚下变，而写死引擎名的判断不会
 * 跟着变，只会静默地测起别的东西——上面第 2 条就是活例子。
 *
 * 所以这里只导出两样：一个**不看引擎名**的强制手段，和一份被测试钉住的能力矩阵。
 */

/** 一个引擎在 `setHtml()` 的档位选择上暴露的三个能力位（对应 set-html.ts 的 readEnv()）。 */
export interface TierEnv {
  /** `'setHTML' in Element.prototype` —— 有就落第 1 级 */
  setHTML: boolean
  /** `'trustedTypes' in window` —— 第 1 级缺席时，有就落第 2 级 */
  trustedTypes: boolean
  /** 全局 `Sanitizer` 构造器在不在（第 1 级要用它建配置） */
  sanitizerCtor: boolean
}

/** 在当前页面上实测三个能力位。不做任何按引擎名的假设。 */
export async function readTierEnv(page: Page): Promise<TierEnv> {
  return await page.evaluate(() => ({
    setHTML: 'setHTML' in Element.prototype,
    trustedTypes: 'trustedTypes' in window,
    sanitizerCtor: typeof (globalThis as unknown as { Sanitizer?: unknown }).Sanitizer === 'function',
  }))
}

/**
 * 把这一页逼进第 2 级：删掉 `Element.prototype.setHTML`，让 `selectTier()` 落到
 * `trustedTypes` 那一支。
 *
 * **必须在 `page.goto()` 之前调用**（走的是 `addInitScript`）。
 *
 * 无条件删除，不判引擎：这个属性不存在时 `Reflect.deleteProperty` 是无害的空操作
 * （WebKit 就是这种情况，它本来就落在第 2 级）。这正是这个函数存在的意义——
 * 调用方不需要知道、也不应该记住哪个引擎有 `setHTML`。
 */
export async function forceTier2(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Element.prototype, 'setHTML')
  })
}
