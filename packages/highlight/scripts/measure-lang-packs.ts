/**
 * 量两个实现全部语言包的实际体积（设计 §5.4 第 1 步），写进
 * packages/highlight/data/lang-pack-sizes.json。
 *
 * 纯本地文件读取 + zlib，无网络。
 *
 *   npm run measure:lang-packs --workspace @readit/highlight
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const require_ = createRequire(import.meta.url)

export interface Pack {
  name: string
  raw: number
  gzip: number
}

export interface Impl {
  package: string
  version: string
  count: number
  gzip: { min: number; p50: number; p90: number; p95: number; p99: number; max: number; sum: number }
  /** 超过 N KB gzip 的语言包个数。 */
  over: Record<string, number>
  /** 最大的十个。 */
  top: Pack[]
}

export interface Report {
  measuredAt: string
  shiki: Impl
  starryNight: Impl
  gate: { built: false; copyIfEverBuilt: string; rationale: string }
}

const THRESHOLDS_KB = [16, 32, 50, 64, 100] as const

function measureDir(dir: string, ext: string): Pack[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => {
      const bytes = readFileSync(path.join(dir, f))
      return { name: f.slice(0, -ext.length), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length }
    })
    .sort((a, b) => b.gzip - a.gzip || a.name.localeCompare(b.name))
}

function quantile(ascending: readonly number[], p: number): number {
  const i = Math.min(ascending.length - 1, Math.max(0, Math.ceil(p * ascending.length) - 1))
  return ascending[i] ?? 0
}

function summarize(packs: readonly Pack[], pkg: string, version: string): Impl {
  const asc = packs.map((x) => x.gzip).sort((a, b) => a - b)
  const over: Record<string, number> = {}
  for (const kb of THRESHOLDS_KB) over[`${kb}KB`] = packs.filter((x) => x.gzip > kb * 1024).length
  return {
    package: pkg,
    version,
    count: packs.length,
    gzip: {
      min: asc[0] ?? 0,
      p50: quantile(asc, 0.5),
      p90: quantile(asc, 0.9),
      p95: quantile(asc, 0.95),
      p99: quantile(asc, 0.99),
      max: asc[asc.length - 1] ?? 0,
      sum: asc.reduce((a, b) => a + b, 0),
    },
    over,
    top: packs.slice(0, 10),
  }
}

function versionOf(pkgJsonPath: string): string {
  return (JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string }).version
}

export function measureAll(): Pick<Report, 'shiki' | 'starryNight'> {
  // shiki 的 dist/langs/*.mjs 只是 re-export 存根（52 字节），真正的语法体在
  // @shikijs/langs 里，打包器跟过去内联的也是它。
  const shikiDir = path.dirname(require_.resolve('@shikijs/langs/javascript'))
  const shikiPkg = path.join(shikiDir, '..', 'package.json')
  const snRoot = path.dirname(require_.resolve('@wooorm/starry-night'))
  return {
    shiki: summarize(measureDir(shikiDir, '.mjs'), '@shikijs/langs', versionOf(shikiPkg)),
    starryNight: summarize(
      measureDir(path.join(snRoot, 'lang'), '.js'),
      '@wooorm/starry-night',
      versionOf(path.join(snRoot, 'package.json')),
    ),
  }
}

const report: Report = {
  measuredAt: '2026-08-10',
  ...measureAll(),
  gate: {
    built: false,
    copyIfEverBuilt: '这个代码块的语言包较大（<N> KB），已跳过高亮。[仍要加载]',
    rationale:
      '本项目对懒加载载荷的既定容忍度是数学包 ~677 KB gzip 与 mermaid 1–1.5 MB，两者都没有闸门。' +
      '最坏的单个语法包（shiki emacs-lisp 194.2 KB gzip）比其中较小的那个还小 3.5 倍。' +
      '只给三个懒加载大件里最小的那个建闸不自洽。完整论证见设计文档 §5.4.1。',
  },
}

const out = new URL('../data/lang-pack-sizes.json', import.meta.url)
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
console.error(
  `shiki: ${report.shiki.count} packs, max ${(report.shiki.gzip.max / 1024).toFixed(1)} KB gzip; ` +
    `starry-night: ${report.starryNight.count} packs, max ${(report.starryNight.gzip.max / 1024).toFixed(1)} KB gzip`,
)
