import MarkdownItConstructor from 'markdown-it'
import type { MarkdownIt } from 'markdown-it'
import type { RenderOptions } from './types.js'

import { applyStrikethrough } from './rules/strikethrough.js'
import { applyTableAlign, applyTableWrapper } from './rules/table.js'
import { applyAutolink } from './rules/autolink.js'
import { applyTagfilter } from './rules/tagfilter.js'
import { applyFrontmatter } from './rules/frontmatter.js'
import { applyFootnote } from './rules/footnote.js'
import { applyMathInline } from './rules/math-inline.js'
import { applyMathBlock } from './rules/math-block.js'
import { applyEmoji } from './rules/emoji.js'
import { applyAlerts } from './rules/alerts.js'
import { applyTaskList } from './rules/tasklist.js'
import { applyHeadingAnchors } from './rules/heading.js'
import { applyDirAuto } from './rules/dirauto.js'
import { applyDecorate } from './rules/decorate.js'
import { applyCodeBlock } from './rules/codeblock.js'
import { applySourceLine } from './rules/sourceline.js'
import { applyRawShape } from './rules/rawshape.js'
import { applyRawHtmlPolicy } from './sanitize.js'

/** 一条渲染规则。文件位于 src/rules/<name>.ts，形如 export function applyXxx(md: MarkdownIt): void */
export type Rule = (md: MarkdownIt) => void

/**
 * 语义规则：改变 CommonMark/GFM **解析或语义**结果的规则。
 * cmark-gfm 的 spec.txt 对这些有明确期望，所以 L1 规格套件必须带上它们。
 * 例：GFM 扩展自动链接、tagfilter、表格 align 属性、<s> -> <del>。
 *
 * 顺序在这四条之间不重要——彼此互不依赖，没有测出任何顺序耦合。
 *
 * 这个数组必须与 `SEMANTIC_RULE_BY_EXTENSION` 的取值**集合相等**，由
 * test/integration.test.ts 的「rule registry」棘轮钉住：规格套件是逐例按
 * 扩展名查那张表来挑规则的，所以「进了本数组却没进那张表」的规则对全部
 * 1324 条规格用例完全不可见。
 *
 * 「那就靠输出断言兜底」是行不通的，这一点是量出来的而不是猜的：把 13 条候选
 * （下面 `SHAPE_RULES` 的 12 条，加上数组外注册的 `applyRawShape`）逐条**真的**
 * 装进规格引擎、再按 `runSpecSuite` 的判定跑完 652 + 672 条用例，有 7 条整套仍
 * 然全绿（applyFrontmatter、applyFootnote、applyMathInline、applyMathBlock、
 * applyEmoji、applyAlerts、applyTaskList）。这个 7 和这份名单不是手工维护的
 * 数字：test/integration.test.ts 的「rule registry」里有一条用例现场重算它，
 * 名单一变就红。
 *
 * `applyTagfilter` 在本数组里的槽位是**承重的**（规格套件按扩展名查
 * `SEMANTIC_RULE_BY_EXTENSION`，GFM 例 652 要它），但作为过滤器它本该是
 * html_block/html_inline 渲染器链的**最外层**，而本数组最先加载，它在这里
 * 只能是最内层。这两条要求曾被当成二选一（要么移出数组、打破棘轮，要么
 * 保留槽位、把缺口写进注释）。它们其实不冲突：`createEngine` 在最后**再
 * 注册一次** `applyTagfilter`，槽位与最外层同时成立。可行的前提是
 * `filterDisallowedTags` 幂等——见 rules/tagfilter.ts 的注释与
 * tagfilter.test.ts 的穷举用例。
 */
export const SEMANTIC_RULES: Rule[] = [
  applyStrikethrough,
  applyTableAlign,
  applyAutolink,
  applyTagfilter, // ← 槽位承重（规格套件要它）；另在 createEngine 末尾再注册一次，见上方注释
]

