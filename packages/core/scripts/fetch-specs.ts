/**
 * 抓取规格套件并落盘为 JSON。**永不在常规测试路径里跑**：
 * 产物已提交进仓库，`npm test` 完全离线。
 *
 * 用法：npx tsx scripts/fetch-specs.ts
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export interface SpecExample {
  markdown: string
  html: string
  example: number
  section: string
}

const CM_URL = 'https://spec.commonmark.org/0.31.2/spec.json'
/** 2026-08-06 实测：140,487 字节 / 652 例 */
const CM_BYTES = 140487
const CM_COUNT = 652

async function fetchText(url: string, expectedBytes: number): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength !== expectedBytes) {
    throw new Error(
      `${url}: expected ${expectedBytes} bytes, got ${buf.byteLength}. ` +
        `上游改了，先人工核对再更新常量。`,
    )
  }
  return buf.toString('utf8')
}

export function parseCommonMarkSpec(json: string): SpecExample[] {
  const raw = JSON.parse(json) as Array<{
    markdown: string
    html: string
    example: number
    section: string
  }>
  return raw.map((e) => ({
    markdown: e.markdown,
    html: e.html,
    example: e.example,
    section: e.section,
  }))
}

export async function fetchCommonMark(outPath: string): Promise<number> {
  const text = await fetchText(CM_URL, CM_BYTES)
  const examples = parseCommonMarkSpec(text)
  if (examples.length !== CM_COUNT) {
    throw new Error(`CommonMark: expected ${CM_COUNT} examples, got ${examples.length}`)
  }
  await writeFile(outPath, JSON.stringify(examples, null, 2) + '\n', 'utf8')
  return examples.length
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1]

if (isMain) {
  const here = new URL('../test/spec/', import.meta.url)
  const cm = await fetchCommonMark(
    fileURLToPath(new URL('commonmark-0.31.2.json', here)),
  )
  console.log(`commonmark-0.31.2.json: ${cm} examples`)
}
