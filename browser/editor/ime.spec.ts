import { mountDoc, test, expect, type Page } from '../support/harness.js'

/**
 * Playwright 对 IME 组合的支持不是一等的。这里走的是 Chromium 的 CDP
 * `Input.imeSetComposition` + `Input.insertText`——那是渲染进程真正的组合路径，
 * compositionstart/update/end 由引擎自己发，不是 JS 里 dispatchEvent 出来的。
 * 这一点很重要：派发合成事件测出来的只是「我们的监听器接得住我们自己造的事件」，
 * 那是自我肯定——contract.spec.ts 那条被排除在共享契约表之外的用例就是活生生的
 * 反例：CodeMirror 6 的 view.composing 只在真的观察到一次组合期间的文本变更时
 * 才置真，dispatchEvent() 派发的合成 CompositionEvent 驱动不了它，这里走 CDP
 * 才是唯一能真正驱动这条路径的办法。
 *
 * 三道自检，任何一道红了都不许把断言改软：
 *  1. 组合过程中必须观察到 compositionstart / compositionupdate / compositionend；
 *     若 CDP 调用其实是空操作，这里一定为空。
 *  2. 同一串 CDP 指令同时打在 plain 档的 <textarea> 上（对照组）。若整套装置
 *     坏了，对照组会一起红——一条只有 CodeMirror 红/绿的结果说明不了装置是好的。
 *  3. 中间态必须出现预编辑串（未提交的 "にほんご"），而不是只有最终结果。
 *     只断言最终结果的话，一个把 insertText 当普通输入处理的实现也会绿。
 */

const PREEDIT = 'にほんご'
const COMMITTED = '日本語'

async function recordCompositionEvents(page: Page, hostId: string): Promise<void> {
  await page.evaluate((id) => {
    const root = document.getElementById(id)?.shadowRoot
    if (root === null || root === undefined) throw new Error(`fixture: no shadow root on #${id}`)
    const events: string[] = []
    ;(window as unknown as { __imeEvents: string[] }).__imeEvents = events
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
      root.addEventListener(type, () => events.push(type), { capture: true })
    }
  }, hostId)
}

async function compositionEvents(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as unknown as { __imeEvents: string[] }).__imeEvents ?? [])
}

async function editorValue(page: Page, handleId: string): Promise<string> {
  return await page.evaluate((id) => window.readitFixture.get(id).getValue(), handleId)
}

/**
 * 三道自检里的第 1、3 道都要在组合*过程中*、提交*之后*分别取值，所以这个
 * 辅助函数把整条 CDP 序列走完并把中间态、终态都带回来，而不是只留最后一次
 * 的结果——只断言最终结果的话，一个把 insertText 当普通输入处理的实现也会绿
 * （这正是任务书原文点名要防的那种假阳性）。
 */
async function compose(
  page: Page,
  handleId: string,
  clickSelector: (page: Page) => Promise<void>,
): Promise<{ preedit: string; committed: string }> {
  const cdp = await page.context().newCDPSession(page)
  await clickSelector(page)
  await recordCompositionEvents(page, 'a')

  for (let i = 1; i <= PREEDIT.length; i++) {
    const text = PREEDIT.slice(0, i)
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
  }
  const preedit = await editorValue(page, handleId)
  await cdp.send('Input.insertText', { text: COMMITTED })
  // insertText 提交之后，实现各自的 compositionend 处理与重渲染都要走一拍
  // 真实的事件循环——不像 vitest 的假时钟能一次 advance 到底。
  await page.waitForFunction(
    ([id, committed]) => window.readitFixture.get(id).getValue().includes(committed as string),
    [handleId, COMMITTED] as const,
    { timeout: 2000 },
  )
  const committed = await editorValue(page, handleId)
  await cdp.detach()
  return { preedit, committed }
}

