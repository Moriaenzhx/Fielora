# Fielora Project Reality V0.1

状态：当前事实源 / Phase 01–03 COMPLETE / Phase 04 → Alpha Remap Candidate 等待审查

日期：2026-08-16

## 1. 产品身份

产品名：**Fielora**。

`Field` 是 Fielora 的核心工作组织概念。`DXE` 是内部核心能力，不作为产品名称。

Fielora 当前不定义为“AI 浏览器”。更准确的内部定义：

> **Fielora 是连接个人数字工作与生活的连续层，以 Field 为持续工作单位，以 Browser / Apps / AI / Agent / Capability 作为完成工作的运行能力。**

Browser 是入口和 Runtime 之一，不是整个产品的中心。

## 2. 第一目标

第一要务：提升真实日常工作效率与生活质量。

主要消灭的问题：不同网页、对话、文件、IDE、测试工具、设计软件、创作软件之间切换导致的上下文断裂。

## 3. 三个一级运行状态

### NOW
回答“我现在最可能继续什么？”，不是 Dashboard，不做 Productivity Score。

### BROWSE
普通浏览器状态，可以遵循成熟 Chrome 类浏览习惯。

### FIELD
真正工作开始后的任务驱动环境。进入 Field 后，Tab / Page 降为资源，不再是一级组织单位。

## 4. Field 正式定义

Field 不是 Tab Group、Workspace Folder、Chat Session 或 Note Collection。

内部可维护：Goal、State、Object、Relation、Capability、Human、Agent、Activity、Evidence、Artifact、Policy、Surface。

默认 UI 不应把这些全部展示出来。

## 5. Field State

V0.1 内部状态类别：FACT / DECISION / ASSUMPTION / QUESTION / TASK / BLOCKER / RESULT。

重要 State 应可追溯来源。用户确认与 AI 推断必须可区分。

核心原则：

> Conversation is history; Field State is reality.

## 6. Capture / Inbox / Promote

Capture：任何状态快速记录 text、selection、page、screenshot、file、media timestamp；默认不要求分类。

`Ctrl/Cmd + Shift + Space` 统一用于 `Summon Fielora`。Capture 是 Summon 经 IDR 判断后的一个 Intent，不设置第二套独立一级 Capture 快捷键。

Inbox：存放尚未确定归属的内容。

Promote：当临时内容成长为持续工作时晋升。

核心链：`Capture → Idea → Field → Requirement → Build → Verify → Result`

## 7. AI 交互

禁止永久 AI Sidebar。

Fielora AI 是系统级可召唤能力。Browse 中通过 Shortcut Summon、轻量 `✦`、Selection Action、Context Chips、Progressive Context 工作。

简单问题在轻量 Overlay 中完成并消失；复杂讨论可 Expand；真正变成持续工作时 Continue in Field。

## 8. IDR

IDR 是轻量 Intent + Referent Resolution，不是独立重型产品。

输入：current runtime / field / focus / object / page / selection / recent activity / explicit refs / user input。

输出：intent / referent / expected change / confidence / ambiguity。

## 9. DXE

DXE 不是任意 Generative UI。

职责：根据 Field State、Intent、Current Goal、Available Objects / Capabilities 编排当前 Working Surface。

V0.1 仅通过固定 Surface Primitive 组合，只负责 select / arrange / resize / focus / collapse / replace。

## 10. UI 最高原则

> 能力常驻系统，不常驻屏幕。

默认一个主焦点，最多两个辅助区域；Context Inspector、Agent Activity、Evidence 等按需出现。

## 11. 核心软件开发流程

V0.1 最深场景：`Idea → Requirement → Research → Design → Build → Run → Test → Fix → Verify → Result`

Requirement 与 Implementation / Test / Evidence 持续关联。

## 12. Existing Project Takeover

接手已有前端或全栈项目是核心 Hero Flow。

初始进入 Understand Project，扫描 repository tree、package files、README、Git history、routes、components、API、config、tests、build、backend、database references，形成持久化 `Project Reality`。

Understand 阶段禁止擅自改源码。

## 13. Verify

Build 和 Verify 是两个不同状态。代码修改完成只表示 Action completed，必须通过真实验证才成为 Result verified。

测试 FAIL 需关联 Evidence，并能继续 Fix → Replay。

## 14. 专业软件边界

Fielora 不重做成熟专业工程软件。

自己做：Capture、Inbox、Field、Notes、Requirement、Research、Library、Coding 基础工作面、Verify、AI 交互、简单创作辅助。

连接：Blender、CAD、专业图像、专业视频、专业 DAW、其他成熟行业工具。

统一抽象：`Capability Connector`，可使用 MCP / API / CLI / Plugin / Extension / Native Bridge。

V0.1 不只定义 Interface，还必须实现一个最小真实 Connector，以 `Generic MCP Connector` 为优先验证方向，跑通 `Contract → Call → Result → Evidence`。Technical Architecture 已冻结 Connector Contract / Adapter 边界；具体 MCP 协议范围与 transport 是 Phase 09 前仍需冻结的开放决定。

## 15. Coding

Coding 是特殊一等能力，因为它位于最高频工作链。

V0.1：Project Tree、Editor、Syntax Highlight、Basic LSP、Search、Terminal、Git Diff、Diagnostics、Run、Browser Preview。

后续研究成熟高星开源 IDE / Editor，学习成熟架构，但不直接复制源码或完整产品结构。

## 16. Creative / Design / Media

长期支持 Design Field、Image Asset Workflow、Film Field、Music Field，但第一版不做完整专业编辑器。

Fielora 更重要的是维护为什么打开工具、当前 Task、Source Asset、Expected Output、Result 回到哪个 Field。

## 17. Leisure

生活体验不能被过度生产力化。看电影 / 视频 / 听音乐时默认最小 UI，不弹 AI 总结、不推任务、不永久 Agent；只保留显式 Summon / Capture。

## 18. Library

Library 是长期个人资源层，不是单纯 Notes App。保存 Web / document / image / video / audio / code / note / references，并逐步保留 source / time / related field / reason saved / usage history。

## 19. Multi-LLM

Fielora 必须 Provider-neutral。V0.1 支持统一 Provider 抽象，目标可接 OpenAI / Anthropic / Google / Qwen / MiniMax / OpenAI-compatible / 其他 Provider。

Local LLM 长期可支持，**V0.1 不实现**。

## 20. App Runtime

Fielora 长期可同时成为 Browser Host 与 Fielora App Host，但 V0.1 不以构建 App Platform 为主目标。App Runtime 必须服务“工作连续性”。

## 21. 长期 Personal Steward

长期方向：Fielora 逐渐理解用户工作与生活，成为 Personal Steward / Butler。它应从长期 Field / Activity / Preference 中成长，而不是第一版放一个“AI 管家”入口。

## 22. 竞争边界

Chat、Projects/本地文件夹、Goal/Resume、Memory、网页总结、AI 搜索、划词问答、截图问答、跨 Tab Context、Vertical Tabs、Split View、Browser Agent、Coding、Permission、Multi-LLM、Plugins/MCP、Computer Use 与保存 Workflow 等不作为核心差异化。

主差异只由四项机制接受验收：Explicit Lifecycle、Operational Work State、Persistent Work Lineage + Verification、DXE。Field/Reality 等名称与 Provider-neutral/Governed Agency 等架构本身不算产品差异；精确边界以第 50 节和 `docs/product/COMPETITIVE_BOUNDARIES.md` 为准。

## 23. 当前 V0.1 平台

唯一正式验收平台：**Windows 11 x64**。

V0.1 是本地桌面应用，不以 Web SaaS 为主交付形态。

Windows 是当前验收平台，不是架构假设。Core、Field Model、UI、Agent、Provider、Capability Contract 从第一天必须保持跨平台，不得依赖 Windows-specific 假设；OS-specific 能力进入 Platform Adapter。未来目标包含 macOS、Linux，并进一步支持跨设备 Field Continuity。

Field Object 的稳定身份不得等同本地文件路径；本地路径是某一设备上的 `Device Binding`。

## 24. 当前技术基线

Desktop Host：Electron + bundled Chromium，用于快速验证 Browser + Field 产品；暂不直接 Fork Chromium。

UI：TypeScript + React。

Core：Rust Sidecar Process。

Python：Research / Eval / Benchmark only。

C++：仅未来 Chromium 深层修改确实需要时使用。

跨平台边界：业务 Core 与 Contract 保持 OS-neutral；文件系统、进程、Shell、PTY、凭据、安全存储、窗口和其他原生能力通过 Platform Adapter 接入。

## 25. Electron 定位

Electron 是当前 V0.1 验证宿主，不是永久架构承诺。若未来完整 Chrome Extension compatibility、Browser Process 深度控制、Profile / Network / Process 等成为核心壁垒，再评估更深 Chromium Integration / Fork。

完整 Chrome Extension compatibility 不属于 V0.1 验收条件，只保留 future compatibility target；不得以该目标为理由提前进入 Chromium Fork。

## 26. 交付标准

Codex 完成定义不是 `pnpm dev 能跑`。每个开发 Phase 必须提供 Portable Windows Build、Test Report、Known Issues 和 Build Info；Installer 固定在 Phase 03、Phase 08、Final Alpha 验证；Fielora V0.1 Alpha 最终交付必须同时包含 Portable + Installer。

统一测试 Gate：`Static → Unit(TS/Rust) → Rust Clippy/Release Build → Integration → Desktop E2E → Package → Packaged Smoke → Human Experience Acceptance`

验证执行采用双模式：日常开发、调试与人工体验长期运行 `pnpm dev`，不因每次普通迭代重复打包解压；只有正式阶段 Gate 才生成并验证 packaged/portable build。若 Electron/Forge packaging、Main/Preload entry、ASAR/resource、bundled sidecar、production origin/protocol、persistence path、签名权限、runtime 升级或其他 packaging-sensitive 基础设施发生变更，可在正式 Gate 前触发与风险相匹配的 targeted packaged smoke。Targeted smoke 不替代正式阶段完整 Gate。

## 27. V0.1 P0

Shell、Now、Inbox、Universal Capture、Browse foundation、Summon、Context Chips、Field、Field Resume、Composer + IDR contract、DXE primitives、Idea → Requirement、Development Field、Existing Project Takeover、Basic Code Workspace、Terminal、Git Diff、Browser Preview、Verify、Evidence、Library foundation、Multi-provider foundation、Capability Connector contract + 一个最小真实 Generic MCP Connector。

P0 的架构约束还包括：核心层跨平台、OS-specific Platform Adapter、Field Object identity 与 Device Binding 分离，以及核心模型预留 owner / actor / visibility / share_scope / permissions / provenance 语义。这些是模型和边界要求，不扩大 V0.1 UI 或网络服务范围。

## 28. V0.1 明确不做

Local LLM Runtime、完整 Blender/Photoshop/Video Editor/DAW/CAD 替代、任意 Generative UI、Agent Marketplace、Capability Marketplace、Multi-Agent Society、完整人生管理、任意桌面软件全自动控制、自动学习所有软件 Workflow、完整 Fielora App Marketplace、Enterprise Admin、完整 Chrome Extension compatibility、Fielora Exchange 的完整通信/IM/共享 Field、Steward-to-Steward 自动协作。

## 29. 跨平台与跨设备方向

V0.1 只在 Windows 11 x64 正式验收，但架构必须允许未来进入 macOS、Linux 和跨设备 Field Continuity。跨平台不是 V0.1 多平台交付承诺，而是禁止把核心模型与 Windows 或单一设备绑定的架构基线。

稳定 Field / Object identity 与设备上的路径、应用、进程等绑定信息分离。设备绑定变化不应使 Field Object 失去身份或工作谱系。

## 30. Fielora Exchange

Fielora 长期支持不同用户的 Fielora 之间交换 Message / Object / Request / Task / Proposal / Result / Field Invite。

V0.1 不实现完整通信、IM、共享 Field 或 Steward-to-Steward 自动协作；只要求 Field / Object / Activity 等核心模型不要假设永久单用户本地环境，并预留 owner / actor / visibility / share_scope / permissions / provenance 语义。该预留不得扩大 V0.1 UI、账号体系或网络服务范围。

## 31. Technical Architecture Freeze

2026-08-13 用户批准冻结 Technical Architecture、Core Contracts 与 Phase 01 Schema；随后又以这些冻结文档和 baseline commit 为唯一基线，显式授权 Phase 01 实现。Phase 01 已在不改变冻结 Contract / Schema 语义的前提下完成。

Phase 01 精确工具链冻结为：Electron 43.4.0、Node 24.18.1 LTS、pnpm 11.21.0、Rust 1.97.1 / Edition 2024、rusqlite 0.40.2 `bundled`、Electron Forge + Webpack + TypeScript + React。

生产 App UI 的唯一 trusted local application origin 是 `fielora://app`。开发态仅可在非 packaged 模式下接受 Forge renderer entry 解析出的当次精确 loopback origin；禁止 wildcard localhost/127.0.0.1、任意端口、`file://` 或远程 origin。Browse/remote content 必须处于 untrusted WebContents/session boundary，不获得 Fielora preload/bridge。

Rust Sidecar 将 parent-owned stdin pipe EOF 视为权威 shutdown signal；即使没有收到 `system.shutdown`，也必须停止接收请求、安全清理，并在 2 秒内退出，不得成为 orphan。Sidecar 不自行重启，restart ownership 只属于 Electron Main。

Installer cadence 冻结为 Phase 03、Phase 08、Final Alpha；每个 Phase 的 Portable Build 仍是硬 Gate，Final Alpha 同时交付 Portable + Installer。

## 32. Canonical Repository 与 Toolchain Gate

Canonical Local Worktree 已由用户明确确认为 `F:\项目\Fielora`。该目录是 Git repository，默认分支 `main`，remote `origin` 绑定 `git@github.com:SolanCheung/Fielora.git`。Remote 在 bootstrap 时由 GitHub API 与用户裁决共同确认为当前账户 `SolanCheung` 所有的 private empty repository。

Toolchain Preparation 已完成并实测：Node 24.18.1（NVM active）、pnpm 11.21.0、Rust/Cargo 1.97.1、rustfmt 与 clippy 1.97.1 toolchain components。Repo 提交 `.node-version`、`rust-toolchain.toml`、`pnpm-lock.yaml` 与 `Cargo.lock`；Phase 01 workspace 与冻结范围内的产品依赖已经真实建立。

Phase 01 从 baseline commit `bfdcbe0147b142cdf73ba06986fe7f35aaf2a604` 在 `phase/01-core-vertical-slice` 分支实施；Engineering evidence head 为 `5051ab31a25285b16ef5bc3aad1ffaaeebbd1a16`。Closeout 后以项目既定 feature-branch → `main` 流程保存完整 Git 历史。

## 33. Phase 01 Complete

Phase 01 Core Vertical Slice 已证明真实链路：`Electron Renderer → typed preload → Electron Main → FIPC/1 → Rust Core → SQLite transaction → Activity/Event → React query → packaged restart/resume`。

截至 2026-08-14：

- Engineering Gate：PASS；
- Desktop Reality Gate：`DESKTOP_REALITY_GATE_PASS`；
- Human Experience Gate：PASS；
- 用户正式裁决：`PHASE_01: COMPLETE`；
- Portable artifact：`artifacts/phase01/Fielora-V0.1-Phase01-win-x64.zip`；
- Portable SHA-256：`04a0d539d11324e941f2f4c7bee39628ad919dcb7e0326afb8525ebc1b7220f9`；
- 冻结规格冲突：无；
- Phase 02：`NOT_AUTHORIZED` / `NOT_STARTED`。

Engineering、Desktop Reality、Human Experience 与 Closeout 证据见 `artifacts/phase01/`。Phase 01 Complete 只确认首个 Core Vertical Slice，不代表 V0.1 全部阶段完成。

## 34. Phase 02 Frozen Specification

用户已批准 Phase 02 Scope Review 方向，但明确未授权实现。2026-08-14 基于已经隔离 Logo 与 Phase 01 状态勘误后的 clean `main@65a8751873deb8ef395286e06d62a9489462629f` 创建 `phase/02-freeze-candidate`，完成设计候选、final amendment 与 bounded SQLite validation。

用户于 2026-08-14 正式裁决：

```text
PHASE_02: APPROVED_FOR_FREEZE
PHASE_02_IMPLEMENTATION_AUTHORIZED: NO
PHASE_02_IMPLEMENTATION_STARTED: NO
```

Frozen Phase 02 边界：

- `fields.revision` 是 Field Reality aggregate revision；
- Phase 02 ObjectKind 只开放 `REFERENCE`；
- Relation 只保留真正需要的 bounded lineage；
- DXE 不做自由布局；
- FIPC/1 transport 保持不变，additive methods 不触发 transport version 重设计；
- Personal Memory、Agent、Browser、LLM 与其他 Later Phase 能力不进入 Phase 02。

精确 State lifecycle、REFERENCE、Relation matrix、SurfaceLayoutV1、deterministic richer Resume、Contract delta 与 Migration 0002 位于：

- `docs/architecture/PHASE_02_IMPLEMENTATION_SPEC_V0.1.md`；
- `docs/architecture/PHASE_02_CONTRACT_DELTA_V0.1.md`；
- `docs/architecture/PHASE_02_MIGRATION_0002_V0.1.md`。

三份文件状态为 `FROZEN / APPROVED / IMPLEMENTATION NOT AUTHORIZED / IMPLEMENTATION NOT STARTED`。它们冻结设计与未来实现边界，不是产品实现文件。

Final amendment 已确认：REFERENCE 保持 HTTPS-only；State content 4000、Activity summary 240、Resume 每组 5；REFERENCE lifecycle 为 ACTIVE↔ARCHIVED；Relation self-edge 以完整 typed endpoint 判断；一个 layout 最多一个 FIELD_TASKS TaskPane，且零 TASK 的空 TaskPane 合法。Surface template 仍固定，但 72/28 只属于 Phase 02 renderer default，不进入 durable layout semantics。

真实 0001 + Candidate 0002 已在系统临时 SQLite 中完成正常 1→2 与 incompatible-data rollback probe，两条路径均 PASS，临时文件已清理。证据位于 `artifacts/phase02/`。该 probe 证明 frozen SQL 在 bounded paths 上可迁移与 fail-closed，但不等于产品 Migration 0002 已创建、产品 runner 已验证或 schema version 已推进。

Freeze closeout 未创建 `crates/fielora-storage/migrations/0002_phase02_reality.sql`，未修改 Rust/TypeScript Phase 02 产品实现，也未增加依赖。Phase 02 继续保持 `NOT_AUTHORIZED / NOT_STARTED`；只有后续单独的明确 Implementation Authorization 才能进入实现。

## 35. Phase 02 Complete

用户于 2026-08-14 基于精确 `main@1419b8541a188e59af7ed2966f869bdde2dc7ada` 正式裁决 `PHASE_02_IMPLEMENTATION_AUTHORIZED: YES`。该裁决只改变 Phase 02 的实现授权状态，不改变第 34 节记录的 Frozen semantics；Frozen Implementation Specification、Contract Delta 与 Migration 0002 Specification 保持原文不变。

实现位于 `phase/02-field-reality`，实现提交为 `baeb73298bd8ffca007dc365394b45ff1c4ae819`。产品 schema 已按 Frozen Migration 0002 推进到 version 2；Field Reality aggregate、State lifecycle、唯一 REFERENCE Object、bounded lineage、typed mode/focus、固定 SurfaceLayoutV1、deterministic richer Resume、20 个 additive Phase 02 capabilities 与严格 Electron bridge 已进入实现。FIPC/1 transport 和 `ProtocolVersion 1.0` 未改变，没有扩入 Later Phase 能力，也没有新增产品依赖。

截至 2026-08-14：

- Static / generated contracts：PASS；
- TypeScript unit、Rust unit、Clippy、Release：PASS；
- real FIPC Integration：PASS；
- Desktop E2E dev：PASS；
- Windows x64 Package / Packaged Smoke：PASS；
- Portable Build / fresh-directory Portable Smoke：PASS；
- Engineering Gate：PASS；
- Desktop Reality Gate：PASS；
- Human Experience Gate：PASS；
- Post-correction Full Gate：PASS；
- Phase 02 Final Acceptance：`GRANTED`；
- Phase 02：`COMPLETE`；
- Merge to main：`AUTHORIZED`；
- Phase 03：`NOT_AUTHORIZED`。

Post-correction portable artifact 为 `artifacts/phase02/Fielora-V0.1-Phase02-win-x64.zip`，bytes `145998148`，SHA-256 `24bf2bae54cf029ae748da0f8f7f6f6fb8c73a0e7049ebe76744017055d02a93`。实现、测试、已知限制、构建信息与待人工验收清单位于 `artifacts/phase02/`。

