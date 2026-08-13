/**
 * 自家的版面规则。github-markdown-css 只管 .markdown-body 内部的排版，窗格布局、
 * 源码回落样式与错误态是我们自己的。
 *
 * :host 规则在 shadow:false 逃生舱下不匹配任何东西——那是逃生舱的定义（宿主自己
 * 管样式），所以布局全部挂在 .readit-root 上，:host 只留一条 display。
 */
export const BASE_CSS = `
:host { display: block; }
:host([hidden]) { display: none; }
/*
 * D2-20：继承属性的边界重置。SPEC §14 的 M3 验收线「敌意宿主 fixture 下渲染不变」
 * 此前被 hostile-isolation.spec.ts 自己的 test.fail() 证明为假，成因就是这里缺的东西。
 *
 * ## 为什么落在 .readit-root 而不是 :host
 *
 * 继承是穿过 shadow 边界的——挡它的从来不是 Shadow DOM，是一次显式重置。
 * 但重置不能挂 :host：宿主页面的 "* { … !important }" 同样命中宿主元素本身，
 * 而按 CSS Scoping 的跨树层叠顺序，**普通**声明外层树赢、**important** 声明内层树赢。
 * 挂 :host 就得跟着写 !important 才压得住，等于跟宿主打 important 军备竞赛。
 *
 * 挂 .readit-root 不用打：那个元素在 shadow 树**内部**，宿主的 "*" 选择器根本
 * 匹配不到它，所以普通声明就赢，而它的全部后代改从它这里继承，不再从被污染的
 * 宿主元素继承。这与 github-markdown-css 挡住 color/font-family/line-height 的
 * 机理完全一致（它把那三项设在 .markdown-body 自己身上）——不是新发明的招式。
 *
 * ## 为什么是这些项
 *
 * 起点是 browser/fixtures/css/hostile-extra.css 设的那九个继承属性。
 *
 * 第一版只重置了六项，把 line-height / color / font-family 减掉了，理由是
 * "github-markdown-css 自己在 .markdown-body 上设了这三项"。**那个减法是错的**，
 * 而且是被测试当场抓住的：它把「shadow 树」与「.markdown-body」当成了一回事。
 * shadow 树里还有错误面板、源码窗格、回落 <pre> 这些**不在 .markdown-body 下**的
 * 节点，gmc 的选择器根本够不到它们。抓到它的是采样里的 "p"——
 * root.querySelector("p") 命中的是错误面板的 .readit-error-title，不是正文段落。
 *
 * 所以 color 与 line-height 也要重置。color 不能硬钉成黑色：错误面板在深色主题下
 * 会变成黑字。用 CanvasText——它随 color-scheme 自动翻转，而那两条 color-scheme
 * 声明正是批次 5 从上游媒体块里抬块时漏掉、又补回来的东西（见 gen-theme-css.ts）。
 * .markdown-body 内部不受影响：gmc 在它自己身上显式设了这三项，那个声明赢。
 *
 * ## tab-size 不在敌意表里，是像素比对逼出来的
 *
 * 前面那份清单从 hostile-extra.css 反推，因此覆盖不到**另一个来源**：
 * 敌意页还加载了 Tailwind Preflight 与 Bootstrap Reboot，而干净页不加载
 * （那是夹具的设计——见 test/visual-wiring.test.ts 那条"差别必须只有那三个 link"）。
 * Preflight 把 tab-size 从浏览器默认的 8 改成 4、把 text-size-adjust 设成 100%，
 * 两者都是继承属性，照样穿过 shadow 边界，含制表符的代码块因此两个宿主渲染不同。
 *
 * 抓到它的不是 hostile-isolation.spec.ts——那条当时是绿的，因为它比的是一张
 * **手挑的** PROPS 表，而 tab-size 不在表里。抓到它的是 L4 的逐像素比对，
 * 以及随后对 getComputedStyle **全部**属性做的一次差集。那条 spec 已改成全属性差集。
 *
 * ## font-family 是唯一一项**故意不重置**的，理由是实测出来的
 *
 * 它是敌意表设的第九项，守卫（base-css.test.ts）里有一条具名豁免。
 * 试过给它加 "font-family: system-ui, sans-serif"，结果是 L4 基线**生不出来**：
 * visual-fonts.css 靠 "#a::part(root)" / "::part(content)" 把字体钉成
 * 'Noto Sans'，再用文档级 @font-face 把那个族名接管到自托管的 woff2——
 * 整套 L4 的字体确定性都建立在「元素自己不硬钉字体、让外部 ::part 说了算」上。
 * 在 .readit-root 上写死一个族栈会跟这套钉法打架。
 *
 * 残留缺口（具名，不是遗漏）：真实宿主若用 "* { font-family: … !important }"，
 * 界面外壳（错误面板标题、降级提示）的字体会跟着宿主走。正文不受影响——
 * github-markdown-css 在 .markdown-body 自己身上设了字体栈。
 * 这是排版观感层面的，不影响内容、不影响安全边界。
 *
 * 其中 font-variant-numeric 是这次才补上的第六项——D2-20 原本记的是「五项」，
 * 那五项来自 browser/support/visual.ts 的 PROPS 采样表，而**那张表漏了它**。
 * 计算样式探针看不见，截图看得见（code-and-tables 里那个 42 会变成等宽数字）。
 * 「广度由做声明的人自己选定」在这个项目里又发作了一次，这次发作在债务条目本身。
 * PROPS 已同步补上它，且 base-css.test.ts 现在从 hostile-extra.css **反推**这张
 * 清单——往敌意表里加一条继承属性而不在这里重置，构建会红，不再依赖谁记得。
 */
.readit-root {
  position: relative; height: 100%; min-width: 0; outline: none;
  letter-spacing: normal; word-spacing: normal; font-style: normal;
  font-variant-numeric: normal; text-align: start; text-transform: none;
  color: CanvasText; line-height: normal;
  tab-size: 8; text-size-adjust: auto; -webkit-text-size-adjust: auto;
}
.readit-root[data-mode="split"] { display: grid; grid-template-columns: 1fr 1fr; }
.readit-pane { min-width: 0; overflow: auto; }
.readit-pane[hidden] { display: none; }
.readit-source-fallback {
  margin: 0; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere;
  font: 12px/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
/*
 * Task 17：两个编辑器实现都不会自己把高度撑满 .readit-source——<textarea>
 * 没有显式 height 时按 rows 属性算一个很小的默认高度；CodeMirror 的
 * .cm-editor 同样不会自动继承祖先的高度（这是它一贯的设计，交给宿主页面决定）。
 * 不补这两条，两个后果都是真的：可见的编辑区域只有几行高，且更要命的是
 * CodeMirror 自己的滚动视口 .cm-scroller 因为「没有被裁切」而不会真的进入
 * 可滚动状态——它的 scrollHeight 会等于 clientHeight，滚动同步（scroll/sync.ts）
 * 从编辑器一侧的 scroll 事件永远等不到，因为那个事件从来不会发生。
 */
.readit-source textarea.readit-plain-editor {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 0;
  resize: none;
}
.readit-source .cm-editor {
  height: 100%;
}
.readit-error { margin: 16px; padding: 12px 16px; border: 1px solid #cf222e; border-radius: 6px; }
.readit-error[hidden] { display: none; }
.readit-error-title { margin: 0 0 4px; font-weight: 600; }
.readit-error-path {
  margin: 0; overflow-wrap: anywhere;
  font: 12px/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
.readit-error-detail { margin: 4px 0 0; font-size: 12px; }
.readit-error-detail:empty { display: none; }

.highlight-source-mermaid[data-readit-mermaid-state="ready"] {
  padding: 16px;
  overflow: auto;
}
.highlight-source-mermaid[data-readit-mermaid-state="ready"] > svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
.readit-mermaid-error {
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid #cf222e;
  border-radius: 6px;
  color: #cf222e;
  white-space: normal;
}

/*
 * §0.1 G4：data-readit-pending 的可见样式——降级角标。属性由 Task 17 的
 * kernel.ts 设置在宿主元素自己身上（host.dataset.readitPending，见 kernel.ts
 * 里 createPanes() 的 onPending 回调），不是设在 shadow 树内部的某个节点上。
 * 这份 CSS 通过 adoptedStyleSheets 挂在 ShadowRoot 里（shadow:true 时），
 * 选择器必须是 :host([data-readit-pending])——裸的 [data-readit-pending]
 * 只会匹配 shadow 树内部带这个属性的元素，那样的元素从来不存在，角标会挂在
 * 一个永远选不中的选择器上，"降级必须可见" 仍然是一句空话（这是本文件在
 * Task 17 之前的实际状态，已订正）。
 * :host() 伪类只在 shadow 上下文里生效——shadow:false 逃生舱下这条规则
 * 同样不匹配任何东西，与文件顶部 ":host { display: block; }" 那条是同一个、
 * 已经写明的已知取舍（逃生舱下宿主自己管样式）。
 * 用 ::after 加一个小角标而不是改变宿主节点的布局盒子，避免内容到达后
 * 再次重排导致的跳动；:host(...) 需要显式给 position，因为默认 :host
 * 规则只设了 display，没有 position: relative 可继承。
 */
:host([data-readit-pending]) { position: relative; }
:host([data-readit-pending])::after {
  content: "";
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
  animation: readit-pending-pulse 1.2s ease-in-out infinite;
  pointer-events: none;
}
@keyframes readit-pending-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 0.75; }
}
`
