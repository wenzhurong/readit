// Highlighter 由 @readit/core 拥有（P3：接口已存在，不得改动）。本包在这里把它
// 再导出一次，让「拿工厂的地方」和「拿类型的地方」是同一个 import —— 类型导出，
// 运行时不产生任何对 core 的引用。
//
// 本文件的最终形态是三行：Task 7 追加 createShikiHighlighter，Task 8 追加
// createStarryNightHighlighter，两次都是追加而非替换。
export type { Highlighter } from '@readit/core/types'
