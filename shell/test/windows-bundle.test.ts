import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// **不要用 process.cwd()，也不要用 new URL(rel, import.meta.url)。**
//
// - `process.cwd()`：规范命令 `npm test` 从仓库根跑（根 vitest 配置带 projects），
//   cwd 不是 shell/。首版这么写，从 shell/ 里单独跑是绿的、从根跑读到空串静默失败。
// - `new URL(rel, import.meta.url)`：仓库根那几个测试（ci-wiring / spec-sync /
//   import-direction / offline-gate）都这么写，但它们跑在 node 环境里。**壳这个
//   project 的 environment 是 happy-dom**（shell/vitest.config.ts:5），它的 URL 按
//   文档位置解析，实测把 base 丢掉后得到 `http://localhost:3000/src-tauri/...`。
//
// 所以这里走纯 node 的 path API。
const SHELL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (rel: string): string => readFileSync(join(SHELL_DIR, rel), 'utf8')

interface BundleConfig {
  targets?: unknown
  windows?: {
    minimumWebview2Version?: string | null
    webviewInstallMode?: { type?: string; silent?: boolean }
  }
}

const bundleOf = (rel: string): BundleConfig =>
  (JSON.parse(read(rel)) as { bundle: BundleConfig }).bundle

describe('Windows bundle policy', () => {
  it('基础配置不钉 targets —— 钉了会静默掐掉 macOS 打包', () => {
    // 实测（2026-08-18，macOS 26.5.2）：基础配置里写 "targets": ["nsis"] 之后，
    // macOS 上 `tauri build` 仍然 exit 0、仍然打印 "Built application at: …/readit-shell"，
    // 但 bundle/macos/ 下不产出任何东西 —— 不报错，只是什么都没有。
    // 平台专属的 targets 必须写在 tauri.<platform>.conf.json 里。
    expect(bundleOf('src-tauri/tauri.conf.json').targets).toBeUndefined()
  })

  it('Windows 侧只打 NSIS —— 只有它的 hook 能注册 Open With', () => {
    expect(bundleOf('src-tauri/tauri.windows.conf.json').targets).toEqual(['nsis'])
  })

  it('用体积小的在线 Evergreen bootstrapper，不钉死运行时版本', () => {
    const windows = bundleOf('src-tauri/tauri.conf.json').windows

    expect(windows?.webviewInstallMode).toEqual({
      type: 'downloadBootstrapper',
      silent: true,
    })
    expect(windows?.minimumWebview2Version).toBeNull()
  })
})
