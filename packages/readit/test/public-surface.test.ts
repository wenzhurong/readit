import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

interface Manifest {
  exports: Record<string, unknown>
}

const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as Manifest

const BREAKING_CHANGE =
  '增删公共导出是破坏性变更：请在 public-surface.test.ts 显式更新对应清单，并在提交信息里说明为什么。'

const EXPECTED_SUBPATHS = [
  '.',
  './editor',
  './element',
  './package.json',
  './plugins/highlight',
  './plugins/math',
  './plugins/mermaid',
  './styles.css',
]

const EXPECTED_JS_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  '.': [
    'DEFAULT_LOADERS',
    'DEFAULT_OPTIONS',
    'GITHUB_EMOJI_BASE',
    'prepare',
    'readFrontmatterOptions',
    'render',
    'renderWithExplain',
    'scan',
  ],
  './editor': ['createEditor'],
  './element': ['DEFAULT_MOUNT_OPTIONS', 'DEFAULT_TAG', 'defineReadit', 'mount'],
  './plugins/highlight': ['createShikiHighlighter', 'createStarryNightHighlighter'],
  './plugins/math': ['TEX_PACKAGES', 'createMathRenderer'],
  './plugins/mermaid': ['createMermaidRenderer'],
}

/** 只取 import 条件实际会走的 JS 目标；类型、require 与非 JS 子路径不混进来。 */
function importTarget(node: unknown): string | undefined {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return undefined
  const conditions = node as Record<string, unknown>
  for (const condition of ['import', 'module-sync', 'default']) {
    const target = importTarget(conditions[condition])
    if (target !== undefined) return target
  }
  return undefined
}

describe('readit 的公共接口面', () => {
  it('exports 子路径清单逐字相等', () => {
    expect(Object.keys(manifest.exports).sort(), BREAKING_CHANGE).toEqual(EXPECTED_SUBPATHS)
  })

  for (const [subpath, expected] of Object.entries(EXPECTED_JS_EXPORTS)) {
    it(`${subpath} 的运行时导出符号集逐字相等`, async () => {
      const target = importTarget(manifest.exports[subpath])
      expect(target, `${subpath} 没有可 import 的 JS 目标。${BREAKING_CHANGE}`).toMatch(/\.js$/)
      if (target === undefined) return

      const mod = (await import(/* @vite-ignore */ pathToFileURL(join(PKG_DIR, target)).href)) as Record<
        string,
        unknown
      >
      expect(Object.keys(mod).sort(), `${subpath}: ${BREAKING_CHANGE}`).toEqual([...expected].sort())
    })
  }
})
