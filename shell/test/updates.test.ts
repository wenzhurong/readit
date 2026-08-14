import { describe, expect, it, vi } from 'vitest'
import { connectUpdateNotice } from '../src/updates.js'

function fixture(): {
  notice: HTMLElement
  message: HTMLElement
  button: HTMLButtonElement
} {
  document.body.innerHTML = `
    <aside id="update" hidden>
      <span id="update-message"></span>
      <button id="install-update" type="button">安装并重启</button>
    </aside>
  `
  return {
    notice: document.querySelector('#update')!,
    message: document.querySelector('#update-message')!,
    button: document.querySelector('#install-update')!,
  }
}

describe('connectUpdateNotice', () => {
  it('keeps the notice hidden when no update exists', async () => {
    const elements = fixture()

    await connectUpdateNotice(elements, {
      check: vi.fn(async () => null),
      install: vi.fn(async () => {}),
    })

    expect(elements.notice.hidden).toBe(true)
  })

  it('requires a click before installing an available update', async () => {
    const elements = fixture()
    const install = vi.fn(async () => {})

    await connectUpdateNotice(elements, {
      check: vi.fn(async () => ({ version: '0.2.0', currentVersion: '0.1.0' })),
      install,
    })

    expect([
      elements.notice.hidden,
      elements.message.textContent?.includes('0.2.0'),
      install.mock.calls.length,
    ]).toEqual([false, true, 0])
  })

  it('installs once and disables the action after the user clicks', async () => {
    const elements = fixture()
    let finishInstall: (() => void) | undefined
    const install = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishInstall = resolve
        }),
    )

    await connectUpdateNotice(elements, {
      check: vi.fn(async () => ({ version: '0.2.0', currentVersion: '0.1.0' })),
      install,
    })

    elements.button.click()
    await Promise.resolve()
    expect([install.mock.calls.length, elements.button.disabled]).toEqual([1, true])

    finishInstall?.()
  })

  it('leaves startup usable when the update endpoint is unavailable', async () => {
    const elements = fixture()

    await connectUpdateNotice(elements, {
      check: vi.fn(async () => {
        throw new Error('offline')
      }),
      install: vi.fn(async () => {}),
    })

    expect(elements.notice.hidden).toBe(true)
  })
})