test.describe('L3b-editor：中日韩输入法在 Shadow Root 内的组合', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'GAP-IME-WEBKIT：WKWebView 侧没有等价于 CDP Input.imeSetComposition 的入口，' +
      '这一档只有手工验证。这是一条具名的覆盖缺口，不是「已通过」。',
  )

  test('对照组：plain 档的 textarea 收得到同一串组合', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await mountDoc(page, 'a', { value: '', mode: 'plain' })
    await page.waitForSelector('#a')
    const { preedit, committed } = await compose(page, id, async (p) => {
      await p.locator('#a').locator('textarea').click()
    })
    expect(preedit).toContain(PREEDIT)
    expect(committed).toContain(COMMITTED)
    expect(committed).not.toContain(PREEDIT)
  })

  test('CodeMirror 在 shadow root 里：预编辑串可见，提交后只剩最终文本', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await mountDoc(page, 'a', { value: '', mode: 'source' })
    await page.waitForSelector('#a')
    await page.waitForFunction(() => document.getElementById('a')?.shadowRoot?.querySelector('.cm-content') != null)
    const { preedit, committed } = await compose(page, id, async (p) => {
      await p.locator('#a').locator('.cm-content').click()
    })
    expect(preedit).toContain(PREEDIT)
    expect(committed).toContain(COMMITTED)
    expect(committed).not.toContain(PREEDIT)
  })

  test('组合事件真的从引擎里发出来了（这条红 == 上面两条是自我肯定）', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await mountDoc(page, 'a', { value: '', mode: 'source' })
    await page.waitForSelector('#a')
    await page.waitForFunction(() => document.getElementById('a')?.shadowRoot?.querySelector('.cm-content') != null)
    await compose(page, id, async (p) => {
      await p.locator('#a').locator('.cm-content').click()
    })
    const events = await compositionEvents(page)
    expect(events).toContain('compositionstart')
    expect(events).toContain('compositionupdate')
    expect(events).toContain('compositionend')
  })

  test('组合期间到达的外部 setValue 被推迟，不冲掉预编辑串', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    const id = await mountDoc(page, 'a', { value: '', mode: 'split' })
    await page.waitForSelector('#a')
    await page.waitForFunction(() => document.getElementById('a')?.shadowRoot?.querySelector('.cm-content') != null)

    const cdp = await page.context().newCDPSession(page)
    await page.locator('#a').locator('.cm-content').click()
    // 逐字符累加组合串，跟另外三条用例里 compose() 走的是同一条路径——单次
    // 整串塞进去时，CodeMirror 的 inputState.composing 计数偶尔来不及在
    // 这一帧内从 0 递增到 >0（它只在 applyDOMChange 真的观察到一次组合期间
    // 的文本变更时才递增），逐字符更新给它多次机会稳定进入「真的在组合」状态，
    // 也更贴近真实输入法逐键上屏候选串的行为。
    for (let i = 1; i <= PREEDIT.length; i++) {
      await cdp.send('Input.imeSetComposition', {
        text: PREEDIT.slice(0, i),
        selectionStart: i,
        selectionEnd: i,
      })
    }
    await page.waitForFunction(
      ([hid, preedit]) => window.readitFixture.get(hid).getValue().includes(preedit as string),
      [id, PREEDIT] as const,
      { timeout: 2000 },
    )
    await page.evaluate((hid) => {
      window.readitFixture.get(hid).setValue('外部写入')
    }, id)
    // 外部写入必须在组合仍在进行时被推迟——预编辑串还在，不是被外部写入冲掉了。
    expect(await editorValue(page, id)).toContain(PREEDIT)
    await cdp.send('Input.insertText', { text: COMMITTED })
    // compositionend 之后，被推迟的外部写入才落地，最终值是外部写入本身
    // （它整体替换了文档），不是把组合结果拼接进去。
    //
    // ⚠️ 这一行钉住的是一个**产品语义决策**，不是一条显然的不变量——它断言
    // 用户刚通过输入法提交的 COMMITTED 被**静默丢弃**了。之所以值得专门说明：
    // 推迟写入这件事本身容易读成「我们会让你把这句话打完」，而实际语义是
    // 「推迟只为了不打断输入法的状态机，写入落地时照样整体替换」。两种读法都站得住，
    // 所以它是个决策，不是个 bug——但它此前是隐式的：Task 13 的合成 composition
    // 事件从不真的往文档里写字，所以「丢用户输入」在批次 7 用真实 CDP 之前
    // 根本不可观测。
    //
    // 若将来判定该保留用户输入（协同编辑、外部内容同步等场景下这是数据丢失），
    // 要改的是 codemirror.ts 的 applyDeferred()，**这一行会跟着变**。
    // 它是决策的落点，不是回归的护栏——别把它当成「本来就该这样」而绕过去。
    // 记账见 docs/plans/2026-08-08-plan2-debt.md 的 D2-18。
    await page.waitForFunction(
      ([hid]) => window.readitFixture.get(hid).getValue() === '外部写入',
      [id] as const,
      { timeout: 2000 },
    )
    expect(await editorValue(page, id)).toBe('外部写入')
    await cdp.detach()
  })
})
