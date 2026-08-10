// §0.2：此刻 @readit/editor/src/index.ts 只有类型再导出（createEditor() 要到 Task 13
// 才落地），所以这个子路径构建出来是个空壳——dist/editor.js 里没有任何运行时绑定。
// publint 与 @arethetypeswrong 此刻仍会判它绿，因为它们只检查「exports 映射与它指向的
// 文件是否存在、类型味道是否匹配」，不检查「模块是否有实质内容」。这是计划二决策 1
// （M3 段先行）明确接受的时序代价，见 contract.md §0.2：Task 17 交付 createEditor() 之后
// 必须重跑 Task 10 的三条分发门，那时这三条门才第一次在真实意义上验证 './editor'。
export * from '@readit/editor'
