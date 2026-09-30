# 新电脑恢复开发工作

快照日期：2026-09-30。最新开发分支：`phase/complete-agent-v0.1`。

## 获取与运行

使用 Windows 11 x64，准备 Git、Node 24.18.1、pnpm 11.21.0、Rust 1.97.1，以及 MSVC C++ 工具链和 Windows SDK。依赖版本以 `.node-version`、`package.json`、`rust-toolchain.toml` 和两个 lockfile 为准。

```powershell
git clone --branch phase/complete-agent-v0.1 https://github.com/Moriaenzhx/Fielora.git
cd Fielora
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会构建 Rust Core 并启动 Electron 开发版。首次运行需要下载依赖；GitHub 的源码 ZIP 不含已安装依赖或可直接启动的最新 EXE。已有克隆可先保存自己的改动，再切换此分支并执行 `git pull --ff-only`。

## 当前工作状态

- 对话执行过程已统一为进展正文、操作摘要、紧凑操作列表、单项详情；不再提供简洁/详细两种模式。
- 正文和输入框外层使用同一最大 920px 阅读列；窄面板边距 16px，普通边距 24px，继续尊重字体设置。
- 本轮只修改展示、转换、局部样式及测试，没有修改 Agent loop、模型提示词、权限判定或持久化协议。
- 相关单测 38/38；桌面 TypeScript、局部 ESLint 和隔离 Electron fixture 回放通过。回放覆盖 1280/1440 窗口、工作区拖动、三种展示态、异常/暂停、复制、键盘、流式更新和滚动。
- 证据位于 `artifacts/conversation-execution-20260930/`。截图使用 fixture，不代表真实模型端到端任务通过；没有运行全量 premerge、全量 E2E、无关 Rust 测试或重新打包。
- 既有架构图源文件、交互产物与视觉检查文件一并保留。下一次开发先读 `AGENTS.md` 的最小当前事实；历史文档中的双模式展示描述已被本次统一展示替代。

## 局部验证

在仓库根目录、Node 24.18.1 环境下：

```powershell
node --test --test-isolation=none apps/desktop/src/renderer/agent-activity-detail.test.ts apps/desktop/src/renderer/agent-activity-projection.test.ts apps/desktop/src/renderer/agent-turn-production.test.ts
cargo build --release -p fielora-core
node tests/e2e/conversation-execution-presentation-e2e.mjs
```

回放脚本使用现有 release Core 和独立数据库、Chromium 配置目录，不发送模型请求。完整本轮命令见证据目录的 `checks.txt`。

## GitHub 快照的边界

代码、项目 Skill、文档、锁文件和本次选定验证证据在仓库中。`node_modules`、Rust target、Electron 构建缓存和旧保留程序包可重新生成，不作为源码提交。本机 Skill 安装事务的回滚副本也不属于当前 Skill 源码；实际 Skill 位于 `.agents/skills/`。

应用内 Project/Conversation/Run 数据库、附件、浏览器会话和界面偏好属于本机应用数据，不随 `git clone` 迁移；Windows Credential Manager 中的 API Key 也不在 GitHub。若要恢复这些内容，需要另行迁移本机数据，并在新电脑重新配置凭据和项目路径。本快照恢复的是源码开发工作，不是整台电脑或 Codex 聊天会话。