Human Gate 前的长期 `pnpm dev` 体验发现：Core Reality persistence 未失败，但 renderer 将 continuation、snapshot freshness、layout source、revision、pane primitive 与 raw wire enum 暴露给用户，使正确的 legacy compatibility semantics 呈现为误导性的“继续 + STALE”。该问题是 presentation defect，不是旧 snapshot 覆盖 authoritative Reality，也不需要改变 Frozen continuation priority。

`f03ed1fe120e60f925896e12a35caca7cc19ec54` 已完成 bounded renderer-only correction：legacy focus 显示为“上次关注”，默认 UI 隐藏 migration/snapshot/revision/pane diagnostic，mode/kind/status/reference/activity 使用产品语言。TypeScript typecheck、lint、12/12 unit 与真实 Electron dev E2E 均 PASS；exact legacy focus + stale Phase 01 snapshot + current Phase 02 TASK 已被独立复现并验证。Contract、Schema、Migration、Rust Core、Electron bridge、FIPC/1 与三份 Frozen specs 零修改。

Post-correction Full Gate 已基于包含该 UI correction 的 source `ccd849c3b4c52662cd89fab023a00db857e88e21` 重新生成 packaged/portable build。完整 `pnpm verify:phase02` 于 2026-08-14 17:22:55–17:25:48 +08:00 退出 0：Static、12 项 TypeScript unit、19 项 Rust unit、Clippy/Release、4 项 FIPC Integration、Desktop E2E、Package、Packaged Smoke、Portable 与 fresh-directory Portable Smoke 全部 PASS。Packaged 与 Portable 各完成 17 项 acceptance checks；四张 standard/legacy 成品截图经人工检查未见 correction 回归。

Final Acceptance Candidate 已固化于 `artifacts/phase02/PHASE_02_FINAL_ACCEPTANCE_CANDIDATE.md`。用户基于 Post-correction Full Gate、实际 Human Experience、重新生成并通过 smoke 的 packaged/portable 与最终 Evidence，正式裁决 `PHASE_02_HUMAN_EXPERIENCE_GATE: PASS`、`PHASE_02_FINAL_ACCEPTANCE: GRANTED`、`PHASE_02: COMPLETE`。正式 closeout 见 `artifacts/phase02/PHASE_02_CLOSEOUT_REPORT.md`。

Phase 02 不再继续开发或继续 Human Gate 打磨。该裁决只授权 Phase 02 closeout 与 merge main；`PHASE_03: NOT_AUTHORIZED`。main closeout 后先停住，后续先单独落实 Development Workflow Hardening，再单独定义和授权 Phase 03 推进方式。

## 36. Development Workflow Hardening

用户在稳定 `main@e757d050b97a3f0dd3b6812bccefc1e433571c8f` 上单独授权的轻量 Development Workflow Hardening 已完成并验证；该任务位于开发基础设施层，不重新打开 Phase 02，也不构成 Phase 03 Authorization。

当前开发循环：

- 日常开发与人工体验长期运行 `pnpm dev`；
- Docs/UI/Core/Cross 四条 Slice Lane 提供与变更范围匹配的快速反馈；
- 所有准备进入 main 的变更运行 `pnpm verify:premerge`，覆盖 Context audit、Contracts、TypeScript、Rust、real FIPC Integration 与 Desktop E2E；
- packaging-sensitive 变更必须额外运行 targeted packaged smoke；
- 正式 Phase Gate 继续包含 Release、Package、Packaged Smoke、Portable、Portable Smoke、Evidence 与 Human Experience，不被 PreMerge 替代；
- 不增加依赖、hook manager、远程 CI 服务或 Phase 03 产品能力。

精确定义位于 `docs/engineering/DEVELOPMENT_WORKFLOW_V0.1.md`，验证证据位于 `artifacts/workflow/DEVELOPMENT_WORKFLOW_HARDENING_REPORT.md`。Docs Lane 与最终 PreMerge 均 PASS；PreMerge 约 73 秒完成 TS 12/12、Rust 19/19、Integration 4/4 与 real Desktop E2E，正式 Phase 02 Evidence diff 0。Hardening closeout 时仍要求等待 Phase 03 单独授权；该授权已由第 37 节记录的新用户裁决给出。

## 37. Phase 03 — Browse Foundation

用户于 2026-08-14 以稳定 `main@7dc1aac593a4d478b7e175e5e197cf99466c1f47` 正式裁决：

```text
PHASE_03_SCOPE: BROWSE_FOUNDATION
PHASE_03_SCOPE_APPROVED: YES
PHASE_03_IMPLEMENTATION_AUTHORIZED: YES
```

Phase 03 只把真实 Web 页面建立为 Fielora 中可靠、安全、可持续使用的一等 Runtime，同时保持 Browser 是能力层而不是产品中心。按以下纵向 Slice 推进：

1. Real Web Runtime：输入 URL，真实 Electron/Chromium 页面加载，前进、后退、刷新与地址同步；禁止 iframe 或伪页面。
2. Basic Page / Tab Lifecycle：新建、切换、关闭页面、打开链接、标题/URL 更新；Tab 只是 Browse Runtime 资源。
3. Loose Browse / Field Boundary：Browse 是普通临时浏览；Field 是持续工作的 Reality。网页、Tab、历史都不自动成为 Field State，也不覆盖 Resume。
4. Web Security Boundary：remote Web content 永远不获得 Fielora preload/bridge、Rust Core、Field mutation 或任意本地文件能力；只有 `fielora://app` 保持受信任。
5. Desktop Experience：在真实文本网站、复杂 JS、登录页、长页面、`target=_blank`、reload 与多页面切换上完成人工体验。

本阶段不进入 AI Sidebar、网页总结、Agent/Auto Browse、Multi-LLM、Summon、IDR、Capture/Inbox、Library ingestion、Requirement、Coding、Terminal、Evidence、MCP、Extension compatibility、Chromium Fork、完整 Profile/Sync/Downloads/History/Bookmark 产品。

Phase 03 不改变 Phase 02 Frozen Schema、Field Reality semantics、FIPC trust model、trusted origin policy 或 Object identity；不新增 durable Browser schema/Migration，也不提供 privileged Web bridge。若实现证明这些必须改变，必须停止并单独提交 Contract Delta。日常按 Slice 使用 `pnpm dev` 与匹配的 Development Lane；Phase 03 Candidate 稳定后才运行 PreMerge，正式 Gate 才生成 packaged/portable，且 Phase 03 仍承担既定 Installer checkpoint。

当前实现分支：`codex/phase-03-browse-foundation`。Slice 01 已开始；在对应开发 Gate 与人工体验完成前不宣布 Slice 或 Phase Complete。

Slice 01 首次真实人工体验于 2026-08-14 被用户正式裁决失败：WebContentsView 已加载百度并回传真实 URL/title，但 Browse 主区域仍为空白；点击 Fields 又错误进入 Now。状态为：

```text
PHASE_03_SLICE_01_IMPLEMENTATION: EXISTS
AUTOMATED_GATE: PASS_BUT_INSUFFICIENT
HUMAN_EXPERIENCE_GATE: FAIL
SLICE_01_ACCEPTED: NO
SLICE_02_AUTHORIZED: NO
```

两项根因均位于 Slice 01 renderer/host glue，不需要改变 Frozen Contract：无错误提示时，三行 CSS Grid 只有两个子项，空内容的 Browse viewport 被放入第二个 `auto` 行并压为零高度，BrowserRuntime 因 `height = 0` 正确保持 WebContentsView hidden；Fields 则被直接绑定到 `goNow`，且 view state union 没有 `FIELDS`。修复将 Browse viewport 固定在唯一弹性内容行，显式维护 `NOW / BROWSE / FIELDS`，恢复真正的 Fields 列表与既有 Field Surface；没有新增 durable Browser schema、Migration、Rust mutation 或普通网页 bridge。

旧 Browse E2E 只通过 remote CDP 证明 WebContents 加载、DOM、URL/title 与 navigation 正常；隐藏或零尺寸的 WebContentsView 仍可通过 CDP 操作，所以形成假绿。修复后的 E2E 同时验证 native View attached/visible/非零 bounds、bounds 与 React viewport 收敛、页面真实渲染像素、远程 DOM 点击/输入/滚动结果、Back/Forward/Reload、原生窗口 resize、Browse/Fields/Now/Field 往返、remote content 无 app/test bridge，以及 Field revision/focus 不变。修复候选仍须用户重新完成人工 Gate；自动验证通过不改变 `SLICE_01_ACCEPTED: NO` 或 `SLICE_02_AUTHORIZED: NO`。

2026-08-15 的 Slice 01 Human Re-Gate 确认显示、输入、滚动、搜索与同页导航已恢复，但百度搜索结果等大量真实链接点击无反应。根因是 Browse Runtime 的 `setWindowOpenHandler` 对所有请求无条件返回 `deny`：普通 `<a href>` 继续由 Chromium 同页导航，而合法 `target=_blank` / `window.open()` 请求因 Slice 01 尚无第二 Page 被静默丢弃。

Slice 01 当时的冻结修复语义为单页降级：window-open handler 始终拒绝创建新 WebContents，但当目标通过既有 Browser Navigation Policy 时，当前 WebContentsView 加载该 URL；当时 `file://`、`fielora://app`、`javascript:` 均拒绝，remote isolation、Node isolation 与 trusted-origin policy 不变。Page Lifecycle 后来由 Slice 02 正式替代单页降级；Slice 04 Human Regate 又以 initiator + target policy 取代 `file://` 的 target-only 全局拒绝，但 Remote Page→file 与所有 Loose Browse→`fielora://app` 拒绝语义保持。

新增 E2E fixture 分别覆盖普通链接、`target=_blank` 与脚本 `window.open()`：三者都在当前 page target 导航，Back 可回来源页，非 app page target 始终恰好一个；被拒绝的 window-open 不改变 URL 或 Page 数量。自动修复验证通过后，当前状态仍是：

```text
PHASE_03_SLICE_01_REPAIR_CANDIDATE: NOT_YET_ACCEPTED
AUTOMATED_REPAIR_GATE: PASS
HUMAN_EXPERIENCE_GATE: FAIL / WAITING_FINAL_REGATE
SLICE_01_ACCEPTED: NO
SLICE_02_AUTHORIZED: NO
```

最后一项地址栏人工反馈确认旧 normalization 将所有无协议输入补为 HTTPS，使 `bilibili` 错误变成 `https://bilibili/`。Slice 01 因此建立最小 Omnibox：显式 HTTP(S) 按现有策略解析；具有明确点分域名特征的输入补 HTTPS；`localhost` / IPv4（含端口、path、query/hash）补 HTTP；普通词、中文、自然语言与特殊字符进入默认搜索。系统不得把 `bilibili`、`github` 等词猜成 `.com` 域名。

默认 Search Provider 在 `browser-policy.ts` 单点定义为 Google，搜索目标为 `https://www.google.com/search?q=${encodeURIComponent(query)}`。Omnibox 分类只依赖 `BrowserSearchProvider` 契约，可注入其他 Provider，不与 Google 或 Baidu 强耦合；这只是 Slice 01 固定默认值，不是 durable Browser setting，当前不新增设置 UI。空输入与显式非法/privileged URL 继续报错，前后空格被裁剪，URL query/hash 保留，搜索 query 正确编码。初始 New/Blank Surface 不强制加入 Chromium history；第一条真实网页仍是 history 起点，不插入 `about:blank`，不改变 Back 到初始空白页的行为。

Omnibox classification 与 encoding 单测已覆盖显式 HTTPS/HTTP、`bilibili.com`、`www.bilibili.com`、`example.co.jp/path`、localhost/IP、普通英文词、中文自然语言、空输入、非法 URL、前后空格、特殊字符及 query/hash。自动修复验证完成后仍只等待用户确认 `bilibili` 进入搜索结果、`bilibili.com` 直接进入网站；在此之前 Human Gate 与 Slice 状态不改变。

用户于 2026-08-15 明确表示“可以接着 Phase 3 的开发了”。该裁决结束 Slice 01 的 Human Experience Gate，并授权 Slice 02 Basic Page Lifecycle；不构成 Slice 03 授权。

Slice 02 使用 Electron Main 内的 ephemeral Page ID 与内存 Page collection，不新增 durable Browser schema、Migration 或 Field/Object identity。每个已加载 Page 拥有独立 `WebContentsView`，共享现有 `persist:fielora-browse` untrusted session；只有 active Page 可见，后台 Page 保持运行状态。新建 Page 从不进入 Chromium history 的空白 Browse Surface 开始；关闭 active Page 选择相邻 Page。最后一个 Page 无论已加载还是干净空白都真正关闭到 0 Page，不自动补建 Page，也不隐藏关闭动作；0 Page 保持既有 Browse 空状态。`+` / `Ctrl+T` 可显式创建空 Page；Omnibox 保持可用，提交有效 URL 或搜索词时由 Runtime 创建第一个 Page 后完成导航，无效输入不会先制造空 Page。

普通 `<a href>` 继续由 Chromium 在当前 Page 导航。Slice 01 对合法 `target=_blank` / `window.open()` 的“当前 Page 降级”在 Slice 02 被正式替代：目标仍必须先通过 Browser Navigation Policy，随后由 Browser Runtime 创建新的隔离 Page；Electron native window 仍被 deny。Slice 04 最终将 policy 改为 initiator-aware：Remote Page 发起的 `file://` 以及任何 Loose Browse 发起的 `fielora://app` / `javascript:` 继续拒绝；Local Page 的合法本地目标可进入新的隔离 Page。Remote Page 仍无 preload、Node、Fielora bridge、Rust Core 或 Field mutation 能力。

Slice 02 Desktop E2E 已覆盖 Page 新建/切换/关闭、唯一已加载 Page 与唯一干净空白 Page 均可关闭到 0 Page、0 Page 无 active Page 或 WebContentsView、`+` / `Ctrl+T` 可重新创建第一个 Page、0 Page 直接提交 URL 或搜索词可创建并导航第一个 Page、标题/URL 同步、普通链接同页导航、`target=_blank`/脚本 `window.open()` 建页、被拒绝目标不建页、后台 Page 状态保留与只有 active View 可见。用户随后要求继续回归 Phase 03 主线，Slice 02 视为获得继续裁决并进入 Slice 03。

Slice 03 不增加新的 UI、Core command 或持久化模型。`BrowseScreen` 通过 props 只接收 `FieloraBridge['browser']` 窄化能力，文件级 lint 禁止直接访问全量 `window.fielora`，防止后续 UI 演进把 Field mutation 接入 Loose Browse；这是一条 trusted renderer 内的编译期维护边界，不替代 remote Web security boundary。Desktop E2E 比较浏览和 Now/Fields/Field 往返前后的完整 Field 列表、Field、Resume、State、Reference、Relation 与 Activity 快照，并验证 Browse Page ID/URL/title collection 在 Fields 往返中保持。用户随后明确授权进入 Slice 04。

Slice 04 没有改变既有 trusted-origin 或 FIPC trust model。Remote 与 Local Page 的 WebPreferences 集中冻结在 `browser-security.ts`：Node main/subframe integration、preload、webview 与 drag-drop navigation 不可用，context isolation、sandbox、web security 与 safe dialogs 开启；所有 Page 继续共享独立 `persist:fielora-browse` untrusted session，permission check/request、device 与 display media 默认拒绝。用户从 trusted Omnibox 明确提交 `file://` 本地文件时，Browser Runtime 可在该 untrusted boundary 内加载隔离 Local Page；这不会把 `file://` 变成 trusted origin，也不会赋予 app bridge 或 Node。HTTP(S) Remote Page 通过 navigation、fetch、iframe 或 window-open 访问 `file://` 仍必须失败；`fielora://app` 对 USER、LOCAL_PAGE、REMOTE_PAGE 发起者均不可进入。

对抗型 Desktop E2E 已证明 remote Page 中 `process`、`require`、`module`、`Buffer`、`global`、`window.fielora`、`window.fieloraTest` 与 webview API 均不可用，opener 为空；Notification、geolocation 与 media 不获授权；本地/privileged fetch、frame、top navigation、window-open 全部未穿透。完整 Field Reality 快照在这些尝试后仍保持不变。

Slice 04 Human feedback 进一步要求安全拒绝不能把 Electron/IPC 原始异常直接呈现在 UI。Browser Policy 现在发出内部稳定错误码，Main/Browser Runtime 仍是最终强制边界；Renderer 只将受控错误码映射为简洁产品提示，并把未知 Electron/IPC/loadURL 异常统一收敛为不含技术细节的兜底文案。`fielora://app` 显示稳定的受保护页面提示且 active Page identity/URL 不变；显式 `file://` 则按上述 Local Page 语义加载。

同一轮发现新拆出的 `browser-errors` 模块在 Electron Forge fresh Main runtime 中被解析为缺失的 `./browser-errors.js`，使旧的增量 `.webpack` 结果可能掩盖 fresh launch 回归。错误码与用户消息现与 `browser-policy.ts` 同模块交付，避免该运行时边缘；Browse Desktop E2E 在每次启动前会验证并只清空 `apps/desktop/.webpack`，随后由 Forge fresh build 并等待 trusted App target 真正 ready。对抗覆盖同时证明：用户显式 Local Page 可见、可点击/输入且无 Node/preload/app bridge；Remote Page 的 navigation/window-open/iframe/fetch 四种 `file://` 访问均失败；Local/Remote/USER 均不能进入 `fielora://app`。自动 Gate 已通过，Human Experience Gate 仍待用户裁决。

该阶段当时状态：

```text
PHASE_03_SLICE_01: ACCEPTED
PHASE_03_SLICE_02: ACCEPTED
PHASE_03_SLICE_03: ACCEPTED
PHASE_03_SLICE_04: ACCEPTED
PHASE_03_SLICE_05_IMPLEMENTATION: EXISTS
PHASE_03_SLICE_05_AUTOMATED_REPAIR_GATE: PASS
PHASE_03_SLICE_05_HUMAN_EXPERIENCE_GATE: FAIL / WAITING_REPAIR_REGATE
PHASE_03_COMPLETE: NO
```

用户随后明确要求读取既有规划中的 Slice 05 并开始实现；按 Phase 03 的顺序 Gate，这构成 Slice 04 的继续裁决并正式授权 Slice 05 Desktop Experience。Slice 05 不新增 Browser 产品能力，只验证当前 Runtime 能否长期承载普通文本网站、复杂 JS、登录页、长页面、window-open、Reload、多 Page、Resize 与 Browse/Field 往返；下载、历史、书签、Profile/Sync、OAuth privileged opener、AI/Agent 与其他明确排除项仍不进入范围。

稳定 Browse Desktop E2E 已新增真实表单语义的登录 fixture：异步 JS hydration 后启用表单，提交 POST 并经 303 redirect 进入账户页，服务端设置 HttpOnly/SameSite session cookie；Reload 后 session 保持，`target=_blank` 打开的第二 Browse Page 共享同一 session，同时页面 JavaScript 不能读取 HttpOnly cookie。该流程继续运行既有长页滚动、Back/Forward/Reload、Page lifecycle、窗口 Resize、Field Reality snapshot 与安全对抗验证，fresh build/fresh Electron launch 后全部 PASS。该 fixture 只提供稳定防回归证据，不替代真实网站人工体验；人工矩阵位于 `artifacts/phase03/SLICE_05_HUMAN_EXPERIENCE_CHECKLIST.md`。

Phase 03 Candidate 随后按既定流程运行 `pnpm verify:premerge` 并退出 0：Context/Contracts/Typecheck/Lint 全部 PASS，TS 25/25、Rust 19/19、Core Integration 4/4、Phase 02 Desktop E2E 与包含 `desktop-login-session` checkpoint 的 Phase 03 Browse Desktop E2E 均 PASS。PreMerge 没有生成 packaged/portable/Installer，也不替代 Slice 05 真实网站 Human Experience Gate；正式 Phase Gate 仍等待用户后续裁决。

Slice 05 首次真实网站 Human Gate 随后正式失败。用户确认 Runtime、Page Lifecycle 与安全边界虽已自动通过，但仍有四个 Desktop Reality Blocker：窄窗口下真实网站呈现异常且旧 E2E 没有比较实际 Web viewport/zoom/DPR/Shell 占宽；网页文本复制与基础 Clipboard 行为不完整；缺少基于真实网页上下文的右键菜单；导航与 Reload 没有清晰 loading feedback。该裁决保持 `PHASE_03_COMPLETE: NO`，只授权 Slice 05 Repair，不扩入 History、Bookmarks、Profile、Sync 或其他后续产品面。

根因诊断确认 Electron `WebContentsView` bounds 与 renderer CSS 坐标都使用 DIP，截图中的 Windows 125% DPR 不是物理像素/CSS 像素混用；主要体验损失来自 Browse shell 在窄窗仍占 150–210 DIP、WebContents 初始 zoom 未显式固定，以及旧自动化只断言 native bounds 而未核对 remote CSS viewport。Repair 将 Browse shell 默认收敛到 176 DIP、窄窗收敛到 116 DIP，并隐藏窄窗 wordmark 文本与非必要 title；新 WebContents 显式从 Chromium 100% CSS zoom 启动，不向网页注入缩放或响应式脚本。Runtime diagnostic 同时输出 host bounds、View bounds 与 zoom。

