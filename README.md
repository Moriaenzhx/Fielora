# Fielora Codex Context Pack

版本：2026-08-17 / Rapid Multi-provider Desktop Rebase

本包用于让 Codex 在首次接手 Fielora 仓库时，不依赖单次 Prompt 猜测产品，而是先完整读取项目历史、当前事实、明确决策、交互规格和技术基线。

## 使用方式

将本包内容复制到 Fielora 仓库根目录，使 `AGENTS.md` 位于仓库根目录。

然后在 Codex 中打开该仓库，粘贴 `CODEX_FIRST_PROMPT.md` 的内容作为第一条任务。Agent 完成最小当前事实阅读与任务相关代码检查后即可进入纵向实现，不再生成或等待确认阅读报告。

## 阅读优先级

发生冲突时，按以下优先级处理：

1. 最新明确用户决定
2. `docs/context/02_PROJECT_REALITY.md`
3. `docs/context/03_DECISIONS.md`
4. `docs/product/FIELORA_V0.1_INTERACTION_SPEC_CN.md`
5. `docs/architecture/*`
6. `docs/context/01_CONVERSATION_TIMELINE.md`
7. 更早的构想、探索性方案

任何会改变当前用户流程、数据或安全边界且无法从最新决定确认的冲突，不得由 Codex 静默合理化；应在任务交付中简短说明。

## 重要说明

`01_CONVERSATION_TIMELINE.md` 是根据当前 Fielora 对话、项目历史与已上传的《Fielora 功能讨论》资料制作的**高保真时序重建**，用于保留“为什么会做出当前决定”的历史脉络；它不冒充 ChatGPT 官方逐字导出的原始聊天记录。

项目真正的当前事实源是 `02_PROJECT_REALITY.md`；已冻结实现边界见 `docs/architecture/TECHNICAL_ARCHITECTURE_V0.1.md`、`CORE_CONTRACTS_V0.1.md`、`SCHEMA_FREEZE_V0.1.md`、`PHASE_01_IMPLEMENTATION_SPEC_V0.1.md`、`PHASE_02_IMPLEMENTATION_SPEC_V0.1.md`、`PHASE_02_CONTRACT_DELTA_V0.1.md` 与 `PHASE_02_MIGRATION_0002_V0.1.md`。

当前 Agent 的正式架构基线为
`docs/architecture/FIELORA_V0.1_AGENT_ARCHITECTURE_SPEC.md`。
当前主架构为 `Model + Harness + Capability`：Model 提供智能，Harness 按
Ingress、Context、Model Runtime、Orchestration / Control、Capability Invocation / Execution Control、
Continuity、Governance、Verification & Recovery、Observability 九层职责组织。
Capability 包含 Fielora 已实现的工具、Skill、资源访问、适配器、插件包装与执行后端；
Tool 是其子集。九层同时用于诊断，不要求九个独立服务，也不恢复三平面。
详见 [主架构、Harness 九层与现有能力](docs/architecture/AGENT_ENGINEERING_VIEWS_V0.1.md)。

逐项建设现状与下一批范围见 [36 项能力对照与补齐清单](docs/architecture/CAPABILITY_INVENTORY_V0.1.md)。代码中存在适配器不等于默认运行已接入，目录查询不等于执行获准或结果已验证。

IDR 保持退出生产链路，历史数据/迁移保留。Memory 是跨域语义，Agent Profile 是
Fielora-owned versioned product definition；均不构成新的 Runtime。Work Scope & Goal
纳入 Harness L4，当前范围由 L7 强制，目标验收由 L8 裁决。
现有 `FAST_EDIT_ADAPTIVE_V1` 仍归属 `CODING_V0.1` Harness Profile。

## 当前阶段状态

Phase 01 Core Vertical Slice 已完成 Engineering、Desktop Reality 与 Human Experience Gate。用户于 2026-08-14 正式裁决 `PHASE_01: COMPLETE`。

Phase 01 完成证据位于 `artifacts/phase01/`。Phase 02 已严格依据三份 Frozen specs 完成实现；Engineering、Desktop Reality、Human Experience 与 Post-correction Full Gate 全部 PASS。用户于 2026-08-14 正式裁决 `PHASE_02_FINAL_ACCEPTANCE: GRANTED`、`PHASE_02: COMPLETE`。最终 portable 与 closeout Evidence 位于 `artifacts/phase02/`。轻量 Development Workflow Hardening 也已完成。

