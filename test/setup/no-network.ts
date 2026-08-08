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
 *  2. Name resolution, on all four of the surfaces `node:dns` exposes it
 *     through — see the block comment above the sweep for why one patch on
 *     `dns.lookup` covered exactly one of them.
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
 * Two gaps in the enumeration above were worth closing in-process rather than
 * leaving to the namespace, because both were patchable and in-realm — neither
 * is one of the five escapes just listed:
 *
 *  - **UDP.** `dgram` did already fail, but only incidentally and badly. Node
 *    routes a dgram destination through `lookup` even for an IP literal (`net`
 *    short-circuits those), so layer 2 fired from inside Node's own internal
 *    callback — surfacing as an unhandled exception that crashes the test file
 *    while the caller's callback never runs. Patching `send`/`connect` directly
 *    turns that into the same synchronous, named error every other layer raises.
 *  - **Name resolution other than `dns.lookup`.** Layer 2 used to be one patch
 *    and claimed the whole layer; `dns.promises.lookup` and the entire
 *    `dns.resolve*` / `dns.Resolver` family went straight past it. See the
 *    sweep below for the measurements.
 *
 * See test/offline-gate.test.ts, which re-derives layer 2's coverage from the
 * live `node:dns` modules rather than trusting this comment.
 */
import dgram from 'node:dgram'
import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'
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

/**
 * Layer 2 — name resolution, all of it.
 *
 * A single patch on `dns.lookup` was documented as "name resolution reached directly, without a
 * connect". It was not that. `node:dns` reaches the resolver through four independent surfaces and
 * only one of them is `dns.lookup`; measured on Node 22 with the previous guard loaded:
 *
 *   - `dns.lookup` / `dns.lookupService`  — getaddrinfo(3). The only surface that was patched.
 *   - `dns.promises.*`                    — a SEPARATE binding. `dns.promises.lookup !== dns.lookup`
 *                                           and it does not call it, so the tripwire never fired.
 *   - `dns.resolve*` / `dns.reverse`      — c-ares. Bound to a default Resolver at module load
 *                                           (`dns.resolve4.name` is `'bound queryA'`), so patching
 *                                           `Resolver.prototype` does not reach them either.
 *   - `new dns.Resolver()` / `new dns.promises.Resolver()` — two DISTINCT classes
 *                                           (`dns.Resolver !== dns.promises.Resolver`); their
 *                                           instances do dispatch through their prototypes.
 *
 * None of that was covered by the five disclosed escapes above — "native addons" means an N-API
 * module, not `node:dns`'s own resolver — so it was a hole in the list, not an admission in it.
 * All four surfaces are swept below. The impact was bounded (a leaked DNS query; any subsequent
 * connect is still caught by layer 1) but it was real and cheap to close.
 *
 * Selection is by NAME rather than a hand-kept list, so a resolver a future Node adds is covered
 * on arrival — `resolveTlsa` reached `node:dns` exactly that way (`@since v23.9.0, v22.15.0`, per
 * the bundled `@types/node/dns.d.ts`), and a hand-kept list written before it would have missed it.
 *
 * Two policies, because the two paths differ in kind:
 *
 *  - getaddrinfo (`lookup`, `lookupService`) keeps the loopback exemption. `net.connect('localhost')`
 *    resolves through it and local fixture servers depend on that staying open.
 *  - c-ares (`resolve*`, `reverse`) is refused for every name, loopback included. A c-ares query is
 *    a packet to a configured nameserver even when the name is `localhost`, so there is no name for
 *    which it is offline. Nothing in this repo calls it.
 *
 * ESM named imports follow the patch: `import { lookup } from 'node:dns/promises'` is a live
 * binding onto this same object (verified — the named import returns the patched function).
 *
 * The throw is synchronous even on the promise-shaped APIs, matching every other layer here. That
 * is within Node's own contract for these functions (they throw synchronously on a bad argument
 * too) and it is louder than a rejection nobody attached a handler to.
 */
const GETADDRINFO_APIS = new Set(['lookup', 'lookupService'])

/** True for every `node:dns` export that can put a name query on the wire. */
function isDnsEgressApi(name: string): boolean {
  return GETADDRINFO_APIS.has(name) || name === 'reverse' || name.startsWith('resolve')
}

function guardDnsApi(owner: Record<string, unknown>, key: string, label: string): void {
  const real = owner[key]
  if (typeof real !== 'function') return
  const viaCares = !GETADDRINFO_APIS.has(key)
  owner[key] = function patchedDnsApi(this: unknown, ...args: unknown[]) {
    // Every one of these APIs takes the name (or, for `reverse`/`lookupService`, the address) as
    // its first argument. A c-ares call is refused whatever that argument is; a getaddrinfo call
    // whose first argument is not a string is malformed rather than remote, so it falls through
    // to Node's own argument validation instead of being reported as a network violation.
    const target = typeof args[0] === 'string' ? args[0] : ''
    if (viaCares || !isLocal(target)) {
      throw new OfflineViolationError(label, target === '' ? '(unnamed target)' : target)
    }
    return (real as (...a: unknown[]) => unknown).apply(this, args)
  }
}

for (const [owner, label] of [
  [dns as unknown as Record<string, unknown>, 'dns'],
  [dnsPromises as unknown as Record<string, unknown>, 'dns.promises'],
  [dns.Resolver.prototype as unknown as Record<string, unknown>, 'dns.Resolver'],
  [dnsPromises.Resolver.prototype as unknown as Record<string, unknown>, 'dns.promises.Resolver'],
] as const) {
  for (const key of Object.getOwnPropertyNames(owner)) {
    if (isDnsEgressApi(key)) guardDnsApi(owner, key, `${label}.${key}`)
  }
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
