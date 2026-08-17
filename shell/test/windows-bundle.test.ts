import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface WindowsBundleConfig {
  targets?: string[]
  windows?: {
    minimumWebview2Version?: string | null
    webviewInstallMode?: {
      type?: string
      silent?: boolean
    }
  }
}

function bundleConfig(): WindowsBundleConfig {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'),
  ) as { bundle: WindowsBundleConfig }
  return config.bundle
}

describe('Windows bundle policy', () => {
  it('builds only the NSIS target whose hooks can register Open With', () => {
    expect(bundleConfig().targets).toEqual(['nsis'])
  })

  it('uses the small online Evergreen bootstrapper without pinning a fixed runtime', () => {
    const windows = bundleConfig().windows

    expect(windows?.webviewInstallMode).toEqual({
      type: 'downloadBootstrapper',
      silent: true,
    })
    expect(windows?.minimumWebview2Version).toBeNull()
  })
})
