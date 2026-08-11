// §0.2 那笔债已还清（Task 17，批次 7）。这里曾经记着一条真实的缺口：@readit/editor
// 只有类型再导出时，这个子路径构建出来是个空壳，而 publint 与 @arethetypeswrong 照样判绿
// ——它们只检查「exports 映射指向的文件在不在、类型味道匹不匹配」，不检查模块有没有实质内容。
//
// 现在空壳这件事在类型层面就不可能发生：packages/element/src/panes.ts 依赖 createEditor()，
// 把 @readit/editor 退回纯类型再导出会让 buildDist() 在 tsc 阶段直接崩
// （TS2339: Property 'createEditor' does not exist），构建根本产不出东西可供门去判绿。
// 这比「某条断言变红」更早、更硬。评审实测复现过这两条路径，见 batch-7-report.md。
//
// 另有 packages/readit/test/build-output.test.ts 从产物侧兜底：CodeMirror 的字符串指纹
// 不得出现在 editor.js 的静态闭包里，且它必须落在一个体积可观的独立懒加载 chunk 中。
export * from '@readit/editor'
export * from '@readit/editor'