用户随后以 `main@7dc1aac593a4d478b7e175e5e197cf99466c1f47` 正式授权 Phase 03 — Browse Foundation。Real Web Runtime、Page Lifecycle、Browse/Field Boundary、Security Boundary、Desktop Experience 五个纵向 Slice 均已完成多轮自动与人工 Gate。用户于 2026-08-16 最终裁决 Phase 03 完结；正式 `pnpm verify:phase03` 在 dev、packaged、fresh-directory portable 中同时验证 Phase 02 Field Reality 与 Phase 03 Browse Runtime 并全部 PASS。最终 portable 与 closeout Evidence 位于 `artifacts/phase03/`。Page 仍只是 ephemeral Browse Runtime 资源，Loose Browse 不创建或修改 Field Reality；Remote/Local Page 共用隔离安全基线，Remote Page→`file://` 和所有 Loose Browse→`fielora://app` 继续拒绝。Phase 03 没有新增 durable Browser schema、设置 UI、Migration、History/Bookmarks/Profile/Sync、privileged Web bridge 或 Chromium Fork。

用户已确认 `CODEX_READING_REPORT.md` 的竞品审计并完成 Phase 04 → V0.1 Alpha 路线重排。Phase 04 Freeze 已授予，Slice 01–05 已完成实现；既有正式 `pnpm verify:phase04` baseline 全部 PASS。首次 Human Gate 随后失败，限定 UX remediation 已实现：Summon Ask-first、Context progressive disclosure、Sensitivity exception-driven、Provider Setup/Inbox 独立、Inbox bounded preview、Quick Capture 不打断 Browse；完整 DXE 未实现。Phase 04 remediation 在 dev/packaged/fresh portable 三宿主 20/20 PASS，新 Portable 已生成；但本轮完整 Gate fresh rerun 被当前 Windows Clipboard `Access denied` 阻断在 Phase 03 原生 Ctrl+C/Ctrl+V 断言，未跳过或放宽。当前 `PHASE_04_HUMAN_EXPERIENCE_GATE: PENDING_RETEST`、`PHASE_04_REAL_PROVIDER_ACCEPTANCE: PENDING`、`PHASE_04_REMEDIATION_ENGINEERING_REVALIDATION: PENDING_ONE_ENVIRONMENT_CHECK`、`PHASE_04: NOT_COMPLETE`、`PHASE_05: NOT_AUTHORIZED`。实现与测试证据见 `artifacts/phase04/`。

2026-08-17 竞争口径进一步收窄：ChatGPT Desktop/Codex 的 Projects、Goal/Resume、Memory、Browser、Coding、Computer Use、Plugins/MCP 等均视为 Foundation；Fielora 只以 Explicit Lifecycle、Operational Work State、Persistent Work Lineage + Verification 与 DXE 四项机制接受差异化验收。Field/Reality/Provider-neutral 等名称或架构本身不算差异。Phase 顺序不变；Phase 10 Alpha Closure 必须包含最小 bounded DXE Runtime proof。该 docs-only 重定位不改变 Phase 04 Frozen Contract/Exit 状态，不授权 Phase 05；详情见 `docs/product/COMPETITIVE_BOUNDARIES.md`。

用户随后纠正产品与开发顺序：近期不再以差异化 Gate 阻断实现，先快速交付 Codex-like multi-provider desktop；之后依次建立 stable long tasks、Aegis、DXE 与 Personal Steward。现有 Field 暂作 Project compatibility layer，Phase 01–04 代码保留复用；旧 Phase 04→10 execution order 与繁重的首次阅读/Freeze ceremony 已被 supersede。当前 canonical 路线见 `docs/product/RAPID_DESKTOP_EXECUTION_V0.1.md`。

Codex-like Desktop Foundation Build A+B 已实现为 schema 5 candidate：Projects 默认工作面、本地 folder、持久 Conversation、Provider/Model 选择、stream/stop、文件 Context、Review Diff/accept/undo、Terminal/test/cancel 与 restart resume 已通过 dev 和 packaged Electron Hero Flow。Windows x64 ZIP 与人工验收清单位于 `apps/desktop/out/desktop-foundation/` 和 `artifacts/desktop-foundation/`。该结果未使用真实 Provider 凭据，不能改写为 real-provider 或用户 Human Acceptance PASS。

