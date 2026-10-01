# macOS 本地开发

2026-10-01：从 `https://github.com/Moriaenzhx/Fielora.git` 在 Apple Silicon Mac 建立开发环境。
当前跟踪开发分支 **`phase/complete-agent-v0.1`**，基线为
`bc163741b14384c0661f77d68974ad695a6fa677`（2026-09-30）。
首次误用了停留在 2026-09-15 的 `main@b334b02`，用户指出后已核对所有远程分支并纠正；
开发分支包含 65 个不在 main 中的提交。后续更新应以当前 tracking branch 为准，不能把默认分支等同于最新开发版本。
本机目录为 `/Users/solan/projects/Fielora`。

## 工具链与首次安装

- Xcode Command Line Tools（`xcode-select -p` 检查；缺失时运行 `xcode-select --install`）。
- Node.js 24.18.1，通过 nvm 管理，仓库 `.nvmrc` 与 `.node-version` 保持一致。
- pnpm 11.21.0。
- Rust 1.97.1，原生 `aarch64-apple-darwin`，附带 rustfmt/clippy。
- Electron 43.4.0，由锁文件安装，首次使用时下载原生 macOS 二进制。

```sh
cd /Users/solan/projects/Fielora
source "$HOME/.nvm/nvm.sh"
nvm install
nvm use
npm install -g pnpm@11.21.0
rustup toolchain install 1.97.1 --profile minimal --component rustfmt --component clippy
pnpm install --frozen-lockfile
pnpm dev
```

仓库历史 `rust-toolchain.toml` 还列有 Windows target；rustup 可能一并下载其标准库，但 macOS 的默认编译产物仍是原生 ARM64。

## 日常启动与停止

首次在其他目录克隆时，明确指定分支：

```sh
git clone --branch phase/complete-agent-v0.1 https://github.com/Moriaenzhx/Fielora.git
```

```sh
cd /Users/solan/projects/Fielora
nvm use
git branch --show-current
pnpm dev
```

`pnpm dev` 编译 Rust Core 并启动 Electron/React 开发窗口。终端中按 Ctrl+C 停止，Forge 中输入 `rs` 可重启 Electron 主进程。开发服务器页面依赖 Electron preload，直接在普通浏览器打开 localhost 页面不能代替桌面应用。

## 数据与网络

- Core 数据：`~/Library/Application Support/Fielora/`，SQLite 位于 `data/fielora.db`。
- Electron profile：`~/Library/Application Support/@fielora/desktop-foundation/`。
- Windows 上的本地项目、会话与 API Key 不会随 Git clone 迁移；本机使用新数据目录。
- 开发或集成测试可通过 `FIELORA_DATA_DIR` 显式使用隔离数据目录。
- 本机 Git 直连 GitHub 不通，已仅在当前仓库设置 `http.proxy=http://127.0.0.1:7890`，对应 macOS 已启用的代理。停用该代理后可用 `git config --local --unset http.proxy` 清除。
- 如首次下载依赖或 Electron 需要代理，可在当前终端设置 `HTTPS_PROXY`、`HTTP_PROXY`（及小写对应变量）；Electron 下载还需 `ELECTRON_GET_USE_PROXY=1`。不需要关闭 TLS 校验。

## 日常验证与打包

```sh
pnpm verify:dev:ui       # typecheck、lint、全部 TS 单测
pnpm verify:dev:core     # fmt、workspace Rust tests、clippy
pnpm verify:dev:cross    # 文档、生成契约、UI、Core、集成测试
pnpm test:e2e:macos     # 当前 Mac 开发桌面闭环
pnpm test:e2e:macos:packaged # 本机打包后验收
pnpm verify:premerge    # Cross 加三条历史桌面 E2E，目前有待修复的旧流程失败
pnpm build              # 原生 release Core + Electron .app
pnpm --filter @fielora/desktop make  # 生成本机 ZIP
```

`verify-development.ps1` 保留为同一 Node Gate 的兼容入口。Windows portable / 历史 Phase 发布脚本仍需 Windows；这不影响上述日常开发命令。E2E 使用独立 Core/Electron profile 和合成凭据，不接触日常用户数据；PreMerge 日志输出临时 evidence 目录并保留以便诊断。

本机产物：`apps/desktop/out/Fielora-darwin-arm64/Fielora.app`，主程序与 sidecar 均为 ARM64。这是本机开发包，尚未配置 Apple Developer 分发签名/公证；不要当作对外发行包。品牌源仍为原 SVG/PNG，`pnpm --filter @fielora/desktop icon:mac` 用系统 sips/iconutil 机械生成 ICNS。

## 已补齐的 Mac 行为

