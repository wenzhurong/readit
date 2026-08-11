import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '..')
// §0 A9：端口钉在 5183。
const PORT = Number(process.env.READIT_FIXTURE_PORT ?? '5183')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

// 前缀 → 根目录。顺序敏感：'/' 必须最后。
const MOUNTS = [
  ['/assets/', resolve(here, '.fixtures-dist')],
  ['/content/', resolve(here, 'fixtures/content')],
  ['/css/', resolve(here, 'fixtures/css')],
  ['/vendor/', resolve(repo, 'node_modules')],
  ['/', resolve(here, 'fixtures/pages')],
]

// /vendor/ 直通 node_modules，所以只放行样式与字体两种扩展名——视觉层需要自托管
// woff2 与真实的 Preflight/Reboot，但没有理由让整个 node_modules 都能被页面拉起来。
const VENDOR_EXT = new Set(['.css', '.woff2'])

const extraHeaders = JSON.parse(readFileSync(resolve(here, 'fixtures/headers.json'), 'utf8'))

function locate(pathname) {
  for (const [prefix, root] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue
    const rel = pathname.slice(prefix.length)
    if (rel === '') continue
    const file = resolve(root, rel)
    if (file !== root && !file.startsWith(root + sep)) return null
    if (prefix === '/vendor/' && !VENDOR_EXT.has(extname(file))) return null
    if (!existsSync(file) || !statSync(file).isFile()) continue
    return file
  }
  return null
}

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)

  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('ok')
    return
  }

  const file = locate(pathname)
  if (file === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`404 ${pathname}`)
    return
  }

  const headers = {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    ...(extraHeaders[pathname] ?? {}),
  }
  res.writeHead(200, headers)
  res.end(readFileSync(file))
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`fixture server on http://127.0.0.1:${PORT}\n`)
})
