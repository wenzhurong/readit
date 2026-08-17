# Windows 壳推进报告

> 对应方案：[`2026-08-17-windows-shell.md`](./2026-08-17-windows-shell.md)  
> 分支：`agent/windows-shell`  
> 同步基线：`33b5ea7 docs: Windows 壳构建方案`

## 当前结论

工作仍在推进中。W1 已完成：当前源码能够在 Windows x64 上编译为原生程序并生成 NSIS 安装包，安装包也能完成当前用户静默安装。W2–W6 尚未完成，因此此时还不能给出“完整符合预期、可正式发布”的结论。

测试主机为 Windows `10.0.26200.9168`、AMD64，已安装 Microsoft Edge WebView2 Runtime `151.0.4129.86`。干净 Windows 10 且没有 WebView2 Runtime 的场景尚未执行，不以当前主机结果代替该场景。

## W1：Windows 构建链与 NSIS

### 选择

- 唯一 Windows 安装目标为 NSIS，安装模式为 `currentUser`。
- WebView2 使用 `downloadBootstrapper` 且静默安装。这样安装包保持较小；运行时缺失时需要联网下载，因此离线安装不属于当前方案的保证范围。
- `minimumWebview2Version` 明确为 `null`。项目依赖 Evergreen WebView2，不把安装卡在某个旧的最低版本；兼容性由后续 Windows 验收和持续集成守护。

### 红灯与绿灯

1. 新增 Windows bundle 配置测试后先运行红灯：2 个断言失败，分别证明原配置没有 `bundle.targets` 和 Windows WebView2 配置。
2. 加入 NSIS、WebView2 和当前用户安装配置后，测试变绿：`1 file / 2 tests passed`。
3. Windows Rust 测试首次跑完 27 个用例后，`notify` 仍可能在测试接收端销毁期间送达排队事件，测试回调中的 `unwrap()` 跨 extern 回调解栈并导致进程退出。回调改为忽略已关闭断言通道后，`cargo test --lib` 为 `27 passed / 0 failed`。

### 构建和安装结果

| 项目 | 结果 |
| --- | --- |
| readit 发布包构建 | 成功；7 个 ESM 入口和 CJS 入口完成，自包含类型闭包检查通过 |
| 壳前端生产构建 | 成功；Vite 转换 441 个模块 |
| Windows 原生程序 | 成功；`x86_64-pc-windows-gnu/release/readit-shell.exe` |
| NSIS | 成功；`readit_0.1.0_x64-setup.exe` |
| 安装包体积 | 9,108,829 bytes（8.69 MiB） |
| 安装后文件 | 31,745,925 bytes（30.28 MiB），共 3 个文件 |
| 静默安装 | 成功，退出码 0；受测试沙箱写权限限制，安装目录显式设为 `D:\robot\installed-readit` |

### 构建环境说明

本机没有可用的 MSVC/Windows SDK，且系统级 Build Tools 安装被权限策略拒绝。为取得真实 Windows 二进制和安装包，本次本地验证使用 Rust `stable-x86_64-pc-windows-gnu` 与便携 LLVM-MinGW。Tauri 官方发布工作流仍应使用 MSVC；GNU 工具链、离线 Cargo vendor 和沙箱构建辅助脚本均位于仓库外，不构成产品改动。

## 待完成

- W2：只写 HKCU 的 `.md` / `.markdown` OpenWith 注册与三种初始状态验证。
- W3：接管 Windows 原生 `Ctrl+F`，并记录对其他 WebView2 浏览器快捷键的影响。
- W4：在真实应用窗口执行六项人工验收，并补 Windows 路径/标题边界测试。
- W5：Windows 发布、更新签名与双平台 `latest.json`。
- W6：收口 README、SPEC、测试计划、债务与最终结论。