网页右键菜单由 Electron Main 的真实 `context-menu` / `ContextMenuParams` 驱动：链接可按既有安全 Policy 在当前或新 Browse Page 打开并复制地址；选择文本、可编辑控件与图片使用 `WebContents`/Clipboard 原生 copy/cut/paste/select-all/copy-image；Back/Forward/Reload 继续调用 Chromium navigation history。网页未获得新 bridge，Remote/Local isolation 与 initiator + target Policy 不变。Toolbar 以真实 `is_loading` 状态显示细进度条、旋转 Reload 与可访问 loading 文案。

修复后的 fresh Browse Desktop E2E 新增真实 Ctrl+C→Ctrl+V 结果、原生右键上下文事件、慢响应页面首次加载与 Reload 的 loading 出现/消失，以及 900×620 窄窗下 remote `innerWidth/innerHeight` 对 native View bounds、`visualViewport.scale=1`、Shell/Remote DPR 一致、受控响应式页面切为单列和截图像素证据；同时发现并修复 initial `about:blank` 可能清除 USER Local Page initiator 的时序竞态，安全策略没有放宽。`pnpm verify:premerge` 再次退出 0，但这些自动证据仍不替代用户对真实网站与同 web viewport Chrome 的 Repair Human Re-Gate。

2026-08-16 的下一次 Human Re-Gate 继续保持 FAIL：工具栏 Reload 按钮旋转被认为笨重；trusted Omnibox 与 Page 标签右键没有反馈；Page 标签没有站点 logo；本地招聘站点在小窗下出现巨大的全宽红色提示。相同 991×590 CSS viewport 的浏览器对照记录为 `innerWidth=991`、`visualViewport.scale=1`、DPR 1.25，页面基础布局与 Fielora 一致；只读 CSS 检查证明红色提示来自站点自己的 `.system-notice`，其样式明确使用 fixed、100% width、30px font 与 30px top padding。因此该提示属于网站行为，Fielora 不注入 CSS 或模拟响应式行为。

第二轮 Repair 将 loading 从工具栏动画迁移到 active Page 的 favicon slot 小型 throbber，并保留 2px 页面进度线；Reload 按钮保持静态，真实 `is_loading` 与可访问状态不变。trusted App WebContents 基于真实 `ContextMenuParams` 为 Omnibox 提供 undo/redo/cut/copy/paste/select-all 原生菜单；Page 标签通过受信任且严格 `page_id` 校验的 Browser IPC 提供 reload/copy URL/close 菜单。站点 favicon 由隔离 Browse session 获取，限制 HTTP(S)/data、受限 image MIME、64KB 和 4096px 输入尺寸，Main 使用 `nativeImage` 解码并重新编码为 32px PNG data URL 后才进入 ephemeral Page state；trusted renderer 不直接加载远程 favicon URL，Remote Page 未获得新 bridge。自动 Gate 新增 favicon data/DOM、地址栏和 Page 标签原生右键日志以及 Reload 静态动画断言，最终状态仍为 `FAIL / WAITING_REPAIR_REGATE`。

用户于 2026-08-16 明确裁决“Phase 3 先完结”。该裁决关闭 Slice 05 Human Experience Gate，并授予 Phase 03 Final Acceptance。正式 `pnpm verify:phase03` 从首项完整运行：Context/Contracts/Typecheck/Lint PASS，TS 25/25、Rust 19/19、Integration 4/4；Phase 02 Field Reality 与 Phase 03 Browse E2E 在 dev、packaged 和 fresh-directory portable 中全部 PASS。第一次正式运行曾因随机 DevTools 端口碰撞在 packaged test target 建立前失败；两套 E2E 改为使用操作系统动态分配 loopback 端口后，先完成 targeted packaged 验证，再完整重跑正式 Gate 退出 0。该测试编排修正没有改变产品或安全语义。

最终 portable 为 `artifacts/phase03/Fielora-V0.1-Phase03-win-x64.zip`，146008702 bytes，SHA-256 `6084dbf493951d8a51e41a6a43c750926a60f29e9cd2b5c83ac094bb951c0197`。Phase 03 Closeout 不新增 durable Browser schema、Migration、privileged bridge、History/Bookmarks/Profile/Sync 或 Chromium Fork；也不修改 Phase 02 Frozen Schema、Field Reality、FIPC trust model、trusted origin policy 或 Object identity。

当前状态：

```text
PHASE_03_SLICE_01: ACCEPTED
PHASE_03_SLICE_02: ACCEPTED
PHASE_03_SLICE_03: ACCEPTED
PHASE_03_SLICE_04: ACCEPTED
PHASE_03_SLICE_05: ACCEPTED
PHASE_03_ENGINEERING_GATE: PASS
PHASE_03_DESKTOP_REALITY_GATE: PASS
PHASE_03_HUMAN_EXPERIENCE_GATE: PASS
PHASE_03_PACKAGED_GATE: PASS
PHASE_03_PORTABLE_GATE: PASS
PHASE_03_FINAL_ACCEPTANCE: GRANTED
PHASE_03: COMPLETE
NEXT_PHASE_SCOPE: NOT_YET_DEFINED
NEXT_PHASE_IMPLEMENTATION: NOT_AUTHORIZED
```

## 38. 最高产品原则

> **不是把所有软件装进 Fielora，而是让用户的工作与生活在软件之间不再断掉。**

> **浏览时像优秀浏览器；轻量 AI 时随叫随走；真正工作时进入 Field。**

## 39. Phase 04 → V0.1 Alpha Remap Candidate

用户已明确确认 `CODEX_READING_REPORT.md` 的 Phase 04–09 / Alpha 竞品审计，并授权据此重排 Phase 04 → Alpha 路线。该授权确认：Browser、AI、Coding、Terminal、Computer Use、MCP、Artifacts、Projects 与长期任务逐渐属于基础设施；Fielora 必须由以下连续链证明产品差异：

```text
Capability
  → Field Reality
  → Goal / Requirement / Decision
  → Action
  → Evidence
  → Verified Result
  → Resume
```

独立候选已形成于 `docs/architecture/PHASE_04_ALPHA_REMAP_CANDIDATE_V0.1.md`。它保留 04–10 编号与大部分 `SCHEMA_FREEZE_V0.1.md` table responsibility，并提出一个待用户审查的 bounded timing change：将 `capabilities` / `capability_executions` 从原 Phase 08 职责提前到 Phase 07，使 Controlled Execution 从一开始拥有 durable invocation/outcome identity；Phase 08 在其上建立 Verification。Frozen Schema 在 Candidate 获接受前不改变。候选重新定义阶段完成语义：

1. Phase 04 — Field Entry & Model Foundation；
2. Phase 05 — Persistent Project Reality；
3. Phase 06 — Field-native Development Workspace；
4. Phase 07 — Controlled Execution Runtime；
5. Phase 08 — Reality Closure / Verification Loop；
6. Phase 09 — Capability Connector Proof；
7. Phase 10 — Continuity Library & V0.1 Alpha Closure。

每个 Phase 必须固定说明 `Foundation Capabilities Added`、`Fielora Semantics Added`、可证伪 `Differentiation Hypothesis`、纵向用户闭环、Negative/Failure Evidence 与 Human Experience verdict。基础工具存在不再单独构成 Phase 成功。

路线级调整包括：Capture/Inbox/Promote 提升为 Phase 04 主线；Repo Scanner 降级为 Phase 05 Project Reality 输入机制；Editor/LSP/Git/PTY 主动压薄为 Development/Execution 工作面；Evidence identity/provenance 从 Phase 05 起出现，完整 Reality Closure 位于 Phase 08；MCP 降级为 Phase 09 的一个 Generic Adapter proof；Library 重构为带 source/reason/Field/usage/result lineage 的 Continuity layer。

当前正式状态：

```text
CODEX_READING_REPORT: CONFIRMED
PHASE_04_ALPHA_REMAP: AUTHORIZED
PHASE_04_ALPHA_REMAP_CANDIDATE: READY_FOR_REVIEW
PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

Remap Candidate 尚未取代 Frozen Architecture 第 19 节，也不是 Phase 04 Product/Contract/Schema/Implementation Spec。用户审查 Candidate 的核心问题是：按该路线完成 Alpha 后，首次用户能否明显体验到 Fielora 在持续维护工作现实，而不是另一套 AI Browser / Coding Agent。只有 Candidate 被明确接受后，才能开始 Phase 04 Freeze Candidate；Freeze 审查通过仍不自动授权实现。

## 40. Reality Competitive Hardening

用户随后接受了对 ChatGPT/Codex Reality overlap 的严格裁决。当前公开产品事实确认 Codex 已有 Projects、thread-scoped Goals、durable externalized state、Memories、Computer History 与 evidence-driven agent loops；因此“记住进度、跨会话续做、保存目标、测试后修复、跨软件工作”均视为基础能力。公开证据只支持 `CODEX_HAS_FIELORA_STYLE_UNIFIED_REALITY_LAYER: NOT_CONFIRMED`，不得声称其他产品内部绝对不存在类似机制。

路线采用以下竞争边界：

> **Context informs the Agent; Reality governs the work.**

Context 回答 Agent 应知道什么；Reality 回答 Fielora 当前承认什么，以及该状态对 Resume、Action、Completion 与 Reverification 产生什么系统后果。Field Reality 的最低竞争 Contract 为 Identity、Type、Provenance、Authority、Lifecycle、Operational Effect、Verification Relation 与 Provider Independence。前五项只证明系统能描述 Reality；后三项证明 Reality 实际支配产品。

用户确认三个强化 Gate：Phase 05 以 Source → Fact → Task/Verification 的 invalidation propagation 为核心实验，而非仅测试 persistence；Phase 08 增加 Requirement revision mismatch，旧 Check/PASS 不得自动验证新 revision；Alpha 增加 Provider Replacement Test，由不同 Provider 分别形成理解、执行和验证，Human 中途修订 Decision，重启并删除/禁用首个 Provider 的聊天摘要或 Memory 后，权威 Reality 与 Resume 仍须完全一致。

Phase 04 Freeze 前必须锁住四个跨阶段不变量：Reality identity 由 Fielora 持有；AI output 默认无权威；provenance 与 authority 分离；Context Package 不等于 Current Reality。这里只冻结 ownership/separation boundary，不提前实现 Phase 05 stale propagation、Phase 08 Verification Graph 或完整 Alpha Schema。

正式状态保持：

```text
CODEX_REALITY_OVERLAP: CONFIRMED
CODEX_HAS_FIELORA_STYLE_UNIFIED_REALITY_LAYER: NOT_CONFIRMED
COMPETITIVE_HARDENING: REQUIRED_BEFORE_FREEZE
PHASE_04_ALPHA_REMAP_CANDIDATE: READY_FOR_REVIEW
PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

用户接受的是竞争边界与强化要求；没有给出字面上的 `PHASE_04_ALPHA_REMAP_CANDIDATE: ACCEPTED`，因此本轮不把 Candidate、Schema 或 Phase 04 标记为 Frozen/Accepted，也不启动实现。

## 41. Fielora × Aegis Governed Agency Boundary

用户确认 Aegis 不作为另一个 Agent 产品、第二套 Reality 或独立用户可见系统并入 Fielora。战略组合定义为：

> **Aegis provides Governed Agency; Fielora provides Governed Reality.**

跨层权力边界固定为：

```text
Model proposes.
Agency governs action.
Adapter causes effects.
Fielora governs authoritative work state.
```

Fielora 独占 Field、Requirement、Work Decision、Project Reality、Verified Result、权威 work Evidence graph、Current Reality 与 Resume 的 authoritative work state。Aegis-derived Runtime 只允许拥有 AgencyMandate、Proposal、Reason/Plan 的内部表示、AuthorityDecision、ExecutionAttempt、DispatchRecord、TechnicalReceipt、UnknownOutcome、Reconciliation、Budget、Pause/Kill 与以后单独授权的 Wake。Technical success、Action semantic success、exit 0、tool/server output 或 Agent 自述均不能推出 Requirement verified；只有 Fielora-owned Verification 根据 Criterion、Check 与 Evidence 形成的 Verified Result 才能改变 Current Reality。

Aegis-derived Runtime 必须是可替换实现。Fielora Domain Contract 只认识最小、protocol-neutral 的 Agency Contract；不得依赖 `AegisWillDecision`、`AegisReasonArtifact`、`AegisMetacognitionArtifact` 或九 Authority 的内部拓扑。现有 Aegis 仓库只作为 contract archaeology 与选择性组件来源，不整仓 merge，不继承 legacy Kernel/Brain、第二套 World Model/Memory/FileEvidenceStore 或产品命名结构。

路线不扩大：Phase 04 只冻结 `LLM output is Proposal, never Reality` 及四层 ownership/separation boundary；`AgencyMandate` 候选留在 Phase 06 Freeze；durable dispatch、attempt、receipt、unknown/reconciliation 主要在 Phase 07；completion authority 与 Reality Closure 在 Phase 08；Adapter/Connector governance 在 Phase 09。Continuous Life、自动 Skill/Evolution、Self Model、Agent society 与无人值守长期自治不进入 V0.1 Alpha。

正式状态：

```text
AEGIS_STRATEGIC_ABSORPTION: YES
AEGIS_DIRECT_REPO_MERGE: NO
AEGIS_AS_SECOND_REALITY_SYSTEM: PROHIBITED
AEGIS_GOVERNED_AGENCY_RUNTIME: RECOMMENDED
AGENCY_RUNTIME_REPLACEABILITY: REQUIRED
CURRENT_PHASE_MAP: REMAINS_VALID
PHASE_04_ALPHA_REMAP_CANDIDATE: READY_FOR_REVIEW
PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

## 42. Phase 04 → Alpha Strategic Product Anchor

用户确认三层产品定义，并将其作为 Phase 04 → Alpha 的战略锚点：

```text
LONG_TERM_VISION
Personal Digital Steward
个人数字管家

        ↓

CORE_PROBLEM
Important work loses continuity and trustworthy state
across people, AI systems, tools and time.

        ↓

CORE_DIFFERENTIATION
Provider-neutral Reality
+ Governed Agency
+ Verification
+ Recovery

        ↓

ALPHA_POSITION
Work Reality Steward

        ↓

ALPHA_PROOF
One real undertaking remains understandable,
verifiable, safely actionable and resumable
across sessions, tools and model providers.

        ↓

LIFE_STEWARD_EXPANSION
DEFERRED
```

这里的 `trustworthy state` 明确取代绝对 `truth` 表述。Reality 不声称掌握终极真相，而是维护当前什么被系统承认、依据是什么、authority/confidence 与 lifecycle 是什么。它必须能区分 `FACT`、`DECISION`、`ASSUMPTION`、`QUESTION`、`BLOCKER`、`RESULT`、`UNKNOWN`、`STALE` 与 `SUPERSEDED`，并让这些状态真实约束 Resume、Action、Completion 与 Reverification。

`Personal Digital Steward` 只承担长期北极星职责，不能直接产生当前 Roadmap Item。Phase 04 → Alpha 的范围由 `Work Reality Steward` 过滤：Capture、Project Reality、Requirement、Verification、Evidence 与 Provider replacement 属于必要证明；Editor、Terminal 只达到纵向闭环所需的 sufficient surface；MCP 只做 minimum proof；Calendar、Email、Weather、Shopping、Continuous Life 与通用 Computer Use 不进入 Alpha，除非未来冻结 Hero Flow 单独证明其不可替代性。

Alpha 极限测试必须覆盖 Provider A 理解、Provider B 开发、Human 修订正式 Decision、Provider C 验证、应用重启、Requirement/source revision 变化与一次 `UnknownOutcome`。最终系统必须基于 Fielora-owned Reality 回答当前正式版本、已完成与仅被 Agent 声称完成的区别、Evidence 有效性及失效原因、下一步和允许行动；不得依赖重新读取历史聊天摘要。

本裁决只稳定战略锚点和措辞，不接受或冻结 Remap Candidate，不授权 Phase 04 产品代码、Schema、Migration、依赖或 credential implementation：

```text
STRATEGIC_ANCHOR: CONFIRMED
LONG_TERM_VISION: PERSONAL_DIGITAL_STEWARD
ALPHA_POSITION: WORK_REALITY_STEWARD
LIFE_STEWARD_EXPANSION: DEFERRED
PHASE_04_ALPHA_REMAP_CANDIDATE: READY_FOR_REVIEW
PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

## 43. Recent Discussion Coverage Audit and Phase 04 Capability Definition

用户要求确认此前战略/架构讨论是否已经进入开发文档，并要求先把能力定义完整，再准备 Phase 04。只读覆盖审计确认：Codex/ChatGPT 竞争重叠、Personal Digital Steward / Work Reality Steward 战略层级、`trustworthy state`、Reality Competitive Contract、Aegis-derived Governed Agency 边界与 Life Steward 延后已经进入 Remap Candidate、Competitive Boundaries、Project Reality 与 Decisions；但 Permission 四层模型、轻量 Reality Admission 的集中定义、Change Safety 工程纪律和 Phase 04 逐能力规格此前仍不完整。

新的 `docs/architecture/PHASE_04_CAPABILITY_DEFINITION_CANDIDATE_V0.1.md` 已补齐 Phase 04 的 13 项能力目录：Provider Registry/Configuration、Credential Boundary、Model Invocation、Summon、Explicit Context Package/Chips、Bounded IDR、Proposal/Draft Boundary、Capture、Inbox、Promote/Reality Admission、Provider Swap/Failure Recovery、Permission Foundation 与 Resume after Entry。它同时定义 logical persistence、五个纵向 Slice、Phase Exit Evidence、明确排除项与 Freeze 前十二项开放决定。

Permission 采用四层正交模型：

```text
Capability Boundary
Mandate
Approval Routing
Semantic Authority
```

用户可见 preset 以后可由 DXE 压缩，但 Domain 不得把 `Observe / Work / Ask / Auto-review / Full control` 做成单轴枚举。正式不变量包括 Model/Provider/网页/Connector metadata 不能 self-grant；Permission 与 Provider identity 解耦；`Full execution access ≠ full semantic authority`；System hard deny 不可被 lower policy/reviewer/普通批准绕过；credential vault、Reality store 与 Permission store 必须位于执行 Agent 不能直接读写的 trusted boundary。

Phase 04 只实现模型 external-send、endpoint、context disclosure、credential 与 tool-request-non-execution 所需的最小权限面。Phase 06 才形成 Observe/Work in Field 与 human ask；Phase 07 建 durable Mandate/Grant/Approval/Audit；Phase 08 建 Verification/Reality mutation authority；Phase 09 扩展 Connector external effect。Auto-review、Full-device access、通用 Permission Profile editor 与完整 policy language 不属于 Alpha 必需能力。

轻量 Reality Admission 明确不增加独立 Epistemic Governance 系统。Conversation、model claim、user factual statement 与 provider/tool success 都不会自动成为 verified Fact/Result；只有内容准备 Capture、Promote、形成正式 Decision/Requirement、触发外部 Action 或宣布 Verified 时才进入对应 Gate。

`docs/engineering/DEVELOPMENT_WORKFLOW_V0.1.md` 新增 Change Safety / Compatibility Discipline：重大变更先形成 `CHANGE IMPACT`，追踪 affected Contract/module/persistence/invariant/Hero Flow，执行 architecture invariant、contract、migration compatibility 与关键 Hero Flow regression。该纪律贯穿 Phase，不新增产品 Phase。

当前状态：

