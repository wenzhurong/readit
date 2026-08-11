import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publint } from 'publint'
import { formatMessage } from 'publint/utils'
import { describe, expect, inject, it } from 'vitest'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(import.meta.url)

function attw(args: readonly string[]): { status: number; output: string } {
  const cliPkgPath = req.resolve('@arethetypeswrong/cli/package.json')
  const bin = (JSON.parse(readFileSync(cliPkgPath, 'utf8')) as { bin: Record<string, string> }).bin.attw
  if (bin === undefined) throw new Error('@arethetypeswrong/cli 没有 attw 这个 bin')
  const r = spawnSync(process.execPath, [resolve(dirname(cliPkgPath), bin), ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  return { status: r.status ?? 1, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

describe('publint', () => {
  it('打包后的 readit 没有任何 error 级问题（strict：warning 也算 error）', async () => {
    // pack:'npm' 让 publint 看到 files 字段过滤后的真实文件集，FILE_NOT_PUBLISHED 这类
    // 规则只有这样才可能触发。npm pack 不需要出网，unshare --net 里照样跑。
    const { messages, pkg } = await publint({ pkgDir: PKG_DIR, strict: true, pack: 'npm' })
    const errors = messages.filter((m) => m.type === 'error')
    expect(errors.map((m) => formatMessage(m, pkg) ?? m.code)).toEqual([])
  })
})

describe('@arethetypeswrong', () => {
  it("'.' 在 node16 的 ESM 与 CJS 两侧都解析到正确味道的类型", () => {
    // node10 被排除：它根本不支持子路径 exports，而这个包要求 Node 22+。
    const { status, output } = attw([inject('readitTarball'), '--profile', 'node16', '--entrypoints', '.', '--format', 'ascii', '--no-emoji', '--no-color'])
    expect(status, output).toBe(0)
  })

  it('四个浏览器子路径是 ESM-only，在 bundler 与 node16-esm 下类型正确', () => {
    // 它们没有 require 条件，这是有意的：把 element/editor 也双发一份，等于让宿主
    // 白白多下一整份浏览器代码。所以这一跑用 esm-only profile，并把「哪些入口是双模的」
    // 这件事写成两次调用，而不是一次调用加一条 ignore-rules。
    //
    // §0.2：'./editor' 此刻是空壳——@readit/editor/src/index.ts 只有类型再导出，
    // createEditor() 要到 Task 13 才落地，dist/editor.js 没有任何运行时绑定。
    // 这条断言此刻是「假绿」：它只验证 exports 映射与类型味道自洽，验证不了
    // '@readit/editor' 有没有实际内容。Task 17 交付 createEditor() 之后必须重跑
    // 这条门（连同 publint 与 tarball-host 门）——那时它才第一次在真实意义上
    // 覆盖 './editor'。
    const { status, output } = attw([
      inject('readitTarball'),
      '--profile', 'esm-only',
      '--entrypoints', './element', './editor', './plugins/math', './plugins/highlight',
      '--format', 'ascii', '--no-emoji', '--no-color',
    ])
    expect(status, output).toBe(0)
  })
})

describe('这两条门确实在 CI 里跑', () => {
  it('本 project 被根 vitest.config.ts 的 projects 收进默认 npm test', () => {
    const rootConfig = readFileSync(join(PKG_DIR, '../../vitest.config.ts'), 'utf8')
    expect(rootConfig).toContain("projects: ['.', 'packages/*']")
  })
})
