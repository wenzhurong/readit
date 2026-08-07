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
 */
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
  const first = args[0]
  if (typeof first === 'object' && first !== null) {
    const o = first as { host?: string; hostname?: string; path?: string; port?: number }
    if (typeof o.path === 'string') return ''
    return o.hostname ?? o.host ?? 'localhost'
  }
  if (typeof first === 'string') return ''
  const second = args[1]
  return typeof second === 'string' ? second : 'localhost'
}

const realConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
  const host = hostOf(args)
  if (!isLocal(host)) throw new OfflineViolationError('net.Socket.connect', host)
  return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args)
}

const realLookup = dns.lookup
;(dns as { lookup: unknown }).lookup = function patchedLookup(hostname: string, ...rest: unknown[]) {
  if (!isLocal(hostname)) throw new OfflineViolationError('dns.lookup', hostname)
  return (realLookup as (...a: unknown[]) => unknown)(hostname, ...rest)
}

const realFetch = globalThis.fetch
globalThis.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
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
