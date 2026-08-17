import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(process.cwd(), '..')
const platformConfigPath = join(process.cwd(), 'src-tauri/tauri.windows.conf.json')
const hooksPath = join(process.cwd(), 'src-tauri/windows/installer-hooks.nsh')

function textIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

describe('Windows installer association policy', () => {
  it('disables Tauri default-file takeover and installs the audited NSIS hook', () => {
    const text = textIfPresent(platformConfigPath)
    expect(text).not.toBe('')

    const config = JSON.parse(text) as {
      bundle: {
        fileAssociations: unknown[]
        windows: { nsis: { installerHooks: string } }
      }
    }
    expect(config.bundle.fileAssociations).toEqual([])
    expect(config.bundle.windows.nsis.installerHooks).toBe('./windows/installer-hooks.nsh')
  })

  it('registers only a per-user ProgID and Open With entries', () => {
    const hook = textIfPresent(hooksPath)

    expect(hook).toContain('WriteRegStr HKCU "Software\\Classes\\readit.md"')
    expect(hook).toContain('Software\\Classes\\.md\\OpenWithProgids')
    expect(hook).toContain('Software\\Classes\\.markdown\\OpenWithProgids')
    expect(hook).not.toMatch(/UserChoice|WriteReg\w*\s+HKLM|WriteReg\w*\s+SHCTX/)
  })

  it('documents the user-controlled Default apps flow', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')

    expect(readme).toContain('设置 → 应用 → 默认应用')
    expect(readme).toContain('不会静默抢占')
  })
})