/**
 * 外形规则：只往输出上贴 GitHub 特有的外壳/属性，不改变解析语义。
 * 例：dir="auto"、标题锚点 wrapper、<markdown-accessiblity-table>、代码块 wrapper、data-line。
 * L1 规格套件**不**加载它们 —— 加载了会让 672 条 GFM 里的绝大多数无条件失败，
 * 「672/672 减白名单」那条验收线就不再可达。它们由 L2 黄金文件套件负责。
 *
 * `applyCodeBlock` 与 `applyRawHtmlPolicy` 需要 `opts`（highlighter / allowDangerousHtml），
 * 不匹配 `Rule = (md) => void` 的签名，因此不放进这个数组——它们在 `createEngine` 里单独调用。
 *
 * 顺序里三处真实耦合（其余顺序只为可读性，互换不影响正确性，已用集成测试验证）：
 *  1. applyDirAuto 必须在 applyTaskList 之后：dirauto.ts 靠 `contains-task-list`
 *     这个 class 跳过任务列表的 <ul>，而这个 class 是 tasklist 的核心规则通过
 *     `state.core.ruler.push` 设置的——两者都用 push，注册顺序 == 执行顺序。
 *  2. applyHeadingAnchors 必须在 applyDirAuto 之前：markdown-it 按 token.attrs
 *     数组顺序序列化属性，GitHub 发的是 `class` 在 `dir` 之前
 *     （`<h1 class="heading-element" dir="auto">`），而两者都在 heading_open
 *     token 上调用 attrSet，同样都用 push。
 *  3. applySourceLine 放最后：它给带 map 的块级 token 补 `data-line`，且同样用
 *     attrSet。集成测试证实了这一点对 `<p dir="auto" data-line="...">` 成立
 *     ——如果 dirAuto 在它之后跑，data-line 就不会是最后一个属性。
 *     但 alerts.ts 的 alert_open 和 codeblock.ts 的 fence/code_block 渲染器
 *     是手工拼字符串读 `attrGet('data-line')`，与数组位置无关，所以「必须最后」
 *     这条理由对它们不成立——sourceline.ts 自己的注释已经把这个边界说清楚了，
 *     这里不重复验证，只是不能拿它们来证伪「最后」这个默认策略。
 *
 *  4. applyRawShape 必须在 applyRawHtmlPolicy 之后，而且**不在这个数组里**——这条
 *     是承重的，不是风格问题。core rule 按 push 顺序执行，数组里每一条都跑在
 *     `readit_sanitize` / `readit_clobber` 之前。applyRawShape 往
 *     html_block/html_inline 的 token.content 里写带 class 的标记（C3(a) 平时禁止
 *     的事），靠的正是「卫生化器已经跑完、永远看不到它」这一点。把它挪进数组、
 *     或者把 applyRawHtmlPolicy 挪到它后面，五项装饰会被静默全灭（`style` 剥掉、
 *     `<markdown-accessiblity-table>` 外壳删掉、`class` 清空、`rel`/`target` 剥掉）。
 *     理由与形态写在 rules/rawshape.ts 顶部的 C3(a) 注释里。
 *
 *  5. applyAutolink 必须在 applyDecorate 之前——**跨槽**耦合，今天成立只是因为
 *     SEMANTIC 数组整体先于 SHAPE 数组加载，属于槽位结构的副产品，不是被声明过
 *     的约束。机制：GFM 扩展自动链接的 link_open token 不是 markdown-it 的
 *     inline 解析器产出的，而是 autolink.ts 的 core rule `readit_gfm_autolink`
 *     在 text token 上**现场合成**的；applyDecorate 的 core rule `readit_decorate`
 *     只认已经存在的 link_open token，给 isExternal 的那些 attrSet('rel',
 *     'nofollow')。两条都用 core.ruler.push，注册顺序 == 执行顺序，所以 decorate
 *     先跑时，扩展自动链接的 link_open 还不存在，nofollow 无从贴起。
 *     实测（2026-08-08，`www.example.com and [md](http://other.com)`）：
 *       正序 <a href="http://www.example.com" rel="nofollow">www.example.com</a>
 *       换序 <a href="http://www.example.com">www.example.com</a>
 *     注意换序**只**打掉扩展自动链接的 nofollow：同一行里 `[md](http://other.com)`
 *     两种顺序下都保留 rel="nofollow"，因为它的 link_open 来自内建 `inline`
 *     规则，而 `inline` 排在所有 push 进来的 core rule 之前。正因为如此，只用
 *     markdown 链接写的测试永远测不出这条耦合。
 *     钉在 test/rules/decorate.test.ts 的「ordering coupling」用例（直接两种顺序
 *     各建一个引擎对比），另由 test/integration.test.ts 那条精确字节断言兜底。
 *
 *  6. 美元护栏 / emoji / 自动链接三者相对 `text_join` 的锚点（计划 C2 第 4 条）。
 *     这条不靠数组顺序，靠各自的锚点，所以换数组位置不影响；列在这里是因为
 *     applyRawShape 接手 #4 槽位时它被挤出了本枚举，而它仍然是承重的：
 *       · applyMathInline 挂 `core.ruler.before('text_join')`——护栏要靠
 *         `text_special` 仍是独立 token 才能做 R9 的 `\$` 遮罩；
 *       · applyEmoji 挂 `core.ruler.after('text_join')`——`\:smile:` 在合并前是
 *         text_special + text 两个 token，看不出候选；
 *       · applyAutolink 用 `core.ruler.push`（即 text_join 之后）——要的正好相反，
 *         实体必须已经并进 text.content 并解码，否则 `&amp;` 会把一条 URL 切成
 *         三个 token。
 *     护栏与自动链接的方向相反但互不干扰。三条要求各自写在
 *     rules/math-inline.ts、rules/emoji.ts、rules/autolink.ts 的注释里。
 *
 * 一处**刻意不成为**第五条耦合的地方：`applyMathBlock` 要处理 ```math 围栏，而
 * `applyCodeBlock` 在下面的循环**之后**才注册 `renderer.rules.fence`，会覆盖
 * 任何在 SHAPE 槽里装的 fence 渲染器。math-block.ts 因此不装 fence 渲染器，改在
 * core rule 里把 token 类型改成 `math_block`——代码块渲染器根本看不到它。它的
 * core rule 也锚在 `after('inline')`（而不是引用 `readit_math_inline` 这个名字），
 * 所以它与 applyMathInline 的相对注册顺序同样不承重。下面把它排在 applyMathInline
 * 紧后面只是为了可读性；换位置不影响正确性，math-block.test.ts 有具名用例钉住这一点。
 */
