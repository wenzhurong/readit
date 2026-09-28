import { closestAnchor, isExternalHref } from './external-links.js'

/**
 * ⌘ / Ctrl / Shift / Alt + 点击文档里的站内链接。
 *
 * 元素对修饰键点击一律放行（在浏览器里「新窗口打开」是宿主的事），可 WebView 里没有
 * 「新窗口」，默认动作会怎样走没有验证过，也可能直接把壳的页面导航走。多标签设计 D6：
 * 本版不开新标签，改为对同一个链接的一次普通点击，交给元素在当前标签里跳转。外链不归
 * 这里，归 external-links.ts；空 href 只拦下（SPEC §11.2）。
 *
 * 必须在 connectExternalLinks 之后接到同一个宿主上：两者都是捕获阶段监听，外链先被那边认领。
 */
export function connectModifierClicks(host: HTMLElement): () => void {
  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) return
    const anchor = closestAnchor(event)
    if (anchor === null) return
    const href = anchor.getAttribute('href')
    if (href === null || isExternalHref(href)) return
    event.preventDefault()
    event.stopPropagation()
    // 显式派发而不用 anchor.click()：composed 的普通点击才能冒出 shadow root 到达元素的监听，
    // 这样写在 happy-dom 与真引擎里行为一致。
    if (href.trim() !== '') {
      anchor.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }),
      )
    }
  }
  host.addEventListener('click', onClick, true)
  return () => host.removeEventListener('click', onClick, true)
}
