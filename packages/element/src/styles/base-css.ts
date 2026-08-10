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
 * §0.1 G4：data-readit-pending 的可见样式——降级角标。属性本身由 Task 15 设置
 * （异步高亮器/数学渲染器还没准备好时挂在对应节点上），这里只提供让它「长得出来」
 * 的那一半；两半缺一，"降级必须可见" 就是一句空话。用 ::after 加一个小角标而不是
 * 改变宿主节点的布局盒子，避免内容到达后再次重排导致的跳动。
 */
[data-readit-pending] { position: relative; }
[data-readit-pending]::after {
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