```text
RECENT_DISCUSSION_COVERAGE: AUDITED
STRATEGIC_AND_REALITY_DECISIONS: DOCUMENTED
PERMISSION_MODEL: DEFINED_AS_CANDIDATE
CHANGE_SAFETY: ACTIVE_ENGINEERING_DISCIPLINE
PHASE_04_CAPABILITY_DEFINITION: READY_FOR_REVIEW

PHASE_04_ALPHA_REMAP_CANDIDATE: READY_FOR_REVIEW
PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

本轮只形成候选定义和事实源同步，不修改 Frozen `CORE_CONTRACTS_V0.1.md`、`SCHEMA_FREEZE_V0.1.md`，不创建 Migration 0004，不选择 Provider SDK/vault 技术，不新增依赖或产品代码。下一步必须先审查并接受 Remap 与 Capability Definition，再分别生成 Phase 04 Product/Contract/Schema/Migration/Implementation Freeze Candidate；Freeze 获批仍不自动授权实现。

## 44. Phase 04 Freeze Package Authoring and Review

用户于 2026-08-16 明确裁决：正式进入 Phase 04 Freeze Package 的编写与审查，不再进行战略层重排。该裁决使现有 `PHASE_04_ALPHA_REMAP_CANDIDATE_V0.1.md` 与 `PHASE_04_CAPABILITY_DEFINITION_CANDIDATE_V0.1.md` 成为 Freeze input，但不自动把它们或 Phase 04 标记为 Frozen，也不授权实现。

新的 Package 入口为 `docs/architecture/PHASE_04_FREEZE_PACKAGE_CANDIDATE_V0.1.md`，并包括 Product Freeze、Contract Delta、Migration 0004、Implementation Spec、Test Plan 与 `artifacts/phase04/PHASE_04_FREEZE_PACKAGE_REVIEW_REPORT.md`。Package 锁定候选为：OpenAI Responses + Anthropic Messages 两个真实 Provider family；Provider-neutral direct Rust HTTP adapter；Windows Credential Manager opaque credential boundary；显式 Context Package；模型输出默认无 Reality authority；Capture/Inbox/Attach/`IDEA_CANDIDATE` Promote；Provider swap/restart 后 Fielora-owned identity/provenance/Resume 保持。

Migration 0004 Candidate 只新增 `provider_configs` 与 `captures`，不扩展 Phase 02 `FieldStateKind`，不建立 Idea/Chat/Provider Session table。Phase 03 没有 durable schema，因此 0003 作为明确永久空号，未来 registry 候选为 `(1,2,4)`。Candidate SQL normalized SHA-256 为 `5a5cbf9f0955aad9c620227fea03422782fbc00fb4eb0c2f2f8f284aa992d1be`；in-memory 0001+0002+0004 structural probe PASS，但产品 runner、schema version 与产品 DB 均未修改。

Cross-review 识别四项 Final Freeze 前用户审查点：一次性 trusted credential FIPC ingress 例外；Phase 03 Installer checkpoint 的历史例外处置；OpenAI + Anthropic 组合；是否允许使用测试 credential/API quota 执行 Windows vault 与真实 Provider bounded probes。

当前状态：

```text
PHASE_04_STRATEGIC_REMAP: ACCEPTED_AS_FREEZE_INPUT
PHASE_04_FREEZE_PACKAGE_AUTHORING: COMPLETE
PHASE_04_AUTHOR_CROSS_REVIEW: COMPLETE
PHASE_04_FREEZE_PACKAGE: READY_FOR_USER_REVIEW

PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
PRODUCT_CODE_CHANGED: NO
DEPENDENCIES_CHANGED: NO
SCHEMA_VERSION_CHANGED: NO
```

## 45. Phase 04 Provider Retention Amendment and Final Probes

用户于 2026-08-16 正式裁决：`PHASE_04_ALPHA_REMAP_CANDIDATE: ACCEPTED`、`PHASE_04_CAPABILITY_DEFINITION: ACCEPTED_FOR_FREEZE_INPUT`、Freeze Package `ACCEPTED_FOR_FINAL_PROBES_AND_AMENDMENT`。同时接受 trusted credential one-shot FIPC ingress、Phase 03 Installer 历史例外、OpenAI Responses + Anthropic Messages Provider family，并授权仅使用 synthetic input、固定预算、无 retry 的真实 credential probes。该裁决不构成 Phase 04 Final Freeze 或产品实现授权。

用户指出 Provider-side retention 是 Final Freeze blocker。Package 现明确：Fielora 默认不本地持久化 full prompt/response；第三方 Provider handling 取决于 Provider/account policy；OpenAI Responses request 强制且不可覆盖 `store:false`，但不得把它描述为 ZDR 或 Provider 不保留；Anthropic 不伪造 retention flag；首次配置/发送显示“发送内容将离开 Fielora，并受所选 Provider 的数据处理和保留政策约束。”

Bounded probes 当前结果：Migration candidate runner 对 fresh、2→4、idempotence、checksum tamper、rollback、intentional `(1,2,4)` gap、FK 与 query plan PASS；WinCred create/read、2048-byte replace/read、delete/unreadable PASS 且测试 credential 已清理；Provider SSE normalization、custom endpoint policy、Context/Capture contract fixtures PASS。Migration hash 按现有 `frozen_migration_checksum` 归一化修正为 `4d142745b3e9a5ccd8c27f422ecdc888163a575a91b0515f90a1ee6aa0f869ab`，早期 `5a5c...` 不再 canonical。

真实 Provider probe 未运行：本机没有 `FIELORA_OPENAI_PROBE_KEY`、`FIELORA_OPENAI_PROBE_MODEL`、`FIELORA_ANTHROPIC_PROBE_KEY`、`FIELORA_ANTHROPIC_PROBE_MODEL`，脚本 fail-closed SKIP，external requests 为 0。不得复用 Codex/App 内部 credential，不得把 secret 写入对话、repo、命令参数或 artifact。

当前状态：

```text
PROVIDER_RETENTION_AMENDMENT: COMPLETE
MIGRATION_WINCRED_FIXTURE_PROBES: PASS
REAL_PROVIDER_PROBE: SKIP_NO_TEST_CREDENTIALS
PHASE_04_FINAL_FREEZE_CANDIDATE: NOT_READY

PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

## 46. Phase 04 Final Freeze Evidence Gate

用户于 2026-08-16 确认当前没有新的 architecture blocker；Final Freeze Candidate 的唯一剩余 blocker 是 OpenAI Responses 与 Anthropic Messages 两家真实 Provider bounded probe。该 probe 只验证 real authentication、real stream、normalized text/usage、client cancellation/terminal behavior 与 representative error mapping，不再承担 Provider 研究，也不得扩展 tools、conversation continuity、reasoning API、structured output、prompt caching、batch、computer use 或其他高级能力。

Final Evidence 必须证明 provider-specific wire protocol 经 Fielora normalization 进入相同稳定 `ModelInvocation` semantics，而不只是两家返回字符串。固定归一化序列为 complete `STARTED → OUTPUT_TEXT_DELTA → USAGE → COMPLETED`、cancel `STARTED → OUTPUT_TEXT_DELTA → CANCELLED`、invalid-auth `STARTED → FAILED / CREDENTIAL_REJECTED`。Probe source 位于 `scripts/freeze/phase04/`，`artifacts/phase04/freeze/` 只保存脱敏 Evidence；其中 prompt body、response body、credential bytes、Authorization headers 与 secret-bearing logs 必须全部为 0。

四个 test credential/model 变量只能安全注入本地 probe 进程环境，不得进入对话、repo、`.env`、截图、命令行参数或 artifact。凭据尚未注入，因此没有发起新的真实请求，状态保持：

```text
REAL_PROVIDER_PROBE: SKIP_NO_TEST_CREDENTIALS
PHASE_04_FINAL_FREEZE_CANDIDATE: NOT_READY
PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

用户随后正式认可该边界并将 Gate 锁定。此后在真实双 Provider Evidence 完成前，不再修改 Product、Contract、Schema 或 Implementation Spec，不进入 Slice 01，也不生成 Final Freeze Candidate。唯一允许的推进链为：安全注入四个专用环境变量 → fixed-budget real probe → complete/cancel/failed 统一语义与五类零泄露断言 PASS → 固化脱敏 Evidence → Cross-review → Final Freeze Candidate → 用户 Final Freeze Review。即使 Freeze 最终获批，Implementation 仍需独立授权。

```text
FREEZE_GATE: LOCKED
NON_CREDENTIAL_PROBES: PASS
REAL_PROVIDER_PROBE: SKIP_NO_TEST_CREDENTIALS
PROVIDER_EXTERNAL_REQUESTS: 0

PHASE_04_FINAL_FREEZE_CANDIDATE: NOT_READY
PHASE_04_FREEZE: NOT_YET
PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED
```

## 47. Phase 04 Provider Gate Amendment and Implementation Authorization

用户于 2026-08-16 正式纠正 Provider Gate：真实 OpenAI + Anthropic credential probe 不再是 Freeze 前置条件，而是产品实现完成后的 Phase Exit Acceptance。Freeze 的对象是稳定 `ModelInvocation` Contract、Credential/Security/Retention/Reality authority 边界；Implementation 证明真实产品链；Phase Acceptance 再证明合规可调用的真实 Provider 在 Fielora 产品内工作。

OpenAI Responses 与 Anthropic Messages 改为 V0.1 reference built-in adapters，不是产品身份或内部 wire standard。未来 Adapter catalog 可以 additive 扩展，当前 Schema/Contract 不重做；无论 Provider/协议如何变化，Capture、Field、Reality、Permission、Resume identity 与 mutation semantics 必须保持 Fielora-owned。

用户同时授权直接完成 Phase 04 Slice 01–05，不要求逐 Slice 停等；完成实现后必须执行严格自动 Gate，并给出人工体验内容。Mock/fixture 全绿只可完成 Engineering Gate；`REAL_PROVIDER_FREEZE_PROBE: NOT_RUN` 必须诚实保留为 implemented-adapter acceptance debt。套餐条款禁止 automation/API testing 的 credential 不得用于验收。

```text
PHASE_04_PROVIDER_GATE_AMENDMENT: ACCEPTED
REAL_PROVIDER_PRE_FREEZE_PROBE: DEFERRED_TO_IMPLEMENTATION_ACCEPTANCE
PHASE_04_FREEZE_PACKAGE: VALIDATED_WITH_PROVIDER_ACCEPTANCE_DEFERRED
PHASE_04_FREEZE: GRANTED
PHASE_04_IMPLEMENTATION: AUTHORIZED

PHASE_04_ENGINEERING_GATE: PENDING
PHASE_04_REAL_PROVIDER_ACCEPTANCE: PENDING
PHASE_04_HUMAN_EXPERIENCE_GATE: PENDING
PHASE_04: NOT_COMPLETE
```

## 48. Phase 04 Implementation and Engineering Gate

用户授权的 Slice 01–05 已连续完成。产品实现包括 provider-neutral Rust ModelRuntime、OpenAI Responses/Anthropic Messages/OpenAI-compatible adapters、Windows Credential Manager、bounded async streaming/cancel/error、全局 Summon、显式 Context chips 与 USER_NOTE/SENSITIVE/custom-endpoint disclosure、active Browse page/selection 重取、Quick Capture、exact Migration 0004/schema 4、Capture Inbox/Attach/Archive/Restore/`IDEA_CANDIDATE` Promote，以及跨重启 Fielora-owned provenance/Resume。

Cross-review 修正并验证了 Frozen Product 的精确上限、credential-like outbound fail-closed、custom endpoint IP/reserved/DNS policy、Provider terminal marker、Tool Proposal normalize-without-execution，以及 complete/cancel/fail 三条稳定语义。正式 `pnpm verify:phase04` 最终从 context/contracts/static/unit/clippy/release/Core integration 一直跑通 dev、packaged 与 fresh-directory portable 的 Phase 02、03、04 Desktop Gates。结果为 26/26 TypeScript、29/29 Rust、5/5 Core integration，三宿主全部 PASS；portable SHA-256 为 `0c5b3d255f2bde7ea74d393ca89201eaa64cd665f5fd140317525a257f6ddff4`。

三宿主 E2E 证明 fixture `STARTED → OUTPUT_TEXT_DELTA → USAGE → COMPLETED`、`STARTED → CANCELLED`、`STARTED → FAILED`，以及 WinCred、Core authoritative context reread、Capture/Promote/restart、secret/unsaved-prompt local file canary 均通过。Evidence 文本扫描未发现 credential/prompt canary 或 bearer-like token，最终测试 WinCred target 为 0。真实 Provider external request 仍为 0；fixture 结果未冒充 real-provider PASS。

```text
PHASE_04_IMPLEMENTATION: EXECUTED
PHASE_04_ENGINEERING_GATE: PASS
PHASE_04_REAL_PROVIDER_ACCEPTANCE: PENDING_NO_ELIGIBLE_AUTOMATION_CREDENTIALS
PHASE_04_HUMAN_EXPERIENCE_GATE: PENDING
PHASE_04_FINAL_ACCEPTANCE: NOT_YET
PHASE_04: NOT_COMPLETE
```

正式 Evidence 位于 `artifacts/phase04/`。没有新的 architecture/engineering blocker；Phase Exit 只等待至少两个 eligible Provider/协议的真实产品验证与用户 Human Experience 裁决。

## 49. Phase 04 Human Experience Remediation

用户对首次 Phase 04 Human Experience Gate 作出 `FAIL / REMEDIATION_REQUIRED` 裁决。问题不是 Core Contract，而是表达层：Summon 像 AI 工程控制台；Ask/Inbox/Providers 被错误做成三等权 Tab；Context、Sensitivity、Provider 过度暴露；Inbox 默认倾倒 Capture 正文；Attach/Promote/`IDEA_CANDIDATE` 等 Domain 术语直出；视觉与现有 Fielora 不一致；Summon 与 Capture 的用户用途没有被清楚表达。

本轮只允许 deterministic fixed React remediation，不改变 Provider wire、Credential Store、ModelInvocation、Context bounds/stale protection、Capture aggregate、Reality、Permission 或 Migration 0004，不进入 Phase 05，也不实现完整 DXE。当前正式边界是：

```text
DXE_DESIGN_PRINCIPLES: PARTIALLY_APPLIED
DXE_SURFACE_RUNTIME: NOT_IMPLEMENTED
```

修复后，Summon 只服务 Ask/Continue，输入为第一焦点；Context 默认显示压缩摘要，按需展开检查/移除/补充；Sensitivity 只在确定性规则命中时出现一次性确认；Provider Setup 与 Inbox 均从 Ask 主体拆出；Inbox 使用 180 字符 bounded preview 与自然语言动作；Browse PAGE/SELECTION Quick Capture 不导航、不切 surface；回答只提供轻量“捕获回答”。Core 的 Attach/Promote/`IDEA_CANDIDATE` semantics 保持不变。

自动证据方面，TypeScript 28/28、Rust 29/29、Core integration 5/5 PASS；Phase 04 remediation 在 dev、packaged、fresh extracted portable 三宿主均 20/20 PASS；Phase 02 三宿主回归 PASS；新 Portable SHA-256 为 `3a2bfdcca925dc0a70c81971c62253144294b387aa368969428308d0a3a9f662`。完整 `pnpm verify:phase04` 的 fresh rerun 在 Phase 03 Chromium 原生 Ctrl+C/Ctrl+V 断言停止：Windows 当前对自动化进程 `OpenClipboard` 返回 `Access denied`，且没有占用窗口。该断言没有被跳过或放宽，因此不能把本轮完整 revalidation 写成 PASS。

```text
PHASE_04_ENGINEERING_GATE: PASS (PRE-REMEDIATION BASELINE)
PHASE_04_REMEDIATION_ENGINEERING_REVALIDATION: PENDING_ONE_ENVIRONMENT_CHECK
PHASE_04_HUMAN_EXPERIENCE_GATE: PENDING_RETEST
PHASE_04_REAL_PROVIDER_ACCEPTANCE: PENDING
PHASE_04_FINAL_ACCEPTANCE: NOT_YET
PHASE_04: NOT_COMPLETE
PHASE_05: NOT_AUTHORIZED
```

正式 remediation、测试、Portable 与人工复测证据位于 `artifacts/phase04/`。

## 50. ChatGPT Desktop / Codex Competitive Rebase

用户于 2026-08-17 基于当前 OpenAI 官方产品资料再次收紧竞争判断。ChatGPT Desktop/Codex 已把 Chat/Work/Codex、Projects、本地文件夹、Browser、文件工作、长任务 Goal、Computer Use 与 Plugins/MCP 等能力放进同一桌面工作环境；因此 `ChatGPT = AI Chat`、`Fielora = AI Work Environment` 的旧比较正式失效。

当前一级抽象改为：

```text
ChatGPT Desktop ≈ AI-centered workspace
Project / Chat / Goal → AI 使用工具完成工作

Fielora ≈ Work-centered environment
Work lifecycle / operational state → Human + interchangeable AI + tools
```

该表达不声称 ChatGPT 做不到相关流程，也不推测其内部绝对不存在统一 Reality。官方可用性还必须精确限定：Computer Use 当前支持受支持地区的 macOS/Windows ChatGPT Desktop；Computer History 截至本次核验仍为 macOS Desktop 能力，并受计划、管理员与地区条件影响，不能写成 Windows 通用现状。

Fielora 的主差异 Gate 收窄为四项：

1. `Explicit Lifecycle`：`Capture → Inbox → Promote → Work → Result → Reuse`；
2. `Operational Work State`：状态改变实际改变有效性、Resume、Completion 或 Reverification；
3. `Persistent Work Lineage + Verification`：`Requirement → ChangeSet → Check → Evidence → Verified Result` 稳定关联，并随 revision 正确失效；
4. `DXE`：工作状态从固定 Surface Primitive 中决定工作面，用户不通过手工选择 Mode 模拟状态。

`Field`、`Reality`、Resume、Memory、Coding、Browser、MCP、Agent、Permission、Multi-provider、Computer Use 与 Personal Steward 的名称或能力存在本身均不构成差异。Provider-neutral Reality、Governed Agency、Permission、Recovery 与 Connector 继续是必要架构边界，但不是单独购买理由。

未来功能统一执行同构检查：若将其加入 ChatGPT Project + Codex 后体验基本相同，则按 Foundation 实现、压薄或延后，不得作为 Differentiation Hypothesis。Phase 04 只证明 Explicit Lifecycle 的 `Capture → Inbox → Promote` 入口；完整 Lifecycle、Operational Work State、Lineage/Verification 与 DXE 仍需后续 Phase 实证。

路线编号不变，但 Alpha Gate 增加最低 DXE proof。Phase 10 必须以 bounded、deterministic、fixed-primitive Runtime 证明 Research → Development → Reverify 的状态驱动工作面转换；Requirement revision 还必须使旧 Result 失效、阻止 Completion、改变 Resume 并切换到 Reverify Surface。任意 Generative UI、自由布局或常驻多面板仍不进入 Alpha。

```text
COMPETITIVE_REBASE: ACCEPTED_AS_ROUTE_CONSTRAINT
PHASE_ORDER: UNCHANGED
PHASE_04_FROZEN_CONTRACT: UNCHANGED
PHASE_04_EXIT_STATUS: UNCHANGED
PHASE_05: NOT_AUTHORIZED
DXE_SURFACE_RUNTIME: NOT_IMPLEMENTED
```

## 51. Rapid Desktop Foundation Rebase

用户随后裁决此前设计和开发顺序存在根本问题：当前 Fielora Reality 与 Codex Project 在真实产品体验上没有成立区别；DXE 与 Aegis 也尚未具备直接作用于现有 Fielora 的运行基础。继续先扩充 Reality/Verification/DXE/Aegis 定义只会增加文档和空抽象，不会更快形成可用产品。

当前开发顺序正式改为：

```text
Codex-like multi-provider desktop
  → stable long-task runtime
  → Aegis governance
  → DXE state-driven surfaces
  → Personal Steward
