import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, inject, it } from 'vitest'

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/host-app')
const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

describe('npm pack 出的 tarball 能装进一个隔离宿主并跑起来（决策 2 的兑现）', () => {
  it('宿主真的 npm install 那个 tarball，然后 render 出正确的 HTML', () => {
    // 装到 os.tmpdir() 而不是仓库内：仓库内任何位置都可能被 npm 的 workspace 发现，
    // 那样测的就不是「隔离宿主」而是「同一个 monorepo 的另一个角落」，软链一路生效，
    // 这条门就变成自我肯定了。
    const host = mkdtempSync(join(tmpdir(), 'readit-host-'))
    cpSync(FIXTURE, host, { recursive: true })

    const install = spawnSync(
      NPM,
      [
        'install',
        IS_WIN ? `"${inject('readitTarball')}"` : inject('readitTarball'),
        // 发布产物运行时零依赖，所以 --offline 必须成立：这条门同时也在
        // offline.yml 的 unshare --net 命名空间里跑。
        '--offline', '--no-audit', '--no-fund', '--ignore-scripts',
        '--cache', IS_WIN ? `"${join(host, '.npm-cache')}"` : join(host, '.npm-cache'),
        '--loglevel=error',
      ],
      { cwd: host, encoding: 'utf8', shell: IS_WIN },
    )
    expect(install.status, `${install.stdout ?? ''}\n${install.stderr ?? ''}`).toBe(0)

    // --no-experimental-require-module 逼 require('readit') 走真正的 'require' 条件
    // （命中 dist/core.cjs），而不是 Node 22.12+ 默认打开的 require(esm) 同步加载路径——
    // 那条路径会命中 exports['.']的 "module-sync" 条件，加载的其实是 dist/core.js（ESM
    // 那份，与上面 esmHtml 拿到的是同一个模块实例），esmHtml/cjsHtml 的比对会变成
    // 自我比较，永远不可能红，也就测不出 exports.require 那个分支——Task 9 那次真实的
    // "Masquerading as ESM" bug 正好就藏在那个分支里。
    const run = spawnSync(process.execPath, ['--no-experimental-require-module', 'run.mjs'], {
      cwd: host,
      encoding: 'utf8',
    })
    expect(run.status, `${run.stdout ?? ''}\n${run.stderr ?? ''}`).toBe(0)

    const out = JSON.parse(run.stdout) as {
      esmHtml: string
      cjsHtml: string
      resolvedTo: string
      scanned: { needsMath: boolean; needsMermaid: boolean; needsHighlight: boolean; languages: string[] }
      stylesBytes: number
      subpaths: { subpath: string; resolved: boolean }[]
    }

    // 结构面的证据：require('readit') 真的解析到了 dist/core.cjs，不是靠 --no-experimental-
    // require-module 生效与否去赌。这条断言本身就能在这个 flag 失效时（比如未来 Node 版本
    // 移除它）第一时间说清楚"没测到该测的东西"，而不是安静地退化回自我比较。
    expect(out.resolvedTo.split(sep).slice(-3).join('/')).toBe('readit/dist/core.cjs')

    expect(out.esmHtml).toBe('<p dir="auto" data-line="0">hello <strong>world</strong></p>\n')
    expect(out.cjsHtml).toBe(out.esmHtml)
    expect(out.scanned).toEqual({ needsMath: false, needsMermaid: false, needsHighlight: false, languages: [] })
    expect(out.stylesBytes).toBeGreaterThan(0)
    // §0.2：'readit/editor' 这里只验证「宿主能把这条路径解析到一个文件」（run.mjs 的
    // subpaths 探针是 import.meta.resolve，故意不执行）。dist/editor.js 此刻是个空壳
    // （@readit/editor 的 createEditor() 要到 Task 13 才有），所以这条断言证明不了
    // '导出的东西真的可用'，只证明得了 exports 映射没错。Task 17 之后要重跑本文件。
    expect(out.subpaths).toEqual([
      { subpath: 'readit/element', resolved: true },
      { subpath: 'readit/editor', resolved: true },
      { subpath: 'readit/plugins/math', resolved: true },
      { subpath: 'readit/plugins/highlight', resolved: true },
    ])
  })
})
