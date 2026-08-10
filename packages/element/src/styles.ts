/**
 * §0 A6：这份包的 `exports` 预留了 `"./styles": "./src/styles.ts"`（Task 1）。
 * 本文件是那个子路径的实体，产出 Task 9 的构建脚本要消费的两个常量：
 *
 *   - `ELEMENT_CSS`：内联进 `./element` 构建产物、走 adoptedStyleSheets 那一份。
 *     Task 9 的 `test/build-output.test.ts` 断言 `ELEMENT_CSS` 里出现的类选择器
 *     确实能在 `dist/element.js` 的产物闭包里找到——这要求它与运行时内核实际
 *     adopt 的样式文本同源。kernel.ts 按当前解析主题在 `LIGHT_CSS` / `DARK_CSS`
 *     二选一 + `BASE_CSS` 走 `setStyles()`；`ELEMENT_CSS` 把两个主题都算进去，
 *     是给「构建产物里到底打包了什么」这个问题的答案，不是给运行时哪张表在生效
 *     的答案——运行时哪张表生效仍由 kernel.ts 的 setTheme() 二选一决定。
 *
 *   - `LIGHT_DOM_CSS`：输出为 `./styles.css`，给 shadow:false 逃生舱下的 light DOM
 *     消费者引入。逃生舱没有 shadow root 的样式隔离，宿主需要自己 <link> 一份；
 *     这里给的是浅色主题 + 版面规则这一份默认值（跨主题切换在 light DOM 下本来就
 *     要宿主自己接线，不是这一份静态文件能解决的）。
 *
 * 这两个常量目前没有运行时调用方——kernel.ts 继续直接从 `./styles/base-css.js`
 * 与 `./styles/theme-css.js` 读取 `BASE_CSS` / `LIGHT_CSS` / `DARK_CSS`，因为
 * setTheme() 需要「只替换一张主题表」而不是整份重算，两个常量服务的是不同消费者。
 */
import { BASE_CSS } from './styles/base-css.js'
import { DARK_CSS, LIGHT_CSS } from './styles/theme-css.js'

export const ELEMENT_CSS: string = [LIGHT_CSS, DARK_CSS, BASE_CSS].join('\n')

export const LIGHT_DOM_CSS: string = [LIGHT_CSS, BASE_CSS].join('\n')
