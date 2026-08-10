import type { Element, Root, RootContent } from 'hast'
import { toHtml } from 'hast-util-to-html'

/**
 * 把一串 hast 节点序列化成 <pre> 的内容。
 *
 * 注意 hast-util-to-html 在文本位置不转义 `>`（GitHub 转义成 `&gt;`）。这只影响
 * 本包自己的 ③档黄金文件：语料以 highlighter: null 跑，看不见任何高亮标记；
 * 而归一化器两侧都要过一遍 parse → toHtml，转义写法在那里被抹平。
 */
export function serializeFragment(children: readonly RootContent[]): string {
  return toHtml({ type: 'root', children: [...children] })
}

function firstElement(children: readonly RootContent[], tagName: string): Element | undefined {
  for (const child of children) {
    if (child.type === 'element' && child.tagName === tagName) return child
  }
  return undefined
}

/**
 * 剥掉 `<pre><code>` 外壳，只留下 token 节点。
 *
 * core 的 renderBlock 自己发 GitHub 形状的
 * `<div class="highlight highlight-source-js …"><pre>{body}</pre></div>`，
 * highlight() 只负责 body。找不到外壳时原样返回，绝不吞内容。
 */
export function unwrapPreCode(root: Root): readonly RootContent[] {
  const pre = firstElement(root.children, 'pre')
  if (pre === undefined) return root.children
  const code = firstElement(pre.children, 'code')
  return code === undefined ? pre.children : code.children
}
