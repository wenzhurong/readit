/**
 * 编辑器内部一律用 LF，行尾在**边界**上还原。
 *
 * 两档实现都无法把行尾原样存住，而且都关不掉：CodeMirror 的 `Text` 按
 * `/\r\n?|\n/` 拆行、`doc.toString()` 一律用 `\n` 拼回；`<textarea>` 的 API value
 * 按 HTML 规范也把换行归一化成 LF。所以办法只能是记住载入时的行尾，在
 * `getValue()` 与 `onChange` 这两个出口再编码回去。
 *
 * ⚠️ **不要改用 CodeMirror 的 `EditorState.lineSeparator`**。那个 facet 同时用于
 * 拆行与拼行：设成 `\r\n` 之后，宿主再 `setValue()` 一份 LF 内容——桌面壳的
 * 「使用磁盘版本」正是这条路径——落单的 `\n` 不再被当成换行，会变成行内的字面
 * 字符，是可见的内容损坏。出口编码没有这个问题。
 *
 * ⚠️ 本模块于 2026-08-18 新增。在此之前，用 CRLF 写成的文档在桌面壳里编辑并保存
 * 会被静默改写成 LF——整份文件的行尾都变，而 M6 手工验收第 7 项操作 A 明写要求
 * 「磁盘字节精确保留 CRLF」。Rust 的原子写一直是字节保真的，丢失发生在更上游。
 */
export type LineEnding = '\n' | '\r\n'

/**
 * 只有**全篇一致**用 CRLF 才判定为 CRLF；混合行尾一律按 LF 处理。
 *
 * 混合行尾的文档本来就谈不上「字节精确保留」——一旦经过编辑器就必然被归一化。
 * 在两种归一化里选 LF：把整篇改写成 CRLF 会造出一个覆盖每一行的假 diff，而只把
 * 落单的那几行改成 LF 是两者中更小的改动。
 */
export function detectLineEnding(value: string): LineEnding {
  if (!value.includes('\r\n')) return '\n'
  // 去掉全部 CRLF 之后若还剩任何 \r 或 \n，说明行尾不一致。
  return /[\r\n]/.test(value.split('\r\n').join('')) ? '\n' : '\r\n'
}

/** 幂等：先把任意行尾归一成 LF，再按目标行尾编码。反复调用结果不变。 */
export function withLineEnding(value: string, ending: LineEnding): string {
  const lf = value.replace(/\r\n?/g, '\n')
  return ending === '\n' ? lf : lf.replace(/\n/g, '\r\n')
}
