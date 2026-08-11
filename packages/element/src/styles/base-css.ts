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
.readit-root { position: relative; height: 100%; min-width: 0; outline: none; }
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
