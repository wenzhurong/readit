import { expect, test, type Page } from '../support/harness.js'

/**
 * `shell/src/find-shortcut.ts` 按 `navigator.platform` 二分和弦：Mac 系用 Meta+F，
 * **其余一律 Control+F，包括 Linux**。而 L3b 跑在 Playwright 的 Linux 容器里、
 * 控制端的本机是 macOS —— 写死任何一个和弦都会在另一边红。
 *
 * 2026-08-18 实测：Windows 壳分支把和弦按平台二分之后，这条 spec 在本机 macOS 三个
 * 引擎全绿、在 CI 的三个引擎**全部超时**（`locator.fill` 等不到查找栏出现）。
 *
 * 判据在这里重算一次而不是从生产代码 import，是因为它要验的正是「页面在这个运行
 * 环境下选了哪个和弦」；但**表达式必须与 `detectShortcutPlatform()` 逐字一致**，
 * 否则两边会各自漂移。
 */
async function platformChords(page: Page): Promise<{ own: string; other: string }> {
  const isMac = await page.evaluate(() => /^(Mac|iPhone|iPad)/.test(navigator.platform))
  return isMac ? { own: 'Meta+f', other: 'Control+f' } : { own: 'Control+f', other: 'Meta+f' }
}

test.describe('shell Cmd+F integration', () => {
  test('repeated Cmd+F refocuses and selects the existing query; Escape clears and restores document focus', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.evaluate(() => {
      const id = window.readitFixture.mount('a', {
        value: '# Find\n\n[focus target](#find)\n\nAlpha beta alpha.\n',
        mode: 'read',
      })
      window.readitFixture.connectShellFindShortcut(id)
      document.querySelector<HTMLElement>('#a')!.shadowRoot!.querySelector<HTMLAnchorElement>('a[href="#find"]')!.focus()
    })

    const chords = await platformChords(page)

    // 反面先测：另一平台的和弦不该唤起查找栏。没有这一条，「按平台二分」就只是
    // 被容忍而不是被钉住 —— 两边都放行也能让下面的正面断言通过。
    await page.keyboard.press(chords.other)
    expect(
      await page.evaluate(() => document.querySelector<HTMLElement>('#a')!.dataset['readitFindOpen']),
    ).toBeUndefined()

    await page.keyboard.press(chords.own)
    const input = page.locator('#a .readit-find-ui-host input')
    await input.fill('alpha')
    await page.keyboard.press(chords.own)

    const reopened = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('#a')!
      const uiHost = host.shadowRoot!.querySelector<HTMLElement>('.readit-find-ui-host')!
      const input = uiHost.shadowRoot!.querySelector<HTMLInputElement>('input')!
      return {
        open: host.dataset['readitFindOpen'],
        focused: uiHost.shadowRoot!.activeElement === input,
        selection: [input.selectionStart, input.selectionEnd],
        query: input.value,
        count: uiHost.shadowRoot!.querySelector('output')?.textContent,
        bars: host.shadowRoot!.querySelectorAll('.readit-find-ui-host').length,
      }
    })
    expect(reopened).toEqual({
      open: 'true',
      focused: true,
      selection: [0, 5],
      query: 'alpha',
      count: '1 / 2',
      bars: 1,
    })

    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('#a')!
      const css = CSS as typeof CSS & { highlights: Map<string, unknown> }
      return {
        open: host.dataset['readitFindOpen'],
        highlighted: css.highlights.has('readit-find'),
        focusedHref: (host.shadowRoot!.activeElement as HTMLAnchorElement | null)?.getAttribute('href'),
      }
    })).toEqual({ open: undefined, highlighted: false, focusedHref: '#find' })
  })

  for (const mode of ['source', 'split'] as const) {
    test(`${mode} CodeMirror focus yields to the document-model find bar`, async ({ page }) => {
      const lines = Array.from({ length: 420 }, (_, index) =>
        index === 370 ? `line ${index} UNIQUE_OFFSCREEN_NEEDLE` : `line ${index}`,
      )
      await page.goto('/host.html')
      await page.waitForFunction(() => window.readitFixture !== undefined)
      await page.evaluate(
        ([value, selectedMode]) => {
          const id = window.readitFixture.mount('a', { value, mode: selectedMode })
          document.querySelector<HTMLElement>('#a')!.style.height = '220px'
          window.readitFixture.connectShellFindShortcut(id)
        },
        [lines.join('\n'), mode] as const,
      )
      await page.waitForFunction(() => document.querySelector('#a')?.shadowRoot?.querySelector('.cm-content'))
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('#a')!.shadowRoot!.querySelector<HTMLElement>('.cm-content')!.focus()
      })
      const renderedBefore = await page.evaluate(() =>
        document.querySelector<HTMLElement>('#a')!.shadowRoot!.querySelector('.cm-content')!.textContent!
          .includes('UNIQUE_OFFSCREEN_NEEDLE'),
      )

      await page.keyboard.press((await platformChords(page)).own)
      const input = page.locator('#a .readit-find-ui-host input')
      await input.fill('UNIQUE_OFFSCREEN_NEEDLE')

      expect(await page.evaluate((renderedBefore) => {
        const host = document.querySelector<HTMLElement>('#a')!
        const root = host.shadowRoot!
        const uiHost = root.querySelector<HTMLElement>('.readit-find-ui-host')!
        return {
          open: host.dataset['readitFindOpen'],
          findFocused: uiHost.shadowRoot!.activeElement === uiHost.shadowRoot!.querySelector('input'),
          count: uiHost.shadowRoot!.querySelector('output')?.textContent,
          codeMirrorSearchPanel: root.querySelector('.cm-search') !== null,
          renderedBefore,
        }
      }, renderedBefore)).toEqual({
        open: 'true',
        findFocused: true,
        count: '1 / 1',
        codeMirrorSearchPanel: false,
        renderedBefore: false,
      })

      if (mode === 'source') {
        await expect.poll(() => page.evaluate(() =>
          document.querySelector<HTMLElement>('#a')!.shadowRoot!
            .querySelector<HTMLElement>('.cm-scroller')!.scrollTop,
        )).toBeGreaterThan(0)
      }

      await page.keyboard.press('Escape')
      expect(await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('#a')!
        return {
          open: host.dataset['readitFindOpen'],
          codeMirrorFocused: host.shadowRoot!.activeElement?.classList.contains('cm-content') ?? false,
        }
      })).toEqual({ open: undefined, codeMirrorFocused: true })
    })
  }
})