首次 Codex 对照 Human review 指出的双左栏与永久深色工具面板已修正：Projects 现采用单一工作导航、Conversation-first 主区与可折叠 Files/Review/Terminal 工作区；完整 PreMerge 和最终 packaged 双 E2E 已通过，仍等待用户 Human Re-Gate。

后续 Human Re-Gate 又确认 Projects 与 Now/Browse/Fields/Inbox 仍在切换两套壳、“新对话”无 Project 时错误直接打开文件夹选择器、Project 空状态过重且底部没有真实设置页。当前所有主页面已共用同一 Codex-like 左栏；新对话先进入明确的对话起始页，文件夹选择只由显式按钮触发；Project 空列表压缩为一行提示；底部“设置”已接通启动页、模型服务、外观、快捷键与关于。完整 PreMerge、release packaged 与全新 ZIP 解压 E2E 均通过，最新 ZIP SHA-256 为 `4f16d66d5401d5d85acabd23a37c592d5dead33b3597d67836040e463f9cc077`，仍等待用户 Human Re-Gate。

第三次 Human Re-Gate 指出设置齿轮、Codex-like 集成顶栏与右侧工作区工具页仍缺失。当前 Windows native title bar 已与应用顶栏整合，提供侧栏、应用前进/后退、文件/编辑/视图/帮助及专注/工具入口；右侧启动器实际接通 Review、Terminal、Browse、Files 与 Summon，空 Project 会显示前置条件而非静默。设置图标已改为标准齿轮。完整 PreMerge、release packaged 与 fresh ZIP E2E PASS；由于用户仍打开上一版输出，新包独立交付于 `apps/desktop/out/desktop-foundation-chrome/`，ZIP SHA-256 为 `5cc24c6c9a3ed264eb964b096064b9912ffd3eddbfccff9434ad0211820df7db`。用户复验前需先关闭上一版 Desktop Foundation 窗口。

第四次 Human Re-Gate 指出工具启动器仍是覆盖中间内容的悬浮层，且顶栏缺少独立 Terminal 入口。当前工具页改为与主工作区同一 grid 的真实右分栏：展开会压缩中间 Conversation、不再 overlay，并在该状态自动收窄 Project 导航以保留对话可读宽度；顶栏 Terminal 直接打开当前 Project 的真实终端。完整 PreMerge、release packaged 与全新 ZIP 解压后的 Desktop Foundation、Browse、single-instance E2E 均 PASS。最新交付位于 `apps/desktop/out/desktop-foundation-split/`，ZIP SHA-256 为 `a02d1345b5b9bb90d715c23a65b6429c7b853bacb502a4a99dc71c5a5311d861`。

最新 Composer correction 使用用户提供的透明 Fielora SVG，并生成 16–256 px 多尺寸透明 Windows ICO；输入区已接通 trusted 系统多文件选择器、受限 UTF-8 文本 Context、真实生效的“只读/审阅后修改”权限、已配置 Provider 默认模型选择、语音转写后确认发送，以及统一的发送/停止图标。Desktop Foundation dev、release packaged、全新 ZIP 与 packaged/fresh single-instance E2E PASS；完整 PreMerge 和三宿主 Browse 回归均在既有 Windows 原生 Ctrl+C/Ctrl+V 硬断言处被当前剪贴板环境阻断，未跳过或放宽。最新交付位于 `apps/desktop/out/desktop-foundation-composer-voice/`，ZIP SHA-256 为 `99cb0b82d6959726ae0f0c149ecb2e2f0540bf1878cc7181e4699e18fc4e89f5`；Human Acceptance 与真实 Provider 仍为 NOT_RUN。

