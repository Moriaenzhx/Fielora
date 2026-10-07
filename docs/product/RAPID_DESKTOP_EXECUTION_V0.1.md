# Fielora Rapid Desktop Execution

状态：`CURRENT PRODUCT / DEVELOPMENT DIRECTION`

日期：2026-08-17

```text
OLD PHASE 04→10 EXECUTION ORDER: SUPERSEDED
CURRENT TARGET: CODEX-LIKE MULTI-PROVIDER DESKTOP
REALITY DIFFERENTIATION: DEFERRED
AEGIS PRODUCT INTEGRATION: DEFERRED UNTIL LONG-TASK RUNTIME
DXE RUNTIME: DEFERRED UNTIL STABLE WORK STATE EXISTS
PERSONAL STEWARD: LONG-TERM
```

## 1. 当前目标

先做一个真正可日常使用的 Codex 类桌面工作软件，再逐步增加 Fielora 的能力。

“Codex 类”表示学习成熟的工作流和信息架构，不复制专有源码、商标、文字或视觉资产。近期不要求产品先证明独特性；稳定、清楚、能完成工作优先。

现阶段 `Field` 在用户侧按普通 `Project` 理解。已有 Field storage 可以作为兼容实现继续使用，但不得再扩展一套没有行为价值的 Reality 术语。Conversation、Project、Folder、Task、File、Diff、Terminal 与 Provider 是近期一级对象。

## 2. 快速构建顺序

### Build A — Desktop Project + Multi-provider Chat

- Project 列表与本地文件夹；
- Project 内多个持久 Conversation；
- 新建、重命名、切换、删除 Conversation；
- 消息 streaming、停止、重试、继续；
- 设置中自由添加 Provider、Base URL、API Key、Model ID；
- 至少支持 OpenAI-compatible 与 Anthropic-compatible 协议；
- API Key 按 2026-10-03 用户决定直接保存在当前设备 SQLite，统一复用于连接测试和任务；系统凭据库仅作为无交互兼容迁移来源；
- 重启后 Project、Conversation、Provider selection 与消息历史恢复。

### Build B — Codex-like Coding Loop

- 单一左侧工作导航承载主要功能、Project 与 Conversation，避免重复导航层；
- Conversation 默认是主焦点，Files / Diff / Terminal 由顶栏按需展开并可关闭，不永久挤占工作面；
- Project 文件树与文本查看/编辑；
- Agent 可以读取项目、提出并应用 bounded file change；
- Diff review、接受、撤销；
- 集成 Terminal/command run、输出与取消；
- 运行测试并把结果放回当前 Conversation/Task；
- 用户可以从同一个桌面工作面完成“提出任务 → 修改 → review diff → run/test → 继续”。

Build A+B 完成后，Fielora 才算拥有可用的桌面基础。Browse、Capture、Inbox 等已有能力可以保留，但不再支配近期路线。

### Build C — Stable Long Tasks

- Task 有 queued/running/waiting/paused/completed/failed/cancelled；
- app 重启、Provider 暂时失败或进程退出后可恢复；
- checkpoint、retry、cancel、timeout、budget 与清楚的当前状态；
- 长任务必须留下用户可理解的计划、进度、变更与测试结果。

### Build D — Aegis Integration

Aegis 只在 Build C 已有真实执行状态后接入，用来治理 permission、approval、budget、危险动作、attempt/outcome、unknown/recovery 与 audit。不得先把 Aegis 概念做成空 UI 或第二套产品模型。

### Build E — DXE

DXE 只在 Project/Conversation/Task/Execution state 稳定后接入。它读取真实工作状态并从固定 Surface 中组织工作面；不使用任意 Generative UI。没有真实 state transition，就不开发 DXE abstraction。

### Build F — Personal Steward

在长期任务、Aegis 和 DXE 均稳定后，再增加主动提醒、跨项目连续性、日程/邮件/生活服务和主动管理。Personal Steward 是演进结果，不是当前入口或宣传承诺。

## 3. 开发方式

1. **Working software first**：每次只做一条可运行纵向流程，不先写完整未来领域模型。
2. **Reuse before rewrite**：保留现有 Electron、Rust sidecar、SQLite、Provider adapter、WinCred、Browser 与测试基础；删除或重写必须有实际阻塞证据。
3. **Minimal docs**：普通 UI/功能只写任务清单和验收条件。只有 Schema/Migration、credential、安全边界、破坏性执行或无法回滚的架构变更需要短 Change Impact。
4. **No freeze ceremony per slice**：不再为每个小功能制作 Product/Contract/Migration/Implementation/Test 六件套。
5. **Test the user loop**：每个 Build 同时提交实现、自动测试和一份短人工体验清单；功能存在不等于工作流可用。
6. **Do not wait for uniqueness**：Build A+B 可以与 Codex 高度相似。DXE/Aegis 是否产生差异，等它们真正能作用于产品后再判断。

## 4. 第一个可交付闭环

```text
打开 Fielora
  → 在 Settings 添加兼容 Provider / Model
  → 打开一个本地 Project
  → 新建 Conversation
  → 让模型理解项目并修改一个文件
  → 查看 Diff
  → 运行测试
  → 关闭并重启 Fielora
  → 回到同一 Project / Conversation 继续
```

这个闭环没有稳定通过前，不新增 Reality Graph、Verification Graph、Aegis UI、DXE Runtime、Connector marketplace 或 Personal Steward 功能。

## 5. 当前代码处置

- Phase 01–04 已有代码和证据保留，不回滚；
- Phase 04 Provider/WinCred/streaming 直接成为 Build A 基础；
- 现有 Field 暂作 Project compatibility layer；
- Phase 04 未完成的 Human/real-provider/Clipboard Gate 记录保留为历史质量信息，但不再阻断新的 Desktop Foundation；
- 旧 Phase 04→10 Remap 保留作历史设计资料，不再控制当前开发顺序。
