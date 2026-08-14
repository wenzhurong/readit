import { expect, test } from '../support/harness.js'

test.describe('shell external-link integration', () => {
  test('composed _blank click opens only through the shell and relative/hash stay with element navigation', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)
    await page.evaluate(() => {
      window.readitFixture.mount('a', {
        value: '# Section\n\n[web](https://example.com/path) [relative](./other.md) [hash](#section)\n',
        mode: 'read',
        baseUrl: '/docs/readme.md',
      })
      window.readitFixture.connectShellExternalLinks('a')
    })

    const result = await page.evaluate(async () => {
      const root = document.querySelector<HTMLElement>('#a')!.shadowRoot!
      const links = [...root.querySelectorAll<HTMLAnchorElement>('a')]
      const named = (text: string): HTMLAnchorElement => links.find((link) => link.textContent === text)!
      named('web').click()
      named('relative').click()
      named('hash').click()
      await Promise.resolve()
      return {
        location: location.href,
        webTarget: named('web').target,
        shell: window.readitFixture.shellExternalLinkState(),
        navigations: [...window.readitFixture.navigations],
        focusedId: root.activeElement?.id,
      }
    })

    expect(result).toEqual({
      location: 'http://127.0.0.1:5183/host.html',
      webTarget: '_blank',
      shell: { opened: ['https://example.com/path'], feedback: [] },
      navigations: ['/docs/other.md'],
      focusedId: 'user-content-section',
    })
  })

  test('shell resource rewriting uses valid selectors in a real browser', async ({ page }) => {
    await page.goto('/host.html')
    await page.waitForFunction(() => window.readitFixture !== undefined)

    expect(await page.evaluate(() => window.readitFixture.probeShellResourceRewrite())).toBe(
      'readit://localhost/images/a%20b.png',
    )
  })
})