```

第一目标不是差异化，而是一个可日常使用的桌面工作闭环：在 Settings 自由配置 OpenAI-compatible / Anthropic-compatible Provider、Base URL、API Key 与 Model ID；打开本地 Project；建立多个持久 Conversation；让模型读取和修改项目；review diff；运行 Terminal/test；重启后回到同一 Project/Conversation 继续。

近期用户侧采用普通 `Project` 概念。现有 Field storage 作为 compatibility layer 保留，避免无价值重写；但不得再宣传 Field/Reality 已与 Codex Project 不同，也不新增 Reality Graph。Conversation、Project、Folder、Task、File、Diff、Terminal 与 Provider 成为近期一级对象。

旧 Phase 04→10 Remap 保留为历史资料，不再控制执行顺序。Phase 01–04 代码、Migration 与 Evidence 不回滚；Phase 04 Provider/WinCred/streaming 直接成为 Desktop Foundation 基础。Phase 04 尚未关闭的 Human、real-provider 与 Clipboard Gate 继续作为历史质量事实保留，但不再阻断新的基础产品开发。

开发流程同步收缩：取消每个 Agent 的 57 文件全读与新 Reading Report；普通可逆 UI/功能直接以纵向切片实现、测试和人工体验。只有 Schema/Migration、credential、安全边界、破坏性执行或不可回滚架构变化要求短 Change Impact。不得再为每个小 Slice 制作 Product/Contract/Migration/Implementation/Test/Cross-review 六件套。

```text
CURRENT_BUILD_DIRECTION: CODEX_LIKE_MULTI_PROVIDER_DESKTOP
OLD_PHASE_04_TO_10_EXECUTION_ORDER: SUPERSEDED
REALITY_DIFFERENTIATION: DEFERRED
LEGACY_PHASE_04_EXIT_GATES: HISTORICAL_NON_BLOCKING
AEGIS_IN_PRODUCT: NOT_IMPLEMENTED
DXE_SURFACE_RUNTIME: NOT_IMPLEMENTED
PERSONAL_STEWARD: NOT_IMPLEMENTED
```

## 52. Codex-like Multi-provider Desktop Foundation Implementation

用户要求连续完成 Codex-like 多模型 Windows 桌面的代码、自动测试、打包和人工验收清单。该 Desktop Foundation 已按 Build A+B 纵向闭环实现，不引入 Aegis、DXE、Personal Steward、LSP、PTY 或新的 Reality Graph。

Migration 0005 将 canonical schema 推进到 5，新增 Project 下的持久 `conversations` 与 `conversation_messages`。近期 Project UI 复用既有 Field stable identity，Windows absolute root 仍只存为 `PROJECT_ROOT` device binding；Conversation 持久保存 provider/model selection、用户/助手消息和 invocation provenance。打开顺序按最近 Conversation 活动恢复，因此真实关闭重启后可回到最近 Project/Conversation。

桌面默认工作面现为 Projects：本地文件夹 Project 列表、多个 Conversation 的新建/切换/重命名/归档、Provider/Model 选择、provider-neutral streaming/stop、选中文件 Context、Files/Review Diff/accept/optimistic-hash undo，以及 PowerShell-backed bounded Terminal/test/cancel。Terminal 结果作为本地运行消息回到当前 Conversation；模型 `fielora-file` replacement 只能形成待 Review Diff，不能自授写盘权限。

Electron Main 的 workspace adapter 对 root/relative path 做 realpath containment，拒绝 path traversal 与 symlink escape；文本读取限 UTF-8/1 MiB，列表有数量/深度/忽略目录上限；写入要求 review 时的 SHA-256，并使用同目录临时文件替换；Terminal 只由用户显式运行，输出限 512 KiB，可取消进程树。Remote Browse WebContents 没有获得该 bridge。

自动验证已通过完整 `pnpm verify:premerge`（TypeScript typecheck/lint/36 tests、30 项 Rust tests、clippy、6 项 Core integration、Phase 02 Field、Phase 03 Browse 与 Desktop Foundation dev E2E），以及最终 release package 上的 Browse、Desktop Foundation 与 single-instance lifecycle packaged E2E。Hero Flow 实际创建 Project/Conversation、运行 fixture streaming、读改文件、Review/accept/undo、运行 Terminal、把结果写回 Conversation、关闭重启并恢复，同时对消息列与工具列边界做 DOM geometry 断言。打包版 `Fielora.exe` 和 ZIP 已生成；下述 lifecycle correction 后的最新 ZIP SHA-256 为 `6bf92b0d9389f802a20dcbb90e669f10d1c325927b115deee722d2e6bdea2472`。

本轮 fixture `provider_external_requests=0`，因此没有把自动测试写成真实 Provider Acceptance。人工验收清单已生成但尚未由用户裁决；existing Phase 04 real-provider/Human/Clipboard debt 也未被改写。

```text
DESKTOP_FOUNDATION_BUILD_A_B: IMPLEMENTED
DESKTOP_FOUNDATION_PREMERGE_GATE: PASS
DESKTOP_FOUNDATION_DEV_E2E: PASS
DESKTOP_FOUNDATION_PACKAGED_E2E: PASS
DESKTOP_FOUNDATION_WINDOWS_ZIP: BUILT
DESKTOP_FOUNDATION_REAL_PROVIDER_ACCEPTANCE: NOT_RUN
DESKTOP_FOUNDATION_HUMAN_ACCEPTANCE: READY_NOT_RUN
SCHEMA_VERSION: 5
```

## 53. Desktop Foundation Unified Work Shell Correction

用户对首版 Desktop Foundation 进行真实 Codex 对照后，明确指出其左侧“全局导航 + Project/Conversation”双栏与右侧永久深色 Files/Diff/Terminal 面板差距过大，暖灰/白/黑三块并列导致界面割裂。该反馈视为首版工作壳的 Human Experience failure，不影响已通过的持久化、Provider、文件、Terminal 或安全 Contract。

Projects 工作面已收敛成一根统一左栏：品牌、主要功能、Project、Conversation 与模型设置处在同一导航树。Conversation 默认占据全部剩余主区；Files、Review 与 Terminal 改为 Conversation 顶栏触发的可折叠右工作区，打开后保持同一白/冷灰界面层级，只有 Terminal 输出画布使用深色。关闭工作区恢复完整聊天宽度。由于 Projects 已经是 AI 主工作面，全局 Summon 浮钮在该页面隐藏，避免重复 Composer；Browse 等页面行为不变。

Desktop Foundation E2E 新增统一左栏唯一性、默认无右面板、Composer 位于 Conversation 边界内、右工作区展开边界及关闭恢复断言，并分别生成 chat-only 与 workspace-open 截图。完整 `pnpm verify:premerge`、最终 release 上的 packaged Browse E2E 与 packaged Desktop Foundation E2E 均 PASS。该自动与视觉 QA 不替代用户对修正版的 Human Re-Gate。

```text
DESKTOP_FOUNDATION_UNIFIED_LEFT_NAV: IMPLEMENTED
DESKTOP_FOUNDATION_CONVERSATION_FIRST: IMPLEMENTED
DESKTOP_FOUNDATION_COLLAPSIBLE_WORKSPACE: IMPLEMENTED
DESKTOP_FOUNDATION_PROJECT_SUMMON_DUPLICATION: REMOVED
DESKTOP_FOUNDATION_UX_CORRECTION_PREMERGE: PASS
DESKTOP_FOUNDATION_UX_CORRECTION_PACKAGED_E2E: PASS
DESKTOP_FOUNDATION_UX_CORRECTION_HUMAN_REGATE: READY_NOT_RUN
```

## 54. Packaged Single-instance Destroyed Window Correction

用户点击的是历史 `artifacts/phase04/Fielora.exe`，错误堆栈明确来自 `artifacts/phase04/resources/app.asar/.webpack/main/index.js:1:36607`。对该历史 asar 进行只读定位后，36607 精确落在旧 `second-instance` 回调的 `BrowserWindow.restore()`：旧进程在窗口对象已经销毁、退出尚未完全结束时仍保留非空引用，再次点击 EXE 会由第二实例触发该回调并抛出 `TypeError: Object has been destroyed`。

当前 Main 已使用独立 lifecycle helper 同时检查 `BrowserWindow.isDestroyed()` 与 `webContents.isDestroyed()`，且 native focus/send 调用包裹销毁竞态；窗口 `close` 时立即清空全局引用并在 native window 销毁前释放 BrowserRuntime。Workspace、Browser 与 Core notification 的 Main→Renderer send 全部通过同一 live-window guard。修复不改变 schema、Provider、workspace permission 或 Browser security Contract。

新增 3 项 lifecycle 单测，覆盖 destroyed window、destroyed webContents 与 check-after-invalidation race。完整 PreMerge、最终 release packaged Browse/Desktop Foundation E2E 及真实双启动 packaged single-instance smoke 均 PASS：第二实例正常退出、第一实例保持存活、输出中没有 destroyed-window/JavaScript error。历史 Phase 04 Artifact 为 Evidence，未覆盖或删除；当前会话仍有该旧包进程运行，因此用户复验新包前必须先从任务管理器退出旧 `artifacts\phase04\Fielora.exe` 一次。

```text
DESKTOP_FOUNDATION_DESTROYED_WINDOW_GUARD: IMPLEMENTED
DESKTOP_FOUNDATION_SINGLE_INSTANCE_UNIT: PASS
DESKTOP_FOUNDATION_SINGLE_INSTANCE_PACKAGED_E2E: PASS
HISTORICAL_PHASE04_PACKAGE: SUPERSEDED_DO_NOT_USE
DESKTOP_FOUNDATION_LIFECYCLE_HUMAN_REGATE: READY_NOT_RUN
```

## 55. Historical Runtime Profile Upgrade Collision Correction

用户随后明确从本轮 `apps/desktop/out/desktop-foundation` unpacked 路径和 ZIP 解压内容启动，但错误堆栈仍指向 `artifacts/phase04/resources/app.asar`。进程核对证明历史 Phase 04 主进程 PID 23244 及其 Chromium 子进程仍驻留，并占用 Electron 默认 `@fielora/desktop` profile 的单实例锁；因此新版代码根本没有进入 Main，而是启动请求先被旧进程截获。上一轮 single-instance smoke 使用隔离 `--user-data-dir`，只能证明同代生命周期修复，未覆盖旧代 profile 已锁定的真实升级场景。

Desktop Foundation 现于申请单实例锁前使用独立稳定 Electron runtime profile `@fielora/desktop-foundation`，显式 `--user-data-dir` 仍保留给隔离测试。该路径只承载 Chromium/Electron runtime state；Fielora Core 数据库继续位于既有 `LOCALAPPDATA/Fielora/data`，Project、Conversation、Provider 配置与 schema 5 均不迁移或重建。新增 runtime identity 单测与 packaged upgrade-collision E2E：先锁定历史 profile，再证明当前包仍能启动，随后证明第二个当前包回到当前窗口且无 destroyed-window error。

完整 `pnpm verify:premerge` 以 38 项 TypeScript、30 项 Rust 与 6 项 Core integration PASS；最终 release packaged Browse、Desktop Foundation、upgrade-collision/single-instance E2E 均 PASS。真实桌面 smoke 保持历史 PID 23244 运行，成功启动当前包 PID 30232，并从子进程确认其 profile 为 `@fielora\desktop-foundation`；随后又将最终 ZIP 解压到全新目录并从该目录成功启动 PID 9540。两轮验证后都只结束本次启动的当前包进程，历史进程未被修改。最新 ZIP SHA-256 为 `92c4fd52edee05f8c4a827adac82f25cd3a7590d77d25b94f3b858db33b0b177`。

```text
DESKTOP_FOUNDATION_RUNTIME_PROFILE: @fielora/desktop-foundation
HISTORICAL_PROFILE_LOCK_INTERCEPTION: ELIMINATED
PACKAGED_UPGRADE_COLLISION_E2E: PASS
REAL_HISTORICAL_PROCESS_COLLISION_SMOKE: PASS
FRESH_ZIP_EXTRACTION_WITH_HISTORICAL_PROCESS: PASS
CORE_DATA_PATH_AND_SCHEMA: UNCHANGED
DESKTOP_FOUNDATION_UPGRADE_COLLISION_HUMAN_REGATE: READY_NOT_RUN
```

## 56. Shared Application Navigation and Functional Settings Correction

用户在真实新版中继续确认 Human Re-Gate 失败：Projects 使用新工作壳，但 Now、Browse、Fields 与 Inbox 仍切回旧版 FIELORA 侧栏，形成明显的跨页面割裂；无 Project 时“新对话”错误直接调用系统文件夹选择器；Project 空列表仍放置大号选择文件夹卡片；底部“模型与服务”不是 Codex-like 的应用设置入口。该问题属于可逆 UI/interaction correction，不修改 schema 5、Project/Conversation 持久化、Provider credential、Browser security 或 workspace permission。

当前 Projects、Now、Browse、Fields 与 Inbox 已复用同一个 `PrimaryNav`：品牌、有效的一级功能、Project/Conversation 区和底部设置保持同一布局与 active-state。未实现的 Pull Request/Sites/Scheduled/Plugins 没有被伪装成装饰按钮；现有按钮都连接已存在的产品行为。Project 空列表缩为“还没有项目”一行；无 Project 点击“新对话”先进入明确的对话起始页，不触发 native dialog，只有用户再次点击“选择 Project 文件夹”才创建 Project 与第一条 Conversation。

新增独立 Settings 工作面：返回应用、搜索、常规启动页、模型与服务、外观密度、减少动态效果、键盘快捷键与关于均有确定行为；Provider 管理复用既有 credential-safe setup flow。纯 UI preferences 只持久在 trusted renderer 的 localStorage，不进入 Core truth。Browse 在常规窗口保持完整共享侧栏，在 900px 窄窗压缩到 112 CSS px，以继续满足真实 Web viewport/100% zoom 回归。

完整 `pnpm verify:premerge` 以 40 项 TypeScript、30 项 Rust、6 项 Core integration，以及 Phase 02、Phase 03 Browse、Desktop Foundation dev E2E 全部 PASS。最终 release unpacked 上的 packaged Browse、Desktop Foundation 与 single-instance E2E PASS；同一 ZIP 解压到全新 `%TEMP%` 目录后 Desktop Foundation 与 single-instance E2E 再次 PASS，且历史 Phase 04 PID 23244 保持运行。最新 ZIP SHA-256 为 `4f16d66d5401d5d85acabd23a37c592d5dead33b3597d67836040e463f9cc077`。自动与截图 QA 不替代用户 Human Re-Gate。

```text
DESKTOP_FOUNDATION_SHARED_PRIMARY_NAV: IMPLEMENTED
DESKTOP_FOUNDATION_NEW_CONVERSATION_NATIVE_DIALOG_REGRESSION: FIXED
DESKTOP_FOUNDATION_COMPACT_PROJECT_EMPTY_STATE: IMPLEMENTED
DESKTOP_FOUNDATION_FUNCTIONAL_SETTINGS: IMPLEMENTED
DESKTOP_FOUNDATION_UI_REGATE_PREMERGE: PASS
DESKTOP_FOUNDATION_UI_REGATE_PACKAGED_E2E: PASS
DESKTOP_FOUNDATION_UI_REGATE_FRESH_ZIP_E2E: PASS
DESKTOP_FOUNDATION_UI_REGATE_HUMAN_ACCEPTANCE: READY_NOT_RUN
```

## 57. Integrated Desktop Chrome and Functional Utility Launcher

用户第三次 Human Re-Gate 明确指出：左栏底部设置仍显示近似太阳的错误图标；Windows 顶部缺少 Codex-like 的侧栏、前进/后退与文件/编辑/视图/帮助；右侧缺少审阅、终端、浏览器、文件和侧边聊天的工具页。该反馈继续限定为 Desktop shell 与已存在能力的可逆编排，不改变 schema、Provider、credential、Browser security 或 workspace permission。

Desktop 现使用 Electron `titleBarStyle:hidden` + Windows `titleBarOverlay`，将 native window controls 与 trusted renderer 顶栏整合。顶栏提供可用的侧栏切换、应用访问历史前进/后退、文件/编辑/视图/帮助菜单、专注布局与右侧工具启动器；原生英文菜单已移除。应用历史更新移出 React state updater，避免 StrictMode 双执行产生重复路由。设置使用标准 cog path，模型服务另用 processor icon。

右侧工具启动器连接既有实际产品面：Review/Files/Terminal 通过 request state 回到最近 Project/Conversation 并打开对应 workspace tab；Browse 进入真实 Browser Runtime；Side Chat 打开既有 Summon。无 Project 或无 Conversation 时 request 被消费并显示明确前置条件，不隐式创建对象或静默失败。对应 `Ctrl+Shift+G`、Ctrl + 反引号、`Ctrl+T`、`Ctrl+P`、`Ctrl+Alt+S`，以及 `Ctrl+N/O/B/,` 已进入真实 handler 与 Settings 快捷键页。

Typecheck、lint、40 项 TypeScript、完整 PreMerge、dev/packaged Browse 与 Desktop Foundation E2E PASS。E2E 实际点击应用前进/后退、显示/隐藏侧栏、应用菜单及五项工具入口，并生成 utility launcher screenshot。release ZIP 又在全新 `%TEMP%` 目录执行 Desktop Foundation 与显式 historical/current profile single-instance E2E 并 PASS。用户当时仍打开上一版 `out/desktop-foundation/Fielora.exe`，Windows 锁定旧输出且同代 profile 会把普通新启动交给旧窗口；因此本包未强制结束用户进程，而是交付到 `out/desktop-foundation-chrome`。最新 ZIP SHA-256 为 `5cc24c6c9a3ed264eb964b096064b9912ffd3eddbfccff9434ad0211820df7db`，复验前必须先关闭上一版 Desktop Foundation 窗口。

```text
DESKTOP_FOUNDATION_INTEGRATED_WINDOWS_CHROME: IMPLEMENTED
DESKTOP_FOUNDATION_APPLICATION_HISTORY: IMPLEMENTED
DESKTOP_FOUNDATION_FUNCTIONAL_TOP_MENUS: IMPLEMENTED
DESKTOP_FOUNDATION_STANDARD_SETTINGS_GEAR: IMPLEMENTED
DESKTOP_FOUNDATION_RIGHT_UTILITY_LAUNCHER: IMPLEMENTED
DESKTOP_FOUNDATION_FIVE_UTILITY_ACTIONS: VERIFIED
DESKTOP_FOUNDATION_CHROME_PACKAGED_E2E: PASS
DESKTOP_FOUNDATION_CHROME_FRESH_ZIP_E2E: PASS
DESKTOP_FOUNDATION_CHROME_HUMAN_REGATE: READY_NOT_RUN
```

## 58. Split Utility Workspace and Direct Terminal Correction

用户第四次 Human Re-Gate 明确指出：右侧工具启动器虽然已有真实动作，但展开位置和行为仍与 Codex 不同——它作为 fixed 浮层覆盖了中间 Conversation，而不是占据布局并把内容向左推；同时顶栏缺少可直接进入 Terminal 的独立按钮。该反馈继续限定为可逆 Desktop shell correction，不改变 schema 5、Project/Conversation、workspace permission、Provider credential 或 Browser security。

Desktop work area 现由单列/双列 grid 切换：工具关闭时主内容独占宽度，打开时右侧工具页成为同级 grid column，左边缘与 `.desktop-content` 右边缘严格衔接，右边缘固定在 work area 边界，不使用 fixed/absolute overlay。展开状态下 Project navigation 收窄到 160 CSS px，使 Conversation 在自动测试窗口仍保持至少 340 CSS px 可读宽度。顶栏新增 Terminal 控件，复用既有 request routing，打开当前 Project/Conversation 的真实 terminal workspace；缺少前置对象时仍返回 Projects 和明确提示。

Desktop Foundation E2E 新增 layout geometry 硬断言：launcher 不是 fixed、content/launcher 无重叠、launcher 对齐右边界、content width 实际缩小、导航宽度和 Conversation 最小可读宽度达标；同时点击顶栏 Terminal，运行真实 Node 命令、核对输出并确认结果进入 Conversation。完整 `pnpm verify:premerge` 以 40 TS、30 Rust、6 Core integration 及三组 desktop E2E PASS。release unpacked 与全新 ZIP 解压目录中的 Desktop Foundation、Browse、historical/current profile single-instance 均 PASS；packaged Browse 首次遇到既有 Windows Clipboard 争用，未放宽断言，原样重跑后 PASS。最新 ZIP SHA-256 为 `a02d1345b5b9bb90d715c23a65b6429c7b853bacb502a4a99dc71c5a5311d861`。

```text
DESKTOP_FOUNDATION_UTILITY_LAYOUT: SPLIT_COLUMN_NOT_OVERLAY
DESKTOP_FOUNDATION_UTILITY_PUSH_GEOMETRY: VERIFIED
DESKTOP_FOUNDATION_UTILITY_CONVERSATION_READABILITY: VERIFIED
DESKTOP_FOUNDATION_TOP_TERMINAL: FUNCTIONAL
DESKTOP_FOUNDATION_SPLIT_PREMERGE: PASS
DESKTOP_FOUNDATION_SPLIT_PACKAGED_E2E: PASS
DESKTOP_FOUNDATION_SPLIT_FRESH_ZIP_E2E: PASS
DESKTOP_FOUNDATION_SPLIT_HUMAN_REGATE: READY_NOT_RUN
```

## 59. Transparent Brand and Functional Composer Inputs

用户随后提供无背景 `fielora-mark-transparent.svg`，并要求 Conversation Composer 支持多文件上传、可选择的真实权限、已配置模型选择、更协调的发送按钮，以及可用时增加语音对话。该变更涉及附件进入 Provider Context 与权限行为，因此先形成 bounded Change Impact；不新增 Schema/Migration，也不扩展 workspace 或 remote Browser security boundary。

持久品牌标志已与用户 SVG 精确一致，Windows ICO 由仓库脚本在透明 Chromium 画布中生成 16/24/32/48/64/128/256 px PNG frame，并以真实 alpha 像素验证背景透明。Composer 的 `+` 连接 trusted Main 系统多文件选择器：每次最多 4 个、单文件最多 1 MiB，仅严格 UTF-8 文本/代码/JSON/CSV/日志进入既有 bounded ModelInvocation Context；消息只保存文件名，绝对路径、附件原文和二进制不持久化。图片、PDF、Office、压缩包及其他不受当前纯文本通道支持的文件明确标注 unsupported，不伪装已发送。

权限只提供 Runtime 当前能兑现的 `只读` 与 `审阅后修改`：只读模式不会把模型 replacement 变成 Review Draft；审阅后修改仍必须人工接受才写盘。模型选择合并为已配置 Provider 的默认 Model，下拉项缺少凭据时不可发送。语音使用 Chromium/System SpeechRecognition，将 interim/final transcript 放入受控 Composer，用户编辑并确认后才发送；不自动提交，不可用或拒绝权限时显示稳定提示。发送键改为黑色圆形上箭头，调用中切换为真实 stop。

42 项 TypeScript、30 项 Rust、6 项 Core integration，以及 Desktop Foundation dev、release packaged、全新 ZIP 解压与 packaged/fresh single-instance E2E PASS。完整 `pnpm verify:premerge` 在完成 context/contracts/typecheck/lint/unit/clippy/integration/Phase 02 后，和 dev/packaged/fresh Browse targeted 回归一样停在既有 Windows 原生 Ctrl+C/Ctrl+V 硬断言；断言未跳过或放宽。最新 ZIP SHA-256 为 `99cb0b82d6959726ae0f0c149ecb2e2f0540bf1878cc7181e4699e18fc4e89f5`，fixture external requests 为 0，Human Acceptance 与真实 Provider 仍为 NOT_RUN。

```text
DESKTOP_FOUNDATION_TRANSPARENT_BRAND_ICON: IMPLEMENTED_AND_ALPHA_VERIFIED
DESKTOP_FOUNDATION_TRUSTED_ATTACHMENT_PICKER: IMPLEMENTED
DESKTOP_FOUNDATION_BINARY_ATTACHMENT_SUPPORT: EXPLICITLY_UNSUPPORTED_IN_TEXT_CHANNEL
DESKTOP_FOUNDATION_PERMISSION_PRESETS: READ_ONLY_AND_REVIEW_CHANGES_FUNCTIONAL
DESKTOP_FOUNDATION_CONFIGURED_MODEL_PICKER: IMPLEMENTED
DESKTOP_FOUNDATION_SPEECH_TO_COMPOSER: IMPLEMENTED_WITH_CONFIRM_BEFORE_SEND
DESKTOP_FOUNDATION_COMPOSER_DEV_PACKAGED_FRESH_E2E: PASS
DESKTOP_FOUNDATION_BROWSER_CLIPBOARD_GATE: ENVIRONMENT_BLOCKED_NOT_WAIVED
DESKTOP_FOUNDATION_COMPOSER_HUMAN_ACCEPTANCE: READY_NOT_RUN
```

## 60. Resizable Right Utility Sidebar and Browser Placement Correction

用户第五次 Human Re-Gate 指出工作区仍不能随窗口自适应，Composer 下拉菜单位置错误，各区域不可拖动；设置页不应与右侧工具区同时出现，Browser 只能位于右侧边栏，顶栏右侧的专注、Terminal 与工具按钮也应归入该边栏。该轮继续属于可逆 Desktop shell correction，不改变 schema 5、Provider wire、credential、Project/Conversation 或 remote Browser security boundary。

Desktop work area 现在使用中央内容、可拖动分隔条、右侧 utility panel 和 48 px control rail 的真实 grid。Browser 不再作为中央一级页面挂载，只能由右侧 Browser action 打开；设置页进入时主动关闭 utility panel，并隐藏 utility divider 与 control rail。Project navigation、Settings navigation、Conversation workspace 和 utility panel 四处边界都支持 Pointer 与键盘调整，持久化宽度并保留中央区域最小可读宽度。Composer 的 permission/model popover 改为向上展开、宽度受 Composer 约束，并在窄窗口保持视口内。

Electron `WebContentsView` 在只拖动自定义分隔条时曾出现 native bounds 已改变、网页 `innerWidth` 仍停留旧值的 Windows 运行时问题。BrowserRuntime 现在只对已加载且处于 active/visible 的 Page，在真实 bounds 尺寸变化后使用 Electron desktop device emulation 同步 `screenSize`/`viewSize`；初始空 Page 不启用，避免干扰首次导航。E2E 新增 divider drag 后 native bounds 与 remote `innerWidth`/`innerHeight` 必须相等的硬断言，并继续核对 DPR、Clipboard、context menu 与 security boundary。

42 项 TypeScript、30 项 Rust、6 项 Core integration、完整 `pnpm verify:premerge`，以及 Desktop Foundation、Browse、single-instance 在 dev、release unpacked 和全新 ZIP 解压目录全部 PASS。本轮原生 Ctrl+C/Ctrl+V 硬断言也通过。最新 ZIP SHA-256 为 `ccf74f76458d08d8743ea21f7491d8ba860737dcd8aa03f115e6b2b7dba74279`；fixture external requests 为 0，Human Acceptance 与真实 Provider 仍为 NOT_RUN。

当前产品具备 Project、persistent Conversation、Provider/Model、文件 Review、Terminal、Browser 与权限输入等 Agent 基础设施，但没有 autonomous execution loop：尚无模型驱动的 plan/tool dispatch、连续文件修改、测试、失败重试、长任务状态机与恢复编排。因此不得把 Desktop Foundation 宣称为完整 Agent。

```text
DESKTOP_FOUNDATION_BROWSER_PLACEMENT: RIGHT_UTILITY_ONLY
DESKTOP_FOUNDATION_SETTINGS_UTILITY_EXCLUSION: VERIFIED
DESKTOP_FOUNDATION_RESIZABLE_DIVIDERS: FOUR_BOUNDARIES_VERIFIED
DESKTOP_FOUNDATION_REMOTE_VIEWPORT_AFTER_DIVIDER_DRAG: VERIFIED
DESKTOP_FOUNDATION_PREMERGE_PACKAGED_FRESH: PASS
DESKTOP_FOUNDATION_AGENT_RUNTIME: NOT_IMPLEMENTED
DESKTOP_FOUNDATION_LAYOUT_HUMAN_REGATE: READY_NOT_RUN
```

## 61. Complete Agent Program Authorization and Integrated Contract

用户于 2026-08-18 授权一次性完成 Fielora Complete Agent Program 的设计、实现、自动测试、打包与人工验收准备，并授权实现侧自主解决旧路线、Contract 与执行范围冲突。当前工作在本地 `phase/complete-agent-v0.1` 分支连续推进，不授权 push、merge main、真实凭据提取、无界付费 Provider probe 或破坏性 Git。

集成裁决以可用 Agent 为近期主线：`Project → Conversation → AgentRun`；Field identity 继续作为 Project compatibility，不额外制造 Thread/Project。append-only persistence 被严格限定为 Agent Execution Ledger，不替代全产品状态，也不把 Fielora 改造成 Full Event Sourcing/Workflow Engine。Reality Admission 只保留为可选受治理出口，不阻断核心 coding loop；Aegis/DXE 名称和 UI 仍按既有顺序延后，但本 Program 实现真实 Policy、Approval、Verification 与 Recovery 基础。

首次 repo audit 证明 Desktop Foundation 具备 Provider/Model、Conversation、文件 Review、Terminal 与 Browser，但 Agent Runtime 仍为 `NOT_IMPLEMENTED`。fresh baseline 的静态、42 TS、30 Rust 与 6 Core integration 通过，Phase 02 Desktop E2E 因 CDP command 没有硬超时出现无限等待；现已增加 WebSocket/CDP/fetch deadline，针对性 dev E2E PASS。既有 51 tracked/63 untracked 工作已在 Agent 分支固定为 `009507a` checkpoint，未清理用户工作。

```text
COMPLETE_AGENT_PROGRAM: AUTHORIZED
COMPLETE_AGENT_INTEGRATED_CONTRACT: ESTABLISHED
COMPLETE_AGENT_PROJECT_CONVERSATION_RUN_RELATION: FROZEN
COMPLETE_AGENT_LEDGER_SCOPE: AGENT_EXECUTION_ONLY
COMPLETE_AGENT_SCHEMA_TARGET: 6
COMPLETE_AGENT_IMPLEMENTATION: IN_PROGRESS
LIVE_PROVIDER_PROBE: NOT_RUN
```

## 62. Complete Agent V0.1 Implemented Engineering Reality

Complete Agent V0.1 has now moved from Foundation-only to a real Core-owned autonomous execution loop. Schema 6 persists AgentRun, append-only typed events, tool calls, one-time approvals, bounded context snapshots, and verification receipts. The provider-neutral loop accepts native tools from OpenAI Responses, Anthropic Messages, and OpenAI-compatible adapters; fragmented arguments never execute before complete JSON exists. Renderer remains a client rather than execution truth.

The Coding profile now compiles bounded repository and Conversation context, excludes common secret paths/content, and offers controlled list/read/search/stat/git/skill/capability tools, hash-guarded create/write/exact-replace/move/delete/restore, typed argv command execution, and bounded read-only child AgentRuns. Writes create checkpoints and invalidate any earlier verification; completion after a mutation requires a later successful process receipt. Windows commands run under a sanitized environment and Job Object so stop/timeout terminates the process tree. Startup converts incomplete tools to UNKNOWN and active runs to PAUSED without replay.

Desktop Composer now creates AgentRuns with read-only, review, or full-control policy presets. Conversation renders status, step, model, tools/events, exact approval summaries, allow/deny, stop/resume and persisted completion across restart. The same Agent hero flow passes dev, packaged and fresh-extracted portable E2E; packaged single-instance lifecycle also passes. Windows x64 ZIP SHA-256 is `fdd15124ee89103e10b60c974352677e1ce2be3692c9fd94171a11e36cc4acea`.

The program does not claim leading model quality. Live-provider evaluation was not run because no eligible credential/model was explicitly authorized. Golden model-dependent bug-fix/feature/replay tasks, semantic compaction-and-continue, and proposal-only fallback for models without native tools remain non-passing. Web research, Archive, DOCX/PDF, XLSX/chart, PPTX, and image adapters return an honest unsupported boundary rather than fake completion. Full `pnpm verify:premerge` is also not green: every earlier gate passed, then the historic Chromium Ctrl+C/Ctrl+V native clipboard check repeatedly failed in the current Windows session and was not weakened.

```text
COMPLETE_AGENT_SCHEMA_6: IMPLEMENTED
COMPLETE_AGENT_CORE_LOOP: IMPLEMENTED_AND_INTEGRATION_VERIFIED
COMPLETE_AGENT_CODING_TOOLS_POLICY_RECOVERY: IMPLEMENTED
COMPLETE_AGENT_BOUNDED_READONLY_SUBAGENT: IMPLEMENTED
COMPLETE_AGENT_DESKTOP_DEV_PACKAGED_PORTABLE: PASS
COMPLETE_AGENT_LIVE_PROVIDER_QUALITY: NOT_RUN
COMPLETE_AGENT_GOLDEN_MODEL_QUALITY: NOT_PASS
COMPLETE_AGENT_PREMERGE: FAIL_BROWSER_NATIVE_CLIPBOARD
FIELORA_COMPLETE_AGENT_V0.1_ENGINEERING_PASS: NOT_ASSERTED
COMPLETE_AGENT_HUMAN_ACCEPTANCE: READY_NOT_RUN
```

## 63. Codex-like Desktop Cohesion Remediation and Saved-provider Probe

用户在 Complete Agent 包上继续指出可见桌面问题：Composer 仍有文字箭头和不一致字号，Terminal 错放右侧且强制深色，右侧控制轨永久占宽，三栏窄化时标题重叠，重命名无效、删除与设置仍出现 Windows 原生控件，Provider 保存后状态不刷新，长 Conversation 缺少快速定位。该轮是可逆 Desktop/UI + bounded Git environment capability，不改变 schema 6、credential storage、Agent policy 或 Browser security boundary。

桌面关闭 utility 时现在只有导航 + 单一工作区，右上控制组作为紧凑浮动组存在；打开 utility 时同一组进入 44px 右轨。Files/Review 仍为可拖动右 Project workspace，Terminal 改为 Conversation 底部可拖动 dock 并跟随系统明暗主题。容器查询在中间区窄化时把工具栏收成图标，标题单行省略；四类分隔线使用 requestAnimationFrame 节流并在鼠标释放后恢复中性样式。Browser utility 不再执行会与原生 WebContentsView 脱节的 translate 动画，只做透明度过渡，targeted Phase 03 完整 E2E 再次 PASS。

Renderer 中 `window.prompt/confirm/alert` 和原生 `<select>` 已清零并增加静态测试；重命名/删除连接真实 Conversation update/archive，自定义 Select/Dialog 统一 Provider、设置、Field 与 Composer。Provider 保存/删除通过显式事件立即刷新 Settings/Composer；Settings 增加直接连接测试与稳定中文错误映射，凭据存在只显示“凭据已保存 · 未测试”，不再假称联网就绪。Project header 新增 bounded Git 环境摘要和真实 status/branch/diff actions；多于 5 条消息时显示点状导航、悬停摘要和点击跳转。Desktop Foundation dev、release packaged、fresh ZIP portable 全部 PASS，TypeScript 为 46/46，ZIP SHA-256 为 `dedce72b075d56f77dd5a9d81bda74f9f25e7f80850903628b0f695751b86c61`。

用户授权的 saved-provider 最小真实 probe 已运行，脚本只通过 Core/WinCred 发起 bounded `provider.probe`，不读取或打印 credential、prompt/response body。当前唯一 active record 为 `provider_kind=OPENAI`、`model_id=Qwen3.7-plus`、无 custom Base URL，结果为 redacted `PROVIDER_UNAVAILABLE`。这证明旧 UI 的“已配置/已就绪”只代表凭据存在，不能代表联网成功；该记录必须改为与实际服务匹配的协议和 HTTPS Base URL 后重新 probe，不能据此声明 live coding quality。

```text
DESKTOP_COHESION_REMEDIATION: IMPLEMENTED
DESKTOP_NATIVE_PROMPT_SELECT_COUNT: ZERO_VERIFIED
DESKTOP_BOTTOM_TERMINAL_SYSTEM_THEME: VERIFIED
DESKTOP_RESPONSIVE_SPLITS_AND_MESSAGE_NAVIGATION: VERIFIED
DESKTOP_PROVIDER_STATE_REFRESH_AND_PROBE_UI: VERIFIED
DESKTOP_DEV_PACKAGED_FRESH_ZIP: PASS
SAVED_PROVIDER_PROBE: FAIL_PROVIDER_UNAVAILABLE
LIVE_AGENT_MODEL_QUALITY: NOT_ESTABLISHED
DESKTOP_HUMAN_REGATE: READY_NOT_RUN
```

## 64. Unified Three-surface Shell and Motion Remediation

用户继续指出导航/右栏分隔线过重、工作区圆角不足、Conversation 菜单位置与关闭行为错误、Terminal 只覆盖中间列、utility 控制重复、可见横向区域超过三块、设置与工作壳割裂、滚动条生硬，以及手动“减少动画”设置没有产品价值。该轮继续是可逆桌面表现层修正，不改变 schema 6、Agent runtime、Provider/Credential 或 Browser security boundary。

当前壳层严格收敛为左侧导航、主工作区、可选右侧工具三块；Files/Review 与 Browser utility 互斥，不能同时制造第四列。右上控制组只有一个 DOM 实例：utility 关闭时位于主区右上，打开时落在右栏 header 内。Terminal 通过 desktop-level portal 位于整个主区与右工具区下方，左边界从 Project 导航之后开始，并保持可拖动高度和 system theme。Conversation 的受控三点菜单移到标题后，点击外部或 Escape 会关闭；设置使用与工作区相同的白色圆角 Surface、字号与导航节奏。

视觉层使用低对比分隔线、柔和 trusted-scrollbar、grid row/column transition、popover/dialog/surface transition，并由 `prefers-reduced-motion` 自动服从系统辅助功能。专门的“外观/减少动画/密度”产品设置已移除；旧持久值只为兼容读取，不再覆盖统一产品视觉。Desktop Foundation dev、release packaged、fresh ZIP portable 与 Phase 03 Browser dev/packaged/fresh portable 全部 PASS；ZIP SHA-256 为 `5c393712c01f0980daaa48b953b20119ccbc5cdef869280caaf5a91ac1d6d6ba`。真实 Provider 仍保持 D-230 的配置阻塞事实，Human Re-Gate 尚未执行。

```text
DESKTOP_MAX_VISIBLE_SURFACES: THREE_VERIFIED
DESKTOP_SINGLE_MOVING_UTILITY_CONTROLS: VERIFIED
DESKTOP_TERMINAL_SPANS_MAIN_AND_UTILITY: VERIFIED
DESKTOP_SETTINGS_SHARED_SURFACE_LANGUAGE: VERIFIED
DESKTOP_SYSTEM_MOTION_AND_SOFT_SCROLLBARS: IMPLEMENTED
DESKTOP_DEV_PACKAGED_FRESH_PORTABLE_BROWSER: PASS
DESKTOP_HUMAN_REGATE: READY_NOT_RUN
```

## 65. Divider-free Desktop Chrome, Correct Focus Semantics and Windows Icon Fit

用户在统一三 Surface 壳层上继续逐图指出：Project 导航与顶栏仍有硬分割线，文件编辑/审阅内部横线过多；主导航与设置导航字体尺度不一致；透明 Windows 图标因 SVG 自带留白在任务栏中过小；Conversation header 仍重复放置 Files/Review；右上常驻 Browser 图标重复；“专注”错误隐藏左栏，而左上侧栏按钮与右栏开关缺少连贯过渡。该轮仍是可逆 Desktop presentation 修正，不改变 schema 6、Agent runtime、Provider/Credential、Workspace containment 或 Browser security boundary。

当前 Project 左边界与应用菜单下横线完全移除，拖拽热区仍保留但默认不可见。主区与右工具区只由一个 1 CSS px 低对比边界表达，面板阴影不再叠出双线；文件 header/footer、workspace header/tab 与 review 内部装饰线同步收敛。Project 与 Settings navigation 共享 `Segoe UI Variable/Segoe UI` 字体栈和 12px 导航尺度，白色工作 Surface 保持 20px 左上圆角。

右上控制组现在只有扩展右工具区、Terminal、右栏开关三个真实动作；Browser 只存在于右栏工具列表，Files/Review 也不再重复占用 Conversation header。“扩展右工具区”会保留左侧 Project 导航，并让右工具区占据中间与右侧；左上侧栏按钮才通过 220ms grid/opacity/transform 过渡收起导航。Terminal 仍从导航之后横跨主区和右区底部，不会覆盖左侧导航。

Windows ICO 生成器现在先计算透明渲染的实际 alpha bounds，再以约 5.5% 安全边距重新适配全部 16/24/32/48/64/128/256 frame；256px frame 的实际标志为 228×226px，打包后 EXE associated icon 已从真实二进制提取并视觉确认。完整 `pnpm verify:premerge` PASS：Context/Contracts、46 项 TypeScript、42 项 Rust、Clippy、8 项 Core integration、Phase 02、完整 Browse（含 native Clipboard）和 Desktop Foundation 全绿；Desktop Foundation 与 Browse 在 release packaged、全新 ZIP portable 也全部 PASS。最新 ZIP SHA-256 为 `0c10fbee6b6818dc8289437a287c7ffc2e4097cba539bf2a8d3e3b3e33b16147`；Saved Provider 仍保持 D-230 的配置阻塞，Human Re-Gate 尚未执行。

```text
DESKTOP_PROJECT_AND_CHROME_HARD_DIVIDERS: REMOVED
DESKTOP_RIGHT_UTILITY_DIVIDER: SINGLE_FAINT_PIXEL_VERIFIED
DESKTOP_NAVIGATION_TYPOGRAPHY: UNIFIED
DESKTOP_CONVERSATION_HEADER_DUPLICATE_TOOLS: REMOVED
DESKTOP_FOCUS_PRESERVES_LEFT_NAVIGATION: VERIFIED
DESKTOP_LEFT_AND_RIGHT_TRANSITIONS: IMPLEMENTED
DESKTOP_WINDOWS_ICON_ALPHA_FIT: 228x226_IN_256_VERIFIED
DESKTOP_PREMERGE: PASS
DESKTOP_DEV_PACKAGED_FRESH_PORTABLE_BROWSER: PASS
DESKTOP_HUMAN_REGATE: READY_NOT_RUN
```

## 66. Window-right Utility Controls and Sampled Panel Motion

用户进一步澄清 Codex 的右上控制并不是在主区与右栏之间移动，而是始终锚定窗口右上；右栏从其下方展开后，控制才自然成为右栏 header 的一部分。当前 Fielora 保留单一控制 DOM，开关前后右边缘实测偏差不超过 0.5 CSS px。控制组外框、底板、group shadow 与 blur 全部移除，只有单个按钮 hover 时出现轻阴影；扩展/专注按钮仅在右栏已打开时存在，关闭状态只保留 Terminal 与右栏开关。

右栏开启动画的旧实现同帧完成 DOM mount 与 `utility-open`，因此 CSS 虽有 transition 但真实视觉会跳过起始状态。现在先以 0 宽挂载，下一 animation frame 再切换为打开状态，关闭时等待 250ms 过渡结束后卸载。Desktop Foundation 连续采样 10 帧，主区宽度渐变超过 80 CSS px；同一测试还验证控制锚点、无框样式、hover shadow、条件 focus、菜单/导航同背景与 alpha 0.055 的单像素右分隔线。

完整 `pnpm verify:premerge` PASS；Desktop Foundation 与完整 Browse Slices 01–05 在 dev、release packaged、fresh extracted portable 三宿主全部 PASS。最新 ZIP 为 `148578963` bytes，SHA-256 `069afd0f4ae5b3f185e0e8a46944a115c550fa05b6f6cd5da110f0725aed2bf9`。Saved Provider 仍保持 D-230 的配置阻塞，Human Re-Gate 尚未执行。

```text
DESKTOP_UTILITY_CONTROLS_WINDOW_RIGHT_ANCHORED: VERIFIED
DESKTOP_UTILITY_CONTROL_GROUP_FRAME: REMOVED
DESKTOP_UTILITY_FOCUS_VISIBILITY: OPEN_ONLY_VERIFIED
DESKTOP_UTILITY_OPEN_MOTION: 10_FRAME_SAMPLED_PASS
DESKTOP_CHROME_NAVIGATION_BACKGROUND: UNIFIED
DESKTOP_UTILITY_DIVIDER_ALPHA: 0.055_VERIFIED
DESKTOP_PREMERGE_DEV_PACKAGED_PORTABLE: PASS
DESKTOP_HUMAN_REGATE: READY_NOT_RUN
```

## 69. Quiet Workbench Design Language and Maintainable Renderer System

用户要求把连续 UI 修正沉淀为一套可描述、可维护、可继续优化的统一语言，而不是继续依靠截图逐处覆盖。只读审计确认现有产品已经形成低对比 Chrome、白色工作 Surface、最多三块可见区域、按需工具和系统动效等稳定方向，但代码层仍主要依赖一个约 78 KiB 的历史 `styles.css`：根级变量不足以表达颜色、字体、几何、阴影和动效，跨页面控件也缺少共同契约。该问题属于可逆 Renderer 架构修正，不改变 schema 6、Agent runtime、Provider/Credential、Workspace 或 Browser security boundary。

当前设计语言正式命名为 **Fielora Quiet Workbench / 静默工作台**，并以 `docs/product/FIELORA_DESIGN_LANGUAGE_V0.1.md` 作为维护契约。Renderer 样式固定分为 semantic tokens、global foundation、历史 Feature/Surface 兼容层、canonical controls 四层；颜色、字体尺度、间距、圆角、控件高度、阴影、动效和 z-layer 均有 `--fl-*` 语义 token。`Button`、`IconButton`、`ToolbarAction`、`SelectMenu`、`TextActionDialog` 与既有 `WorkspaceSurface`、`ResizableDivider` 构成首批共享原语，Environment、Terminal、右栏开关和 Conversation menu 已使用这些原语。旧样式不做无验证价值的整文件重写，而按触达路径迁移；原始颜色字面量从审计时 479 个降至 408 个，并以只能下降、不能增长的静态预算锁定。

新增 5 项设计系统静态测试，分别锁定样式加载顺序、Token 覆盖、foundation/controls 禁止 raw color、共享 React primitive 和 legacy raw-color budget。当前 51 项 TypeScript、完整 `pnpm verify:premerge`、Desktop Foundation 与完整 Browse 在 dev、独立 release package、全新 ZIP 解压目录均 PASS。补充便携包位于 `artifacts/design-system-v0.1/Fielora-Quiet-Workbench-V0.1-win-x64.zip`，大小 `153198902` bytes，SHA-256 `ae077c0859cd2571d5ff1843934f03d0fed4c358e087632cfb8c0ce61a9d7251`。历史 Surface 仍是明确的 compatibility debt；Human Re-Gate 与 D-230 的真实 Provider 配置阻塞不因本次设计系统工程 PASS 而关闭。

```text
FIELORA_DESIGN_LANGUAGE: QUIET_WORKBENCH_V0.1_CURRENT
FIELORA_DESIGN_TOKENS_FOUNDATION_CONTROLS: IMPLEMENTED
FIELORA_SHARED_UI_PRIMITIVES: IMPLEMENTED_AND_CORE_ACTIONS_MIGRATED
FIELORA_LEGACY_RAW_COLOR_BUDGET: 408_MAX_AND_NONINCREASING
FIELORA_DESIGN_SYSTEM_STATIC_TESTS: 5_PASS
FIELORA_TYPESCRIPT_TESTS: 51_PASS
FIELORA_PREMERGE_DEV_PACKAGED_FRESH: PASS
FIELORA_DESIGN_SYSTEM_HUMAN_REGATE: READY_NOT_RUN
```

## 67. Shared Project/Settings Workspace Surface and Terminal Route Boundary

用户确认 Terminal 在视觉上错误附着到“新对话”，并再次指出左侧导航不应出现 Terminal；设置工作区也仍不像应用工作区，不能左右拖动。只读定位发现 Terminal dock 本身已经位于 desktop-level portal，但全局 Terminal action 会无条件导航到 `PROJECTS`，因此从 Settings/Now 等页面触发时会先进入 Project/“新对话”；Settings 则只有相似样式，没有复用 Project 的可拖动布局结构。既有 E2E 只检查了设置的静态类名，没有验证 divider geometry 或真实 drag，属于测试缺口。

当前新增共享 `WorkspaceSurface`，Project 与 Settings 使用同一三列 grid、同一 `ResizableDivider`、190–360px 边界和同一持久化 navigation width；设置拖动后回到 Project 会复用最终宽度。设置仍保留设置分类导航和内容，但不渲染工作态右栏 controls。Terminal 全局动作不再跨 route 导航，rail/utility 的 Terminal 入口只在 Project route 存在；Project 未打开时也不会创建虚假终端。Terminal DOM 明确属于 `desktop-terminal-layer`，不在 Conversation column 或左侧导航中，并从导航之后横跨主区与可选右工具区。

Desktop Foundation E2E 新增真实设置 divider drag、过渡完成后的 geometry、Settings→Project width reuse、Settings Ctrl+backtick route stability，以及 Terminal portal/Conversation/sidebar ownership 断言。完整 `pnpm verify:premerge` PASS；Desktop Foundation 与完整 Browse Slices 01–05 在 dev、release packaged、fresh extracted portable 三宿主全部 PASS。最新 ZIP 为 `148579397` bytes，SHA-256 `92f658c1e24448c70538661a31cd5bdf8df02900b20cdeb56455438b81e0ce91`。Saved Provider 仍保持 D-230 的配置阻塞，Human Re-Gate 尚未执行。

```text
DESKTOP_PROJECT_SETTINGS_SHARED_WORKSPACE_SURFACE: VERIFIED
DESKTOP_SETTINGS_NAVIGATION_DRAG: VERIFIED
DESKTOP_SETTINGS_PROJECT_WIDTH_CONTINUITY: VERIFIED
DESKTOP_TERMINAL_ROUTE_SCOPE: PROJECT_ONLY_VERIFIED
DESKTOP_TERMINAL_LAYER: OUTSIDE_CONVERSATION_AND_LEFT_NAV_VERIFIED
DESKTOP_PREMERGE_DEV_PACKAGED_PORTABLE: PASS
DESKTOP_HUMAN_REGATE: READY_NOT_RUN
```

## 68. Terminal Navigation Exclusion and Unified Window-right Actions

用户继续指出：Terminal 虽然逻辑上不属于左侧导航，但 desktop work area 的全宽底行让终端背景仍绘制在导航下方，同时 Environment 与 Terminal/右栏开关分属 Conversation header 和 window-right dock，造成中心线与 hover 阴影不一致。该轮是纯 Renderer 布局和样式修正，不改变 Workspace/Terminal 执行、Agent、Provider、credential、schema 或 Browser boundary。

当前左侧导航保持覆盖完整 work area 高度；Terminal 改为只从共享导航宽度之后开始的 desktop-level absolute bottom layer，其左边缘与 Conversation 左边缘一致，背景不会进入导航下方。Environment 保留全部 Git status/branch/diff/source 功能，但通过 Project-scoped portal 进入与 Terminal、右栏开关相同的 window-right control dock。三个 action 共享 34px 高度、中心线、颜色、背景、阴影和位移过渡，popover 内部按钮不继承 dock 样式。

Desktop Foundation E2E 新增 DOM ownership、Terminal geometry、navigation full-height、三按钮 center-Y/height 与 computed hover style 等值断言。完整 `pnpm verify:premerge` PASS；Desktop Foundation 与完整 Browse Slices 01–05 在 dev、release packaged、fresh extracted portable 三宿主全部 PASS。最新 ZIP 为 `148579792` bytes，SHA-256 `e721fe317da2326cdc08126abcd55ae17b5704eabbc8357e759c8206d9654ecd`。Saved Provider 仍保持 D-230 的配置阻塞，Human Re-Gate 尚未执行。

```text
DESKTOP_LEFT_NAVIGATION_SPANS_TERMINAL_HEIGHT: VERIFIED
DESKTOP_TERMINAL_EXCLUDES_LEFT_NAVIGATION: VERIFIED
DESKTOP_PROJECT_ACTIONS_SHARED_CONTROL_DOCK: VERIFIED
DESKTOP_TOP_CONTROLS_BASELINE: MAX_0.5_CSS_PX_VERIFIED
DESKTOP_TOP_CONTROLS_HOVER_STYLE: COMPUTED_EQUAL_VERIFIED
DESKTOP_PREMERGE_DEV_PACKAGED_PORTABLE: PASS
DESKTOP_HUMAN_REGATE: READY_NOT_RUN
```

## 70. China Model Baseline-first Eval Foundation

用户要求在 Complete Agent 已存在的基础上实测 `qwen3.7-plus` 并建立国产模型优化路线。审核裁决该工作不得重新实现 Agent、不得在 Kernel 写 Qwen 分支，也不得在没有 bounded live-call 授权时把“已保存凭据”当成付费调用授权。当前路线固定为 generic baseline → zero-request preflight → corrected Provider config → bounded live smoke → Golden/CN baseline → failure classification → single-variable candidate → identical-case A/B → holdout/provider-neutral regression。

仓库现有 Provider 记录已通过只读 metadata preflight 核验：`Qwen3.7-plus` 凭据存在，但配置仍是 `OPENAI` 且没有 custom Base URL；它会走 OpenAI 官方协议而不是 Qwen-compatible chat-completions，因此当前为 configuration blocker。当前环境也不存在 `LIVE_PROVIDER_CALLS`、Provider/model、request/cost/wall-time 六项完整授权；本轮 external model requests 为 0。

新增 `pnpm eval:agent:qwen:preflight`，复用既有 Core/Model/Agent runtime，运行 adapter/tool deterministic tests，校验 8 个固定中文 case、3 个 holdout、`generic-current` source hashes 与未激活的 `qwen3.7-plus-candidate-v1`。Capability 与 Behavior 在 eval data 中分离，未知项保持 `UNVERIFIED`，没有扩展 FIPC/schema 或伪造支持。唯一生产改动是 Provider-neutral Context Compiler 的 bounded CJK n-gram term extraction，修复整段中文被当作单词导致中文文件定位失效的问题；中文/空格/反斜杠路径与 UTF-8 observation 也有确定性回归。

```text
CHINA_MODEL_EVAL_ROUTE: BASELINE_FIRST_CURRENT
QWEN_CONFIG: BLOCKED_OPENAI_PROTOCOL_AND_MISSING_BASE_URL
QWEN_CREDENTIAL_METADATA: PRESENT_SECRET_NOT_READ
LIVE_PROVIDER_CALLS: NOT_AUTHORIZED
EXTERNAL_MODEL_REQUESTS_THIS_SLICE: 0
QWEN_SUPPORT_LEVEL: UNVERIFIED_NOT_L0
QWEN_BEHAVIOR_PROFILE: CANDIDATE_NOT_ACTIVE
CN_AGENT_CASES: 8_FIXED_3_HOLDOUT_NOT_RUN
CHINESE_CONTEXT_AND_WINDOWS_UNICODE_PATH_REGRESSION: PASS
```

## 71. Qwen3.7-plus Phase A Smoke Authorization Stopped at Configuration Gate

用户正式授权 Qwen Phase A smoke-only：最多 7 个真实请求、总费用不超过 3 CNY、总墙钟 900 秒，并增加每请求保守输入估算 120000 token、输出 12000 token 上限；不得自动进入 Golden、不得激活 Qwen optimization。该授权与 Provider 配置 Gate 正交。

按要求重新运行 zero-request preflight 后，授权六项与 bound 全部有效，但 canonical Core metadata 仍只返回一个 active `Qwen3.7-plus` 配置：model ID 大小写不等于授权的精确 `qwen3.7-plus`、credential present、`provider_kind=OPENAI`、`base_url_present=false`、endpoint class missing。它不满足 exact model ID + `OPENAI_COMPATIBLE + Alibaba Model Studio compatible-mode/v1 HTTPS endpoint`，因此严格执行 `STOP_BEFORE_LIVE_REQUEST`。S01–S07 均未运行，请求使用 0/7、费用 0/3 CNY；Qwen production profile 保持 inactive，support level 仍为 UNVERIFIED/not L0。

Preflight 同时收紧为验证 DashScope/Alibaba endpoint class，并使用本轮精确变量 `MAX_TOTAL_COST_CNY`、`MAX_WALL_TIME_SECONDS`；4 项 runner test、10 项 model adapter test、9 项 Agent tool/context test PASS。脱敏 Evidence 位于 `artifacts/agent-v0.1/qwen/preflight/PHASE_A_PREFLIGHT_RESULT.json`。

```text
QWEN_PHASE_A_AUTHORIZATION: VALID_UNUSED
QWEN_PHASE_A_BOUND: 7_REQUESTS_3_CNY_900_SECONDS
QWEN_PHASE_A_PREFLIGHT: CONFIGURATION_BLOCKED
QWEN_PHASE_A_LIVE_REQUESTS_USED: 0
QWEN_PHASE_A_COST_CNY: 0
QWEN_PHASE_A_S01_S07: NOT_RUN
QWEN_PRODUCTION_PROFILE: INACTIVE
QWEN_SUPPORT_LEVEL: UNVERIFIED_NOT_L0
```

## 72. Programming, Testing, Typed Git and Six-family China Model Foundation

用户将近期范围明确收敛为：先把 Fielora 做成可长期使用的编程、测试与代码版本管理桌面；设计和其他能力以后再接。首批国产模型为 Qwen、DeepSeek、Kimi、GLM、MiniMax、Doubao，未来 Provider 必须可以继续接入。实施前的短 Change Impact 位于 `docs/architecture/PROGRAMMING_AND_CHINA_MODELS_CHANGE_IMPACT_V0.1.md`；本轮不改 schema、migration、credential storage 或 Project/Conversation identity。

Agent 现在具备窄化的 `git_stage / git_unstage / git_create_branch / git_switch_branch / git_commit / git_push`。这些工具拒绝 stage-all、敏感路径、非法 ref/remote、force/amend/reset/clean/rebase/checkout/tag；所有 Git 写操作即使在 Full Control 也逐次 Ask，push 禁用交互 credential prompt。通用 `run_command` 不能绕过 typed Git 执行 mutation。Git metadata 不再错误地使已经通过的代码测试失效，但 commit/push 也绝不算 verification。

Verification 从“任意 process exit 0”收紧为真实 test/check/build/lint/typecheck 命令；文件写入后、verification 前，Git finalize tools 不向模型暴露。六家模型复用同一个 `china-coding-v1` 行为层和稳定英文 tool schema，只增加中文沟通、严格 JSON、证据→小改→测试→Diff 的执行纪律，不授予新权限。MiniMax conservative OpenAI-compatible wire 使用 `max_completion_tokens`；设置页提供六个可编辑 Provider preset，Environment 的“准备提交”进入 Agent 测试→Diff→批准→提交路径，不再预填 shell 拼接命令。

当前完整 `pnpm verify:premerge` 已以退出码 0 PASS，覆盖 context/contracts、53 项 TypeScript、全部 Rust workspace unit、Clippy、8 项 Core integration，以及 Phase 02、Phase 03 Browse 和 Desktop Foundation dev E2E。release Core 与 Electron package 构建成功，最终 packaged Desktop Foundation E2E PASS；可执行文件 SHA-256 为 `5534451f0fb3b00787a7cb5802a5aaa67fd4c799d5fb57c2692f7c028fcbc739`。真实六家模型质量仍未运行；最终 zero-request preflight 为 external requests 0、credential bytes read false、Qwen 配置 blocker、其余五家未配置，不能把 deterministic PASS 写成 live support 或“已经好用”的最终 Human 结论。

```text
PROGRAMMING_LOOP: INSPECT_EDIT_TEST_DIFF_TYPED_GIT_IMPLEMENTED
GIT_WRITE_APPROVAL: ALWAYS_ASK
PROCESS_EXIT_ZERO_EQUALS_VERIFICATION: NO
CHINA_MODEL_FAMILIES: QWEN_DEEPSEEK_KIMI_GLM_MINIMAX_DOUBAO
CHINA_CODING_PROFILE: SHARED_ACTIVE_NO_NEW_AUTHORITY
SIX_PROVIDER_PRESETS: IMPLEMENTED_EDITABLE
PROGRAMMING_PREMERGE: PASS
PROGRAMMING_PACKAGED_DESKTOP_FOUNDATION: PASS
LIVE_MODEL_QUALITY: NOT_RUN_UNVERIFIED
SCHEMA_MIGRATION_CREDENTIAL_CHANGE: NONE
```

## 73. Qwen Coding Plan Credential Classification and Interactive Route

用户明确授权使用已保存千问 Key 直至套餐用量上限。首个隔离 S01 请求按 7 requests / 3 CNY / 900 seconds 小批次 Gate 发往标准 Model Studio 北京 compatible endpoint，真实返回 `CREDENTIAL_REJECTED`；runner 当即停止且未重试。该请求没有获得 usage、没有响应正文、没有修改 canonical Project/Conversation，Evidence 位于 `artifacts/agent-v0.1/qwen/live/qwen-live-2026-08-18T12-03-25-456Z.json`。

随后通过只返回类型、不打印/哈希/保存密钥的 Windows Credential 本地诊断确认该 Key 是 `sk-sp-` 类 Coding Plan 专用凭据且没有首尾空格。官方要求 Coding Plan Key 使用 `https://coding.dashscope.aliyuncs.com/v1`，不能与标准 Model Studio endpoint 混用。项目既有规则禁止用 Coding Plan credential 做 automation/API acceptance，因此 live runner 新增 fail-closed guard；修复后的复跑在 request 1 前以 `CODING_PLAN_AUTOMATED_EVAL_PROHIBITED` 停止，requests=0。

