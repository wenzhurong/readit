import net from 'node:net'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OfflineViolationError } from './setup/no-network.js'

describe('offline gate', () => {
  it('is wired into vitest.config.ts as a setupFile', () => {
    const cfg = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8')
    expect(cfg).toContain("setupFiles: ['./test/setup/no-network.ts']")
  })

  it('is enforced by a CI job that has no egress at all', () => {
    const wf = readFileSync(new URL('../.github/workflows/offline.yml', import.meta.url), 'utf8')
    expect(wf).toContain('sudo unshare --net')
    expect(wf).toContain('Verify the network namespace really has no egress')
  })

  it('rejects fetch to the CDN that starry-night reaches for', async () => {
    await expect(fetch('https://esm.sh/vscode-oniguruma@2.0.1/release/onig.wasm'))
      .rejects.toBeInstanceOf(OfflineViolationError)
  })

  it('names the offending target in the error message', async () => {
    await expect(fetch('https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js'))
      .rejects.toThrow(/offline gate: fetch tried to reach https:\/\/cdn\.jsdelivr\.net/)
  })

  it('blocks raw sockets to remote hosts', () => {
    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(OfflineViolationError)
  })

  it('leaves loopback open so local fixture servers still work', async () => {
    const closed = await new Promise<string>((resolve) => {
      const s = net.connect({ host: '127.0.0.1', port: 1 })
      s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'no-code'))
      s.on('connect', () => { s.destroy(); resolve('CONNECTED') })
    })
    expect(closed).not.toBe('no-code')
    expect(['ECONNREFUSED', 'CONNECTED']).toContain(closed)
  })
})
