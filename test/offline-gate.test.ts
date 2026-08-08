import dgram from 'node:dgram'
import dns from 'node:dns'
import dnsp from 'node:dns/promises'
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

  /**
   * `no-network.ts` names this workflow as "the thing that makes 'the suite is offline' true", so
   * it has to actually block a merge. `continue-on-error: true` leaves the job present, named and
   * green in the checks list while its failures stop gating anything — and the assertion above,
   * which only reads for `unshare --net`, would still pass over a job that had been quietly made
   * advisory. Same guard `ci-wiring.test.ts` puts on `test.yml`, for the same reason; asserted as
   * a bare substring because it is equally fatal on a job and on a single step.
   */
  it('has no continue-on-error, so the no-egress job still gates a merge', () => {
    const wf = readFileSync(new URL('../.github/workflows/offline.yml', import.meta.url), 'utf8')
    expect(
      wf,
      'continue-on-error makes the no-egress job advisory: still listed, still green, no longer ' +
        'blocking. This is the job the in-process gate defers to for everything it cannot see — ' +
        'if it should not gate a merge, delete it and say so in no-network.ts, do not leave a ' +
        'check that looks like a backstop and is not.',
    ).not.toContain('continue-on-error')
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

  /**
   * Layer 2 used to be exactly one patch — `dns.lookup` — while the file's enumeration described
   * it as "name resolution reached directly, without a connect". Measured with that guard loaded:
   *
   *     dns.promises.lookup === dns.lookup          false   (and it does not call it)
   *     dns.resolve4                                 bound queryA  (c-ares, never via dns.lookup)
   *     dns.Resolver === dns.promises.Resolver       false
   *
   * so `dns.promises.*` and the whole `dns.resolve*` / `dns.Resolver` family were unpatched,
   * in-realm, JS-reachable egress that none of the five disclosed escapes covered. The tests
   * below re-derive the coverage from the live modules instead of restating it in prose, because
   * a prose enumeration is exactly what was wrong.
   *
   * Probes are RFC 2606 `.invalid` for names and RFC 5737 TEST-NET-1 for addresses, so a broken
   * guard leaks a query for a name guaranteed not to exist rather than reaching anything real.
   */
  describe('layer 2: name resolution, on every surface node:dns exposes', () => {
    const surfaces: [string, Record<string, unknown>, unknown][] = [
      ['dns', dns as unknown as Record<string, unknown>, dns],
      ['dns.promises', dnsp as unknown as Record<string, unknown>, dnsp],
      ['dns.Resolver', dns.Resolver.prototype as unknown as Record<string, unknown>, new dns.Resolver()],
      [
        'dns.promises.Resolver',
        dnsp.Resolver.prototype as unknown as Record<string, unknown>,
        new dnsp.Resolver(),
      ],
    ]

    /**
     * Independently of `no-network.ts`'s own predicate: any own function property whose name is
     * `lookup`, `lookupService`, `reverse`, or begins with `resolve` puts a name query on the wire.
     */
    const isEgressName = (n: string): boolean =>
      n === 'lookup' || n === 'lookupService' || n === 'reverse' || n.startsWith('resolve')

    const egressNames = (surface: Record<string, unknown>): string[] =>
      Object.getOwnPropertyNames(surface)
        .filter((n) => isEgressName(n) && typeof surface[n] === 'function')
        .sort()

    /** Call one dns entry point with a probe argument and report whether the gate stopped it. */
    const probe = (surface: Record<string, unknown>, self: unknown, key: string): Error | 'no-error' => {
      const args: unknown[] =
        key === 'lookupService'
          ? [TEST_NET, 80, () => {}]
          : key === 'reverse'
            ? [TEST_NET, () => {}]
            : ['oracle.invalid', () => {}]
      try {
        const returned = (surface[key] as (...a: unknown[]) => unknown).apply(self, args)
        // Only reachable with a broken guard, and only then does a promise exist to reject; swallow
        // it so the diagnosis is this test's failure list rather than an unhandled rejection.
        if (typeof (returned as PromiseLike<unknown> | undefined)?.then === 'function') {
          void (returned as Promise<unknown>).catch(() => undefined)
        }
        return 'no-error'
      } catch (err) {
        return err as Error
      }
    }

    it('stops every one of them, and there are far more than the one that used to be patched', () => {
      const unguarded: string[] = []
      const checked: string[] = []
      for (const [label, surface, self] of surfaces) {
        for (const key of egressNames(surface)) {
          checked.push(`${label}.${key}`)
          if (!(probe(surface, self, key) instanceof OfflineViolationError)) unguarded.push(`${label}.${key}`)
        }
      }
      expect(unguarded, 'these node:dns entry points reached the resolver').toEqual([])
      // The four surfaces contributed 17 + 17 + 15 + 15 = 64 entry points on the Node 22.23.1 this
      // was written against. Asserted as a floor, not an equality: a future Node adding a record
      // type must not fail the suite, but the sweep silently degenerating to a handful must.
      expect(checked.length).toBeGreaterThanOrEqual(60)
      // The four specific holes the finding named, by name.
      expect(checked).toContain('dns.promises.lookup')
      expect(checked).toContain('dns.resolve4')
      expect(checked).toContain('dns.Resolver.resolve4')
      expect(checked).toContain('dns.promises.Resolver.resolveTxt')
    })

    /**
     * Why one patch could not have covered the others — the measurements, asserted rather than
     * described, so "patching `dns.lookup` is enough" cannot come back as a plausible-sounding
     * simplification.
     */
    it('the four surfaces really are distinct bindings', () => {
      expect((dnsp as { lookup: unknown }).lookup).not.toBe((dns as { lookup: unknown }).lookup)
      expect(dns.Resolver).not.toBe(dnsp.Resolver)
      // `dns.resolve4` is bound to a default Resolver at module load, so it is not the prototype
      // method and patching the prototype alone would leave it wide open.
      expect((dns as unknown as Record<string, unknown>).resolve4).not.toBe(
        (dns.Resolver.prototype as unknown as Record<string, unknown>).resolve4,
      )
    })

    /**
     * The inventory check, and the reason the sweep can select by name at all. Selecting by name
     * means an egress API added under a name outside `lookup|lookupService|reverse|resolve*` would
     * be missed silently — so this enumerates every OTHER function reachable on the two module
     * objects and along both `Resolver` prototype chains, and pins them against the set that is
     * deliberately not guarded. Every one of those is a local setting: `cancel` aborts pending
     * queries, `get/setServers` and `setLocalAddress` configure the resolver, `get/setDefault
     * ResultOrder` sorts getaddrinfo results. A new name appearing here is a decision someone has
     * to make, not a silent pass.
     *
     * The chain matters: the query methods live on `Resolver.prototype` itself, while `cancel` and
     * the setters live one level up on a shared base — so a sweep that only looked at the class's
     * own prototype would not see a future addition to that base.
     */
    it('everything else reachable on the dns surfaces is a local setting, not egress', () => {
      const notGuarded = new Set([
        'constructor',
        'Resolver',
        'cancel',
        'getServers',
        'setServers',
        'setLocalAddress',
        'getDefaultResultOrder',
        'setDefaultResultOrder',
      ])
      const chain = (start: object): object[] => {
        const out: object[] = []
        for (let p: object | null = start; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) out.push(p)
        return out
      }
      const inventory: [string, object][] = [
        ['dns', dns],
        ['dns.promises', dnsp],
        ...chain(dns.Resolver.prototype).map((p, i): [string, object] => [`dns.Resolver[proto ${i}]`, p]),
        ...chain(dnsp.Resolver.prototype).map((p, i): [string, object] => [`dns.promises.Resolver[proto ${i}]`, p]),
      ]
      for (const [label, surface] of inventory) {
        const bag = surface as Record<string, unknown>
        const unexpected = Object.getOwnPropertyNames(bag)
          .filter((n) => typeof bag[n] === 'function' && !isEgressName(n) && !notGuarded.has(n))
          .sort()
        expect(
          unexpected,
          `${label}: an unclassified function appeared. If it can reach a nameserver, add it to ` +
            "no-network.ts's sweep; if it cannot, add it to this test's notGuarded set and say why.",
        ).toEqual([])
      }
      // The chains are two levels deep today; if that ever collapses to one, the base-class
      // methods have moved and the walk above is no longer covering what it claims to.
      expect(chain(dns.Resolver.prototype)).toHaveLength(2)
      expect(chain(dnsp.Resolver.prototype)).toHaveLength(2)
    })

    it('names the offender and the API, on the promise surface too', () => {
      expect(() => dnsp.lookup('oracle.invalid')).toThrow(
        /dns\.promises\.lookup tried to reach oracle\.invalid/,
      )
      expect(() => dns.resolve4('oracle.invalid', () => {})).toThrow(
        /dns\.resolve4 tried to reach oracle\.invalid/,
      )
      expect(() => dns.reverse(TEST_NET, () => {})).toThrow(/dns\.reverse tried to reach 192\.0\.2\.1/)
      expect(() => dns.lookupService(TEST_NET, 80, () => {})).toThrow(
        /dns\.lookupService tried to reach 192\.0\.2\.1/,
      )
    })

    /**
     * c-ares is refused for every name, loopback included: unlike getaddrinfo it does not read
     * /etc/hosts, it sends a packet to a configured nameserver, so there is no name for which
     * `resolve4('localhost')` is an offline operation. getaddrinfo keeps the loopback exemption
     * because `net.connect('localhost')` depends on it.
     */
    it('refuses c-ares even for localhost, while getaddrinfo keeps its loopback exemption', () => {
      expect(() => dns.resolve4('localhost', () => {})).toThrow(OfflineViolationError)
      expect(() => new dns.Resolver().resolve4('localhost', () => {})).toThrow(OfflineViolationError)
      expect(() => dns.lookup('localhost', () => {})).not.toThrow()
      expect(() => void dnsp.lookup('localhost').catch(() => undefined)).not.toThrow()
    })
  })

  /**
   * UDP. A post-fix residual sweep on this gate covered ten TCP/TLS shapes and concluded they
   * were all blocked; a separate note in the same review said `dgram` was unguarded and that a
   * `dgram.send` to a TEST-NET address was simply accepted. Measured here, neither reading was
   * right: the packet did NOT get out, because Node routes a dgram destination through `lookup`
   * even for an IP literal (`net` short-circuits those with `isIP`), so the dns layer fired —
   * but it fired from inside Node's own internal dgram callback, which surfaced as an unhandled
   * exception that took down the test file while the caller's callback never ran at all.
   *
   * "Stopped, but only by accident and with a crash" is not a layer anyone should rely on, so
   * `send`/`connect` are now patched directly and throw synchronously to the caller like every
   * other layer. TEST-NET-1 throughout: if these guards ever break, the probes still cannot
   * reach anything.
   */
  it('blocks dgram.send to an IP literal, synchronously and by name', () => {
    const sock = dgram.createSocket('udp4')
    try {
      expect(() => sock.send(Buffer.from('probe'), 53, TEST_NET)).toThrow(OfflineViolationError)
      expect(() => sock.send(Buffer.from('probe'), 53, TEST_NET)).toThrow(
        /dgram\.Socket\.send tried to reach 192\.0\.2\.1/,
      )
    } finally {
      sock.close()
    }
  })

  it('blocks the dgram.send(msg, offset, length, port, address) overload too', () => {
    const sock = dgram.createSocket('udp4')
    const buf = Buffer.from('probe')
    try {
      expect(() => sock.send(buf, 0, buf.length, 53, TEST_NET)).toThrow(OfflineViolationError)
    } finally {
      sock.close()
    }
  })

  it('blocks dgram.connect to a remote host', () => {
    const sock = dgram.createSocket('udp4')
    try {
      expect(() => sock.connect(53, TEST_NET)).toThrow(OfflineViolationError)
      expect(() => sock.connect(53, 'oracle.invalid')).toThrow(/dgram\.Socket\.connect tried to reach oracle\.invalid/)
    } finally {
      sock.close()
    }
  })

  it('leaves a loopback dgram.send alone', async () => {
    const sock = dgram.createSocket('udp4')
    const err = await new Promise<Error | null>((resolve) => {
      sock.send(Buffer.from('probe'), 65535, '127.0.0.1', (e) => resolve(e))
    })
    sock.close()
    expect(err).toBeNull()
  })

  /**
   * The enumeration in no-network.ts is a claim about coverage, and an incomplete one reads as a
   * complete one. This gate exists because a previous review's "complete trigger set, confirmed
   * by a sweep" turned out to be bounded by the breadth the claimant chose — so the file has to
   * keep naming what it cannot see, and keep pointing at the namespace job that can.
   */
  it('no-network.ts states what it does NOT cover, and names the backstop', () => {
    const src = readFileSync(new URL('./setup/no-network.ts', import.meta.url), 'utf8')
    for (const uncovered of ['Child processes', 'Native addons', 'WASM', 'before this setup file is evaluated']) {
      expect(src, `no-network.ts must disclose: ${uncovered}`).toContain(uncovered)
    }
    expect(src).toContain('.github/workflows/offline.yml')
    expect(src).toContain('unshare --net')
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