Canonical Provider 元数据在 SQLite 在线一致性备份后修正为 `OPENAI_COMPATIBLE + qwen3.7-plus + Coding Plan endpoint`，原 WinCred reference 保持不变，未读取 credential bytes。设置页新增独立 Qwen Coding Plan preset；通用 Qwen preset 保留。Model wire 仅对 Qwen Plan/Token Plan endpoint 使用官方 `enable_thinking:true`，并为所有 direct compatible invocation 增加 1024 output-token hard bound。该状态允许用户在 Fielora 中交互式编程，不构成自动化模型质量 PASS。

```text
QWEN_LIVE_S01_REQUESTS: 1
QWEN_LIVE_S01_RESULT: CREDENTIAL_REJECTED_WRONG_ENDPOINT
QWEN_CREDENTIAL_CLASS: CODING_PLAN_SECRET_NOT_PRINTED
QWEN_CANONICAL_CONFIG: OPENAI_COMPATIBLE_CODING_PLAN_REPAIRED
QWEN_INTERACTIVE_CODING: READY_FOR_USER_USE
QWEN_AUTOMATED_ACCEPTANCE: BLOCKED_BY_CODING_PLAN_POLICY
QWEN_PLAN_THINKING_WIRE: ENABLED_OFFICIAL_SETTING
QWEN_DIRECT_OUTPUT_BOUND: 1024
QWEN_LIVE_QUALITY: UNVERIFIED
```