export const SHAPE_RULES: Rule[] = [
  applyFrontmatter,
  applyFootnote,
  applyMathInline,
  applyMathBlock,
  applyEmoji,
  applyAlerts,
  applyTableWrapper,
  applyTaskList,
  applyHeadingAnchors,
  applyDirAuto, // ← 必须在 applyTaskList 与 applyHeadingAnchors 之后（见上方注释 #1 #2）
  applyDecorate,
  applySourceLine, // ← 必须最后（见上方注释 #3）
]

/**
 * readit 自己生成的、含 class 的原样 HTML 统一走这个 token 类型。
 * 见 C3(a)：用 html_inline / html_block 的话，class 会被 applyRawHtmlPolicy 的
 * walker 当成用户写的 class 剥掉——emoji 规则在起草集成时真的踩到过这个 bug。
 *
 * 只在 createEngine 里注册一次。createSpecEngine 不需要它：SEMANTIC_RULES 四条
 * 规则没有一条会发 readit_raw token。各规则文件里仍保留的 `??=` 防御性注册
 * 是幂等的，可以留着（standalone 单测直接 new MarkdownIt().use(applyXxx) 时
 * 还要靠它们）。
 */
function registerReaditRaw(md: MarkdownIt): void {
  md.renderer.rules.readit_raw ??= (tokens, idx) => tokens[idx]!.content
}

/**
 * 两条引擎共用的基础实例。
 *
 * `html: true`是硬编码，不跟着 `opts.allowDangerousHtml` 走——`sanitize.ts` 的
 * `applyRawHtmlPolicy` 自己的文档写得很清楚：「markdown-it must always run
 * with html: true; the safety comes from here, not from the parser.」如果这里
 * 按 `opts.allowDangerousHtml` 置 `html`，那么默认选项（`allowDangerousHtml:
 * false`）下 markdown-it 根本不会把原始 HTML 切成 html_block/html_inline
 * token，`applySanitize` 的 walker 就找不到任何目标可清洗，原始 HTML 反而会被
 * markdown-it 自身的文本转义直接吞掉——集成测试跑通之前这里原来就是
 * `html: opts.allowDangerousHtml`，是本任务发现并修的第一处装配 bug。
 */
function baseEngine(breaks = false): MarkdownIt {
  return new MarkdownItConstructor({
    html: true,
    xhtmlOut: false,
    // 默认 false = GitHub 的 .md 文件渲染，也是 CommonMark 规格套件（L1）要的值；
    // createSpecEngine 不传参，永远走这一档。只有 createEngine 会按宿主选项抬起它。
    breaks,
    langPrefix: 'language-',
    // linkify-it 6 把 fuzzyLink 默认关了；GFM 扩展自动链接由 SEMANTIC_RULES 里的
    // 自写规则移植（SPEC §6 规则 1）。这里必须保持 false，不要改回 true。
    linkify: false,
    typographer: false,
  })
}

