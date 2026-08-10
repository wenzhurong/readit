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
