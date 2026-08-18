import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 路径解析的两个坑见 windows-bundle.test.ts 顶部：process.cwd() 不是 shell/，
// 而 new URL(rel, import.meta.url) 在 happy-dom 环境下会丢掉 base。
const SHELL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(SHELL_DIR, '..')
const platformConfigPath = join(SHELL_DIR, 'src-tauri/tauri.windows.conf.json')
const hooksPath = join(SHELL_DIR, 'src-tauri/windows/installer-hooks.nsh')

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
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8')

    expect(readme).toContain('设置 → 应用 → 默认应用')
    expect(readme).toContain('不会静默抢占')
  })
})
