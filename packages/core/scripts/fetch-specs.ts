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
  /**
   * GFM 扩展名，取自围栏行 info string（如 `` ```````... example autolink ``）。
   * 空串表示这条例子在 cmark-gfm 自己的 runner 里是用**不带任何扩展**的基线解析器
   * 生成的（672 例里的 648 例）。CommonMark 规格本身没有扩展概念，恒为空串。
   * L1 套件的 harness 靠这个字段逐例决定该加载哪条 SEMANTIC 规则——见 test/spec/harness.ts。
   */
  extension: string
}

const CM_URL = 'https://spec.commonmark.org/0.31.2/spec.json'
/** 2026-08-06 实测：140,487 字节 / 652 例 */
const CM_BYTES = 140487
const CM_COUNT = 652

// 钉在 tag `0.29.0.gfm.13` 而不是 `master`：2026-08-06 实测两者内容 SHA-256 相同，
// 钉 tag 现在零成本，且能防止 fixture 将来在 master 上悄悄漂移。
const GFM_URL =
  'https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/spec.txt'
/** 2026-08-06 实测：216,680 字节 / 672 例 */
const GFM_BYTES = 216680
const GFM_COUNT = 672

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
    extension: '',
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

/**
 * 从 cmark-gfm 的 spec.txt 提取例子。
 *
 * ⚠️ 三个必须做对的点：
 * 1. 在 `<!-- END TESTS -->` 处截断 —— 其后是回归用的杂项，不属于规格。
 * 2. 围栏后的 info string 必须**保留**，不能按 `info.trim() === 'example'` 过滤。
 *    实测：672 例中有 24 例带非空 info（table 8 / autolink 11 / disabled 2 /
 *    strikethrough 2 / tagfilter 1），那 24 例正好是全部 GFM 扩展例子。
 *    markdown-it 自己的 harness 用那个等号过滤，会静默丢光它们。
 *    ⚠️ Task 32a 发现：只是"不过滤"不够——info string 本身若不存进产出对象，
 *    下游仍然无从得知哪些例子该套哪个扩展，648 个空 info 例子会被无条件规则污染
 *    （applyAutolink/applyTagfilter 让 GFM 自己的非扩展 Autolinks/HTML blocks 小节
 *    也失败）。所以这里把 info string trim 后存进 `extension` 字段，供
 *    test/spec/harness.ts 逐例只加载该例声明的 SEMANTIC 规则。
 * 3. markdown 与 html 两侧都要把 U+2192 (→) 换回 Tab。
 */
export function parseGfmSpec(text: string): SpecExample[] {
  const endMarker = '<!-- END TESTS -->'
  const endAt = text.indexOf(endMarker)
  if (endAt < 0) throw new Error(`GFM spec.txt 里找不到 ${endMarker}`)
  const body = text.slice(0, endAt)

  const exampleRe = /^`{32} example(.*)\n([\s\S]*?)^\.\n([\s\S]*?)^`{32}$/gm
  const raw: Array<{
    markdown: string
    html: string
    extension: string
    start: number
    end: number
  }> = []
  let m: RegExpExecArray | null
  while ((m = exampleRe.exec(body)) !== null) {
    raw.push({
      markdown: m[2]!.replace(/→/g, '\t'),
      html: m[3]!.replace(/→/g, '\t'),
      extension: m[1]!.trim(),
      start: m.index,
      end: m.index + m[0]!.length,
    })
  }

  // 章节名取最近的前置 h1/h2，但必须排除落在例子体内部的伪标题
  // （规格里有 `# Foo` 这样的 markdown 输入，不排除会把 section 记成 "[Foo]"）。
  const headings = [...body.matchAll(/^#{1,2} (.*)$/gm)]
    .filter((h) => !raw.some((e) => h.index! >= e.start && h.index! < e.end))
    .map((h) => ({ at: h.index!, name: h[1]!.trim() }))

  return raw.map((e, i) => {
    let section = ''
    for (const h of headings) {
      if (h.at < e.start) section = h.name
      else break
    }
    return { markdown: e.markdown, html: e.html, example: i + 1, section, extension: e.extension }
  })
}

export async function fetchGfm(outPath: string): Promise<number> {
  const text = await fetchText(GFM_URL, GFM_BYTES)
  const examples = parseGfmSpec(text)
  if (examples.length !== GFM_COUNT) {
    throw new Error(`GFM: expected ${GFM_COUNT} examples, got ${examples.length}`)
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
  const gfm = await fetchGfm(fileURLToPath(new URL('gfm-0.29.json', here)))
  console.log(`gfm-0.29.json: ${gfm} examples`)
}