## 74. Unified Appearance System and Settings

用户明确要求将 Codex-like 外观能力接入 Fielora，并将 Light、Dark、System、强调色、对比度、密度、圆角、字体、动效、半透明侧栏与主题导入/重置作为真实设置，而不是静态展示。该决定重新打开 D-231 当时移除的手动密度与减少动画入口；D-231 的 Desktop Surface ownership 仍有效，但“只服从 OS、无手动入口”不再是当前事实。

当前实现扩展既有 `--fl-*` token 与统一 `app-preferences`，没有新增第二套 theme runtime、schema、migration、credential 或 Provider 逻辑。偏好升级为 localStorage v2，兼容迁移 v1；System 使用 `matchMedia` 实时解析且不改写用户选择，首次 React render 前应用，降低主题闪烁。Theme Config v1 仅解析 bounded JSON data，拒绝未知字段、非法颜色与低于 4.5 的 canvas/foreground 对比；恢复默认只重置 appearance。

设置页新增独立“外观”，关键 Desktop/Coding Surface 统一消费 Light/Dark semantic roles，外部 Browse WebContents 保持隔离。TypeScript typecheck、lint、62 项 desktop tests 与真实 Electron Appearance E2E PASS；E2E 覆盖切换、System 跟随、持久化、accent/density/radius/sidebar/motion、非法导入与局部 reset，并产出 Light/Dark 截图。完整 PreMerge、packaged 与 Human Gate 尚未运行，不能据此写为全产品最终验收。

