# npm high 依赖告警修复规格

**日期：** 2026-08-29
**范围：** 台账 D2-26；不改前置物解析 schema，不改业务 API，不宣称 Rust advisory 已审计。

## 1. 修复前现状与目标

`npm audit --json` 在本规格开始时的 lockfile 上报告 **2 high / 0 critical**：

- 直接出货依赖 `js-yaml 4.1.0`，当前通告要求至少 `4.3.2`；
- 构建链 `vite → postcss → nanoid 3.3.17`，通告要求至少 `3.3.18`。

旧风险评估证明当时的 readit 路径不可达，但不能替代已发布补丁。本轮目标是在不
改变 `CORE_SCHEMA` 和已记录诊断契约的前提下消除两条 high，使 `npm audit --audit-level=high`
退出 `0`。

## 2. 实现

1. 将 `packages/core` 直接依赖固定为 `js-yaml 4.3.2`。
2. 在 lockfile 中将 PostCSS 允许范围内的 nanoid 解析为 `3.3.18`；不把它伪装成根直接依赖。
3. 新增静态回归，钉住 manifest/lockfile 不得回退到已知受影响版本。
4. 保留 `load(yaml, { schema: CORE_SCHEMA })`、merge/`!!omap` schema 守卫与现有错误诊断棘轮；
   若上游诊断文本变化，必须显式重判而不得盲改快照。
5. 在常规在线 `test` workflow 中加入唯一一次阻塞式 `npm audit --audit-level=high`。该步骤
   放在单次 Ubuntu typecheck job 的完整构建/类型检查之后，既不把相同网络审计重复三遍，
   也不污染明确要求断网执行的测试；不得设置 `continue-on-error`。

## 3. 验收门

- `npm ci` 原样成功；
- 根全量测试、完整 build/typecheck 通过；
- 前置物语料、CommonMark/GFM 棘轮和发布包自包含检查继续通过；
- browser、visual、offline 远程 workflow 通过；
- `npm audit --audit-level=high` 退出 `0`；
- 远程 `test` workflow 的显式 audit step 阻塞执行并通过；
- README 和 D2-26 更新为已修复，历史报告保留当时实测数据而不回写。

只有上述门全部通过，D2-26 才可关闭。本规格不将 npm 结果外推为 Cargo/Rust 依赖审计结论。

## 4. 执行结果与清账

提交 `d2a54d91db81264704bc41090b82a29ea0ff0322` 的四条基础工作流全部成功：

| Workflow | Run | 结果 |
|---|---:|---|
| browser | [`33284072318`](https://github.com/wenzhurong/readit/actions/runs/33284072318) | 5 个 browser jobs 全部成功 |
| visual | [`33284072134`](https://github.com/wenzhurong/readit/actions/runs/33284072134) | L4 visual regression 成功 |
| offline | [`33284072150`](https://github.com/wenzhurong/readit/actions/runs/33284072150) | 无出口网络 namespace 内完整 suite 成功 |
| test | [`33284072185`](https://github.com/wenzhurong/readit/actions/runs/33284072185) | 6 个 jobs 全部成功 |

[`typecheck` job](https://github.com/wenzhurong/readit/actions/runs/33284072185/job/99184083975)
先完成完整 build/typecheck，再真实执行名为 `Block high and critical npm advisories` 的阻塞步骤；
日志中的原始命令为 `npm audit --audit-level=high`，输出 `found 0 vulnerabilities`，没有 skip、
`continue-on-error` 或 shell 吞错。CI wiring 通过 YAML 语义解析钉住唯一 audit step、精确命令、
顺序及无条件跳过，不能用 `|| true`、`--omit` 或 `if: false` 假绿。

同一 `test` run 的根测试为 `103 files / 2977 tests`，三平台、深路径 build/typecheck 及 Windows
Rust `40/40` 均成功。`js-yaml 4.3.2` 与 `nanoid 3.3.18` 的静态版本守卫继续通过。因此本规格
全部验收门已满足，D2-26 改判 **已还清**。该结论不包含 Cargo/Rust advisory 审计；npm
registry/API 不可用时 audit 会失败关闭，这是持续安全门的明确可用性权衡。
