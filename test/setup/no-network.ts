/**
 * Offline gate, in-process half.
 *
 * Loaded as a vitest setupFile so that every test worker starts with outbound
 * networking severed. Anything that reaches for a CDN (starry-night's browser
 * path hard-codes fetch('https://esm.sh/...onig.wasm'), MathJax font chunk
 * loaders, mermaid CDN fallbacks) fails loudly and names itself, instead of
 * silently succeeding on a developer laptop and failing on a user's machine.
 *
 * Loopback stays open so local fixture servers and Playwright's own transport work.
 *
 * ## What this file patches
 *
 *  1. `net.Socket.prototype.connect` — every TCP connect, and so also `http`,
 *     `https`, `tls` and `http2`, which all build on it. Pinned against IP
 *     literals, which skip `dns.lookup` and leave this as the only guard.
 *  2. `dns.lookup` — name resolution reached directly, without a connect.
 *  3. `globalThis.fetch` — undici has its own connection path; patching it here
 *     also lets the violation name the full URL rather than just the host.
 *  4. `dgram.Socket.prototype.send` / `.connect` — UDP.
 *
 * ## What this file does NOT cover, and cannot
 *
 * This is a monkey-patch inside one JS realm. It is a linting layer that names
 * the offender, not a sandbox, and these escape it by construction:
 *
 *  - **Child processes.** A `child_process` spawn gets a fresh Node realm with
 *    none of these patches applied.
 *  - **Native addons.** An N-API module calling `connect(2)` itself never goes
 *    through any of these JS entry points.
 *  - **WASM/WASI socket access**, for the same reason.
 *  - **Anything that opens a socket before this setup file is evaluated**, or
 *    that captured a reference to the real function before we replaced it.
 *  - **Raw `process.binding` / internal bindings**, which reach libuv directly.
 *
 * The backstop for every one of those is `.github/workflows/offline.yml`, which
 * re-runs the whole suite under `sudo unshare --net` — a real, kernel-enforced
 * empty network namespace — and first proves the namespace is actually isolated
 * so the assertions inside it cannot be vacuous. Treat that job, not this file,
 * as the thing that makes "the suite is offline" true. This file exists to make
 * a violation *legible* on a developer laptop, where there is no namespace.
 *
 * UDP was the one gap in the enumeration above worth closing in-process rather
 * than leaving to the namespace: `dgram` did already fail, but only incidentally
 * and badly. Node routes a dgram destination through `lookup` even for an IP
 * literal (`net` short-circuits those), so layer 2 fired from inside Node's own
 * internal callback — surfacing as an unhandled exception that crashes the test
 * file while the caller's callback never runs. Patching `send`/`connect`
 * directly turns that into the same synchronous, named error every other layer
 * raises. See test/offline-gate.test.ts.
 */
import dgram from 'node:dgram'
import dns from 'node:dns'
import net from 'node:net'

export class OfflineViolationError extends Error {
  constructor(api: string, target: string) {
    super(
      `offline gate: ${api} tried to reach ${target}. ` +
        'The test suite runs with no network. Vendor the asset or inject it as a test double.',
    )
    this.name = 'OfflineViolationError'
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'])

function isLocal(host: string | undefined): boolean {
  if (host === undefined || host === '') return true
  return LOOPBACK.has(host) || host.endsWith('.localhost')
}

function hostOf(args: unknown[]): string {
  // `net.Socket.prototype.connect` is reached with two different argument shapes, and the
  // second one used to escape entirely:
  //
  //   (options, cb) / (port, host, cb)  — the raw user arguments. This is what TLS (and so
  //                                       `https`) passes straight through.
  //   ([options, cb])                   — Node's OWN pre-normalized array, produced by
  //                                       `normalizeArgs` and passed as a single argument.
  //                                       This is what `net.connect()` and the `http` Agent
  //                                       use (verified on Node 22).
  //
  // An array is `typeof 'object'`, so without this unwrap the normalized shape was inspected
  // as if the array itself were the options bag: no `.hostname`, no `.host`, so it fell
  // through to the `'localhost'` default and was waved past as loopback. That left plain
  // `http` — and every `net.connect()` call — unguarded whenever the target was an IP
  // literal, the one case where `dns.lookup` is skipped and cannot cover for it.
  // Pinned by test/offline-gate.test.ts's TEST-NET-1 probes.
  const argv = Array.isArray(args[0]) ? (args[0] as unknown[]) : args
  const first = argv[0]
  if (typeof first === 'object' && first !== null) {
    // IPC/unix-socket connects carry a string `path` and no host at all; they never touch the
    // network. (For a TCP connect Node explicitly sets `path: null` here, so this cannot be
    // mistaken for an HTTP request's URL path.)
    const o = first as { host?: string; hostname?: string; path?: string; port?: number }
    if (typeof o.path === 'string') return ''
    return o.hostname ?? o.host ?? 'localhost'
  }
  if (typeof first === 'string') return ''
  const second = argv[1]
  return typeof second === 'string' ? second : 'localhost'
}

const realConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
  const host = hostOf(args)
  if (!isLocal(host)) throw new OfflineViolationError('net.Socket.connect', host)
  return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args)
}

/**
 * The destination address in a `dgram` call, or `''` (treated as local) when there is none.
 *
 * Both shapes put the address in the first string argument at index >= 1:
 *
 *   send(msg, [offset, length,] [port,] [address,] [cb])
 *   connect(port, [address,] [cb])
 *
 * Index 0 is skipped because `send`'s message may itself be a string. No string at all means
 * either a connected socket (whose `connect` was already checked here) or the 127.0.0.1
 * default — local either way.
 */
function dgramTargetOf(args: readonly unknown[]): string {
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]
    if (typeof a === 'string') return a
  }
  return ''
}

const realSend = dgram.Socket.prototype.send
dgram.Socket.prototype.send = function patchedSend(this: dgram.Socket, ...args: unknown[]) {
  const host = dgramTargetOf(args)
  if (!isLocal(host)) throw new OfflineViolationError('dgram.Socket.send', host)
  return (realSend as (...a: unknown[]) => void).apply(this, args)
}

const realDgramConnect = dgram.Socket.prototype.connect
dgram.Socket.prototype.connect = function patchedDgramConnect(this: dgram.Socket, ...args: unknown[]) {
  const host = dgramTargetOf(args)
  if (!isLocal(host)) throw new OfflineViolationError('dgram.Socket.connect', host)
  return (realDgramConnect as (...a: unknown[]) => void).apply(this, args)
}

const realLookup = dns.lookup
;(dns as { lookup: unknown }).lookup = function patchedLookup(hostname: string, ...rest: unknown[]) {
  if (!isLocal(hostname)) throw new OfflineViolationError('dns.lookup', hostname)
  return (realLookup as (...a: unknown[]) => unknown)(hostname, ...rest)
}

const realFetch = globalThis.fetch
// Parameters<typeof realFetch> rather than the global `RequestInfo`/`RequestInit` names: with
// `lib: ["ES2023"]` and `types: ["node"]` there is no DOM lib, so `RequestInfo` is not in scope
// and this file failed to compile the moment it was brought under tsc. Deriving the parameter
// types from the function actually being wrapped is also what keeps the wrapper honest.
globalThis.fetch = function patchedFetch(
  input: Parameters<typeof realFetch>[0],
  init?: Parameters<typeof realFetch>[1],
) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    host = url
  }
  if (!isLocal(host)) return Promise.reject(new OfflineViolationError('fetch', url))
  return realFetch(input, init)
}