```text
APPEARANCE_ARCHITECTURE: EXISTING_TOKENS_AND_PREFERENCES_EXTENDED
THEMES: SYSTEM_LIGHT_DARK_IMPLEMENTED
APPEARANCE_CONTROLS: ACCENT_CONTRAST_DENSITY_RADIUS_FONT_MOTION_IMPLEMENTED
THEME_CONFIG: BOUNDED_DATA_ONLY_IMPORT_EXPORT
PREFERENCE_MIGRATION: LOCALSTORAGE_V1_TO_V2
DESKTOP_APPEARANCE_TARGETED_E2E: PASS
PACKAGED_AND_HUMAN_GATE: NOT_RUN
SCHEMA_MIGRATION_CREDENTIAL_PROVIDER_CHANGE: NONE
```

## 75. Agent Interaction Language V0.1

用户对照 Codex 后确认当前差距已从配色转向 Agent UX：旧界面把 Run、Tool、Event、error code 平铺成状态机报告，用户无法自然理解“正在做什么、发生了什么、最终得到了什么”。当前产品 Contract 位于 `docs/product/AGENT_INTERACTION_LANGUAGE_V0.1.md`。

Renderer 现将 Agent 输出分为 Conversation、Execution、Technical Trace 三层。默认层使用“正在检查项目 / 正在修改项目 / 正在运行并验证 / 这次没有完成 / 工作已完成”等人话；Execution 由真实 Tool effect/name 和 Receipt 确定性生成 Work Narrative，不显示模型私有 Chain-of-Thought；技术事件和 error code 二次折叠。Approval 使用具体效果按钮并说明一次性边界；Failure 根据 completed workspace mutation 区分“无项目变化”与“已有部分变化”；完成态提供真实“查看修改”和“查看运行记录”。

同一轮收紧 User Bubble、Composer、Header 与 Sidebar：消息按内容收缩、Composer 移除常驻权限说明、单模型只显示静态标签、完整本地路径改为 hover、导航改为正文式层级和弱选中 indicator。该轮没有修改 Agent ledger、schema 6、permission、Provider wire、credential 或 Browser security。

```text
AGENT_INTERACTION_LANGUAGE: V0_1_IMPLEMENTED
CONVERSATION_EXECUTION_TECHNICAL_LAYERS: SEPARATED
CHAIN_OF_THOUGHT_DISPLAY: PROHIBITED
WORK_NARRATIVE_SOURCE: RUN_EVENT_TOOL_RECEIPT_FACTS_ONLY
APPROVAL_FAILURE_RESULT_LANGUAGE: IMPLEMENTED
SCHEMA_PERMISSION_PROVIDER_CHANGE: NONE
ENGINEERING_VERIFICATION: 68_TS_DEV_AND_PACKAGED_AGENT_UX_PASS
PACKAGED_EXE_SHA256: 501891C3E86DC72B9943BD334F4C7D5A613CE33C2B9904D9AF168DD84BAA8D33
EXTERNAL_PROVIDER_REQUESTS: 0
FULL_PREMERGE_AND_HUMAN_GATE: NOT_RUN
```

## 76. Qwen Fast Edit Performance Remediation

用户授权使用已配置 Qwen Coding Plan credential 对真实 Coding Agent 闭环执行 bounded Golden Task。整改前真实本地任务运行 521,995ms 后仍停在审批，产生 12 次模型调用、23 次工具调用、113 个 Durable Event、522,458 input tokens，并发生重复读取、Context 重建、原始 reasoning 展示与 Desktop projection timeout。

当前 Provider-neutral Agent Harness 新增 `FAST_EDIT` 分类、task-scoped tools、stable context/transcript cache、并行 observe、batched search/replace、atomic guarded `apply_patches`、receipt feedback、Windows package-manager shim、轻量 durable event 与增量 Desktop projection。Provider intermediate planning 不进入 Conversation，最终文本通过 bounded state-machine 移除完整/残缺 `<think>` 段。Project 创建后立即生成并选中唯一 unsent Conversation。

最终隔离真实 Qwen Golden Task 以 5 次模型调用、6 次工具调用、20,460 input tokens 在 23,941ms 内 PASS；模型耗时 22,318ms、工具 1,243ms、Context 71ms、验证 1,131ms，0 duplicate observe，三份目标文件精确修改且非目标文件未变。60 项 Rust workspace、71 项 Desktop TS、Clippy、8 项 Core integration、Phase 02 Desktop、dev/packaged Project Navigation 与 Agent UX E2E PASS。完整 PreMerge 已运行并在 Browse 真实 navigation/security/input/scroll 后被既有 Windows Chromium 原生 Ctrl+C/Ctrl+V 环境硬断言阻断；断言未跳过或放宽。其他五家国产 Provider live quality 仍未验证。

```text
QWEN_FAST_EDIT_GOLDEN: PASS
TOTAL_DURATION_MS: 23941
MODEL_CALLS: 5
TOOL_CALLS: 6
DUPLICATE_OBSERVE_CALLS: 0
DURABLE_EVENTS: 39
RAW_REASONING_LEAK: FALSE
PROJECT_CREATE_AUTO_CONVERSATION: DEV_AND_PACKAGED_PASS
PACKAGED_EXE_SHA256: D09ABB3938AD8C9AC049B159A32D5B437569AB4922063E6849CC8E5C655118ED
PACKAGED_CORE_SHA256: 0C0911480BFDD6ADB968192756967485D3A5E74BB219CFDB21F4A5F76CBD5C53
OTHER_CHINA_PROVIDER_LIVE_QUALITY: UNVERIFIED
FULL_PREMERGE: BLOCKED_AT_WINDOWS_NATIVE_CLIPBOARD_AFTER_PRIOR_GATES_PASS
```

修复后的完整 `pnpm verify:premerge` 以退出码 0 PASS，覆盖 53 项 TypeScript、50 项 Rust workspace unit、Clippy、8 项 Core integration 与 Phase 02/Phase 03 Browse/Desktop Foundation dev E2E；release build、Electron package 和 packaged Desktop Foundation E2E 同时 PASS。最新 unpacked `Fielora.exe` 为 `225533440` bytes，SHA-256 `acdd2387b78cd994eb705abfa4e86f4d9e95bcfe05b3d2b50df24be148f9fb12`。这些 Gate 没有发起 Provider 请求。

## 77. Agent Desktop Convergence V0.1

用户固定同一 Qwen Coding Plan 任务，要求先测量 Golden/Core 与真实 Dev/Packaged Desktop，再把 Simple Edit 从开放式循环收敛为 deterministic FAST_EDIT。Baseline 证明四个宿主都识别为 FAST_EDIT，但仍需要 8–16 次模型调用、7–15 次工具调用、3–4 次 Patch，并出现 1–3 次 conflict；Desktop 单次 UI submit 只持久化一条用户消息，因此截图中的重复消息没有复现为 transport/persistence retry，本轮没有无依据新增 `client_request_id` schema。

当前 `FAST_EDIT_BOUNDED_V1` 使用持久 lexical Repository Context Index、Stable/Dynamic/Task-local context hash、完整可信文件正文、一次 bounded multi-file change set、最多一次全量相关文件 conflict recovery、targeted verification、git diff invariant 与最终语义说明。Runtime 以 `LOCATE / EDIT / VERIFY / FINALIZE` canonical phase 作为唯一主状态；Renderer 只投影该状态，工作叙述由 runtime facts/template 生成，raw tools 留在技术信息。Build Provenance 可通过 Core 查询，并自动进入 Run/Evidence。

同一固定任务的最终 AFTER 结果：Debug Core 13,486ms、Packaged Core 22,170ms、Dev Desktop 17,382ms、Packaged Desktop 19,963ms；四者均为 2 次模型调用、3 次工具调用、0 search/read/duplicate observe、1 次 Patch、0 conflict、1 次 targeted verification、29 events，并精确修改四个目标文件。Packaged Desktop 的 FIPC event query 总耗时 9ms、projection 1ms，模型请求耗时 19,068ms，占总时长约 95.5%，证明剩余主要瓶颈在 Provider，而非 Desktop projection/FIPC。Rust 25 项、Desktop 74 项与 Core integration 10 项 PASS；真实 Dev/Packaged Desktop 还验证了四阶段 DOM、一条用户消息与复制成功反馈。

```text
FIELORA_AGENT_DESKTOP_CONVERGENCE_V0.1: PASS
DESKTOP_CONVERGENCE: PASS
FAST_EDIT_PERFORMANCE: PASS
PRESENTATION_CONSISTENCY: PASS
PACKAGED_EXE_SHA256: D09ABB3938AD8C9AC049B159A32D5B437569AB4922063E6849CC8E5C655118ED
PACKAGED_APP_ASAR_SHA256: 93ACC7344DC51346B020CEE3EEE99990C4BC2045EE49B2AD743D7342D80985C0
PACKAGED_CORE_SHA256: F42FA2985798FE402B54497DB0973C244C529D9BDE061B720033060560BD5788
OTHER_CHINA_PROVIDER_LIVE_QUALITY: UNVERIFIED
```

## 78. FAST_EDIT Robustness and Agent UX V0.1

真实用户措辞“把项目列表页面的显示/隐藏列里面的进行阶段勾选项去掉”证明 `FAST_EDIT_BOUNDED_V1` 虽然快，但在全截断候选、目标实体缺失和首次工具调用不完整时会 one-shot fail；历史开放循环还曾把目标复选框与相邻“开发顾问”一起删除。当前实现升级为 Provider-neutral `FAST_EDIT_ADAPTIVE_V1`：先记录 Context Confidence；LOW 时允许正式 `NEED_MORE_EVIDENCE`，由 Harness 只执行一次 batched search + parallel bounded reads；模型随后以 `apply_patches` 或 `no_change_needed` 返回 READY_TO_EDIT。ChangeSet 在持久化/执行前进行 typed validation，证据完成后最多纠正一次，Patch conflict 最多重读并重试一次，总模型调用上限 4。

Minimum Necessary Change 已变成执行约束：界面控件任务只允许证据支持的模板路径，controller/service/表格业务逻辑/相邻控件默认禁止；多 label 删除判为 ambiguous。旧全文件“目标词必须消失”验证被替换为 receipt-backed operation invariant，允许同名业务列正确保留。目标控件已不存在时以 no-change COMPLETED 收口，不写文件、不运行伪验证。

Renderer 只展示 `定位 / 修改 / 验证` 三阶段，FINALIZE 不再作为“完成”步骤；Blocked/Skipped 使用中性未执行状态，Activity Detail 改为 Conversation inline expansion。最终真实 Qwen 隔离套件以 5 种真实措辞重复 10 次，10/10 PASS，P90 17,349ms、P95 18,351ms、平均 3.0 次模型调用、最大 4、不安全写入 0。其他五家国产模型 live quality 仍未验证。

最终 packaged 回归又发现英文子串分类会把 `FIXTURE` 中的 `fix` 误判为 FAST_EDIT；英文动作词现改为真正的 ASCII word boundary，新建/生成文件任务保持 GENERAL，中文 FAST_EDIT 触发不变。Rust workspace 62/62、Core integration 10/10、Desktop TypeScript 75/75、typecheck、Clippy 与 packaged Agent UX PASS。完整 Desktop Foundation 后半段仍在 utility → Review 切换断言失败，该既有工作区信号不计入本专项 PASS。

```text
FAST_EDIT_PIPELINE: FAST_EDIT_ADAPTIVE_V1
FORMAL_DECISIONS: READY_TO_EDIT_OR_NEED_MORE_EVIDENCE
BOUNDED_EVIDENCE_RECOVERY: ONE_BATCH
BOUNDED_CHANGESET_RETRY: ONE
BOUNDED_PATCH_CONFLICT_RETRY: ONE
MINIMUM_NECESSARY_CHANGE: ENFORCED_BEFORE_WRITE
FAST_EDIT_VISIBLE_PHASES: LOCATE_EDIT_VERIFY
ACTIVITY_DETAIL: INLINE_EXPANSION
QWEN_REAL_PHRASING_ROBUSTNESS: 10_OF_10_PASS
QWEN_P90_MS: 17349
QWEN_AVERAGE_MODEL_CALLS: 3.0
UNSAFE_WRITES: 0
OTHER_CHINA_PROVIDER_LIVE_QUALITY: UNVERIFIED
```

## 79. Real CRLF Edit + Permission Presets Closure

用户真实 Run 使用 Qwen 修改 `finance-add.controller.js` 时，read receipt 与 write proposal 均为 SHA-256 `43ff20dc...e40a`，但文件包含 2,513 个 CRLF 行尾；旧 `replace_text` 用 LF exact text 匹配失败后错误返回 `AGENT_FILE_CHANGED`。审批恢复又让模型重复读取和写入，最终在 16 步达到 `AGENT_MAX_STEPS_REACHED`。该失败不是用户操作错误，也不是模型未定位修改。

当前 runtime 在 SHA guard 通过后按文件行尾归一化 exact replacement，并把真正的 hash change、text match failure 与 patch conflict 分开；Focused Edit 在真实 verification 和一次 `git_read diff` 后停止暴露工具，强制进入最终 Markdown 结果。三档 Composer 权限改为“请求批准 / 帮我批准 / 完全访问权限”，同时持久化 Conversation、Project、Global，新 Conversation 不再回退。Child subagent 仍由 observe-only catalog 真正隔离。

最终使用原 97,401-byte 文件的隔离副本执行同一 Qwen 任务：33,754ms、11 model calls、Run `COMPLETED`、0 `AGENT_FILE_CHANGED`、0 approval；目标用户字段变为非必填，真实 command verification 与 diff 完成。81 TS、28 targeted Rust、10 Core integration、dev/packaged Agent UX E2E PASS。最终 package 在历史 Phase 04 PID 23244 仍存活时成功独立启动；旧进程未被本轮删除。

```text
REAL_QWEN_CRLF_EDIT: PASS
RUN_DURATION_MS: 33754
MODEL_CALLS: 11
FILE_CHANGED_FALSE_POSITIVES: 0
FULL_ACCESS_APPROVALS: 0
PERMISSION_INHERITANCE: CONVERSATION_PROJECT_GLOBAL_PASS
DEV_AGENT_UX_E2E: PASS
PACKAGED_AGENT_UX_E2E: PASS
EXE_SHA256: D09ABB3938AD8C9AC049B159A32D5B437569AB4922063E6849CC8E5C655118ED
CORE_SHA256: C3AB157A875F9EAB0F86555489A13B5A238AAF3BD4784D05BD10F8CAFE191808
ASAR_SHA256: 75222B2AFE9230A6A53782A426DB7BE5E3EFEDC373D47CA82ED15728409524B5
```

## 80. Canonical Model / Harness / Tools Agent Architecture

用户于 2026-08-24 提供并要求采用
`FIELORA_V0.1_AGENT_ARCHITECTURE_SPEC.md`。当前 Agent 的唯一正式顶层
结构为 `Model + Harness + Tools`；Harness 统一由 Ingress & Context、
Identity & Goal、Continuity、Orchestration、Governance、Execution、
Verification & Evidence、Adaptation 八个功能域理解。Aegis、IDR、AG-UI 与
DXE 只能按该规格进入既有边界，不得形成第二套 Core/Runtime/State/
Permission/Evidence。

真实代码审计确认 Provider adapter 与 normalized model turn 位于
`fielora-model`；`AgentCoordinator`、`ContextCompiler`、
`PolicyEngine`、AgentRun/Event、Approval 与 Verification 均为 Harness
职责；Rust `ToolRuntime` 主体是 Filesystem/Process/Git Tool executor，
而 Policy、Approval、ToolCall lifecycle、receipt persistence 与 completion
仍由 Harness 持有。当前新增实际使用的 `ToolExecutor` 接口固定该边界，
不做 crate/目录重写。`BrowserRuntime` 与 `WorkspaceRuntime` 是 Tool/
product capability backends；Agent Runtime 只属于 `Harness.Execution`。

当前只建立并使用 `CODING_V0.1` Harness Profile；
`FAST_EDIT_ADAPTIVE_V1`、`FOCUSED_EDIT_V1` 与
`GENERAL_AGENT_LOOP_V1` 是其 strategy，所选 Profile/strategy 进入 durable
`RUN_STARTED` facts。没有创建 Research/Browser/Document/Data/Creative
空 Profile。审计同时修正恢复路径：只有执行时被 Harness 标记
`verification_eligible=true` 且成功的 receipt 才可重建 verification；
普通成功进程不得在 pause/restart 后证明 mutation。

```text
AGENT_ARCHITECTURE_BASELINE: MODEL_HARNESS_TOOLS
CURRENT_HARNESS_PROFILE: CODING_V0.1
FAST_EDIT_OWNERSHIP: CODING_HARNESS_STRATEGY
TOOL_EXECUTION_BOUNDARY: ToolExecutor
SECOND_AGENT_CORE: FORBIDDEN
SCHEMA_CHANGE: NONE
USER_VISIBLE_BEHAVIOR_CHANGE: NONE
```

Targeted alignment Gate 使用冻结 Node 24.18.1 / pnpm 11.21.0：
`verify:dev:docs` PASS（80-entry context manifest）；
`verify:dev:core` PASS（format、70 Rust workspace tests、workspace Clippy）；
`test:integration` 10/10 PASS，并验证 General 与 FAST_EDIT 真实 Core 路径的
durable Harness Profile/strategy facts、Approval、Tool receipt、Verification、
Run completion 与 recovery。未运行与本轮无关的 UI、Browse、packaging 或
真实 Provider Gate。

## 81. Stable Long Tasks Minimum Reliable Closure

Stable Long Tasks 的最小闭环继续位于既有 `Harness.Continuity +
Harness.Execution`，没有新增 LongTask Core、Runtime、状态库、权限系统或
schema。AgentRun 使用既有 `QUEUED / RUNNING / WAITING_APPROVAL / PAUSED /
COMPLETED / FAILED / CANCELLED`；Core/App 中断时，RUNNING Tool 没有 final
receipt 即持久化为 `UNKNOWN`，Run 进入 `PAUSED`，WAITING_APPROVAL 的原 nonce
和 PAUSED 状态跨重启保留。

用户 Resume 之前不执行新动作。恢复时只读操作可重读；文件写入依据受
project-root/symlink/sensitive-path 保护的当前文件 hash 与预期 before/after
状态判定 APPLIED、NOT_APPLIED 或 DIVERGED；中断 Verification 必须 fresh
执行；Git、network、destructive 和普通未知 process 不盲目 replay。已确认
APPLIED 的 mutation 保留原 Tool identity 并要求新 verification，已有可信
成功 receipt 的同参副作用不会重复执行。

Verification process receipt 现在记录当前 workspace mutation revision。
只有 `success + verification_eligible=true + current workspace revision` 可证明
当前修改；普通成功 process、旧 revision、缺失/失败/中断 verification 或
未裁决 UNKNOWN 均不能进入 COMPLETED。显式 retry 记录前次 failure type、
tool effect、receipt state、workspace revision 与 verification validity；
POLICY_DENIED / USER_DENIED 永不自动 retry。

```text
STABLE_LONG_TASKS_MINIMUM_CLOSURE: IMPLEMENTED
SCHEMA_CHANGE: NONE
UNKNOWN_IS_FIRST_CLASS: YES
FRESH_VERIFICATION_REVISION: ENFORCED
BACKGROUND_SCHEDULER: NOT_IMPLEMENTED
AEGIS_DXE_IDR_AG_UI: DEFERRED
```

## Apache-2.0 正式开源（2026-09-15）

用户明确选择 Apache-2.0，用于 IDR 与 Fielora。Fielora 新增根目录 LICENSE、NOTICE，Cargo 与 npm 包元数据统一为 Apache-2.0，README 指向完整协议。项目自有源码与文档按此声明开放；第三方材料保留原许可证。private/publish 标记保留，不发布 npm/crates 包，不修改运行时或既有验收结论。此次授权不追溯重写历史 Evidence。详情见 [开源决定](../engineering/APACHE_2_0_ADOPTION.md)。

## 2026-11-07 — Fielora 改用 MIT 许可证

Fielora 自有源码与文档采用 [MIT 许可证](../../LICENSE)。README、npm 包和 Cargo 工作区声明使用同一许可证标识。