/** 完整引擎：语义规则 + 外形规则。render() 走这条。 */
export function createEngine(opts: RenderOptions): MarkdownIt {
  const md = baseEngine(opts.breaks)
  registerReaditRaw(md)
  for (const apply of SEMANTIC_RULES) apply(md)
  for (const apply of SHAPE_RULES) apply(md)
  applyCodeBlock(md, opts.highlighter)
  applyRawHtmlPolicy(md, opts.allowDangerousHtml)
  applyRawShape(md) // ← 必须在 applyRawHtmlPolicy 之后（见上方注释 #4）
  // 第二次注册 applyTagfilter，**故意**的：SEMANTIC 槽让它成为
  // html_block/html_inline 渲染器链的最内层，这一行让它同时成为最外层，于是
  // 任何未来在 SHAPE 槽覆写这两条渲染器的规则，其 `prev(...) + X` 里的 X 也会
  // 被过滤。之所以能这么做而不是二选一，是因为 filterDisallowedTags 幂等——
  // tagfilter.ts 的注释里有对 TAGFILTER_RE 的证明，tagfilter.test.ts 另有一条
  // 穷举用例守着那条正则。第二次注册零字节差异这件事也是量出来的：
  // tagfilter.test.ts 会构造一个**真的只注册一次**的引擎来对比（9 个标签 ×
  // 7 种文档形状 × 两种模式 = 126 份文档，0 字节差异）。
  // applyRawShape 不参与这条链——它是 core rule，改的是 token.content，渲染器
  // 无论注册在哪儿都只看最终内容。
  applyTagfilter(md)
  return md
}

/**
 * 规格一致性引擎：只加载语义规则。仅供 test/spec/ 下的 L1 套件使用。
 *
 * 不调用 `applyRawHtmlPolicy`：L1 套件（见 test/spec/harness.ts 的
 * `renderForSpec`）假定原始 HTML 透传——markdown-it 在 `html: true` 且没有渲染器覆写的情况下，
 * 对 html_block/html_inline 的默认行为本来就是原样输出 token.content，
 * 完全等价于「透传」，不需要再套一层策略，也没有 RenderOptions 可消费。
 *
 * `rules` 默认等于 `SEMANTIC_RULES`（保持原有「规格引擎 = 全部语义规则」的行为，
 * 集成测试 `createSpecEngine loads only the semantic slot` 依赖这个默认值）。
 * test/spec/harness.ts 会显式传一个只含单条规则（或空）的子集——见下方
 * `SEMANTIC_RULE_BY_EXTENSION` 的文档注释，这是 Task 32a 修复 L1 套件结构性
 * 缺口所需要的挂钩。
 */
export function createSpecEngine(rules: readonly Rule[] = SEMANTIC_RULES): MarkdownIt {
  const md = baseEngine()
  for (const apply of rules) apply(md)
  return md
}

/**
 * SEMANTIC_RULES 里每条规则对应的 cmark-gfm 扩展名，取自 spec.txt 围栏行的
 * info string（如 `` ```````... example autolink ``，见 scripts/fetch-specs.ts
 * 的 `parseGfmSpec`）。
 *
 * 存在原因（Task 32a 的结构性发现）：cmark-gfm 自己的 spec 是**逐例**按 info
 * string 挑扩展生成期望输出的——672 个 GFM 例子里 648 个 info 为空，是用**不带
 * 任何扩展**的基线解析器（含 CommonMark 本身，652 例，同样零扩展）生成的。
 * `createSpecEngine` 若无条件加载全部 SEMANTIC_RULES，`applyAutolink` /
 * `applyTagfilter` 会污染那 648 个空 info 例子——包括 GFM 自己的「Autolinks」
 * （非扩展小节）与两套规格的「HTML blocks」小节——CommonMark 套件因为零扩展，
 * 污染面是全部 652 例。
 *
 * `disabled`（cmark-gfm 自己的 runner 也跳过的 2 个任务列表例子）与空串一样，
 * 都不映射到任何规则——两者都应该用零扩展的基线引擎渲染。
 */
export const SEMANTIC_RULE_BY_EXTENSION: Readonly<Record<string, Rule>> = {
  table: applyTableAlign,
  autolink: applyAutolink,
  strikethrough: applyStrikethrough,
  tagfilter: applyTagfilter,
}