- Provider API Key 与静态 MCP credential 使用系统 Keychain，service 为 Fielora，account 延续原有目标命名空间。只在 native Core 读写，不放进配置文件或命令行；秘密上限仍为 2048 bytes。存在性查询不读取密码内容。
- Agent 命令与 MCP managed child 使用独立 Unix 进程组。取消/超时/释放 owner 清理该组；Desktop 终端和浏览器服务器同样清理后代。主动脱离进程组的程序不在保证内；这不是 OS 安全沙箱。
- macOS 使用 zsh、Command 菜单和 Shift+Command+Z 重做；原生交通灯与顶栏内容分开占位，保留 Glass 与原有 Pane 结构。
- 外部打开支持 Finder，以及 `/Applications` 和 `~/Applications` 中检测到的 VS Code、Cursor、IntelliJ IDEA、PyCharm、WebStorm。
- Finder 启动时有界读取用户 zsh/bash 的 PATH，保留已有启动 PATH 的优先级。Agent 环境发现包含 HOME 下 nvm/Volta 和 Homebrew 已知位置；候选发现不等于已验证版本。
- 首次窗口加载前等待 Core 启动握手，避免界面首次读取项目时遇到 Core unavailable；启动失败仍显示窗口供诊断。
- 本仓库 Git identity 为 `Moriaen <formsg@163.com>`，不修改其他仓库的全局署名。GitHub CLI 已安装；HTTPS 推送须先完成 `gh auth login`，再 `gh auth setup-git`。不把拉取公开仓库成功当作推送认证成功。

## 验证记录与边界

2026-10-02：277 项 TypeScript 测试、420 项 Rust 测试（另有 5 项原有 ignored 测试）、typecheck/lint/fmt/clippy、13 项 Core 集成、23 项 UI/UX 系统检查通过。Keychain 回环使用真实系统存储；Core 集成包含重启后继续、Provider fixture 和凭据脱敏。外部真实模型/API Key 尚未配置，因此未验收真实供应商对话。

Cross Lane 在本机 macOS 上整体通过，Windows Gate 本轮未重跑。Phase 02 与 Mac 专项桌面验收均在 dev 和原生 ARM64 packaged 模式通过，覆盖交通灯避让、Command 侧栏/设置、真实 Keychain fixture、Agent 写入与命令验证、zsh/Node、Finder 菜单、持久 Project/Provider/Run、退出重启。`pnpm build` 通过，主程序与 Core sidecar 均确认为 Mach-O ARM64。专项证据见 `/tmp/fielora-macos-20261002/dev/` 与 `/tmp/fielora-macos-20261002/packaged/`。

Chromium CDP 在 macOS 绕过 Cocoa 快捷键转换，编辑键测试需携带 `Input.dispatchKeyEvent.commands`，不把测试输入模拟缺失归咎产品。最终通过原生桌面工具打开应用并检查用户键盘操作时，Mac 已锁屏；这项可见窗口检查需用户解锁后继续，不能把自动化桌面验收写成已完成人工键盘验收。

首次 main 上的适配已留在 Git stash；新版启动前 Core/Electron profile 备份在 `.tmp-macos-profile-backup-Y2F08M/`。Windows 用户数据和凭据尚未迁移；没有新增 schema migration。已有开发分支迁移照常工作，不可直接让旧二进制打开升级后的数据库。

实现参考：[Security Framework passwords](https://docs.rs/security-framework/3.7.0/security_framework/passwords/index.html)、[Electron 自定义标题栏](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)、[Chromium 输入协议](https://chromedevtools.github.io/devtools-protocol/tot/Input/)。


### 完整 PreMerge 尚未通过

- Browse Gate：Mac CDP 编辑命令与动画时序问题已校正，真实剪贴板往返和页面输入通过。关闭受控 `/blank` 页面后，产品 Page 列表已删除该页，但 CDP 仍列出该 WebContents，等待 3 秒仍存在。原 exact-target-count 断言保留失败；调整 close/remove 顺序未解决，未保留该无效产品修改。根因尚待进一步原生 Electron 复现，不能宣称完整浏览器生命周期通过。
- Desktop Foundation Gate：旧断言中 Logo 中心不透明、侧栏消失靠 opacity、同路由清除新聊天子页等与当前产品定义不符，已校正。后续在 Scheduled 页面访问已不存在的 `chrome-tools` 控件失败；未为通过测试而恢复产品已隐藏的控件，后续应按当前导航重写该历史流程。
- 因此此 changeset 是可继续开发的 Mac 基线，尚不满足合入 main 所要求的完整 PreMerge；不推送或合并 main，不称为发布完成。测试失败日志留在 `/tmp/fielora-mac-browse.log` 与 `/tmp/fielora-mac-foundation.log`，新专项证据在 `/tmp/fielora-macos-20261002/`。
