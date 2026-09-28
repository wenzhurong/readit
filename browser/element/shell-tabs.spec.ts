import { expect, test, type Page } from '../support/harness.js'
import { openShell } from '../support/shell.js'

/**
 * 真壳前端（shell/index.html + main.ts + styles.css）在真引擎里跑多标签。Tauri IPC 由
 * browser/support/shell.ts 的假后端顶替。对应 docs/superpowers/specs/2026-09-28-multi-tab-design.md
 * §8 的「真引擎」一条与 §10 的验收句。
 */

const LONG = (title: string, marker = ''): string =>
  `# ${title}\n\n${Array.from({ length: 120 }, (_, index) =>
    index === 30 && marker !== '' ? marker : `${title} paragraph ${index}.`,
  ).join('\n\n')}\n`

const tabs = (page: Page) => page.locator('#tab-strip [role="tab"]')
const labels = (page: Page) => page.locator('#tab-strip .tab-label')
const activeHost = (page: Page) => page.locator('.document-tab.is-active')

async function makeDirty(page: Page, index: number, text: string): Promise<void> {
  await tabs(page).nth(index).click()
  await page.locator('#mode-switch [data-mode="source"]').click()
  await activeHost(page).locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
}

const calledWith = (page: Page, cmd: string) =>
  page.evaluate((name) => window.readitShell.calls.filter((call) => call.cmd === name).map((call) => call.args), cmd)