最新 Desktop layout correction 把 Browser 固定为右侧工具区能力，中间区域只承载 Project/Conversation；设置打开时右侧工具区与控制栏自动关闭。Project 导航、Settings 导航、Conversation 工作区和右侧工具区均支持拖动调整宽度，工具区使用 push layout 而非悬浮遮挡；真实 Chromium viewport 会随窗口和分隔条同步变化。Composer 权限与模型菜单改为向上展开并保持在可视区域内，专注、Terminal、Browser 与工具入口统一移至右侧控制栏且都连接真实动作。完整 PreMerge、42 项 TypeScript、30 项 Rust、6 项 Core integration，以及 dev/release/fresh ZIP 的 Desktop Foundation、Browse、single-instance 全部 PASS，原生 Clipboard 硬断言本轮也已通过。该历史交付位于 `apps/desktop/out/desktop-foundation-resizable-sidebar-v4/`，ZIP SHA-256 为 `ccf74f76458d08d8743ea21f7491d8ba860737dcd8aa03f115e6b2b7dba74279`；当时 Agent Runtime 尚未实现，已被后续 Complete Agent 状态取代。

用户误启历史 `artifacts/phase04/Fielora.exe` 后再次点击触发的 Main process `Object has been destroyed` 已精确定位为旧单实例回调访问已销毁 BrowserWindow。当前 Desktop Foundation 已加入统一 window/webContents lifecycle guard、提前清理与 packaged single-instance E2E。后续真实复验又证明旧进程仍会截获同 profile 的新版启动，因此 Desktop Foundation 现使用独立稳定的 Electron runtime profile `@fielora/desktop-foundation`；Core 数据仍位于既有 `LOCALAPPDATA/Fielora`，Project/Conversation 不迁移。保留历史 PID 运行的真实升级碰撞验证已经 PASS，历史 Phase 04 包仍仅作 Evidence。

Complete Agent 现已实现 Project-scoped 持久 Run、Context、typed file tools、受控命令、Approval、Verification、recovery 与只读 subagent。2026-08-18 的当前优先级进一步收敛为编程、测试和代码版本管理：新增 Always-Ask typed Git stage/unstage/branch/commit/push，文件写入后必须通过真实 test/check/build/lint/typecheck 再进入 Git finalize；Qwen、DeepSeek、Kimi、GLM、MiniMax、Doubao 共用 `china-coding-v1` 行为层和可编辑 Provider presets。已保存 Qwen Key 确认为 Coding Plan 并修正到专用交互 endpoint；自动化 Acceptance 对该类 Key fail-closed。deterministic engineering 已验证，六家真实模型质量仍为 `NOT_PASSED / UNVERIFIED`，不能据此宣称最终好用或 Provider certification。详情见 `docs/product/FIELORA_CHINA_MODEL_OPTIMIZATION_V0.1.md`。

Agent 设计与实现中的错误、失败尝试、修正办法和验证缺口集中维护在
[`AGENT_DESIGN_IMPLEMENTATION_LESSONS.md`](docs/engineering/AGENT_DESIGN_IMPLEMENTATION_LESSONS.md)。
后续相关调查、修复、复发与验收随同一 changeset 更新；开始工作时按索引查相关案例，不新增完整历史阅读要求。

## 开发工作流

日常开发与人工体验长期运行 `pnpm dev`。根据变更范围使用 `pnpm verify:dev:docs`、`verify:dev:ui`、`verify:dev:core` 或 `verify:dev:cross`；任何准备进入 main 的变更运行 `pnpm verify:premerge`。Packaging-sensitive 变更额外执行 targeted packaged smoke；重大 Contract/Schema/Permission/Reality/Verification 变化先形成 `CHANGE IMPACT` 并运行受影响兼容性与 Hero Flow regression。正式阶段仍运行冻结的完整 Phase Gate。精确定义见 `docs/engineering/DEVELOPMENT_WORKFLOW_V0.1.md`。

Desktop UI 的唯一 canonical 设计语言是 **Fielora Glass**。System / Light / Dark 只决定明暗外观；产品原则见 `docs/product/FIELORA_DESIGN_LANGUAGE_V0.1.md`，实现 ownership、Cascade、Typography、Phosphor Icon 与共享控件规范见 `docs/architecture/FIELORA_UI_UX_SYSTEM_V0.1.md`。任何受管理 UI/UX 系统样式变更必须在同一 changeset 更新该架构文档，并通过 `pnpm verify:ui-ux`。

## License

Fielora source code and documentation are licensed under the
[Apache License, Version 2.0](LICENSE), except where a file or directory
identifies a separate license. See [NOTICE](NOTICE) for project attribution.
Third-party dependencies and vendored materials retain their original licenses
and notices.

See [the adoption record](docs/engineering/APACHE_2_0_ADOPTION.md).
