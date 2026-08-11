import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'

/**
 * npm pack packages/readit 到 outDir，返回 tarball 的绝对路径。
 * Windows 上 Node 22 拒绝在 shell:false 下 spawn .cmd，所以那边走 shell 并给路径加引号。
 */
export function packTarball(outDir: string): string {
  const dest = IS_WIN ? `"${outDir}"` : outDir
  const r = spawnSync(NPM, ['pack', '--pack-destination', dest, '--loglevel=error'], {
    cwd: PKG_DIR,
    encoding: 'utf8',
    shell: IS_WIN,
  })
  if (r.status !== 0) {
    throw new Error(`npm pack 失败 (${String(r.status)}):\n${r.stdout ?? ''}\n${r.stderr ?? ''}`)
  }
  const found = readdirSync(outDir).filter((f) => f.endsWith('.tgz'))
  if (found.length !== 1) {
    throw new Error(`期望 ${outDir} 里恰好一个 tarball，实得：${found.join(', ') || '（空）'}`)
  }
  return join(outDir, found[0]!)
}