test.describe('desktop shell tabs', () => {
  test('三个标签来回切，各自的滚动位置不变', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': LONG('Alpha'), '/docs/b.md': LONG('Beta'), '/notes/c.md': LONG('Gamma') },
      pending: ['/docs/a.md', '/docs/b.md', '/notes/c.md'],
    })
    await expect(labels(page)).toHaveText(['a.md', 'b.md', 'c.md'])
    await expect(tabs(page).nth(2)).toHaveAttribute('aria-selected', 'true')

    for (const [index, offset] of [
      [0, 400],
      [1, 900],
      [2, 1500],
    ] as const) {
      await tabs(page).nth(index).click()
      await activeHost(page).evaluate((element, top) => {
        element.scrollTop = top
      }, offset)
    }
    const offsets: number[] = []
    for (const index of [0, 1, 2]) {
      await tabs(page).nth(index).click()
      offsets.push(await activeHost(page).evaluate((element) => element.scrollTop))
    }
    expect(offsets).toEqual([400, 900, 1500])
  })

  test('在一个标签里改了不保存：只有它带 ●，切走再切回修改还在', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '# A\n', '/docs/b.md': '# B\n' },
      pending: ['/docs/a.md', '/docs/b.md'],
    })
    await makeDirty(page, 0, '# A edited')
    await expect(labels(page)).toHaveText(['● a.md', 'b.md'])
    await tabs(page).nth(1).click()
    await tabs(page).nth(0).click()
    await expect(activeHost(page).locator('.cm-content')).toContainText('# A edited')
  })

  test('关掉带 ● 的标签会先问；取消就不关', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '# A\n', '/docs/b.md': '# B\n' },
      pending: ['/docs/a.md', '/docs/b.md'],
    })
    await makeDirty(page, 0, '# A edited')
    await tabs(page).nth(0).locator('.tab-close').click()
    await expect(page.locator('#leave-title')).toHaveText('关闭「a.md」？')
    await page.locator('#leave-cancel').click()
    await expect(tabs(page)).toHaveCount(2)
    await tabs(page).nth(0).locator('.tab-close').click()
    await page.locator('#leave-discard').click()
    await expect(labels(page)).toHaveText(['b.md'])
  })

  test('关窗时两个带 ● 的标签依次各问一次；选「取消」就不关', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '# A\n', '/docs/b.md': '# B\n' },
      pending: ['/docs/a.md', '/docs/b.md'],
    })
    await makeDirty(page, 0, '# A mine')
    await makeDirty(page, 1, '# B mine')
    await page.evaluate(() => window.readitShell.emit('readit-leave-requested', { kind: 'close' }))
    await expect(page.locator('#leave-message')).toHaveText('「a.md」有尚未保存的修改。')
    await page.locator('#leave-discard').click()
    await expect(page.locator('#leave-message')).toHaveText('「b.md」有尚未保存的修改。')
    await page.locator('#leave-cancel').click()
    await expect.poll(async () => (await calledWith(page, 'cancel_leave')).length).toBe(1)
    expect(await calledWith(page, 'complete_leave')).toEqual([])
    await expect(tabs(page)).toHaveCount(2)
  })

  test('关掉最后一个标签就关窗', async ({ page }) => {
    await openShell(page, { files: { '/docs/a.md': '# A\n' }, pending: ['/docs/a.md'] })
    await tabs(page).nth(0).locator('.tab-close').click()
    await expect.poll(() => calledWith(page, 'complete_leave')).toEqual([{ kind: 'close' }])
  })

  test('「打开…」可多选，每个文件一个新标签，加在最右边', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '# A\n', '/docs/b.md': '# B\n', '/docs/c.md': '# C\n' },
      pending: ['/docs/a.md'],
      dialog: ['/docs/b.md', '/docs/c.md'],
    })
    await expect(tabs(page)).toHaveCount(1)
    await page.locator('#tab-strip [data-action="open"]').click()
    await expect(labels(page)).toHaveText(['a.md', 'b.md', 'c.md'])
    await expect(tabs(page).nth(2)).toHaveAttribute('aria-selected', 'true')
    expect(await calledWith(page, 'open_dialog')).toEqual([{ generation: 1 }])
  })

  test('打不开的文件：不新开标签，通知区说明原因，也不挡住队列里后面的文件', async ({ page }) => {
    // spec §2.2。
    await openShell(page, {
      files: { '/docs/a.md': '# A\n' },
      pending: ['/docs/missing.md', '/docs/a.md'],
    })
    await expect(labels(page)).toHaveText(['a.md'])
    await expect(page.locator('#notice')).toContainText('cannot open /docs/missing.md')
  })

  test('再打开一个已经开着的文件：切到那个标签，不多开', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '# A\n', '/docs/b.md': '# B\n' },
      pending: ['/docs/a.md', '/docs/b.md'],
    })
    await expect(tabs(page)).toHaveCount(2)
    await page.evaluate(() => window.readitShell.enqueue(['/docs/a.md']))
    await expect(tabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs(page)).toHaveCount(2)
    await expect.poll(() => page.evaluate(() => Object.keys(window.readitShell.open).length)).toBe(2)
  })

  test('两个文档各自的图片按各自的 generation 取', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '![a](img.png)\n', '/other/b.md': '![b](img.png)\n' },
      pending: ['/docs/a.md', '/other/b.md'],
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('.document-tab')].map(
            (host) => host.shadowRoot?.querySelector('img')?.getAttribute('src') ?? null,
          ),
        ),
      )
      .toEqual(['readit://localhost/1/img.png', 'readit://localhost/2/img.png'])
  })

  test('后台标签的文件被外部改了：没改过的静默刷新，改过的打上冲突标记', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '# A\n', '/docs/b.md': '# B\n', '/docs/c.md': '# C\n' },
      pending: ['/docs/a.md', '/docs/b.md', '/docs/c.md'],
    })
    await makeDirty(page, 1, '# B mine')
    await tabs(page).nth(2).click()
    await page.evaluate(() => {
      const shell = window.readitShell
      shell.files['/docs/a.md'] = '# A from disk\n'
      shell.files['/docs/b.md'] = '# B from disk\n'
      shell.emit('readit-document-changed', { generation: 1, path: '/docs/a.md' })
      shell.emit('readit-document-changed', { generation: 2, path: '/docs/b.md' })
    })
    await expect(tabs(page).nth(1)).toHaveAttribute('data-conflict', 'true')
    await expect(tabs(page).nth(0)).not.toHaveAttribute('data-conflict', 'true')
    await tabs(page).nth(0).click()
    await expect(activeHost(page).locator('.markdown-body')).toContainText('A from disk')
    await tabs(page).nth(1).click()
    await expect(page.locator('#conflict')).toBeVisible()
  })

  test('查找命中不会停在标签栏底下', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': LONG('Alpha', 'needle is here') },
      pending: ['/docs/a.md'],
    })
    await expect(tabs(page)).toHaveCount(1)
    // 先滚到底，让命中在视野上方：查找往上滚时，把命中对齐到可见带的上沿。
    await activeHost(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.keyboard.press('ControlOrMeta+f')
    await page.keyboard.type('needle')
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stripBottom = document.getElementById('tab-strip')?.getBoundingClientRect().bottom ?? 0
          const host = document.querySelector('.document-tab.is-active')
          const hit = [...(host?.shadowRoot?.querySelectorAll('p') ?? [])].find((p) =>
            p.textContent?.includes('needle'),
          )
          // 量命中的文字本身，不量段落：段落盒比文字高出半个行距（约 3px），查找对齐的是文字。
          const text = hit?.firstChild
          if (text === undefined || text === null) return false
          const range = document.createRange()
          range.selectNodeContents(text)
          const rect = range.getBoundingClientRect()
          return rect.top >= stripBottom - 1 && rect.bottom <= innerHeight
        }),
      )
      .toBe(true)
  })

  test('分栏模式下两侧窗格各自滚动，页面本身不滚', async ({ page }) => {
    // 多标签设计 §4 的「须实测」：改成定高滚动盒之后，窗格才真正各自滚动。
    await openShell(page, { files: { '/docs/a.md': LONG('Alpha') }, pending: ['/docs/a.md'] })
    await page.locator('#mode-switch [data-mode="split"]').click()
    await expect(activeHost(page).locator('.cm-content')).toBeVisible()
    const preview = activeHost(page).locator('.readit-pane-content')
    await preview.hover()
    await page.mouse.wheel(0, 2000)
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0)
  })

  test('模式按钮默认在标签栏下方', async ({ page }) => {
    await openShell(page, { files: { '/docs/a.md': '# A\n' }, pending: ['/docs/a.md'] })
    const strip = await page.locator('#tab-strip').boundingBox()
    const control = await page.locator('#mode-switch').boundingBox()
    expect(strip).not.toBeNull()
    expect(control).not.toBeNull()
    expect(control!.y).toBeGreaterThanOrEqual(strip!.y + strip!.height)
  })

  test('不带文件启动：第一屏里看得到提示和「打开…」按钮', async ({ page }) => {
    await openShell(page, { files: { '/docs/a.md': '# A\n' }, dialog: ['/docs/a.md'] })
    await expect(page.locator('#empty-state')).toBeInViewport()
    await expect(page.locator('#empty-open')).toBeInViewport()
    await page.locator('#empty-open').click()
    await expect(tabs(page)).toHaveCount(1)
    await expect(page.locator('#empty-state')).toBeHidden()
  })

  test('保存失败时，错误提示出现在当前视口内', async ({ page }) => {
    await openShell(page, { files: { '/docs/a.md': LONG('Alpha') }, pending: ['/docs/a.md'] })
    await expect(tabs(page)).toHaveCount(1)
    await activeHost(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.evaluate(() => {
      window.readitShell.failSaves('cannot save: injected failure')
      window.readitShell.emit('readit-save-requested', null)
    })
    await expect(page.locator('#notice')).toBeInViewport()
    await expect(page.locator('#notice')).toContainText('injected failure')
  })

  test('⌘/Ctrl+点击相对链接：在当前标签里跳转，页面不被导航走', async ({ page }) => {
    await openShell(page, {
      files: { '/docs/a.md': '[next](b.md)\n', '/docs/b.md': '# B\n' },
      pending: ['/docs/a.md'],
    })
    await expect(tabs(page)).toHaveCount(1)
    let navigated = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigated += 1
    })
    await activeHost(page).locator('a', { hasText: 'next' }).click({ modifiers: ['ControlOrMeta'] })
    await expect(labels(page)).toHaveText(['b.md'])
    expect(navigated).toBe(0)
  })
})
