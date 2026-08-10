import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

    const run = spawnSync(process.execPath, ['run.mjs'], { cwd: host, encoding: 'utf8' })
    expect(run.status, `${run.stdout ?? ''}\n${run.stderr ?? ''}`).toBe(0)

    const out = JSON.parse(run.stdout) as {
      esmHtml: string
      cjsHtml: string
      scanned: { needsMath: boolean; needsMermaid: boolean; needsHighlight: boolean; languages: string[] }
      stylesBytes: number
      subpaths: { subpath: string; resolved: boolean }[]
    }

    expect(out.esmHtml).toBe('<p dir="auto" data-line="0">hello <strong>world</strong></p>\n')
    expect(out.cjsHtml).toBe(out.esmHtml)
    expect(out.scanned).toEqual({ needsMath: false, needsMermaid: false, needsHighlight: false, languages: [] })
    expect(out.stylesBytes).toBeGreaterThan(0)
    expect(out.subpaths).toEqual([
      { subpath: 'readit/element', resolved: true },
      { subpath: 'readit/editor', resolved: true },
      { subpath: 'readit/plugins/math', resolved: true },
      { subpath: 'readit/plugins/highlight', resolved: true },
    ])
  })
})
