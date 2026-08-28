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
const smokeScriptPath = join(REPO_ROOT, '.github/scripts/windows-installer-smoke.ps1')
const releaseWorkflowPath = join(REPO_ROOT, '.github/workflows/release-desktop.yml')

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
    expect(hook).not.toMatch(
      /UserChoice|WriteReg\w*(?:\s+\/\S+)*\s+(?:HKLM|SHCTX)\b/,
    )
  })

  it('removes only readit-owned association entries after uninstall succeeds', () => {
    const hook = textIfPresent(hooksPath)

    expect(hook).toContain('!macro NSIS_HOOK_POSTUNINSTALL')
    expect(hook).toContain(
      'DeleteRegValue HKCU "Software\\Classes\\.md\\OpenWithProgids" "readit.md"',
    )
    expect(hook).toContain(
      'DeleteRegValue HKCU "Software\\Classes\\.markdown\\OpenWithProgids" "readit.md"',
    )
    expect(hook).toContain('DeleteRegKey HKCU "Software\\Classes\\readit.md"')
    expect(hook).not.toMatch(
      /DeleteRegKey(?:\s+\/\S+)*\s+HKCU\s+"Software\\Classes\\\.(?:md|markdown)"/,
    )
    expect(hook).not.toMatch(
      /DeleteReg\w*(?:\s+\/\S+)*\s+(?:HKLM|SHCTX)\b|UserChoice/,
    )

    const preUninstall = hook.match(
      /!macro NSIS_HOOK_PREUNINSTALL[\s\S]*?!macroend/,
    )?.[0]
    expect(preUninstall ?? '').not.toMatch(/DeleteReg/)
    expect(hook.match(/!insertmacro UPDATEFILEASSOC/g)).toHaveLength(2)
  })

  it('runs an install-version-uninstall lifecycle smoke on the Windows release artifact', () => {
    const script = textIfPresent(smokeScriptPath)
    const workflow = textIfPresent(releaseWorkflowPath)

    expect(script).not.toBe('')
    expect(script).toContain("$uninstallKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\readit'")
    expect(script).toContain("$progIdKey = 'HKCU:\\Software\\Classes\\readit.md'")
    expect(script).toContain("Test-RegistryValue $mdOpenWithKey 'readit.md'")
    expect(script).toContain("Test-RegistryValue $markdownOpenWithKey 'readit.md'")
    expect(script).toContain('Get-SemanticProductVersion $executable')
    expect(script).toContain('Assert-DefaultAssociationsUnchanged')
    expect(script).toContain('$mdUserChoiceKey')
    expect(script).toContain('Invoke-FailedRunCleanup')
    expect(script).toContain('Start-Process -FilePath $uninstaller')

    expect(workflow).toContain('Smoke test Windows installer silent lifecycle')
    expect(workflow).toContain("if: matrix.platform == 'windows-latest'")
    expect(workflow).toContain('npm test -- shell/test/version-sync.test.ts')
    expect(workflow).toContain('./.github/scripts/windows-installer-smoke.ps1')
  })

  it('documents the user-controlled Default apps flow', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8')

    expect(readme).toContain('设置 → 应用 → 默认应用')
    expect(readme).toContain('不会静默抢占')
  })
})
