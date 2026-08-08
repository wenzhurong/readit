import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OfflineViolationError } from './setup/no-network.js'

/**
 * RFC 5737 TEST-NET-1. Reserved for documentation and guaranteed never to be routed, so
 * these probes cannot reach a real host even if the guard under test is completely broken
 * — the failure mode of a regression here is a hung socket that this file times out, not
 * live egress. Never replace this with a routable host.
 */
const TEST_NET = '192.0.2.1'

interface Attemptable {
  on(event: 'error', listener: (err: Error) => void): unknown
  destroy(): unknown
}

/**
 * Run one connection attempt and report the error the offline gate raised, or the string
 * 'no-error' if the attempt got as far as opening a socket.
 *
 * The guard throws synchronously from inside `net.Socket.prototype.connect`, but whether
 * that throw reaches the caller or is re-emitted as an 'error' event depends on which API
 * is on top (`net.connect` rethrows; the `http`/`https` Agent may surface it on the
 * request), so both are accepted — what is under test is that an OfflineViolationError
 * surfaces at all, before any socket is opened.
 */
async function attempt(start: () => Attemptable): Promise<Error | 'no-error'> {
  let handle: Attemptable
  try {
    handle = start()
  } catch (err) {
    return err as Error
  }
  return await new Promise<Error | 'no-error'>((resolve) => {
    const timer = setTimeout(() => {
      handle.destroy()
      resolve('no-error')
    }, 500)
    handle.on('error', (err) => {
      clearTimeout(timer)
      handle.destroy()
      resolve(err)
    })
  })
}

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

  /**
   * Everything below uses an IP literal on purpose. A hostname is resolved through
   * `dns.lookup`, which this file's other assertions already cover — so a hostname probe
   * passes even when `net.Socket.prototype.connect`'s interception is completely broken,
   * which is exactly how the gap these tests pin went unnoticed. `isIP()` short-circuits
   * the lookup, leaving `net.Socket.connect` as the only guard in the path.
   *
   * The gap itself: Node calls `Socket.prototype.connect(normalizedArgs)` with a
   * PRE-NORMALIZED `[options, cb]` array for `net.connect()` and for the `http` Agent.
   * `Array.isArray([]) && typeof [] === 'object'`, so before the unwrap in `hostOf` the
   * array itself was inspected for `.hostname`/`.host`, found neither, and defaulted to
   * 'localhost' — waving the connection through.
   */
  it('blocks net.connect to an IP literal, whose pre-normalized args array has no dns.lookup to fall back on', async () => {
    const err = await attempt(() => net.connect({ host: TEST_NET, port: 80 }))
    expect(err).toBeInstanceOf(OfflineViolationError)
    expect(String(err)).toContain(`net.Socket.connect tried to reach ${TEST_NET}`)
  })

  it('blocks the net.connect(port, host) overload to an IP literal', async () => {
    const err = await attempt(() => net.connect(80, TEST_NET))
    expect(err).toBeInstanceOf(OfflineViolationError)
    expect(String(err)).toContain(`net.Socket.connect tried to reach ${TEST_NET}`)
  })

  it('blocks plain http to an IP literal (the http Agent hands connect a pre-normalized array)', async () => {
    const err = await attempt(() => http.get(`http://${TEST_NET}/x`))
    expect(err).toBeInstanceOf(OfflineViolationError)
    expect(String(err)).toContain(`net.Socket.connect tried to reach ${TEST_NET}`)
  })

  it('blocks https to an IP literal', async () => {
    const err = await attempt(() => https.get(`https://${TEST_NET}/x`))
    expect(err).toBeInstanceOf(OfflineViolationError)
    expect(String(err)).toContain(`net.Socket.connect tried to reach ${TEST_NET}`)
  })

  it('blocks http to a hostname, naming the host', async () => {
    const err = await attempt(() => http.get('http://oracle.invalid/x'))
    expect(err).toBeInstanceOf(OfflineViolationError)
    expect(String(err)).toContain('tried to reach oracle.invalid')
  })

  /**
   * `dns.lookup` is the second layer. Before `hostOf` learned to unwrap Node's normalized
   * args array it was the layer that actually stopped hostname traffic; now the socket
   * guard fires first and this one is never reached along the connect path, so it needs
   * its own probe or it would rot into untested code. It still matters on its own: any
   * dependency that resolves a name directly — rather than handing it to `connect` — is
   * caught here and nowhere else.
   */
  it('blocks a direct dns.lookup of a remote hostname', () => {
    expect(() => dns.lookup('oracle.invalid', () => {})).toThrow(OfflineViolationError)
    expect(() => dns.lookup('oracle.invalid', () => {})).toThrow(/dns\.lookup tried to reach oracle\.invalid/)
  })

  it('leaves a dns.lookup of localhost alone', () => {
    expect(() => dns.lookup('localhost', () => {})).not.toThrow()
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
