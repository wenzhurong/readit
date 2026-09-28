import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

/**
 * §0 A9：vite 8.2.1 一套，esbuild 那套装置弃用——`?raw` 导入与工作区 `.ts` 软链解析
 * （npm workspaces 把 @readit/element 等包软链进 node_modules，指向各包 src 目录下的
 * 真实路径）都靠它。
 *
 * 动态 import 边界要在浏览器里还是动态的：Rollup 的 ES 输出天然按 import() 分块，
 * 不需要像 esbuild 那样显式开 splitting——@readit/editor 落成独立 chunk 而不是被并进
 * 主 bundle，这是「read 模式不加载 CodeMirror」在这一层的可证伪形式（Task 17 才会有
 * 真的动态 import，这里先把装置立好）。
 */
const fixturesDir = fileURLToPath(new URL('.', import.meta.url))
const outDir = fileURLToPath(new URL('../.fixtures-dist/', import.meta.url))

await rm(outDir, { recursive: true, force: true })

await build({
  root: fixturesDir,
  logLevel: 'info',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2023',
    sourcemap: 'inline',
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./entry.ts', import.meta.url)),
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
})

/**
 * 真壳前端：shell/index.html + main.ts + styles.css 原样打包，挂在 /assets/shell/ 下
 * （serve.mjs 把 /assets/ 映射到 .fixtures-dist）。Tauri IPC 由 browser/support/shell.ts
 * 在页面脚本之前装上的假后端顶替。
 *
 * `readit/*` 指向发布外观包的**源码**而不是 dist：CI 的浏览器 job 只跑 npm ci，不跑
 * npm run build，dist 在那里不存在。configFile: false 是为了不带上壳自己的 vite 配置——
 * 它的 closeBundle 会把 emoji 拷进 shell/dist，这里用不上，也不该写那里。
 */
await build({
  root: fileURLToPath(new URL('../../shell/', import.meta.url)),
  configFile: false,
  base: '/assets/shell/',
  logLevel: 'info',
  resolve: {
    alias: [
      {
        find: /^readit\/(.+)$/,
        replacement: `${fileURLToPath(new URL('../../packages/readit/src/', import.meta.url))}$1.ts`,
      },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL('../.fixtures-dist/shell/', import.meta.url)),
    emptyOutDir: true,
    target: 'es2023',
    sourcemap: 'inline',
    minify: false,
    modulePreload: false,
  },
})
