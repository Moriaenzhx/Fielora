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

`Ctrl/Cmd + Shift + Space` 统一用于 `Summon Fielora`。Capture 是 Summon 经
Entry Intent Resolver 路由后的一个 Intent，不设置第二套独立一级 Capture
快捷键。

Inbox：存放尚未确定归属的内容。

Promote：当临时内容成长为持续工作时晋升。

核心链：`Capture → Idea → Field → Requirement → Build → Verify → Result`

## 7. AI 交互

禁止永久 AI Sidebar。

Fielora AI 是系统级可召唤能力。Browse 中通过 Shortcut Summon、轻量 `✦`、Selection Action、Context Chips、Progressive Context 工作。

简单问题在轻量 Overlay 中完成并消失；复杂讨论可 Expand；真正变成持续工作时 Continue in Field。

## 8. Entry Intent Resolver（历史 IDR 命名已 supersede）

这里的窄化能力负责当前用户输入进入哪条产品流程；旧文档曾称其为轻量
`IDR / Bounded IDR`，当前名称为 `Entry Intent Resolver`。它不是 Agent
Framework 的 `IDR / Individualized Disposition Runtime`。

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

Shell、Now、Inbox、Universal Capture、Browse foundation、Summon、Context Chips、
Field、Field Resume、Composer + Entry Intent Resolver contract、DXE primitives、
Idea → Requirement、Development Field、Existing Project Takeover、Basic Code
Workspace、Terminal、Git Diff、Browser Preview、Verify、Evidence、Library
foundation、Multi-provider foundation、Capability Connector contract + 一个最小
真实 Generic MCP Connector。

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

新的 `docs/architecture/PHASE_04_CAPABILITY_DEFINITION_CANDIDATE_V0.1.md` 已补齐
Phase 04 的 13 项能力目录：Provider Registry/Configuration、Credential
Boundary、Model Invocation、Summon、Explicit Context Package/Chips、当时称为
`Bounded IDR` 的 Entry Intent Resolver、Proposal/Draft Boundary、Capture、
Inbox、Promote/Reality Admission、Provider Swap/Failure Recovery、Permission
Foundation 与 Resume after Entry。它同时定义 logical persistence、五个纵向
Slice、Phase Exit Evidence、明确排除项与 Freeze 前十二项开放决定。

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

> `SUPERSEDED TERMINOLOGY`：本节记录 2026-08-24 当时采用的八域与 IDR
> 口径；当前定义由第 94 节和 canonical Agent Architecture Spec 覆盖。

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

## 82. Navigation / Library / Storage / Portable Profile Foundation

Desktop 固定导航收敛为“新聊天 / 现在 / 资料库”；Project 与 Conversation
列表继续留在同一工作导航，Browse 等既有能力改为按需入口而非固定一级项。
Browser 自身右侧 `⋮` 分组菜单承载保存到资料库与 Browser 设置入口；Browser
设置不进入全局设置分类列表，现有隔离 Runtime 与安全策略不变。
新增 Library MVP 使用 schema 7 的 SQLite metadata、stable Library Object ID、
SHA-256 content hash 与独立 LibraryRoot blob；支持本地文件及当前 Browser 页面
保存、筛选、打开/定位与 tombstone 删除，不建立第二套 Project 或 Browser
history/bookmark identity。

`StorageManager` 统一管理 DataRoot、LibraryRoot 与 CacheRoot。设置页显示数据库、
Agent ledger、Library blob、内部 repository index 的实际路径；未实现的 vector /
search index 明确显示 `NOT_PRESENT`。DataRoot 与 LibraryRoot 迁移均为 copy +
validate + switch，源数据保留；失败回到原 root。Cache 清理只作用于明确的
CacheRoot。

Portable Profile 使用 versioned `.fielora` manifest、逐文件 SHA-256 与严格
logical-path allowlist；导出闭合 SQLite snapshot，可选 Library blobs，并排除
credential bytes、Browser session/cookie、device binding、absolute machine path、
cache 与临时状态；Provider metadata 可保留，但恢复为 disabled 并要求新设备重新
授权。新设备导入保留 stable Profile/Project/Conversation/Library
identity，创建新的 device identity，Project path 由用户显式 rebind。Sync 只增加
profile/device/revision/journal/tombstone 的 provider-neutral 基础，默认 provider
禁用且没有网络实现。

```text
SCHEMA_VERSION: 7
DATA_ROOT_SOURCE_DELETE: NEVER
LIBRARY_ROOT_SOURCE_DELETE: NEVER
PORTABLE_CREDENTIAL_BYTES: EXCLUDED
CLOUD_SYNC_PROVIDER: DISABLED
CLOUD_SYNC_REQUESTS: 0
```

## 83. First Web Intelligence Slice

Web Intelligence 的首个 Slice 继续位于 canonical `Model + Harness + Tools`：
`WebToolProvider` 通过既有 `ToolProvider` 同时贡献稳定语义 Tool
`web.search` 与 `web.fetch`，二者显式使用现有 `AgentToolEffect::NETWORK`，
经同一个 catalog、PolicyEngine/Approval、RoutedToolExecutor、durable
ToolCall receipt 与 Verification boundary；Core 没有 Search/Web-specific
AgentCoordinator 分支，也没有新增 Agent、Runtime、Permission、Receipt 或
Verification hierarchy。

`web.search` 使用 provider-neutral `SearchBackend`，首个 production adapter
为 `brave.search.v1`。Brave secret 只接受显式注入的 `SecretBytes`；当前 generic
CredentialStore 虽能安全保存 bounded bytes，但没有非模型 integration 的产品级
identity/config/activation flow，因此本 Slice 不读取环境变量、不注册产品 credential、
不新增 UI/schema/migration，并且 live search request 为 0。Agent-facing Tool identity
不包含 Brave，deterministic backend switch test 证明替换 backend 不改变 Tool definition。

`web.fetch` 固定单 URL/GET、HTTP(S)、80/443、无 userinfo/header/body/cookie/
Browser session/JS/implicit proxy。每一 hop 先解析 DNS，拒绝任何非公网或 mixed
answer，再将 reqwest 连接 pin 到已验证 SocketAddr；最多五次 redirect 且每次重走
scheme/host/DNS/IP gate，credentialed request 不跨 origin。Body 在 stream 中以
2 MiB fail-close，`Accept-Encoding: identity` 且拒绝其他 encoding；只接受 HTML、
XHTML 与 plain text。HTML 使用 `scraper/html5ever` 真实 DOM parser，排除 script、
style、nav、hidden 等 subtree；最终文本受现有 64 KiB provider observation contract
约束为 48 KiB。

Search snippet 与 fetch text 均明确输出 `UNTRUSTED_WEB_CONTENT`、
`instruction_authority=false`，且现行 Agent system instruction 已把所有 Tool output
裁决为 untrusted data。Core integration 证明 NETWORK 请求在批准前不执行；成功
receipt 由 Core 追加 `fielora.web/HTTPS` execution source，但 HTTP 200/search success
均不产生 Verification receipt、不改变 Policy，也不完成 AgentRun。

```text
FIRST_WEB_INTELLIGENCE_SLICE: IMPLEMENTED
WEB_TOOLS: web.search + web.fetch
AGENT_ARCHITECTURE: UNCHANGED_MODEL_HARNESS_TOOLS
TOOL_EFFECT: NETWORK
SSRF_POLICY: RESOLVE_VALIDATE_PIN_REVALIDATE_REDIRECT
LIVE_SEARCH_REQUESTS: 0
LIVE_FETCH_REQUESTS: 0
PRODUCT_CREDENTIAL_ACTIVATION: DEFERRED
SCHEMA_MIGRATION: NONE
UI_BROWSER_RUNTIME: UNCHANGED
CHANGE_IMPACT: HIGH
```

Targeted final Gate 为 Web 15/15、Agent 45/45（含 Skill）、Model 17/17、
Platform 2/2、Core 23/23、真实 stdio MCP 12/12；targeted Clippy
`-D warnings`、fmt、Core release build、contracts、Docs context manifest 与
diff check 均 PASS。没有运行与本 Slice 无关的 Desktop E2E、package/portable
smoke 或 full premerge。

## 84. First File Intelligence Read / Extract Slice

Rich File Read / Extract 继续位于 canonical `Model + Harness + Tools`。新增且
仅新增一个 built-in `OBSERVE` Tool：`file.extract`；现有 `read_file` 继续负责
UTF-8 代码/文本。PDF、DOCX、PPTX、XLSX 通过格式 adapter 产生同一 bounded、
provider-neutral normalized observation；没有 File/PDF/Office Agent、Artifact
Runtime、UI、schema、migration、credential、网络或新的 Permission/Receipt/
Verification hierarchy。

Project-relative 输入复用现有 canonical containment，并对打开 handle 与重新准入
路径做 file identity 对照；source digest 覆盖最终解析的同一 handle bytes。所有内容
均标记 `UNTRUSTED_PROJECT_CONTENT`。Core pipeline proof 证明 Observe ToolCall 经
现有 PolicyEngine、ToolExecutor、durable receipt 与 execution-source envelope；
receipt 不保存正文/原始 PDF/ZIP/XML，解析成功不产生 Verification PASS。

OOXML 在高层 parser 前执行共享 ZIP/XML admission：entry/path/duplicate/encryption/
macro/size/expanded-total/XML depth/attribute/event/DTD/expected-structure 全部
fail-closed，external relationship 不跟随。PDF 使用修复过嵌套问题且支持 load/page
解压上限的 parser。XLSX 只输出值、公式 source 与已有 cached value，绝不求值或
触发 file/network/shell/DDE。

```text
FIRST_FILE_INTELLIGENCE_READ_SLICE: IMPLEMENTED
TOOL: file.extract
FORMATS: PDF + DOCX + PPTX + XLSX
AUTHORITY: UNTRUSTED_PROJECT_CONTENT
TOOL_EFFECT: OBSERVE
SCHEMA_MIGRATION: NONE
UI_ARTIFACT_RUNTIME: NOT_IMPLEMENTED
CHANGE_IMPACT: HIGH
```

精确架构边界与资源上限记录于非冻结
`FIELORA_V0.1_FILE_INTELLIGENCE_READ_CANDIDATE.md`。Creation/edit/export、
preview/render、OCR、图片提取、公式计算、宏及远程文件继续后置。

Targeted final Gate 为 File 11/11、Agent full 56/56（含 Skill/Web）、Core
24/24、真实 stdio MCP 12/12；targeted Clippy `-D warnings`、fmt、Core release
build、contracts、Docs context manifest 与 diff check 均 PASS。未安装
`cargo-audit`，advisory 使用 RustSec primary records 与 exact dependency tree
人工核对；未运行与本 Slice 无关的 Desktop E2E、package/portable smoke 或
full premerge。

## 85. User-configured Local MCP Connection Foundation

技术用户现在可在现有 `PlatformPaths.config_dir/mcp.json` 声明最多八个已安装的
absolute-path Local stdio MCP Server。配置读取只形成 exact-bytes SHA-256 的
AgentRun snapshot；不做 executable admission、spawn、discovery、network 或
credential read。Project 内 `.mcp.json`、`mcp.json`、`.fielora/mcp.json` 不扫描，
因此打开 repository 不会触发本地进程。

仅新增 built-in `mcp.list_connections`（OBSERVE）与
`mcp.activate_connection`（PROCESS）。Activation 在现有 Policy/Approval 后验证
snapshot digest，随后复用既有 `McpStdioToolProvider`、ManagedChild/env_clear/Job
Object 与 provider-neutral catalog。Run-scoped provider 在下一 Model turn 通过同一
catalog path 暴露；Run terminal/cancel/discovery failure/Core exit 均由现有 Drop
链回收。Windows provider 生命周期内持有禁止 write/delete sharing 的只读
executable handle，使运行文件与 identity digest 绑定；没有 Connection Runtime 或
daemon。

任意 user-configured MCP Tool 统一使用已有 `DESTRUCTIVE` effect；MCP
`readOnlyHint/destructiveHint`、名称与描述不能降权。Activation 与 MCP Tool 成功都不
产生 VerificationReceipt。Receipt 只保存 connection/config/provider/executable
digest 与既有 MCP source envelope，不保存绝对路径、argv、raw config 或 env。

```text
USER_LOCAL_MCP_CONNECTION_FOUNDATION: IMPLEMENTED
CONFIG_SOURCE: USER_APP_CONFIG_ONLY
PROJECT_MCP_AUTO_IMPORT: FORBIDDEN
TRANSPORT: LOCAL_STDIO_ONLY
UNKNOWN_TOOL_EFFECT: DESTRUCTIVE
CREDENTIALS_REMOTE_UI_INSTALLER: NOT_IMPLEMENTED
SCHEMA_MIGRATION: NONE
NEW_DEPENDENCIES: 0
CHANGE_IMPACT: HIGH
```

## 86. Artifact Type Storage Extensibility Repair

Durable Artifact 的 schema-8 `artifacts.artifact_type` 原先使用
`DOCUMENT/PRESENTATION` closed SQL CHECK，导致每个未来 typed Artifact 都必须
增加一次数据库迁移。Forward migration
`0009_artifact_type_extensibility` 只重建 `artifacts` envelope：数据库现在验证
1..32-byte ASCII uppercase `[A-Z][A-Z0-9_]*` canonical token；0001–0008、
`artifact_revisions`、revision/recovery/idempotency、Tool/Receipt/Verification 和
Profile schema 均不变。

Storage extensibility 不产生 semantic authority。该 repair 完成时 Production
`ArtifactType`、`ArtifactContentV1` 和 Model-facing Artifact Tool schema 仍只接受
Document/Presentation；此历史状态已由下述 Diagram First Slice additive
supersede。当前 reader 遇到 `FUTURE_ARTIFACT` 等仍未知的 canonical token 时继续
稳定返回 `ARTIFACT_TYPE_UNSUPPORTED`，没有 arbitrary JSON fallback、类型降级、
静默跳过或数据删除。Spreadsheet 仍未实现。

真实 schema-8 fixture 覆盖 Document、Presentation、多 revision 与 Artifact
Verification subject。迁移到 schema 9 后 Artifact/Revision IDs、current pointer、
content schema version 1、canonical content/digest、Profile/Project/Conversation
provenance、FK 与 index 保持；注入 table replacement 后故障证明 registry 不推进、
旧表/数据恢复、无 partial replacement table 且 foreign keys 恢复 ON。

```text
CURRENT_DATABASE_SCHEMA: 9
MIGRATION_0009: artifact_type_extensibility
SQLITE_ARTIFACT_TYPE: BOUNDED_CANONICAL_TOKEN
DOMAIN_ARTIFACT_TYPE_AT_REPAIR: CLOSED_DOCUMENT_PRESENTATION
UNKNOWN_TYPE: ARTIFACT_TYPE_UNSUPPORTED
CONTENT_SCHEMA_VERSION: 1_UNCHANGED
DIAGRAM_SPREADSHEET_IMPLEMENTATION_AT_REPAIR: NONE
CURRENT_STATE: SUPERSEDED_BY_SECTION_87
NEW_DEPENDENCIES: 0
CORE_AND_CROSS_DEVELOPMENT_GATES: PASS
RUST_WORKSPACE_TESTS: 177_PASS
DESKTOP_TYPESCRIPT_TESTS: 176_PASS
CORE_INTEGRATION: 12_PASS
FULL_PREMERGE_BROWSER_E2E_PACKAGED: NOT_RUN
```

## 87. Diagram Artifact First Implementation Slice

Durable Artifact Core 现在 additive 支持第三个 closed typed Artifact：`DIAGRAM`。
`ArtifactType::Diagram` 与 `ArtifactContentV1::Diagram(DiagramArtifactV1)` 只增加
bounded nodes/edges/one-level groups、stable local IDs、closed semantic/style intent
及 `LAYERED_AUTO` direction；不接受 arbitrary JSON、raw SVG/XML/Mermaid/CSS、
manual geometry 或 operation DSL。Document/Presentation representation 和
`content_schema_version=1` 保持不变。

Diagram create/read/update 完整复用现有 Artifact/Profile/Project ownership、schema-9
`artifacts`/`artifact_revisions`、immutable revision、current pointer CAS、ToolCall
idempotency、restart recovery、Policy/Approval、durable ToolCall receipt、exact
Artifact-revision Verification subject 与 mutation freshness。没有 Diagram Tool、
Agent、Runtime、revision/receipt/verification hierarchy、table 或 migration；数据库
schema 继续为 9，0001–0009 未修改。

`FIELORA_BOUNDED_LAYERED_V1` 是 repository-owned bounded renderer adapter：先做
weak components 与 SCC condensation/rank，再按 stable local ID、exclusive one-level
group band 与 fixed CJK/Latin width estimate 确定 placement，支持 cycle、self-edge、
parallel/cross-edge 和 disconnected graph。相同 canonical revision、renderer
`fielora.diagram.svg@0.1.0`、theme `LIGHT_NEUTRAL_V1` 产生相同 layout digest 和
SVG bytes；不可读文本或 viewBox 超过 16384/axis 时稳定
`DIAGRAM_LAYOUT_OVERFLOW`。

只有 saved Diagram revision 可通过现有 `artifact.export` 导出 Project-relative
`.svg`；inline Diagram export 不支持。受控 writer 只生成 static allowlist vocabulary，
无 script/style/foreignObject/image/use/animation/href/event/URL/raw attribute。最终
bytes 在写前与 atomic write 后都由既有 direct `quick-xml 0.41` 独立 parse，验证
root/namespace、elements/attributes、finite/bounded geometry、node/edge/group counts
及 rendered text。Receipt 只记录 Artifact/revision/digest、renderer/layout/viewBox/
counts/output digest，不保存完整 semantic content 或 SVG；export success 不生成
Verification PASS，`artifact.read` 继续标记 `UNTRUSTED_ARTIFACT_CONTENT`。

```text
DIAGRAM_ARTIFACT_FIRST_SLICE: IMPLEMENTED / TARGETED_VALIDATED
ARCHITECTURE: MODEL + HARNESS + EXISTING_ARTIFACT_TOOLS
ARTIFACT_TYPES: DOCUMENT + PRESENTATION + DIAGRAM
DIAGRAM_SOURCE: CLOSED_TYPED_SEMANTIC_GRAPH
LAYOUT: FIELORA_BOUNDED_LAYERED_V1
RENDERER: fielora.diagram.svg@0.1.0
DIAGRAM_INLINE_EXPORT: NOT_SUPPORTED
CONTENT_AUTHORITY: UNTRUSTED_ARTIFACT_CONTENT
CURRENT_DATABASE_SCHEMA: 9
NEW_MIGRATION: 0
NEW_DEPENDENCIES: 0
UI_FIPC_PNG_MERMAID_COMPOSITION_SPREADSHEET: NOT_IMPLEMENTED
CHANGE_IMPACT: HIGH
```

## 88. Spreadsheet Artifact First Implementation Slice

Durable Artifact Core 现在 additive 支持第四个 closed typed Artifact：
`SPREADSHEET`。`SpreadsheetArtifactV1` 只包含 bounded workbook metadata、stable
sheet-local ID、XLSX-compatible display name、one-based typed coordinate、sparse
non-empty cells、`STRING/DECIMAL/BOOLEAN` literal，以及 closed format/presentation
intent；不接受 arbitrary JSON、XLSX/CSV/OOXML source bytes、Formula、Date、merge、
chart、link、macro、external data 或 executable DSL。

Spreadsheet canonicalization 按 stable Sheet ID 排 sheets、按 row/column 排 cells、
拒绝 identity/name/coordinate collision，并把等价 decimal lexical forms 收敛为
bounded canonical token。输入 sheet/cell array order 不进入语义；canonical typed JSON
与现有 SHA-256 仍是 Artifact semantic authority。Formula-like `STRING`（包括 `=`、
`+`、`-`、`@` 前缀）通过 writer 后独立 reopen 为 exact literal text；Formula variant
和 calculation engine 不存在，`CALCULATION_AUTHORITY=NONE`。

现有 exact-pinned `office_oxide 0.1.8` 已通过 test-only multi-sheet writer Gate，随后
以 `fielora.spreadsheet.xlsx@0.1.0+office_oxide.0.1.8` 接入 saved-revision
`artifact.export`。Production adapter 在内存中生成 XLSX，独立检查 bounded ZIP/OPC、
required parts、internal-only relationships、zero formula/macro/external/link/drawing，
精确 reopen sheet order/name 与 sparse coordinate/type/value；atomic write 后对 final
bytes 再次做 size/hash/reopen。当前 probe 观察到 byte-identical output，但 ZIP byte
identity 不是 Artifact contract，semantic digest 和 exact output digest 分别承担语义与
文件身份。

Spreadsheet create/read/update/export 完整复用现有 Artifact/Profile ownership、
schema-9 generic rows、immutable revision、CAS、ToolCall idempotency、restart recovery、
Policy/Approval、durable receipt、exact Artifact-revision Verification/freshness 与
`UNTRUSTED_ARTIFACT_CONTENT`。没有 Spreadsheet-specific Tool、Agent、Runtime、
revision/receipt/verification hierarchy、DB table、migration、dependency、UI 或 FIPC。

```text
SPREADSHEET_ARTIFACT_FIRST_SLICE: IMPLEMENTED / TARGETED_VALIDATED
ARCHITECTURE: MODEL + HARNESS + EXISTING_ARTIFACT_TOOLS
ARTIFACT_TYPES: DOCUMENT + PRESENTATION + DIAGRAM + SPREADSHEET
SPREADSHEET_SOURCE: CLOSED_TYPED_LITERAL_WORKBOOK
COORDINATES: ONE_BASED_TYPED_ROW_COLUMN
CALCULATION_AUTHORITY: NONE
RENDERER: fielora.spreadsheet.xlsx@0.1.0+office_oxide.0.1.8
SPREADSHEET_INLINE_EXPORT: NOT_SUPPORTED
CONTENT_AUTHORITY: UNTRUSTED_ARTIFACT_CONTENT
CURRENT_DATABASE_SCHEMA: 9
CONTENT_SCHEMA_VERSION: 1
NEW_MIGRATION: 0
NEW_DEPENDENCIES: 0
FORMULA_CHART_IMPORT_UI_NEW_RUNTIME: 0
CHANGE_IMPACT: HIGH
```

## 89. PNG Admission and Durable Source Asset First Slice

Artifact foundation 现在新增第一种 durable binary resource：Profile-owned、immutable
的 PNG Source Asset。`artifact.asset.import` 仍是现有 `WORKSPACE_WRITE` ToolCall，经过
PolicyEngine/Approval/ToolExecutor/durable receipt；它只读取 current Project 内的
bounded relative regular file，不接受 absolute path、URL、Library/Data/Cache path、
symlink/reparse escape，也不把 bytes/path 传给 Model。

Fielora-owned PNG admission 先执行 exact signature、bounded raw chunk scan、CRC、
IHDR/contiguous IDAT/final IEND/EOF 与 closed ancillary allowlist，再由 exact-pinned
`png 0.18.1` 在 CRC + Adler 开启、64 MiB decoder limit、IDENTITY transform 下完成
一次 full static decode。第一版只允许 8-bit grayscale/RGB/GA/RGBA；8 MiB encoded、
4096/axis、16,777,216 pixels、64 MiB decoded、128 chunks。APNG、Adam7、palette/tRNS、
1/2/4/16-bit、text/compressed text/iCCP/eXIf、private/unknown chunks、bad checksum、
malformed deflate、trailing/polyglot 全部 fail closed。只有 exact original encoded bytes
持久化；decoded pixels 立即释放。

Forward migration `0010_durable_source_assets` 把 schema 提升到 10，只新增 immutable
`assets` metadata、Profile scope、provenance、index 与 update/delete denial triggers；
0001-0009 不变。Asset bytes 复用现有 `LibraryRoot/blobs/objects/<prefix>/<sha256>`
content-addressed layout，但不创建 `LibraryObject`、Library category/UI/tombstone/journal；
Library delete 仍只改 metadata，不删除 shared blob。Blob-first→metadata transaction→
receipt 的 crash ordering 不会产生成功 metadata 指向缺失 blob；metadata failure 只可能
留下 safe deduplicable orphan，本 Slice不做 delete/GC。

`AssetId` 与 content SHA-256 分离；同 ToolCall/request replay 返回同 AssetId，新
ToolCall 导入相同 bytes 可创建新 AssetId 并共享 blob。`ArtifactAssetRefV1` pin
AssetId/digest/`image/png`/byte length，Document `INLINE_IMAGE` 只增加
`DOCUMENT_WIDTH_BOUNDED` 与 optional bounded alt text。Document create/update 在 parent
revision commit 前 exact-resolve same-Profile Asset metadata；saved export 从 controlled
blob 重查 length/SHA/static PNG structure/dimensions，形成 immutable render snapshot，
再复用 `office_oxide` DOCX inline image writer。Final DOCX bytes 独立 reopen media part、
internal relationship、content type、drawing ref、bounded extent 与 exact embedded digest。

Receipt 继续是 existing ToolCall receipt，只保存 bounded Asset facts、reference count 与
canonical sorted Asset-set digest；binary/path/decoded pixels/EXIF 不进入 receipt、Context、
Model 或 Verification。Admission/embedding success 不产生 semantic Verification PASS。

```text
PNG_SOURCE_ASSET_FIRST_SLICE: IMPLEMENTED / TARGETED_VALIDATED
ARCHITECTURE: MODEL + HARNESS + EXISTING_TOOLS
INGRESS_TOOL: artifact.asset.import / WORKSPACE_WRITE
PNG_DECODER: png 0.18.1 / DEFAULT_FEATURES_FALSE
ASSET_STORAGE: SHARED_LIBRARYROOT_CONTENT_BLOB / NO_LIBRARY_OBJECT
ASSET_IDENTITY: ASSET_ID_DISTINCT_FROM_CONTENT_SHA256
DOCUMENT_BLOCK: INLINE_IMAGE / DOCUMENT_WIDTH_BOUNDED
ASSET_EXPORT_REVALIDATION: LENGTH_SHA256_STATIC_STRUCTURE
CONTENT_AUTHORITY: UNTRUSTED_ARTIFACT_CONTENT / BINARY_NOT_IN_MODEL_CONTEXT
CURRENT_DATABASE_SCHEMA: 10
MIGRATION_0010: durable_source_assets
PRESENTATION_IMAGE_DIAGRAM_RASTER_UI_DELETE_GC_REMOTE_IMAGE: NOT_IMPLEMENTED
CHANGE_IMPACT: HIGH
```

## 90. Capability / Tools V0.1 Artifact Completion

Durable Artifact 的当前产品能力已在既有 `Model + Harness + Tools` 管线内收口。
Presentation 新增 closed typed `IMAGE` block，只接受 exact durable
`ArtifactAssetRefV1` 与 `CONTAIN` layout intent；不接受 path、URL、base64、raw bytes、
SVG、LibraryObject、EMU 或任意 geometry/OOXML。Document 与 Presentation 现在复用同一
Profile-scoped Asset resolver。Saved Presentation export pin exact revision/blob snapshot，
重查 length/SHA/static PNG structure/dimensions，复用现有 PPTX writer，并对最终包执行
bounded Office entry admission、internal-only relationships、`p:pic`、`image/png`、placement、
embedded digest 与 unexpected-media graph reopen。R1→PNG A、R2→PNG B、再次导出 R1→A
保持历史精确性；text-only Presentation 与 renderer v0.2 语义不变。

新增三个 ordinary Artifact Tools：`artifact.list` 与 `artifact.history` 均为
`OBSERVE`、Profile-scoped、metadata-only、default 20/max 100；historical semantic content
仍只由 `artifact.read(artifact_id, revision_id)` 显式读取。`artifact.set_archive_state`
为现有 `WORKSPACE_WRITE`/Policy/Approval/ToolCall/receipt/recovery 路径上的 reversible
visibility mutation。Migration `0011_artifact_archive_state` 将 schema 10→11，只在
existing `artifacts` envelope 增加 `archived_at`、ToolCall idempotency/recovery facts 与
bounded index；无新 table、revision、content schema、Verification subject 或 Runtime。
Archive 默认从 list 隐藏，但不删除 identity/revisions，不阻断 explicit read/export 或
historical composition reference。

现有 internal `read_asset` 与 generic resolver 已满足 bounded Asset metadata需求，未新增
Model-facing Asset manager/list/history/binary/blob-path Tool，也仍无 delete/GC。Production
catalog audit 为 34 built-ins + existing two Web provider Tools，external providers继续受
16 providers/32 Tools-per-provider上限，Model-visible exposure继续按 task class、permission、
phase/verification过滤；当前规模不需要 vector tool search 或第二套 registry。

`web.download` 诚实标记为 `WEB_DOWNLOAD_DEFERRED_POLICY_MODEL`：当前 Tool contract每次
调用只有一个 `AgentToolEffect`，不能同时表达 `NETWORK + WORKSPACE_WRITE`。本 changeset
禁止用其中一个 effect 偷渡另一个 authority，也不新增 composite Permission/protocol。
现有 `web.search`/`web.fetch` 与 `file.extract`/`artifact.asset.import` 保持独立可用能力。

```text
CAPABILITY_TOOLS_V0_1: SUFFICIENT
PRESENTATION_DURABLE_PNG: IMPLEMENTED / TARGETED_VALIDATED
ARTIFACT_LIST_HISTORY_ARCHIVE_RESTORE: IMPLEMENTED / TARGETED_VALIDATED
ASSET_METADATA_TOOL: NOT_NEEDED / INTERNAL_RESOLVER_REUSED
WEB_DOWNLOAD: WEB_DOWNLOAD_DEFERRED_POLICY_MODEL
CURRENT_DATABASE_SCHEMA: 11
MIGRATION_0011: artifact_archive_state
NEW_DEPENDENCIES: 0
NEW_RUNTIME_PERMISSION_RECEIPT_VERIFICATION_UI: 0
GENERAL_ADDITIONAL_TOOLS: 0
CHANGE_IMPACT: HIGH
```

Targeted final evidence为 Agent 124、Office writer 8、Contracts 2、Core 29、Storage 26
全部 PASS，并由 TypeScript、Core integration、Core/Cross/Docs development lanes、
Clippy `-D warnings`、fmt、context audit、diff check 与 release Core build收口。完整
PreMerge、已知 Browse baseline、Desktop/visual、packaged/portable、live network 与 Model
probe按范围未运行。详细事实见
`docs/architecture/FIELORA_V0.1_CAPABILITY_TOOLS_CLOSEOUT.md`。

## 91. Artifact Working Surface Product Integration

Durable Artifact 已进入现有 Project Conversation 右侧 `RightWorkspaceDock`：
Profile-scoped Artifact catalog 与 `artifact:<ArtifactId>` 多 tab 为 session-local UI
state，关闭 tab 不改 Artifact，restart 后可从 durable catalog 重新打开。
Document、Presentation、Diagram、Spreadsheet 都以 exact semantic revision 为 UI
authority；CURRENT 跟随新 current revision，HISTORICAL 固定 exact revision 并显示
有新版本。Spreadsheet 只生成 bounded 20×10 viewport DOM，Diagram 只通过既有
deterministic renderer 和 structural reopen 产生 transient controlled SVG。

Desktop 新增最小 read/mediation FIPC：Artifact list/read/history、same-Profile exact
PNG Asset preview、exact Diagram preview 与 archive/restore human command。Preview 不暴露
DataRoot/LibraryRoot/blob/SQLite/temp path，PNG 重查 expected digest、size 与 strict
admission；SVG 使用 `<img>`，不注入 DOM。Archive/restore 由 zero-model human command
继续走既有 PolicyEngine、ToolExecutor、durable ToolCall receipt 与 recovery，没有
第二条 mutation path。

Agent request 可携带 Core-validated `ActiveArtifactContext`：Artifact/type、viewed/current
revision、CURRENT/HISTORICAL、archive 与 optional selected slide/sheet。该 trusted
application selection 进入当次 Context Snapshot 并绑定 AgentRun，但不自动加入
Document blocks、slides、cells、graph、history 或 PNG bytes；Artifact content 继续是
`UNTRUSTED_ARTIFACT_CONTENT`，Model 需要内容时使用 existing `artifact.read`。
create/update UI 同步只消费 foreground Conversation 的 durable ToolCall receipt，不解析
自然语言，也不增 Agent→UI protocol。

```text
ARTIFACT_WORKING_SURFACE: IMPLEMENTED / TARGETED_DESKTOP_VALIDATED
HOST: EXISTING_RIGHT_WORKSPACE_DOCK
MUTATION: CHAT_DRIVEN_EXISTING_ARTIFACT_TOOLS
ACTIVE_CONTEXT: BOUNDED_TRUSTED_SELECTION_METADATA
CONTENT_AUTHORITY: UNTRUSTED_ARTIFACT_CONTENT
PREVIEW: PROFILE_SCOPED_PNG + VALIDATED_DIAGRAM_SVG
CURRENT_DATABASE_SCHEMA: 11
NEW_MIGRATION: 0
NEW_MODEL_TOOLS: 0
NEW_DEPENDENCIES: 0
DIRECT_EDITORS_FORMULA_CHART_CANVAS_DESIGNER: DEFERRED
CHANGE_IMPACT: HIGH
```

## 92. Overall Desktop Product Experience Redesign

Fielora Desktop 已在既有 `Quiet Workbench`、Theme Registry 与 `--fl-*` semantic
token 基线上完成一次 presentation-only 整体收敛。Project/Conversation 信息架构不变，
Conversation 保持主协作线；Activity 作为可渐进披露的次级事实；Composer 使用统一的
floating control depth；Document、Presentation、Diagram、Spreadsheet 与 File/Browse/Review
继续由同一 `RightWorkspaceDock` 承载，并统一 tab/header/toolbar/body 视觉语法。

Artifact Working Surface 不再用常驻版本侧栏压缩内容，既有 exact revision history 改为
header disclosure；archive/restore、CURRENT/HISTORICAL 与 durable semantics 不变。Settings
从管理卡片收敛为 section/row，MCP 配置保持被动读取并将 command/argument/credential/tool
scope 放入按需展开的技术细节；`Configured/Current/Active` 使用中性色，只有真实 PASS/FAIL
使用绿/红。

Typography 收敛到约 12.5px metadata、13.5px controls 与 15px body；有限 glass 只用于
shell/header/floating control/popover，并有无 `backdrop-filter` fallback。Light/Dark/System
继续使用同一组件和 Theme Registry，没有第二套 theme engine。1280px 下右工作区成为
720px session-local overlay，使 Conversation 保持 1006px；1440/1920 下继续并排，实测
Conversation 分别为 382px/862px，Composer 与 Dock 均未越界。

真实 Electron deterministic Gate 生成 `artifacts/overall-ui-redesign/` 12 张 Light/Dark、
Conversation/Activity、四类 Artifact、multi-tab、Settings/MCP 视觉证据；Model requests=0，
public network requests=0。UI lane 的 typecheck、lint、180 TS tests，以及 Artifact、Appearance、
Conversation long-task、MCP 与 overall visual targeted E2E 均 PASS。旧
`workspace-dock-tabs-e2e` 单独运行命中已知 Core startup/Browse baseline，并未修改或放宽。
Human visual acceptance 仍需用户基于截图或真实 Desktop 完成。

```text
OVERALL_UI_REDESIGN: IMPLEMENTED / TARGETED_DESKTOP_VALIDATED
DESIGN_LANGUAGE: QUIET_WORKBENCH_CONVERGED
PRIMARY_FLOW: PROJECT_CONVERSATION
WORKING_SURFACE: EXISTING_RIGHT_WORKSPACE_DOCK
THEME_ENGINE: EXISTING_THEME_REGISTRY
CURRENT_DATABASE_SCHEMA: 11
NEW_MIGRATION: 0
NEW_DEPENDENCIES: 0
BACKEND_FIPC_MODEL_TOOL_SEMANTIC_DELTA: 0
MODEL_REQUESTS: 0
PUBLIC_NETWORK_REQUESTS: 0
HUMAN_GATE: READY / NOT_YET_ACCEPTED
CHANGE_IMPACT: MEDIUM / PRESENTATION_ONLY
```

## 93. Final UI / Product Exposure Polish

Overall UI Human Review 的主要问题已在同一 changeset 收口。Diagram 默认按
renderer intrinsic coordinate size显示，不再因容器 `fit-contain` 或二次 CSS scale缩成
中央细条；Surface具有固定可用高度、内部低存在感滚动和临时“适合视图 / 可读大小”切换，
不会改变 Diagram semantic revision。Spreadsheet移除行/列 slider，继续用 bounded 20×10
sparse DOM viewport，并通过水平/垂直滚动更新当前窗口；sheet/header/grid与 literal alignment
保持产品化 viewer语义。Presentation放大 active slide、增加 navigator可读宽度与完整 title
tooltip；active dock tab获得更高宽度优先级与 horizontal overflow。

Workspace移除 Artifact上方重复 Project toolbar，保持 Tabs + Artifact Header；1440/1920
并排实测 Conversation为580/862px，1280使用720px overlay且Conversation保持1006px。
0-message Conversation让同一Composer进入lower-center start state，首条消息后回到底部模式。
文件变更summary数字、Full Control permission mode、MCP configured/inactive state与普通 folder
action统一为中性色；真实 PASS/FAIL与代码diff内容仍保留语义色。Light/Dark均使用既有Theme
Registry，没有新theme或glass范围。

Settings新增产品拥有的Skills与插件页面，并与现有MCP并列为“AI与扩展”。Skills只读取现有
`SkillCatalog` metadata，分组Built-in/current Project/Plugin-contributed，展开也不调用
`load_skill`或展示body；`allowed-tools`明确是advisory。Local Plugin Registry复用ConfigRoot
的bounded `local-plugins.json`，只保存最多16个explicit canonical root reference。人类通过
trusted FIPC注册/移除，existing Plugin Contribution Host每次被动重读manifest/Skill facts；
broken root保留为unavailable且不crash，移除不删除Plugin文件。Project不会自动扫描Plugin
目录，registry不会读取Credential、启动process/network/MCP或向Model暴露路径/能力。

```text
FINAL_UI_PRODUCT_EXPOSURE_POLISH: IMPLEMENTED / TARGETED_DESKTOP_VALIDATED
SKILLS_SETTINGS: METADATA_ONLY / EXISTING_SKILL_CATALOG
LOCAL_PLUGIN_REGISTRY: CONFIG_ROOT_REFERENCES_ONLY
PLUGIN_EXECUTABLE_RUNTIME_INSTALLER_MARKETPLACE: NOT_IMPLEMENTED
MODEL_TOOL_DELTA: 0
CURRENT_DATABASE_SCHEMA: 11
NEW_MIGRATION: 0
NEW_DEPENDENCIES: 0
MODEL_REQUESTS: 0
PUBLIC_NETWORK_REQUESTS: 0
HUMAN_GATE: READY / NOT_YET_ACCEPTED
CHANGE_IMPACT: MEDIUM / TRUSTED_CONFIG_AND_PRODUCT_EXPOSURE
```

UI development lane为184/184 TS PASS；Cross development lane包含Contracts、全部affected
Rust、Clippy、12 Core integration并PASS。Artifact Working Surface、Overall visual、MCP
Settings与Appearance Light/Dark targeted E2E均PASS，最终12张截图位于
`artifacts/final-ui-polish/`。Full PreMerge、Browse baseline、packaged/portable、live Model与
public network按范围未运行。

## 94. Agent Framework Architecture Terminology Closure

2026-08-28，Fielora Agent 的顶层公式继续固定为：

```text
Agent = Model + Harness + Tools
```

Harness 的八个一级职责域最终收口为 Ingress & Context、Work Scope & Goal、
Continuity、Orchestration、Governance、Execution、Verification & Evidence 与
IDR（Individualized Disposition Runtime）。旧 `Identity & Goal` 收缩并改名为
`Work Scope & Goal`；`Adaptation` 不再是一级域，其原有语义按 context、
continuity、retry、verification、model behavior 与 human personalization
分别归入现有 owner。

IDR 现在只表示长期、可校正 Human Model 的语义 owner，并通过
`Individualized Direction` 向 Model/Harness 提供个体化方向。Fact、Observation、
Preference 与 Inference 必须区分；IDR 不拥有 reasoning、planning、Tool
selection authority、Permission、Approval、Execution、Verification、Reality
或 final decision authority。旧 Phase 04 的 ASK/CAPTURE/PROMOTE/CONTINUE
`Bounded IDR` 正式改称 `Entry Intent Resolver`，历史 Candidate/Freeze/Evidence
原文保留但属于 superseded terminology。

Memory 是 cross-cutting Domain：working memory 由 Orchestration + Continuity
承载，episodic history 主要由 Continuity 持有，human-specific long-term
memory 由 IDR 负责，current Project/Artifact/Decision/Reality facts 则属于
Reality/Product state 而不是 Memory。Agent Profile 是 Fielora-owned、versioned、
bundled product definition，回答“我是谁”，不是 Memory 或 Runtime。Workspace
是长期产品容器；Work Scope 是当前 Agent task/run 的边界，两者不得互换。

当前继续采用本地 single-primary-human 假设，不增加 Aegis-style Identity
Runtime、Tenant/Organization/Enterprise principal、多用户 subject 或 delegation
Runtime。Reality Identity 仍由 Fielora 持有，Provider、Model、Conversation 与
AgentRun 均不能成为 Project/Field/Artifact Reality identity owner。

代码审计未发现依赖 `Adaptation`、`IdentityGoal`、`BoundedIDR`、IDR、
HumanProfile 或 AgentProfile 名称的 runtime type、contract、table 或 migration。
现有 `AgentCoordinator`、Context/Policy、Tool/Verification 行为均不修改。本轮不
实现 IDR、Memory、Agent Profile 或新 Runtime，不新增 Schema/Migration。

```text
AGENT_FRAMEWORK: MODEL_HARNESS_TOOLS
HARNESS_DOMAINS: 8_FINAL
IDR: INDIVIDUALIZED_DISPOSITION_RUNTIME / DESIGN_ONLY
OLD_BOUNDED_IDR: ENTRY_INTENT_RESOLVER
MEMORY: CROSS_CUTTING_DOMAIN
AGENT_PROFILE: FIELORA_OWNED_PRODUCT_DEFINITION
LOCAL_IDENTITY: SINGLE_PRIMARY_HUMAN
REALITY_IDENTITY: PRESERVED
CODE_BEHAVIOR_CHANGE: NONE
SCHEMA_CHANGE: NONE
DEPENDENCY_CHANGE: NONE
```

## 95. IDR V2 Design Candidate

`docs/architecture/FIELORA_IDR_V2_DESIGN_CANDIDATE.md` 已形成 design-only
Candidate，状态为 `DRAFT / CANDIDATE / NOT FROZEN`，Implementation 未授权。
它不改变第 94 节的 Agent Framework，只细化 `Harness.IDR`。

Candidate 将 Human Model 收敛为五种不重叠语义：`FACT`、`PREFERENCE`、
`OBSERVATION`、`DISPOSITION` 与 `LONG_TERM_GOAL`。Behavioral Pattern、Working/
Communication/Decision/Risk Style 属于 Preference/Disposition dimension；
Feedback 属于 observation/correction evidence。Observation 不会静默变成
Preference，Model inference 不能成为 User Fact。

Provenance 使用 Fielora-owned source reference、source type/time 与必要的 bounded
excerpt/digest，不复制完整 Conversation。Scope Candidate 使用 GLOBAL + 可选
domain/project/task_type/interaction selector；confidence 将 explicit/observed/
inferred evidence basis 与 HIGH/MEDIUM/LOW inference confidence 分离，拒绝伪精确
浮点概率。Lifecycle Candidate 为 CANDIDATE、ACTIVE、WEAKENED、CONFLICTED、
SUPERSEDED、REVOKED，并定义 remember/correct/remove/forget/reset/inspect
contract-level semantics。

Disposition Resolution 只消费当前 Work Scope/Context/Reality reference 与 Human
Model snapshot，排除非 ACTIVE、scope mismatch、conflict、revoked/superseded 与
Reality-invalid item；输出 bounded Relevant Disposition Set 和结构化
Individualized Direction。Candidate Eval 默认上限为 8 个 Direction、每项 3 个
support refs、4 KiB projection，值未冻结。Direction 永远是 soft signal，不能覆盖
current instruction、Work Scope、Governance、Permission、Reality 或 Verification。

Privacy 维持 local-first、inspect/correct/delete/reset、no secret、no raw transcript
duplication；cloud/cross-device/multi-user sync 均 out of scope。Eval 必须以 same
Model/Harness/Task/Tools 的 IDR disabled/enabled A/B 覆盖 explicit preference、
inferred disposition 与 preference change，并把 authority/secret/Reality/scope
leakage 设为 hard safety metrics。

```text
IDR_V2_DESIGN: CANDIDATE
ONTOLOGY: 5_KINDS
CONTRACT: NOT_STARTED
SCHEMA_MIGRATION: NONE
RUNTIME_CONTEXT_UI: NOT_IMPLEMENTED
MODEL_REQUESTS: 0
NEXT: USER_REVIEW_OF_DESIGN_PRECONDITIONS
```

## 96. IDR V2 Contract Candidate

`docs/architecture/FIELORA_IDR_V2_CONTRACT_CANDIDATE.md` 已将既有 IDR V2
语义设计收敛为 minimum semantic Contract Candidate，状态为
`DRAFT / CANDIDATE / NOT FROZEN`；Contract Freeze、Schema、Migration、Runtime、
FIPC、Context integration 与 UI 均未授权。

V2 继续采用 local primary human singleton，因此移除未产生产品行为的
`HumanProfileId`。统一 `HumanModelItem` 保留五种 closed kind、bounded
provenance、evidence basis、ordinal inference confidence、flat scope selectors 与
显式 lifecycle。Model/inference 只能生成 update proposal；admission、transition、
scope matching、precedence、bounds 与 authority 均由 deterministic Harness 规则拥有。

Activation 采用 Conservative policy：explicit Fact/Preference/confirmed Goal 可在
admission 后 Active，Observation 只作为 observation evidence，inferred Disposition
必须先保持 Candidate 并经用户显式确认。`ASK_WHEN` 改名为
`CLARIFY_WHEN`，且不产生 Governance ASK 或 Approval。

Resolution 以 versioned structured snapshot 输入，输出 bounded、explainable 的
RelevantDisposition projection 与 structured IndividualizedDirection；使用
`contract_version + human_model_revision + resolution_profile_version +
resolution_ref`，不保留无意义的 `resolution_revision`。Forget/erasure 统一为
带 `DISABLE_USE / ERASE_IF_ALLOWED / RESET_PROFILE` mode 的请求，且不承诺删除
Conversation、Reality 或其他 authority 持有的历史。

```text
IDR_V2_CONTRACT: CANDIDATE
ARCHITECTURE_PLACEMENT: HARNESS_IDR
HUMAN_PROFILE_ID: REMOVED_FOR_V2
AUTOMATIC_ACTIVATION: CONSERVATIVE
ASK_WHEN: RENAMED_TO_CLARIFY_WHEN
SCHEMA_MIGRATION: NONE
RUNTIME_CONTEXT_UI: NOT_IMPLEMENTED
MODEL_REQUESTS: 0
NEXT: USER_REVIEW_OF_CONTRACT_PRECONDITIONS
```

## 97. IDR V2 Schema Candidate

`docs/architecture/FIELORA_IDR_V2_SCHEMA_CANDIDATE.md` 已把 accepted IDR V2
semantic Contract 映射为 local SQLite physical design Candidate，状态为
`DRAFT / CANDIDATE / NOT FROZEN`。本轮没有创建 migration、table、index、trigger、
Rust/Serde type、repository、Resolver、Context integration、FIPC、UI 或 Eval。

Candidate 复用现有 DataRoot 与 Fielora SQLite authority；当前仓库 schema version
仍为 11，未来候选 migration version 为 12，但文件未创建。V2 每个 database
instance 继续只有一个 implicit local primary human，不复用现有 storage Profile 充当
`HumanProfileId`，也不新建 `idr.db`、`memory.db` 或 profile table。初始 Human
Model 固定为空且 aggregate revision 为 0，不扫描历史 Conversation 或自动推断。

最小 durable set 候选为 singleton `idr_human_model_state`、typed current
`idr_human_model_items`、bounded `idr_item_history`、shared
`idr_provenance_refs` + many-to-many `idr_item_provenance`、reference-only
`idr_item_reality_refs` 与 minimal `idr_erasure_tombstones`。Durable proposal、
resolution、direction snapshot、forget request、observation 专表和 run-context 专表均
不建立；Candidate item、ephemeral resolution 与 existing `agent_context_snapshots`
分别承担对应职责。

Typed payload 采用 common relational envelope + closed/versioned/bounded
kind-specific JSON（Option B），拒绝 universal untyped JSON 与五套过重 subtype
table。Scope 使用四个 fixed nullable columns，Project ref 指向 Fielora-owned
`fields.id` 兼容身份但不伪造 FK；Reality 与 polymorphic provenance 只存 tagged
reference。EvidenceBasis/kind/confidence、lifecycle vocabulary、terminal behavior、
one-link supersession、global monotonic revision 与 compare-and-increment transaction
均形成候选约束。

Forget 的 `DISABLE_USE` 保留 Revoked audit；`ERASE_IF_ALLOWED` 与
`RESET_PROFILE` 删除 IDR-owned semantic row/relations/history，只保留不含 kind、
payload、scope、provenance 的 opaque tombstone。Resolution 默认 ephemeral；FTS、
Vector、Embedding 与 provider-specific storage 均为 0。

```text
IDR_V2_SCHEMA: CANDIDATE
STORAGE: EXISTING_FIELORA_SQLITE
CURRENT_SCHEMA_VERSION: 11
CANDIDATE_MIGRATION_VERSION: 12_NOT_CREATED
TABLES: 7_CANDIDATE
TYPED_PAYLOAD: OPTION_B
HUMAN_PROFILE_ID: NONE
INITIAL_ITEMS: 0
MIGRATION_RUNTIME_CONTEXT_UI: NOT_IMPLEMENTED
MODEL_REQUESTS: 0
NEXT: USER_REVIEW_OF_SCHEMA_PRECONDITIONS
```

## 98. IDR V2 Storage / Migration Implemented Candidate

用户于 2026-08-28 单独授权 IDR V2 的 storage/migration slice，不授权 Resolver、
Individualized Direction、ContextCompiler/AgentCoordinator integration、Model
extraction/learning/activation、Memory、FIPC/UI 或 Eval。实现继续位于既有
`Harness.IDR` 和 `fielora-storage`，没有建立第二套 Core/Runtime/State/
Permission/Evidence，也没有改变任何现有 Agent 行为。

实现时重新确认 migration 0012 未被占用，因此
`0012_idr_v2_human_model.sql` 将 existing local Fielora SQLite schema 11→12。
Migration additive、Immediate transaction、初始 singleton aggregate revision 为 0、
items 为 0，不扫描 Conversation、不导入旧 Memory、不推断或 seed Human Model。
它只创建 `idr_human_model_state`、`idr_human_model_items`、
`idr_item_history`、`idr_provenance_refs`、`idr_item_provenance`、
`idr_item_reality_refs`、`idr_erasure_tombstones` 七表和六个真实 query/
uniqueness indexes；proposal/resolution/direction/forget/observation/run-context/
profile/user 专表仍为 0，FTS/Vector/Embedding 仍为 0。

`fielora-storage::idr` 使用 common relational envelope + closed/versioned/bounded
kind-specific JSON，建立五种 Rust typed payload、16 KiB V2 payload profile、2 KiB
bounded provenance support、EvidenceBasis/confidence matrix、fixed nullable Scope、
Project `fields.id` ownership validation、reference-only Reality dependency、
singleton revision compare-and-increment、完整 lifecycle matrix、repository-only
terminal guard、one-link correction/supersession、consistent snapshot read、
DISABLE_USE、ERASE_IF_ALLOWED、shared-provenance GC、RESET_PROFILE 与 erased ID
non-reuse。Unknown version/structure fail closed；API 不暴露 arbitrary SQL、generic
JSON patch、force lifecycle 或 skip revision check。

受影响 storage crate 36/36 unit tests PASS；其中 9 项 IDR tests 覆盖五 kinds、
非法 matrix/confidence/version/payload、lifecycle/terminal/stale write、Scope/
Project/provenance/Reality round trip、atomic correction/supersession、forced
mid-transaction rollback、disable/reset、erasure/GC/non-reuse，以及 forbidden
schema channels。独立 schema-11→12 upgrade/reopen/forced migration failure test
证明失败时 physical objects 与 registry/version 同时回滚。高熵非敏感 sentinel 在
ERASE_IF_ALLOWED 后跨全部 IDR semantic/history/provenance/relation/tombstone 表的
occurrences 为 0。该结论只证明 application-level semantic erasure，不声明 SQLite
free-list/disk-sector secure deletion、zero forensic recoverability 或法律合规。

```text
IDR_V2_STORAGE_IMPLEMENTATION: PASS
STATUS: IMPLEMENTED_CANDIDATE_NOT_FROZEN
ARCHITECTURE_PLACEMENT: Harness.IDR
SCHEMA_VERSION: 12
MIGRATION_0012: idr_v2_human_model
TABLES: 7
INDEXES: 6
TERMINAL_DB_GUARD: REPOSITORY_ONLY
ERASURE_SENTINEL_OCCURRENCES: 0
DEPENDENCIES_CHANGED: NO
AGENT_BEHAVIOR_CHANGED: NO
RESOLVER_CONTEXT_MODEL_UI_EVAL: NOT_IMPLEMENTED
MODEL_REQUESTS: 0
NEXT: IDR_V2_RESOLVER_DESIGN_CONTEXT_INTEGRATION_REVIEW_NOT_IMPLEMENTED
```

## 99. IDR V2 Resolver / Context Integration Design Candidate

IDR V2 storage changeset 已独立提交为
`bd7a1398cfaccfd66d9b0709f5c37d53366e4a63`。随后只进行 design/audit：没有新增
Resolver runtime，没有接入 `ContextCompiler`，没有改变 Agent 行为、schema、migration、
Model extraction/learning/activation、Memory write、UI/FIPC、Provider、Tool、FTS、Vector
或 Embedding。

`docs/architecture/FIELORA_IDR_V2_RESOLVER_CANDIDATE.md` 将 Resolver 精确放在
existing `Harness.IDR` 内。它只在 caller 提供的 structured Human Model revision、
Scope、Reality 与 current-constraint input 上，确定 lifecycle/scope/Reality eligibility、
supersession lineage、kind-specific precedence、structured conflict、suppression 与
deterministic ordering；不拥有 Context admission、Direction generation、learning、
activation、planning、Tool、Permission、Reality、Verification 或 final-decision authority。
同一 revision/input/profile 必须得到同一 ephemeral
`ResolvedHumanModelViewV1 + resolution_ref`，Model 不参与基础裁决，resolution table/
cache/vector persistence 仍为 0。

设计审计确认当前只真正拥有 consistent Human Model snapshot/revision、Project
identity/revision、Run/Conversation identity、raw task 以及可选 Active Artifact
identity/revision。稳定的 domain/task-type/interaction selector、normalized current-
instruction constraints、通用 non-Project Reality snapshot、semantic key/value registry、
freshness/decay profile 与 shared context budget allocator 尚不存在。Resolver 不能解析
raw prompt 伪造这些输入；selector input 缺失必须 fail closed，non-Project Reality
未知必须为 `REALITY_UNRESOLVED`，只有对 supplied authority 的确定 mismatch 才能标记
`STALE_REALITY_REF`。

`docs/architecture/FIELORA_IDR_V2_CONTEXT_INTEGRATION_REVIEW.md` 将 per-invocation
admission 放在 existing `Harness.Ingress & Context`。Resolver 决定“哪些 Human Model
语义成立/冲突/失效”，Context Admission 决定“其中哪些可在当前指令、Reality、kind、
relevance 与 budget 约束下进入 Model Context”；`ContextCompiler` 继续只负责编译现有
repository excerpts。硬优先级保持
`CURRENT USER INPUT > CURRENT REALITY > DURABLE HUMAN MODEL`。Candidate、Weakened、
Conflicted values、Superseded、Revoked、stale/unresolved Reality dependency 均默认不进
Context；Observation 永不成为直接 guidance。Projection 继续以最多 8 个 semantic
entries、每项最多 3 个 bounded refs、总计最多 4 KiB 为设计基线，并要求 future
Context Snapshot why-used manifest 只记录 item/ref/kind/scope/lifecycle/reason/version/
revision/digest/bounds，不复制 source body、transcript、Provider response 或 reasoning。

本轮 Candidate 进一步提出在实现前拆开 existing Contract Candidate 中 bundled
`DispositionResolutionResult.direction`：Resolver 只输出
`ResolvedHumanModelViewV1`，future Individualized Direction 作为独立、非权威阶段消费
`resolution_ref`。新增候选 reason code、semantic normalization、structured current
constraints、Reality snapshot 与 global context budget 仍需 Contract/implementation
review；不因此修改 durable schema。

```text
IDR_V2_RESOLVER_DESIGN: CANDIDATE_PASS
IDR_V2_CONTEXT_INTEGRATION_REVIEW: PASS_DESIGN_ONLY
ARCHITECTURE_PLACEMENT: Harness.IDR.Resolver + Harness.Ingress & Context.IDR Admission
RESOLVER_AND_CONTEXT_ADMISSION: SEPARATE
INDIVIDUALIZED_DIRECTION: FUTURE_SEPARATE_STAGE
MODEL_IN_RESOLVER: NO
RESOLUTION_PERSISTENCE: NONE
CONTEXTCOMPILER_BEHAVIOR: UNCHANGED
RUNTIME_IMPLEMENTATION: NONE
SCHEMA_CHANGE: NO
AGENT_BEHAVIOR_CHANGED: NO
NEXT: IDR_V2_RESOLVER_IMPLEMENTATION_REVIEW_NOT_IMPLEMENTED
```

## 100. IDR V2 Resolver Implementation Review

Resolver/Context design changeset 已按用户要求独立提交为
`eb09432d91deb5ea25d54bac9413e6a705b83791`，提交后 worktree clean。随后进行的
Implementation Review 仍为 docs/contract only：没有实现 Resolver、Context Admission、
Direction/Learning、Model extraction/activation、ContextCompiler/Agent loop、FIPC/UI，
也没有修改 schema 12 storage、migration、dependency、Provider 或 Tool。

`FIELORA_IDR_V2_RESOLVER_IMPLEMENTATION_CONTRACT_CANDIDATE.md` 把下一轮 Resolver
可编码输入收敛为 `ResolveHumanModelInputV1`，输出为 ephemeral
`ResolvedHumanModelViewV1`。Resolver 版本为 `IDR_RESOLVER_V1`，使用 code-owned
`IDR_SEMANTIC_REGISTRY_V1`、tri-state normalized selectors、structured current
constraints、source availability 与 Reality validation projection；Model、randomness、
wall-clock decay、fuzzy equivalence、source retrieval 与 raw task parsing 均为 0。

`SemanticKeyV1` 使用四个隔离 family：Human Fact subject、Preference/Disposition
共享 Behavior dimension、Observation item identity 与 Long-term Goal key。只有真正
共享 Behavior key 的 Preference/Disposition 可跨 kind 比较；Fact、Goal、Observation
不得被强行塞进同一 winner pool。V1 registry 固定八个既有 Candidate behavior
dimensions 及 bounded values、三类 Fact subjects、五类 Observation classification、
三类 Goal keys，以及 `CODING / FAST_EDIT|FOCUSED_EDIT|GENERAL /
TASK_EXECUTION|FINAL_RESPONSE|APPROVAL_EXPLANATION` Scope vocabulary。Unknown key/value/
selector 均 fail closed；registry 不进入数据库、Plugin 或 Marketplace。

Resolution pipeline 固定为 version/snapshot/context validation → registry projection →
lineage → lifecycle → exact Scope → source/Reality/current constraints → semantic
grouping → kind-specific comparator → conflicts → canonical output/ref。只有 Active
可 effective；Candidate/Weakened/Conflicted/Superseded/Revoked 不可用，terminal
predecessor 永不 fallback。Missing/erased predecessor 只产生 incomplete-lineage
diagnostic，不否定具有独立 payload/provenance 的 current successor；present cycle、
fork/self/impossible lineage hard fail。Confidence 只可在 same-value Disposition
duplicate 中选择 representation，不能为 conflicting values 选 winner，也不推广成
generic memory/truth score。

Reality Contract 使用 `VALID / STALE_REALITY_REF / REALITY_UNRESOLVED`。Project 可由
`FieldId + ProjectView.revision` 验证；Project fingerprint 只 hash identity/revision。
Active Artifact 可由 `ArtifactId + current ArtifactRevisionId` 形成 fingerprint，不伪造
numeric revision。Decision/Verification/FieldObject 与 non-active Artifact 当前没有通用
live projection，缺失 authority 必须 unresolved。Current constraints 明确保持
`CURRENT EXPLICIT USER INPUT > CURRENT AUTHORITATIVE REALITY > CURRENT TASK/PROJECT
CONSTRAINTS > DURABLE HUMAN MODEL`；Resolver 暴露 COMPATIBLE/OVERRIDDEN/UNRESOLVED，
Context Admission 只允许 COMPATIBLE。

`IDRContextAdmissionV1` 独立属于 `Harness.Ingress & Context`，固定最多 8 个
model-facing entries、4 KiB complete UTF-8 block、Fact/Preference/Disposition/Goal
per-kind cap 与最多 2 个 neutral conflict notices；Observation cap 为 0。Selection 只用
structured applicability、scope、kind 与 stable IDs，不用 Model。`WhyUsedManifestV1`
最多 16 KiB，记录 item/kind/SemanticKey/scope/lifecycle/revision/version/ref/digest/
admission reason/Reality state，不记录 raw semantic/source/transcript/file/web/provider
body、Project path、secret 或 chain-of-thought。未来 owner 仍为 existing
`AgentContextSnapshotView.manifest`，不新增 `idr_run_contexts`。

已提交 `HumanModelSnapshot` 包含 Resolver 所需 typed payload、scope、basis/confidence、
lineage、provenance 与 Reality dependency；fixed registry/current projections 都是
versioned application input。Tradeoff、unknown/open value、missing source/Reality 可以
安全 suppress，无需重写已存 rows。因此本轮 storage compatibility 结论为
`STORAGE_CONTRACT_GAPS: NONE`、`SCHEMA_CHANGE: NO`、`MIGRATION: NONE`。

```text
DESIGN_COMMIT: eb09432d91deb5ea25d54bac9413e6a705b83791
RESOLVER_IMPLEMENTATION_REVIEW: PASS
IMPLEMENTATION_READY: YES
IMPLEMENTATION_AUTHORIZED: NO
ARCHITECTURE_PLACEMENT: Harness.IDR.Resolver
CONTEXT_ADMISSION: Harness.Ingress & Context / CONTRACT_ONLY
RESOLUTION_PERSISTENCE: NONE
MODEL_IN_RESOLVER: NO
MODEL_IN_CONTEXT_ADMISSION_V1: NO
STORAGE_CONTRACT_GAPS: NONE
SCHEMA_CHANGE: NO
RUNTIME_IMPLEMENTATION: NONE
AGENT_BEHAVIOR_CHANGED: NO
NEXT: IDR_V2_RESOLVER_IMPLEMENTATION_AUTHORIZATION_NOT_GRANTED
```

## 101. IDR V2 Resolver + Standalone Context Admission Implemented Candidate

用户于 2026-08-29 单独授权 `Harness.IDR.Resolver` 与
`Harness.Ingress & Context` deterministic IDR Context Admission，但明确不授权真实
AgentRun/ContextCompiler/Model request 主路径接入。上一轮八文件设计 changeset 已先独立
提交为 `568668264b1a55736d4f93f3f2c27b2ca7671925`，提交后 worktree clean，随后才开始代码。

Provider-neutral V1 DTO、stable hard/suppression reason tokens 与 shared canonical byte
encoder 位于 `fielora-contracts::idr`；纯 `HumanModelResolverV1` 位于现有
`fielora-core::idr_resolver`，只消费 storage-owned immutable `HumanModelSnapshot` 与 caller-supplied
normalized Context/Reality/source projections，不执行 SQLite I/O，也不暴露 Human Model
mutation；`IDRContextAdmissionV1` 位于 `fielora-agent::idr_context`，与现有
`ContextCompiler` 同 crate 但没有调用或修改它。

Resolver 已实现 fixed `IDR_SEMANTIC_REGISTRY_V1`、四类隔离 SemanticKey、only-Active
eligibility、exact Scope AND/specificity、provenance authority、source availability、显式
lineage、kind-specific conflicts、Disposition-only confidence、Reality VALID/STALE/
UNRESOLVED、structured current-constraint precedence、bounded diagnostics、canonical stable
ordering/result digest/resolution ref。Context Admission 只窄化 compatible resolved items，
执行 8-entry/4-KiB/per-kind/3-provenance-ref/2-neutral-conflict bounds、whole-item omission与
16-KiB `WhyUsedManifestV1`；model-facing structured entries 不含 item/provenance ID 或
conflict digest，这些只存在 why-used evidence。

Targeted Candidate tests 当前覆盖 Contracts 3、Resolver 19、Admission 8；包括 128 次重复/
插入顺序独立、Project/Artifact known fingerprint vectors、lineage self/cycle/fork hard fail、
read-only real storage snapshot、Context bounds/neutral conflict/manifest privacy，以及 Resolver/
Admission 静态依赖边界。受影响三 crate Clippy `-D warnings` PASS。未新增 dependency、schema、
migration、table/index、Model request、
Provider branch、FIPC/UI、Context Snapshot 写入或 Governance effect。

```text
IDR_V2_RESOLVER_IMPLEMENTATION: IMPLEMENTED_CANDIDATE / NOT_FROZEN
CONTEXT_ADMISSION: IMPLEMENTED_STANDALONE_CANDIDATE
CONTEXT_PRODUCTION_INTEGRATION: NOT_IMPLEMENTED
RESOLUTION_PERSISTENCE: NONE
HUMAN_MODEL_MUTATION: NONE
MODEL_IN_RESOLVER: NO
MODEL_IN_CONTEXT_ADMISSION: NO
PRODUCT_MODEL_REQUESTS: 0
SCHEMA_CHANGE: NO
DEPENDENCY_CHANGE: NO
AGENT_BEHAVIOR_CHANGED: NO
NEXT: IDR_V2_CONTEXT_PRODUCTION_INTEGRATION_REVIEW_NOT_AUTHORIZED
```

## 102. IDR V2 Final Architecture Closeout

用户于 2026-08-29 要求一次性关闭 IDR V2 剩余架构问题，不再拆分 Context、Acquisition、
Agent Profile、Memory、Identity、Runtime 或 Eval Review。最终入口为
`docs/architecture/FIELORA_IDR_V2_FINAL_ARCHITECTURE_CLOSEOUT.md`，状态为
`FINAL ARCHITECTURE CANDIDATE / IMPLEMENTATION ROADMAP APPROVED FOR REVIEW / NOT YET
FROZEN`，`BLOCKING_ARCHITECTURE_OPEN_QUESTIONS=0`。

最终 production chain 固定为 trusted Work Scope/Reality/current-constraint projection +
storage-owned `HumanModelSnapshot` → `fielora-core::idr_resolver` → ephemeral
`ResolvedHumanModelViewV1` → `fielora-agent::idr_context::IDRContextAdmissionV1` →
existing Ingress & Context → primary Model stream。`AgentCoordinator` 只协调 builder、
invalidation、ephemeral reuse、fail-soft degradation 与 existing Context Snapshot evidence；
不成为 IDR semantic authority。自由文本 current constraint 与 acquisition proposal 复用
同一 primary Model semantic stream，不新增 classifier/model call；首轮尚无可信 projection 的
key 标记 unavailable 并省略对应 personalization，Generic Agent 继续。

Acquisition 固定为 event-driven/bounded proposal → deterministic admission → atomic Human
Model mutation。Current instruction 与 durable Preference 分离；Observation 只是 evidence；
inferred Disposition 只进入 Candidate，V2 只能经显式用户 `ACTIVATE_DISPOSITION` 激活。
Correction 复用 supersession/revoke/replacement；forget 继续使用 `DISABLE_USE /
ERASE_IF_ALLOWED / RESET_PROFILE`。Sensitive policy 固定为 `ALLOW / REQUIRE_EXPLICIT /
DENY`，secret 及任何 secret-derived value 永不进入 Human Model。

最小 `FieloraAgentProfileV1` 是 bundled/versioned/code-owned stable self definition，Agent
Identity 与 Model/Provider Identity 分离。Memory 仍为 cross-cutting Domain；Reality 保持当前
truth authority，且 `Current Reality > historical Memory > IDR inference`。IDR production
policy 为 fail-soft；无数据、部分输入或 integrity failure 都禁用当前 Run 的 stale/invalid
personalization并记录 bounded diagnostic，Generic Agent 继续。IDR on/off 只控制
participation，不执行 forget。

Freeze 必须等待 Context production integration、acquisition/activation/correction/forget、
Agent Profile、restart/recovery、controlled IDR OFF/ON A-B Eval、provider-neutral evidence、
privacy 与 hard-zero invariants 全部 PASS。本轮仅修改架构文档，不改 Runtime、Schema、
Migration、依赖、Agent behavior 或 Model requests；下一步直接按 Closeout 的 12 步顺序进入
IDR V2 implementation execution，不再要求新的 architecture review。

```text
IDR_V2_FINAL_ARCHITECTURE_CLOSEOUT: PASS
BLOCKING_ARCHITECTURE_OPEN_QUESTIONS: 0
CONTEXT_PRODUCTION_INTEGRATION: ARCHITECTURE_CLOSED / NOT_IMPLEMENTED
ACQUISITION_PIPELINE: ARCHITECTURE_CLOSED / NOT_IMPLEMENTED
AGENT_PROFILE: ARCHITECTURE_CLOSED / NOT_IMPLEMENTED
FAILURE_POLICY: FAIL-SOFT
FREEZE: NOT_YET
RUNTIME_CHANGED: NO
SCHEMA_CHANGED: NO
DEPENDENCIES_CHANGED: NO
NEXT: IDR_V2_IMPLEMENTATION_EXECUTION
```

## 103. IDR V2 End-to-End Implementation and Freeze

用户于 2026-08-29 授权在已关闭架构内连续完成 IDR V2，不再拆 Slice 或新增架构
Review。实现提交 `6d17b62`、`23b6d88` 与 `958510c` 已将 trusted current-constraint、
Project/active Artifact Reality、source-availability 与 normalized context builders，existing
Core Resolver/Agent Admission/ContextCompiler/AgentCoordinator production chain，bundled
`FieloraAgentProfileV1`、existing Context Snapshot WhyUsed/evidence、ephemeral invalidation/cache
和 fail-soft Generic continuation 接通。自由文本 semantic projection 复用同一 primary Model
stream 的 provider-neutral typed control plane；它不进入 executable Tool catalog，不获得
Policy、Permission、Reality、Verification 或 Tool authority，且 IDR 不新增第二次 Model call。

Human Model acquisition 已覆盖 explicit Fact/Preference/Long-term Goal、bounded Observation、
Observation-supported inferred Disposition Candidate、explicit activation、atomic correction/
supersession、disable、application-level semantic erasure 与 reset。所有 mutation 检查 expected
Human Model revision；stale 返回 conflict，不 silent retry/rebase。高风险个人数据必须 explicit，
secret/credential/secret-derived material 永不存储，也不生成 secret hash/prefix/last4/fingerprint。
Automatic activation 继续不存在。

Targeted Gate：Agent 132、office writer probe 8、Contracts 6、Storage 36、Core 69 全部 PASS；
受影响四个 Rust crate strict Clippy `-D warnings` PASS；required IDR OFF/ON Eval 10/10 PASS。
代表性 fixture 为 180 extra bytes（粗略约 45 tokens）、1,956 μs total（builder 420、Resolver
983、Admission 553），preloaded Human Model read 为 0；生产路径会在 existing Context Snapshot
单独记录实际 SQLite snapshot read μs。ON/OFF preference adherence 1/0，task success 1/1；
七项 hard-zero counter 全为 0。Live Model/Provider request、schema/migration、dependency、FIPC/UI
与 resolved-view persistence 均为 0；full premerge 因边界未跨越而 `NOT_RUN`。

Evidence 位于 `artifacts/agent-v0.1/IDR_V2_END_TO_END_EVIDENCE.md`。Storage、Resolver、production
Context、Acquisition、Profile、Recovery、Provider-neutral Eval、Privacy 与 hard-zero Gate 均 PASS，
因此 `FIELORA_IDR_V2_FINAL_ARCHITECTURE_CLOSEOUT.md` 的最终状态为 `FROZEN`，blocker 为 0。
Automatic activation、cloud sync、multi-profile/device、vector memory、dynamic registry/
marketplace、IDR dashboard 与 enterprise identity 是 post-V2，不阻塞 Freeze。

```text
IDR_V2_END_TO_END_IMPLEMENTATION: PASS
ARCHITECTURE: CLOSED / UNCHANGED
PRODUCTION_CONTEXT_INTEGRATION: PASS
ACQUISITION_AND_LIFECYCLE: PASS
RESTART_RECOVERY: PASS
REQUIRED_AB_EVAL: 10/10 PASS
HARD_ZERO_INVARIANTS: PASS
MODEL_REQUESTS: 0
SCHEMA_CHANGED: NO
DEPENDENCIES_CHANGED: NO
FREEZE_GATE: PASS
IDR_V2_STATUS: FROZEN
FREEZE_BLOCKERS: NONE
NEXT: RETURN_TO_NORMAL_FIELORA_PRODUCT_DEVELOPMENT
```

## 104. Durable Screenshot Evidence Foundation

用户于 2026-08-30 授权在稳定基线 `a6065261f04c53bb119cee8bdc0c4abf116e4eef`
上建立最小 durable Browser viewport screenshot evidence。实现使用 Electron 产品路径
`WebContents.capturePage()` 捕获当前 active/visible、已完成导航的 Browse Page；捕获前后严格核对
Page ID、WebContents、navigation generation、URL、loading 与 visibility，结果只接受 bounded PNG。
Production 不使用 CDP；CDP 只用于确定性 Desktop E2E 断言。

Migration 0014 将 local SQLite schema 13→14，新增 Profile-owned independent
`ScreenshotEvidenceId` 与 bounded metadata/provenance。PNG bytes 复用既有
`LibraryRoot/ContentBlobStore`，但 Screenshot Evidence 不是 `LibraryObject`、Artifact Asset、
Attachment 或 Verification outcome。可选 Conversation/Run/Tool/Verification 关系要求 same
Profile 且 causal IDs 一致；截图不能授予 PASS。ResultReference IMAGE 保留历史 `LIBRARY` wire
source，并增加 typed `SCREENSHOT_EVIDENCE` source；Completed Markdown 复用现有 renderer、图片预览
与 Lightbox，缺失或损坏时 fail-soft 显示不可用。

Portable `include_library=true` 改由 Core 提供 eligible Library/Artifact blob manifest，物理上共用
LibraryRoot 不再等于可导出；普通 Library image 继续导出，Screenshot Evidence record 与由它单独
授权的 blob 均排除。Screenshot Evidence 为 `LOCAL_ONLY / EXCLUDED`，不写 sync journal，fixture
external requests 为 0。LibraryRoot migration 仍复制 content-addressed bytes，因此迁移后同一
ScreenshotEvidenceId 可恢复预览；Core restart 与 Conversation reopen 也保持 identity/reference。

Targeted Gate 已覆盖 Contracts、migration/Storage/restart/profile scope/causal isolation/portable
privacy/sync zero/verification non-authority、Browser capture bounds/cancel/stale navigation、Desktop
validation/renderer、四个受影响 Rust crate strict Clippy、Desktop typecheck/lint，以及单一
deterministic Desktop E2E。E2E 完整证明 capture → durable ID → completed Markdown inline image →
existing Lightbox → LibraryRoot migration → portable exclusion → Core restart restore。Live Model/
Provider request、Agent screenshot Tool、new runtime/blob store/viewer、auto/full-page/window/desktop
capture、cloud sync 与 attachment migration 均为 0。

```text
DURABLE_SCREENSHOT_EVIDENCE_FOUNDATION: PASS
BROWSER_PRODUCT_SCREENSHOT: YES
SCREENSHOT_EVIDENCE_IDENTITY: INDEPENDENT / DURABLE
LIBRARY_OBJECT_CREATED: NO
PORTABLE_SCREENSHOT_EXPORT: EXCLUDED
SYNC_JOURNAL_WRITES: 0
VERIFICATION_AUTHORITY_GRANTED: NO
AGENT_SCREENSHOT_TOOL: NOT_IMPLEMENTED
LIVE_MODEL_CALLS: 0
SCHEMA_VERSION: 14
```

## 105. Fielora Glass Official Design Language Implemented Candidate

用户于 2026-08-30 将 **Fielora Glass** 定义为 Desktop 唯一官方设计语言，不再把 Light、Dark、Solid 或历史命名视为并列 Theme。Renderer 内建 Theme identity 已收敛为唯一 `fielora`；Settings 只暴露 System / Light / Dark appearance，Solid 只作为 `backdrop-filter` 不可用时的内部 material fallback。未来 Custom Theme 只保留 declarative token seam，Importer 尚未实现且入口禁用；脚本、React、DOM、网络、文件、credential、Tool 与 Runtime authority 均不在 seam 内。

视觉结构固定为 Canvas / Content / Chrome / Floating / Overlay 五种 semantic surface。组件只声明 `data-surface`，`styles/materials.css` 集中解析 background、edge、shadow、backdrop 与同结构 Solid fallback；Feature CSS 不再复制 blur recipe。Settings、Navigation、Conversation、Composer、Workspace/Tabs、Browser Chrome 与主要 Overlay 已按该结构收敛。高频产品 glyph 统一进入 `<AppIcon>` registry；外部品牌、文件类型和内容媒体保持各自语义来源。Remote Browse WebContents 仍不注入 Fielora CSS。

本 changeset 只修改 presentation、appearance preference 解释与前端静态/E2E contract；Project、Conversation、Agent、Browser runtime、安全、FIPC、Schema、Migration、Provider、Tool、Permission、Verification 与 native window glass behavior 均未改变。1280/1440/1920、Light/Dark、Settings/Conversation/Workspace/Tabs 与 forced solid fallback 将由 targeted Desktop E2E 和截图 Evidence 验证；用户 Visual Human Gate 仍是冻结前置条件。

```text
FIELORA_GLASS: SINGLE_OFFICIAL_DESIGN_LANGUAGE
BUILT_IN_THEME_IDENTITIES: 1 / fielora
APPEARANCE_OPTIONS: SYSTEM / LIGHT / DARK
SEMANTIC_SURFACES: CANVAS / CONTENT / CHROME / FLOATING / OVERLAY
SOLID: INTERNAL_FALLBACK_ONLY
CUSTOM_THEME: DECLARATIVE_SEAM_ONLY / IMPORT_DISABLED
PRODUCT_BEHAVIOR_CHANGED: NO
SCHEMA_MIGRATION_FIPC_CHANGED: NO
STATUS: IMPLEMENTED_CANDIDATE / NOT_FROZEN
VISUAL_HUMAN_GATE: REQUIRED
```

## 106. Desktop UI/UX System Governance And Packaged Startup Repair

用户于 2026-08-31 要求保持已优化的三栏、Conversation、Right Workspace Dock、Settings Content 与 Bottom Terminal ownership，不允许后续字体、图标或材质优化再次替换布局。Renderer 现只从 `styles/index.css` 进入明确 Cascade Layers；`layout.css`、`typography.css`、`controls.css` 与 `materials.css` 分别拥有 geometry、type roles、shared primitives 和 surface paint。历史 `styles.css` 被隔离为 legacy layer，raw color budget 只能下降。Phosphor 成为产品 icon system；本机应用 icon、favicon 与内容媒体保持真实来源。

最新 packaged EXE 的空白窗口已定位为 `@phosphor-icons/react` 在打包依赖图中解析第二份 React，触发 `useContext` Invalid Hook Call，导致 `#root` 未挂载。Webpack Renderer 现显式 alias 单一 React/ReactDOM，静态 contract 与 packaged smoke 覆盖该回归。

`docs/architecture/FIELORA_UI_UX_SYSTEM_V0.1.md` 是 UI/UX 实现 canonical；任何受管理样式、共享 primitive、icon 或 layout ownership 文件变化必须在同一 changeset 更新该文档，`pnpm verify:ui-ux` 强制检查。Agent/Core/Provider/Tool/Permission/Verification/FIPC/Schema/Migration 变化均为 0。

```text
PACKAGED_BLANK_ROOT_CAUSE: DUPLICATE_REACT / FIXED
LAYOUT_OWNERSHIP: LOCKED
TYPOGRAPHY_ROLES: 5 / MANAGED
PRODUCT_ICON_SYSTEM: PHOSPHOR / MANAGED
SHARED_CONTROLS: BUTTON / MENU / SELECT / TABS / DIALOG
CASCADE_ENTRY: styles/index.css
LEGACY_CSS: COMPATIBILITY_LAYER / BUDGET_DOWNWARD_ONLY
UI_UX_DOC_SYNC: ENFORCED
MATERIAL_VISUAL_HUMAN_GATE: PENDING
```

## 107. Scheduled Tasks And UI/UX Structural Lock

用户要求将原“现在”入口收敛为 Codex-like“已安排”页面，并在既有 Desktop Foundation 上提供搜索、状态筛选、创建、编辑、暂停/恢复、立即运行、删除、下次运行与上次失败状态。Schedule 使用 Desktop local durable JSON 保存；每个新任务创建一个既有 persistent Conversation，触发时先写入正常 User Message，再调用既有 `command.agent.start` 产生正常 AgentRun。Conversation、AgentRun、Tool、Approval、Permission 与 Evidence 仍由现有 Model + Harness + Tools 链拥有，没有建立第二套 Agent Core/Runtime/State。

用户同时明确锁定现有 UI/UX 页面结构。后续 Typography、Icon、Color、Material、Shadow、Motion、Spacing 或整体视觉优化不得大幅调整 App Shell、Route composition、Pane topology 或 Navigation/Conversation/Workspace/Dock/Settings ownership。结构变化必须在实现前暂停并取得用户明确批准；canonical 文档通过 `STRUCTURAL_CHANGE_REQUIRES_USER_APPROVAL` 标记和自动检查保持同步。

```text
SCHEDULED_TASKS: EXISTING_CONVERSATION_AND_AGENTRUN_PATH
SECOND_AGENT_RUNTIME: NO
SCHEDULE_STORAGE: DESKTOP_LOCAL_DURABLE_JSON
UI_UX_LAYOUT_OWNERSHIP: LOCKED
STRUCTURAL_CHANGE: USER_APPROVAL_REQUIRED_BEFORE_IMPLEMENTATION
```

## 108. Replaceable Pastel Bloom Brand Chrome

用户提供新的透明粉紫三瓣 Logo，并要求品牌主题只从左上角向左导航和 Desktop 顶部
tab/title Chrome 延伸，不能污染 Conversation 或右侧工作区。Renderer 现以
`apps/desktop/assets/fielora-brand-mark.png` 作为应用品牌位与 Windows icon generator 的唯一图片
源；替换该 PNG 后运行既有 `icon:generate` 即可同步 EXE icon，不再维护独立 SVG 副本。

用户复看首版后裁决高饱和紫色过重，且顶部与左导航视觉上被切成两块。当前
`tokens.css` 中连续的 `--fl-brand-chrome-*` bundle 改为低饱和、近白的薰衣草/雾粉画布，并集中
拥有 Light/Dark canvas、native caption edge、foreground、hover、active、input、edge 与 Logo shadow。
Desktop 顶栏与左导航以相同 `100vw × 100vh` 背景尺寸绘制；左导航使用 `0 -44px` 位置继续顶栏
坐标，因此不再依赖两套独立渐变模拟连续性。Workspace/Settings 的外层 shell 使用同一坐标下的
canvas 作为 underlay，但只从 Content 圆角切口露出；正文和右侧工作面仍由中性 Content 完整覆盖。
只有 `data-brand-chrome="top|navigation"` 可以消费该 bundle：DesktopChrome、Project Navigation
和 Settings Navigation 已显式声明；Overlay menu、Conversation、Settings Content、Right Workspace
Dock、Right Dock Tab Strip、Utility Workspace 与外部 Browse content 保持原中性 Surface。

用户随后明确纠正 Conversation 右上角无需调整，因此新增的外侧右上 radius 已撤回；Conversation
恢复既有左上 `--fl-radius-work-surface`、右上直角几何。左上品牌 Logo 通过 Brand bundle 中受控
opacity 降低视觉强度，原始 PNG 与 Windows icon source 不变。

本轮未改变 App Shell、Route、Pane topology、resizer 或 surface ownership；Agent/Core/Browser
runtime、FIPC、Schema/Migration、Provider、Tool、Permission 与 Verification 变化均为 0。最终色彩与
五层关系仍由真实 Electron Human Visual Gate 裁决。

```text
BRAND_ASSET_SOURCE: fielora-brand-mark.png / SINGLE
BRAND_CHROME_SCOPE: DESKTOP_TOP + LEFT_NAVIGATION
CONVERSATION_BRAND_BACKGROUND: NO
RIGHT_DOCK_UTILITY_BRAND_BACKGROUND: NO
OVERLAY_BRAND_BACKGROUND: NO
LAYOUT_OWNERSHIP_CHANGED: NO
THEME_REPLACEMENT: DECLARATIVE_TOKEN_BUNDLE + SINGLE_PNG
BRAND_CHROME_CANVAS: SHARED_VIEWPORT / LOW_SATURATION
CONVERSATION_TOP_RIGHT_GEOMETRY: UNCHANGED
```

## 109. Scheduled Shared Frame And Empty Dock Motion

用户明确授权修正此前锁定结构中的一处不一致：`已安排` 不再使用 legacy fixed-width
`.shell`，而是与 Project Conversation、Settings 一样复用唯一 `WorkspaceSurface`。Scheduled
直接复用现有 Primary Navigation、共享 `fielora:workspace-navigation-width` 偏好、同一 4px
resizer 与 `--fl-radius-work-surface` Content 左上圆角；因此在 Scheduled、Conversation 与
Settings 之间切换不再改变左侧边界。应用 BrowserWindow 的初始宽度保持 `1180px`，初始高度
改为当前允许的最小高度 `620px`；`minWidth` / `minHeight` 仍为 `900px / 620px`，不改变用户后续 resize 能力。

Right Workspace Dock 的 Tab Strip 只在至少一个标签存在时显示“＋”；零标签状态继续由既有
Dock launcher 提供当前真实入口。关闭最后标签或手动收起 Dock 时，Conversation minimum、
divider 与 Dock width 使用注册的 length tracks 在既有 panel duration 内连续收起，Dock Content
同时执行既有 opacity/translate motion；Reduced Motion 仍由全局可访问性设置裁决。

该变更不增加 Pane、Route、Overlay、Agent Runtime、Tool、FIPC、Schema/Migration、Provider、
Permission 或 Verification；它只把用户明确批准的 Scheduled ownership 修正到已有共享容器，并
修复既有 Dock 关闭 presentation。

```text
SCHEDULED_FRAME: SHARED_WORKSPACE_SURFACE
SCHEDULED_NAVIGATION_WIDTH: SHARED_PREFERENCE
SCHEDULED_CONTENT_TOP_LEFT_RADIUS: SAME_AS_CONVERSATION
INITIAL_WINDOW_SIZE: 1180X620 / MINIMUM_HEIGHT
EMPTY_DOCK_ADD_BUTTON: HIDDEN
LAST_TAB_CLOSE_MOTION: INTERPOLATED_LENGTH_TRACKS
SECOND_LAYOUT_OR_RUNTIME: NO
```

## 110. Summon Removal And Minimum-height Startup Correction

用户明确要求删除全局 Summon 功能，而不是只隐藏按钮。当前 Renderer 已移除全局 Summon
浮动按钮、Overlay/Context 编辑与发送流程、`Ctrl+Shift+Space`、Desktop Utility 和 Right Dock
中的“侧边聊天”、`Ctrl+Alt+S` 及其 presentation/test contract。Right Dock 零标签启动页现在只保留
工作对象、审阅、PowerShell、浏览器和文件五个真实入口。Project Conversation / Agent 继续承担
模型交互；Inbox、Quick Capture 与 Provider Setup 保留，但不再能进入第二套 Summon 请求界面。

用户同时纠正上一轮尺寸要求：默认进入时需要使用最小高度而不是最小宽度。因此 BrowserWindow
初始尺寸为 `1180 × 620px`，约束仍为 `minWidth: 900px`、`minHeight: 620px`。
Provider-neutral Model Runtime、Conversation Agent flow、Capture persistence、Credential、FIPC、Schema/
Migration、Tool、Permission 与 Verification 均未删除或改变；删除范围只属于已明确废弃的 Summon
产品入口和 Renderer presentation。

```text
GLOBAL_SUMMON_UI: REMOVED
SIDE_CHAT_ENTRY: REMOVED
SUMMON_SHORTCUTS: REMOVED
RIGHT_DOCK_LAUNCHER: 5 CURRENT ENTRIES
PROJECT_CONVERSATION_AGENT: PRESERVED
INBOX_QUICK_CAPTURE_PROVIDER_SETUP: PRESERVED
INITIAL_WINDOW_SIZE: 1180X620
MINIMUM_WINDOW_SIZE: 900X620
SECOND_MODEL_RUNTIME: NO
```

## 111. Appearance Theme Overrides

用户要求在 Settings → 外观中加入六项实时界面自定义，并明确它们必须是当前 Fielora Glass Theme
之上的 Override，而不是第二套 Theme System。现有 v2 local UI preferences 现持久化 Sidebar Base
Color、Workspace Base Color、UI font family/size、Code font family/size、neutral Surface contrast 和
Primary Action Base Color；修改后由既有 `applyAppPreferences` 写入批准的 semantic CSS variables，
无需重启。该轮最初以 `#EFEBFF` 代表 Light Sidebar；其 flat-default 行为已由 §112 supersede。

Sidebar Override 只作用于左侧 Navigation；Workspace Override 覆盖 Conversation、Settings/Library
Content、Right Dock/Utility 的基础 Content；Glass alpha/highlight/blur 与 Floating/Overlay 仍归现有
Material resolver。UI size 以 15px 基线派生既有 typography roles，Code 以独立 13px 基线覆盖
Markdown Code、Diff、Editor 与 Terminal。对比度 0–100 只派生中性 Surface/Border/Input token，并同步派生
Brand Chrome 菜单 Hover/Selected/Edge/Input 与 selection shadow；滑杆收敛为 thin track + strong thumb + 数值，未使用
全局 CSS filter；Action Base 自动派生交互状态和可读前景，不覆盖 Success/Warning/Danger。

“恢复当前主题默认值”只清空六项 Override，保留 System/Light/Dark 和可访问性设置。Theme identity
仍只有 `fielora`，Custom Theme importer、Schema/Migration、Agent/Core/Provider/Tool/Permission/
Verification 变化均为 0。

```text
THEME_IDENTITY: FIELORA / ONE
APPEARANCE_OVERRIDES: 6 / DECLARATIVE
DEFAULT_LIGHT_SIDEBAR_BASE: SUPERSEDED_BY_112
DEFAULT_LIGHT_WORKSPACE_BASE: #FFFFFF
DEFAULT_LIGHT_ACTION_BASE: #6847D8
SURFACE_CONTRAST_FILTER: FORBIDDEN
SEMANTIC_STATUS_COLOR_OVERRIDE: NO
RUNTIME_RESTART_REQUIRED: NO
```

## 112. Continuous Chrome, Compact Appearance And Library Shared Frame

用户复看打包版后确认三项 presentation/ownership 修正：默认 Sidebar 不得以历史
`#EFEBFF/#F0ECFF` flat override 与 Titlebar 分层，而要继续消费同一张 viewport-aligned Brand Chrome
canvas；这两个旧版默认色若已作为 persisted override 保存，读取时迁回 `null`。Appearance 中代表色改为
`#F7EFFB`，自定义 Sidebar Base Color 作为同一 Chrome canvas 上的 tint，而不是第二张不连续背景。

Settings → Appearance 的六项自定义收敛为 compact 两列 matrix，右侧 control 起止边界统一、行高收紧、
section 描述位于标题下方。Library 从 legacy `.shell` 迁入现有 `WorkspaceSurface`，与 Conversation、
Scheduled、Settings 共享 Primary Navigation 宽度偏好、4px resizer、Content Base Surface 和左上圆角；
Library 数据行为、Filter、Add/Open/Delete、Browser Save contract 均不改变。

```text
DEFAULT_SIDEBAR_SURFACE: SHARED_TITLEBAR_CHROME_CANVAS
LEGACY_FLAT_SIDEBAR_DEFAULTS: #EFEBFF/#F0ECFF -> NULL
APPEARANCE_LAYOUT: COMPACT_ALIGNED_TWO_COLUMN_MATRIX
LIBRARY_FRAME: SHARED_WORKSPACE_SURFACE
LIBRARY_BEHAVIOR_CHANGED: NO
SECOND_THEME_OR_RUNTIME: NO
```

## 113. Purple Open-center Brand Mark

用户提供黑色与紫色两个同形 SVG。两者几何均为三条旋转花瓣 path，仅填色和中心圆不同；在当前
near-white lavender/pink Chrome 上，黑色版本视觉重量过高，因此选用 `#5840C8` 紫色版本，并按用户
要求彻底删除中心浅色圆。Renderer 直接消费 canonical `fielora-brand-mark.svg`；透明 PNG 与 Windows
ICO 由同一 SVG 机械生成，不产生第二套 Logo geometry。

```text
BRAND_MARK_VARIANT: PURPLE #5840C8
BRAND_MARK_CENTER_CIRCLE: REMOVED
CANONICAL_RENDERER_ASSET: fielora-brand-mark.svg
GENERATED_NATIVE_ASSETS: PNG + ICO / SAME GEOMETRY
```

## 114. Unified Page Rails, Gradient Overrides And Bounded Color Picker

用户连续复看 Scheduled、Library、Conversation 与 Settings 后确认：前三个主工作面不能继续使用互不相干的
标题宽度、按钮尺度和空状态；Settings 各分类也不能混用 860/920/960px 内容宽度。当前 presentation 统一为
1040px Page Rail 与 920px Settings Rail：Scheduled/Library 共用 30px 标题、38px Primary Action 和 quiet
empty state，Conversation 保留专用 reading/composer width 但 Header 左边线对齐；Settings Header、row copy 与
shortcut label 统一左边线。Route、Pane、Navigation、Composer、Dock、Resizer ownership 均未改变。

Sidebar 与 Titlebar 现在直接消费同一个 `--fl-brand-chrome-canvas`，不再通过独立 Sidebar tint 形成两层；
`#EFEBFF/#F0ECFF/#F7EFFB` 三个历史 flat representative override 读取时都恢复到真实 Theme 默认。Sidebar 和
Workspace Background 均支持 Default/Solid/Gradient，Workspace 渐变 Paint 与 neutral solid derivation 分离，
避免把 CSS image 当成 neutral mix color。

Windows native color input 已从 Appearance 移除，替换为 Fielora Overlay Color Picker：saturation/value、Hue、
HEX 实时同步，按 trigger 自动向上或向下展开，并在 12px viewport inset 内 clamp。它不新增 Theme、Schema、
Migration、Runtime、Provider、Agent、Tool 或 Permission。

```text
PRIMARY_PAGE_RAIL: 1040PX
SETTINGS_CONTENT_RAIL: 920PX
BACKGROUND_OVERRIDE_MODES: DEFAULT / SOLID / GRADIENT
SIDEBAR_TITLEBAR_CANVAS: ONE CONTINUOUS TOKEN
NATIVE_COLOR_PICKER: REMOVED
IN_APP_COLOR_PICKER: BOUNDED OVERLAY
STRUCTURAL_OWNERSHIP_CHANGED: NO
```

## 115. Native Caption Seam And Neutral Workspace Tabs

用户复看发现 Renderer Titlebar 渐变进入 Windows 原生最小化/最大化/关闭区域时仍有竖向色阶，尤其在
Appearance 切换或自定义 Sidebar 背景时可见。当前 Titlebar 在原生控制区前 96px 平滑过渡到
`--fl-brand-chrome-caption`；该 token 由默认 Theme、Sidebar 单色或 Sidebar 渐变右端色确定，并通过
trusted window IPC 以严格 `#RRGGBB` 校验后同步给 `setTitleBarOverlay`。Renderer 与 native caption
因此消费同一个最终颜色。

Right Workspace Dock 的 active Tab 删除底部蓝紫 accent indicator，只保留 neutral material shift、文字
和 close affordance；Browser loading 仍使用 favicon-slot spinner 与 Address Toolbar progress，不把 loading
和 selected 混为同一状态。

```text
TITLEBAR_NATIVE_CAPTION_COLOR: CURRENT BRAND CHROME RIGHT EDGE
TITLEBAR_NATIVE_PAYLOAD: TRUSTED + STRICT HEX
RIGHT_DOCK_ACTIVE_TAB_UNDERLINE: NONE
BROWSER_LOADING_FEEDBACK: PRESERVED
PANE_OR_RUNTIME_CHANGE: NO
```

## 116. Locale Override, Compact Window, Queued Follow-up And Edge-collapse Gesture

Settings → General 现在提供 `SYSTEM / ZH_CN / EN` 界面语言偏好并实时生效；SYSTEM 只读取 Electron
renderer 的系统 locale，中文系统显示简体中文。官方内置 Skill 的用户可见名称与说明通过受信任映射本地化，
内部 Skill ID、Project Skill 与 Plugin metadata 保持原值。该实现复用现有 AppPreferences v2，不建立第二套
Theme 或设置系统。

Desktop 初始高度与最低高度同步下调为 `560px`，宽度仍为 `1180px`、最低宽度仍为 `900px`。运行中的
Conversation follow-up 在真正启动前以 Composer 上方的本地队列卡片存在，可调整回输入框、删除或关闭排队；
只有上一 Run terminal 后才创建 durable User Message 并调用既有 Agent start，Side Chat 不回归。

共享 Navigation divider 与 Right Workspace divider 均支持边缘越界收起；window-level pointer lifecycle 保证
鼠标左键未松开时可反向拖回恢复。真实 Electron E2E 已覆盖左右两侧 collapse → restore、宽度持久化、
Browser native bounds 与 Terminal/File Dock 回归。

```text
UI_LANGUAGE: SYSTEM / ZH_CN / EN
SYSTEM_ZH_LOCALE: ZH_CN
WINDOW_INITIAL_MIN_SIZE: 1180x560 / 900x560
QUEUED_FOLLOW_UP: EDITABLE_UNTIL_START
SIDE_CHAT_REINTRODUCED: NO
DIVIDER_EDGE_COLLAPSE_RESTORE: SAME_POINTER_GESTURE
RUNTIME_OR_SCHEMA_CHANGED: NO
```

## 117. Neutral Right Divider And Simple Expand Icon

用户基于最新 packaged Desktop 复看确认 Conversation 与 Right Workspace Dock 之间的持续淡紫线不符合
中性工作区层级。该 divider 现在固定消费 Light/Dark 对应的 neutral gray token，默认、hover 与 dragging
视觉宽度均为 `1px`；4px grid track 和更宽 pointer hit area 继续保留，不改变拖拽、边缘收起或恢复行为。

右上工作区扩展/恢复按钮从四向 `ArrowsOut` 改为双对角 `ArrowsOutSimple`，继续通过 canonical
`AppIcon` registry 使用 Phosphor，不增加组件内 SVG。Pane ownership、Agent/Browser runtime、FIPC、
Schema/Migration 与 Permission/Verification 均不变。

```text
RIGHT_DOCK_DIVIDER: 1PX NEUTRAL GRAY
RIGHT_DOCK_DIVIDER_BRAND_OR_ACTION_COLOR: NO
WORKSPACE_FOCUS_ICON: ARROWS_OUT_SIMPLE
POINTER_HIT_AREA_OR_EDGE_COLLAPSE_CHANGED: NO
```

## 118. Bounded Workspace Tabs, Visible Resources And Distinct Tool Icons

用户在真实 Project 中同时打开多个文件后确认：Right Workspace Tab 会延伸到 window-right controls 下方，
代码与图片 Tab 虽已建立但内容区可能保持空白；同时右侧 PowerShell 与底部 Terminal、审阅入口与 Conversation
变更卡片缺少可辨识的图标语义。当前 Tab Strip 改为在右上 controls 前结束的 bounded horizontal lane，超出时
只在 lane 内滚动，active Tab 自动回到可视区，`+` 与标签均不得进入 controls 区域。

File/Image 打开流程现在先建立带 loading presentation 的 session-local Tab，再异步填充真实文本或 binary-safe
image preview；任何阶段都不再静默渲染空白。Syntax paint 位于透明 textarea 之上，Image viewer 取得完整可用
尺寸。真实 Electron E2E 不再只检查节点存在，而是验证代码 value 与 paint text、图片 `naturalWidth` 和 rendered
size。Conversation/Right Dock 的 4px divider hit track 同时改为 Content paint，只有居中的 1px neutral gray edge
可见，hover/dragging 不再出现品牌紫或增粗。

Review 与 Conversation changed-files 统一使用 canonical `PlusSquare`；右侧 PowerShell 保留 `Terminal`，底部
Terminal 使用 `TerminalWindow`。全部来自既有 Phosphor registry，不新增 SVG、Pane、Route、Runtime、Schema、
Migration、Permission 或 Agent 语义。

```text
RIGHT_DOCK_TAB_OVERFLOW: BOUNDED HORIZONTAL SCROLL
ACTIVE_TAB_VISIBILITY: AUTO_REVEAL
WINDOW_RIGHT_CONTROL_OVERLAP: FORBIDDEN
FILE_PREVIEW_SILENT_BLANK: FORBIDDEN
CODE_AND_IMAGE_VISIBLE_CONTENT_E2E: PASS
DIVIDER_HIT_TRACK_PAINT: CONTENT
DIVIDER_VISIBLE_EDGE: 1PX NEUTRAL IN ALL STATES
RIGHT_TERMINAL_ICON: TERMINAL
BOTTOM_TERMINAL_ICON: TERMINAL_WINDOW
REVIEW_ICON: PLUS_SQUARE
```

## 119. Animated Dock Focus And Frame-coalesced Divider Resize

Right Workspace Dock 的扩展/恢复不再在两套不兼容的 Grid track 之间瞬切；同一注册的
length-percentage track 现在从用户偏好宽度连续插值到可用 Work Area，Conversation 同步收窄并淡出，恢复时
反向执行。全局 Reduced Motion 仍能把该过渡压缩为即时切换。

Workspace divider 只消费每次 pointer event 的最后一个 coalesced sample，并继续以 `requestAnimationFrame`
合并为每帧一次。直接拖动期间关闭 panel track transition、暂停重复的 syntax highlight paint，同时保持原始代码
文字可见；pointer release 后立即恢复完整 syntax presentation。Pane、Runtime、FIPC、Schema/Migration 与用户
宽度持久化不变。

```text
DOCK_FOCUS_TRANSITION: INTERPOLATED PANEL TRACK
DIVIDER_POINTER_UPDATES: LATEST COALESCED SAMPLE / ONE PER FRAME
DRAG_LAYOUT_TRANSITION: OFF
DRAG_CODE_VISIBILITY: PRESERVED
REDUCED_MOTION: PRESERVED
```

## 120. Workspace Tab Context Actions And Adjacent Add Control

Right Workspace Tab 现在拥有受控右键菜单：重新加载、复制、重命名、关闭、关闭其他、关闭右侧。File/Image
复制会建立独立 session-local Tab presentation，重命名只改显示标签，不修改文件路径或 Runtime identity；Browser
Page 仍使用 Browser Runtime 既有原生 Page 菜单，聊天分支不错误进入 File/Tool Tab。

“＋”恢复为紧跟 bounded Tab lane 的控制，不再被 flex 拉到右上 window controls 前；Tool Menu 越过 Header
overflow 正常可见，仍只打开既有五种 Workspace Tool，不新增 Pane 或 Runtime。

```text
WORKSPACE_TAB_CONTEXT: RELOAD / DUPLICATE / RENAME / CLOSE / CLOSE_OTHERS / CLOSE_RIGHT
WORKSPACE_TAB_CHAT_BRANCH: NOT_APPLICABLE
ADD_CONTROL_POSITION: ADJACENT_TO_TAB_LANE
ADD_TOOL_MENU_CLIPPED: NO
```

## 121. Artifact Launcher De-duplication And Plus/Minus Review Icon

用户复看右侧工具启动器后确认“工作对象”与文件/资源预览形成重复心智。该常驻入口已从零标签启动页与“＋”
Tool Menu 移除；底层 Artifact 持久化、版本、active context 与 Agent 创建后直接打开的独立 Tab 均保留，因此不是
删除 Artifact 能力。工具启动器现在只包含审阅、PowerShell、浏览器和文件。

审阅及 Conversation changed-files 的 canonical `diff` glyph 从只有“＋”的 `PlusSquare` 改为
`PlusMinus`，由共享 optical box 增加圆角方框，确保“＋ / −”同时可辨。没有新增手绘 SVG、Pane、Route、
Runtime、FIPC、Schema/Migration 或 Agent semantics。

```text
PERSISTENT_ARTIFACT_TOOL_ENTRY: REMOVED
AGENT_CREATED_ARTIFACT_TAB: PRESERVED
ARTIFACT_RUNTIME_AND_PERSISTENCE: PRESERVED
RIGHT_DOCK_LAUNCHER: REVIEW / POWERSHELL / BROWSER / FILES
REVIEW_ICON: BOXED_PLUS_MINUS
```

## 122. Compact Conversation Corner And Resize-aware Active Tab Reveal

用户以 Codex 窗口参考确认 Conversation Content 左上 `28px` 弧度偏大。Conversation 现在使用独立
`--fl-radius-conversation-surface`：Standard 为 `16px`，Small/Large 为 `12px / 20px`；Settings、Scheduled
与 Library 继续使用既有 Work Surface radius，Conversation 右上保持直角。

真实多标签回归同时暴露：active Tab 初次 reveal 后，Dock 宽度动画仍可能再次缩短 Tab lane。Tab Strip 现在由
ResizeObserver 在尺寸变化后按 animation frame 重新 reveal active Tab，避免动画结束时标签被右侧 controls 截断。
该轮只调整 Presentation 与观察时序，不改变 Pane ownership、Runtime、FIPC、Schema/Migration 或 Agent semantics。

```text
CONVERSATION_TOP_LEFT_RADIUS: 16PX STANDARD / 12PX SMALL / 20PX LARGE
CONVERSATION_TOP_RIGHT_RADIUS: 0
ACTIVE_TAB_REVEAL_AFTER_DOCK_RESIZE: YES
```

## 123. Window-level Workspace Tool Menu

单标签 Browser host 暴露出“＋”Tool Menu 虽声明为 Overlay、实际仍挂在 Right Dock Header 内的问题：菜单左侧会被
Dock 的 overflow 边界截断。Tool Menu 现在与通用 Tab context menu 一样通过 `document.body` Portal 承载，使用
fixed viewport 坐标；打开、窗口 Resize 与祖先 Scroll 时重新读取触发器和菜单真实 bounds，并在窗口边缘自动翻转、
保持至少 `8px` inset。点击菜单项、外部点击和 Escape 的关闭语义保持。

真实 Electron Workspace Dock 回归增加“仅一个 Browser Tab”场景，验证 Portal parent、fixed positioning、四边
viewport bounds 与左上命中测试，避免仅以 DOM 存在制造假绿。Pane ownership、Browser Runtime、FIPC、
Schema/Migration、Permission 与 Agent semantics 不变。

```text
WORKSPACE_TOOL_MENU_HOST: DOCUMENT_BODY_PORTAL
WORKSPACE_TOOL_MENU_POSITION: FIXED / MEASURED / VIEWPORT_CLAMPED
SINGLE_BROWSER_TAB_MENU_CLIPPED: NO
```

## 124. Conversation Disclosure, Summary Recovery And Turn Navigation

2026-09-07 用户要求先修复 Conversation 样式与过程展示，再处理 Agent 执行质量。当前工具组、
单项操作及长段过程说明均支持渐进展开，失败结果直接显示已有错误原因；历史文件引用只从同 Run
成功读取回执解析，并复用既有带 SHA 校验的文件查看器。正文、执行记录、表格及 Composer 共用
1040px 上限和 `clamp(28px, 5cqw, 56px)` 留白；顶栏标题使用 500 字重并与菜单文字保持相同侧边距离，
正文强调与标题不再另增字号，右侧工具区展开后控制按钮按实际 Conversation 边界定位。

设置、资料库或已安排页面返回后摘要按钮丢失已通过真实打包应用复现，原因是 ProjectWorkspace
查找 Portal host 时 DesktopChrome 尚未恢复该节点。host 现在常驻并按路由隐藏，摘要菜单恢复正常。
至少四个已展示用户轮次且内容需要滚动时显示左侧轮次导航；支持鼠标/键盘跳转、当前轮次标记、
独立滚动和切换对话清理。开发版与打包版验证覆盖 8/40 轮、窄窗、右栏展开和摘要页面往返。

UI Lane 225 项、UI/UX 23 项、打包应用启动及 single-instance 检查均 PASS，证据位于
`artifacts/conversation-summary-navigation-packaged/`。这些是隔离数据的界面验证，模型请求为 0；
原登录任务的 24 步终止、排查效率、编辑失败恢复与验证闭环尚未修改，不能视为 Agent 质量验收。

## 125. Sliding File Workspace, Search And Shared File Presentation

2026-09-08 用户连续提出右侧 Dock 与文件目录的拖动、展开/收起、布局、筛选和文件展示共 13 项修正。
该切片沿用现有 Pane ownership：普通拖动缓存边界并按 animation frame 写 CSS，仅结束时保存宽度；
向左越过普通 split 上限可进入扩展并反向恢复。点击开合由同一 grid 负责，内容按测量宽度裁切显现，
消除旧 opacity/translate 前奏与目录 display:none 导致的突然消失。长文件在拖动和目录动效中保持
代码排版宽度，结束后按真实可用区域重新换行；语法颜色和源文件行号始终保留。中断/失焦会释放拖动。

已确认旧 textarea 字体 shorthand 与高亮层行高不同，导致滚动与换行错位；两层现共用字体、行高、
scrollbar gutter 与即时 scroll 同步。目录 aside 继承的旧 28px padding 已清除。工具栏与目录边界
共用 1px 中性分割线；目录开关改为 Folders，放在“打开”左侧；扩展状态改用向内的 ArrowsInSimple。
筛选框距横线 5px，支持大小写无关的文件名/路径、多个关键词、清空/Escape、无结果反馈与过滤路径压缩；
常规目录保留 18px 层级缩进，hover/focus 增强祖先线。

用户授权文件类型图标例外：本地 MIT Material Icon Theme 子集同时用于目录与文件/图片 Tab，
JS/TS/React/ESLint/JSON/Markdown 等按真实路径映射，Tab 重命名不改变文件类型。产品控件继续使用
Phosphor。代码主题独立于图标资源，以紫色关键字、蓝色属性、青绿色字符串协调浅色/深色外观，
源代码等宽行号不为软换行重复计数。不宣称该资源就是 Codex 内部使用的图标库。

UI Lane 类型检查、lint 和 225 项单元检查、UI/UX 23 项检查 PASS。隔离 Core 数据和 Electron profile
的打包应用 E2E 已验证 400 行长文件真实鼠标滚动到底、输入/高亮位置一致、双层裁切开合、内部分割线
往返拖动/键盘/失焦清理、搜索与清空、目录层级以及实际解码的目录/Tab 图标；外侧 Dock 回归覆盖窄窗、
宽窗、偏好恢复、扩展/还原、Reduced Motion 与 File/Browser/Terminal。证据位于
`artifacts/workspace-file-experience/`。打包输出位于 `apps/desktop/out/fielora-file-workspace-20260908/`，
包含 Release Core。上述自动与截图验证不替代用户对最终拖动手感的复看；Core/Agent/FIPC/Schema 未变。

## 126. Workspace Motion Profiling And Native Open Default

2026-09-08 用户复看仍确认三条竖向分割线、终端和整体开合卡顿，说明上一轮几何/功能检查不足以
证明流畅度。300 文件、FILES 加 3 个文件 Tab、4798 DOM 节点的同机真实打包应用 trace 确认：
高频宽度 CSS 变量默认继承，导致无关文件行、高亮 token 和隐藏 Tab 每帧重复计算样式。仅对三个
宽度输入做 non-inherited ablation 就使对应样式计算耗时下降 83%–91%；这不是动效曲线猜测。

当前所有 live grid 输入及临时 slide/code/content 尺寸均限定在实际消费者上，必要时只显式传递一层。
目录树使用 memo 与稳定回调，避免开合时重复构造隐藏 Tab 的树。导航缓存拖动起点/边界，视口宽度
校正在手势结束后执行；侧栏保持内容宽度，由同一 grid 裁切显隐，取消独立 padding/opacity 动画。
终端层和上方 Conversation/Dock 共享 height/margin 时间曲线，终端内容保持完整高度，无额外淡入平移；
left 直接跟随导航边界。终端拖动只预览局部尺寸，释放后一次提交 React 状态和 localStorage。

“打开”默认按钮复用本机 FILE_EXPLORER native icon；下拉菜单只显示其他已安装应用，移除
文件资源管理器重复项、Fielora 文件/终端及遗留分割线。既有系统打开行为保持。

UI Lane 类型检查/lint/225 项单元检查与 UI/UX 23 项检查 PASS。打包回归覆盖全部三条竖向分割线、
开合中间帧、终端逐步拖动与释放持久化、文件长文滚动/筛选/图标/重启恢复，以及窄宽窗口、边缘收起
反向恢复、Reduced Motion 和 File/Browser/Terminal 宽度。证据位于
`artifacts/workspace-motion-performance/`；交付位于 `apps/desktop/out/fielora-motion-20260908/`。
保留旧包与用户数据；未修改 Core/Agent/FIPC/Schema，也不声称已知 Codex 内部实现或以自动结果代替
用户最终手感判断。

## 127. Real Project Directory Layout Cost And Drag-to-Collapse

2026-09-08 用户确认 motion 包在文件与目录同时打开时仍严重卡顿。本次直接以用户截图中的本地
Project 为只读输入、隔离 Core 数据和 Electron profile 复现：目录挂载 2759 个文件/文件夹行，
整个页面 20117 个 DOM 节点。上一轮 300 文件 trace 不足以覆盖此场景。外侧/内侧分割线实际往返
拖动的帧间隔 P95 分别为 133.5/133.4ms；样式变量的继承开销已减少，但目录中屏幕外的行仍随
每一帧宽度变化重新 layout。仅固定目录 body 宽度的 ablation 即使两条分割线降至约 16.8ms。

现有 outer/inner divider 共用 measured-width hold：手势开始时一次读取 active code surface、
directory body 或 standalone Files 的真实宽度，手势中只改变裁切 viewport；释放、失焦、capture
丢失或卸载均恢复响应式宽度。没有隐藏 syntax、修改目录数据、丢失选择/折叠状态或引入第二套树。
真实项目修复后 outer/inner P95 为 17.4/16.9ms；2500 文件分层 fixture 也通过持续拖动检查。

用户同时要求内部目录分割线拖到最右侧收起：live preview 可缩到保存宽度下限以下，距右缘 36px
时进入与工具栏相同的目录 collapsed 状态；同一次 capture 手势反向拉回 80px 即恢复。收起不覆盖
原展开宽度，按钮再次展开恢复偏好；松手后代码区域按最终可用空间排版。真实 E2E 已覆盖上述状态、
跟手位移、手势中两层内容宽度保持、释放与失焦清理。证据位于 `artifacts/file-pane-drag/`；
新包位于 `apps/desktop/out/fielora-file-drag-20260908/`。用户文件只读，Core/Agent/FIPC/Schema 未变。

## 128. Live File Scrollports And Viewport Rendering

2026-09-08 用户指出拖动时文件滚动条留在旧位置、松手才移动。已确认这是上一轮整块内容宽度
hold 的副作用。本轮 supersede 第 127 节的 direct-drag width hold：代码、目录、筛选框和原生
scrollport 均实时使用当前 Pane 宽度，保留现有 click-driven 裁切开合与右缘收起/反向恢复语义。

目录超过 200 文件或行时，将既有过滤/折叠树展平成可视窗口，挂载 viewport 与上下 overscan；
完整行数、字体感知行高与 spacer 维持原生滚动范围，宽度变化不回写目录 React state。实际 Project
2759 行目录只挂载 29 行，整页由原 20117 个 DOM 节点降至 755，目录底部、筛选和 Home 导航可用。

400 行长代码进一步暴露旧 textarea + 全量 syntax DOM 的双份排版开销。文件 Surface 现复用 MIT
CodeMirror 6 的可视范围排版，统一拥有软换行、语法、行号、光标、选择、撤销与原生滚动；语法仍映射
现有 Theme token，文件 Tab、目录、审阅/写入与 Core 文件权限不变。保留 CRLF，避免仅打开 Windows
文件就产生未保存修改；不增加 IDE Pane、补全入口、Runtime 或文件访问通道。

最终包在 2500 文件 + 400 长代码行、实际只读 Project 两组测试中，outer/inner 拖动 P95 均约 16.8ms；
按住鼠标采样时 scrollport 边缘与 Pane 对齐，代码换行和滚动范围实时变化。单次压力测试仍出现一个
50ms 离群帧，不宣称所有硬件或场景零掉帧。测量窗口禁用 Chromium 原生遮挡降频，产品启动参数不变。
UI Lane 类型检查/lint/225 项检查、UI/UX 23 项检查与 targeted packaged E2E PASS，覆盖长文件滚动
到底、可见行号位置、输入撤销、CRLF 审阅/写入/撤销精确还原、Markdown/Source、目录筛选、双层开合、
窄宽窗口/Reduced Motion、File/Browser/Terminal 及 Core 重启恢复。证据位于 `artifacts/live-scrollbar/`；
新包位于 `apps/desktop/out/fielora-live-scrollbar-20260908/`，保留 Release Core 和旧包。未修改用户项目
文件、Core/Agent/FIPC/Schema；这些自动验证不替代用户最终手感复看。

## 129. Workspace info 与 Tab 交互校准（2026-09-08）

用户授权优化摘要菜单的图标/功能，并补充选中标签阴影、方向键竖线、滚轮横移和溢出渐隐。
工作区信息现在区分任务 Review 与 Git 工作区计数，分支/上游为真实静态信息；状态与未暂存
改动统计复用已有终端只读入口。GitCommit、ListChecks、ArrowUpRight 经 Phosphor registry
统一使用；来源沿用文件类型图标，可直接返回对应文件。重复添加、伪分支下拉与未实现 PR 项移除。
提交/推送分开生成可检查的 Composer 草稿，保留用户原文，不自动发送；没有上游时推送不可用。
这属于 Product/Workspace 的交互纠正，未修改 Model、Harness Governance、Tools 或权限边界。

标签旧样式覆盖选中阴影，且主按钮 outline 被父标签裁切为竖线；现由完整 Tab 承担键盘焦点，
选中使用浅中性底色与 subtle shadow。共享 TabStrip 增加左右方向键/Home/End 和 roving tabindex，
Dock 通过非 passive wheel 支持普通滚轮横移并保留横向触控板。左右 mask 根据实际溢出变化，
不包含“＋”及窗口控制，不因无关 Conversation render 将手动滚动拉回。保持既有 Pane ownership。

打包桌面已验证 12 个 File/Tool 标签、键盘连续切换及完整焦点、横纵滚轮、两侧渐隐、关闭与工具菜单，
以及真实临时 Git 仓库状态/统计、刷新、来源图标、草稿保留且零自动发送、非 Git、窄窗口和菜单明暗外观。
UI Lane 225 项、UI/UX 23 项通过。新包与证据分别位于
`apps/desktop/out/fielora-workspace-info-tabs-20260908/` 和 `artifacts/workspace-info-tabs/`；
不修改用户 Git 工作区，不执行用户项目 commit/push，不改变 Core/FIPC/Schema。


## 130. General Agent 首轮补齐：进展、续接与完成证据（2026-09-09）

用户授权补齐 Agent，并要求每次结合故障解释所属架构职责。本轮在既有
Model + Harness + Tools 内扩展 `GENERAL_AGENT_LOOP_V2`：三轮无新增成功工具证据
触发重新规划，六轮暂停；八轮阶段回看，余五轮提醒收敛与验证。工具读取不再由
仅参数缓存长期遮蔽外部文件变化。模型判断与工具回执分开保存为有界工作检查点。

原单次预算仍默认 24、最大 64；General 耗尽改为可继续的 PAUSED，显式 Resume
为同一 Run 追加最多 24 步，累计硬上限 4096，授权与投影/事件原子持久化。
Migration 0016 保留全部 Run/事件/工具/Artifact lineage，旧 Migration 不改。
无新增 Provider、权限或语义权威；新数据库不可直接用旧二进制回退。

所有 Provider 的 action 完成判断不再允许仅凭文字；代码修改需当前版本验证，
未完成操作/未通过验证/未知结果明确保留待处理状态。桌面暂停原因、继续额度与
停止按钮在折叠过程下仍可见。此轮是稳定长任务的第一条纵向流程，不代表完整
Aegis、后台调度、语义假设验证、General no-change 验收或自动上下文压缩已完成。

验证入口：`tests/integration/core.integration.test.mjs` 的 General continuity 场景、
Storage migration 0016 原子/保留/预算测试、`tests/e2e/agent-continuity-e2e.mjs`。
当前已通过 Core 重启/旧指纹/恢复编辑/验证/停滞/虚假完成/跨 64 步检查，
Storage 0016 保留与失败回滚测试；开发版真实 Electron 继续/停止/重启恢复与完整 Cross Gate 已通过（227 项 TS、293 项 Rust、13 项 Core integration）。打包版同一流程亦通过。新包位于 `apps/desktop/out/fielora-agent-continuity-20260909/Fielora-win32-x64/Fielora.exe`，证据位于 `artifacts/agent-continuity/`、`artifacts/agent-continuity-packaged/` 与 `artifacts/agent-continuity-cross.log`。
未运行真实外部模型验收。

## 131. General Agent 持续执行纠正（2026-09-09）

用户拒绝默认每 24 步暂停的长任务体验，要求生成纠正后的体验包。General V3 中
正常发送、排队和重试使用默认资源策略，阶段检查不暂停；默认累计 4096 步仅作为
最后防失控上限。显式小预算与历史 Run 的既有额度保留，不静默扩张。
整体预算为累计模型/工具运行 60 分钟、输入 200 万或输出 65,536 token；缺失 usage
时按字节估算。预算账目由既有事件恢复，重启和批准不清零，耗尽后的显式继续才续额。

工具失败也可能提供新信息；重复不变操作先请求改策略，持续重复才暂停。
过长历史自动整理成原始任务上下文、工具事实检查点和完整的近期调用/结果，
模型判断仍标为未验证；此能力不等同于完整语义计划或模型窗口自适应压缩。
这次修改属于 Harness.Orchestration / Continuity / Ingress & Context / Governance，
沿用同一 AgentRun、Schema 16、权限、工具执行与当前版本验证机制。

完整 Cross Gate 通过（227 项 TS、296 项 Rust、13 项 Core integration）。开发版和
打包版 Electron 从实际 Composer 发起的任务均在第 24 步编辑失败后继续，第 27 步
完成真实 Node 行为检查，全程无暂停/续跑；显式小预算重启继续、旧指纹保护、
停止按钮、持续重复与换策略恢复、资源预算重启续额和完整工具交换整理均有验证。
新包：`apps/desktop/out/fielora-agent-continuous-20260909/Fielora-win32-x64/Fielora.exe`。
证据与说明：`artifacts/agent-continuous/`、`artifacts/agent-continuous-packaged/`、
`artifacts/agent-continuous-cross.log`。包内 Core SHA-256 与 release 一致：
`8b4f191c52949ffeca79cae0d0956b4157149ff5a709cdaed261f8abe1e5d4f9`。
用户原数据库已另存一致性备份，未以新包升级用户资料；fixture 无外部模型请求，
真实 Provider 定位实际登录问题的质量仍待体验，不能从模拟流程推断通过。

## 132. 新项目首条对话入口修复（2026-09-09）

用户截图确认无 Conversation 的 Project 仍使用遗留创建表单，缺少正常 Composer
的模型、权限、附件等控件；该表单只创建空对话，选择切换还会清空输入。
现在空 Project 和现有 Conversation 复用同一 Header、消息区与 Composer，保持
现有阅读列和右侧工具区布局。首次发送创建或复用未发送对话，并使用捕获的文本、
附件、模型和权限启动任务；同步提交锁避免首次发送期间重复创建消息/任务。
仅打开项目不创建对话，显式新建仍复用未发送对话。属于 Conversation UI 状态衔接，
本轮未改变 Model/Harness/Tools、Core、Schema 或权限边界。

UI Lane 227 项测试、UI/UX 23 项检查通过。开发和打包 Electron 验证首次发送、
文本附件保留、模型/权限选择、连续提交只启动一次、未配置模型保留草稿、右侧
工具区打开后的控件几何与显式新建对话通过。使用隔离资料和本地模型 fixture，
外部模型请求为 0；未验证真实模型回答质量或语音识别服务。
新包：`apps/desktop/out/fielora-new-project-composer-20260909/Fielora-win32-x64/Fielora.exe`。
证据：`artifacts/new-project-composer/`、`artifacts/new-project-composer-packaged/`。


## 133. 模型故障续接与过程展示修复（2026-09-10）

用户实际两次任务在第 46/38 步以 PROVIDER_PROTOCOL_ERROR 结束，均已修改文件。
终止前消息上下文约 121 KB；旧记录未保存 HTTP 拒绝状态，不能据此断言是上下文
超限、供应商故障或某个 MCP 导致。旧继续按钮仅重发需求，未把已有工作放回
模型上下文；旧协议重试在存在工具历史时没有整理历史且削减了验证工具。

本轮在既有 Harness 中补齐：模型故障有限重试时整理完整工具交换，保留原始
需求、基于回执的工作检查点和验证工具；可恢复模型错误保存后暂停，同一 Run
继续。历史 FAILED 保持不变，通过显式关联尝试继承已知变更及未验证工作线索，
重新检查当前文件并运行当前尝试的验证。HTTP 拒绝与响应协议错误分开记录，
不保存响应正文或凭据。不新增 Schema、Runtime 或权限权威。

界面仅显示当前说明及最近操作组，旧过程淡出后保留在可展开记录内；批准和
继续入口始终可见。移除重复准备上下文和未配置 MCP 提示；保留真正的连接
诊断。结果使用统一语义/文件类型图标，移除按钮内分隔点，跳到底部使用箭头。
同一用户轮次的旧失败尝试折叠在最新结果之前，避免成功结果上方/下方混排。
修正工具事件频繁刷新会重置计时器而使耗时停留不到一秒的问题。

Cross Gate（230 项 TypeScript、297 项 Rust、13 项集成）及 UI/UX 23 项检查通过。
开发和打包 Electron 验证进度替换/展开、暂停后重启同 Run 继续、旧失败关联
续接无重复写入、旧尝试折叠与最新结果顺序通过。负向集成检查确认已修改文件
被改回错误状态后不能复用旧验证，修正并重新验证后方可完成。外部模型请求为 0，
不代表真实 Qwen 任务质量通过。release Core 与包内 Sidecar 哈希一致。
新包：`apps/desktop/out/fielora-agent-recovery-20260910/Fielora-win32-x64/Fielora.exe`。
证据与问题归属：`artifacts/agent-recovery-presentation-packaged/ANALYSIS_AND_VALIDATION.md`；
开发检查：`artifacts/agent-recovery-presentation/`。

## 134. 目标识别、无修改验证与稳定过程（2026-09-10）

真实 Run 01a08966-190f-7170-aad0-96c4636e0dd3 在 21 次读取/搜索后以
COMPLETED 结束，verification_passed=false；“改成”漏过执行意图判断，完成检查
未生效。绑定目标是 F:\项目\大猎英才\dalieyingcai，模型却把它叫作参考项目
headhunt-web。此前失败确实留下 finance-info 与 popup 文件的部分修改；失败
不代表回滚，当前看见这些代码也不证明业务目标已经验证。该轮未读取参考项目。

修复复用 Harness Work Scope、Context、Continuity 与 Verification：统一常见
修改表达识别；固定目标根目录身份，携带同项目/同任务的有界历史事实；读取后
宣称完成必须经过检查。已有功能允许不修改，检查回执绑定当前已读取文件，
检查时文件改变则拒绝旧结果。该约束只覆盖已观察路径及既有验证命令分类，
不等同于自动证明模型的业务测试充分性，也不声称已修复用户财务系统。

界面固定说明在操作上方，连续查找/目录/读取合并并保留逐项原始记录；区分
语义图标，旧式结果对号使用中性统一图标，原文与代码示例保留。当前验证进度
及可体验包以 artifacts/agent-goal-progress-packaged/ANALYSIS_AND_VALIDATION.md
为交付记录；不使用真实供应商自动请求。

本轮最终 Cross Gate（231 项 TypeScript、297 项 Rust、13 项集成）与 UI/UX
23 项检查通过。开发和打包 Electron 的流式/落盘几何、合并组、语义图标、
有验证无修改完成、无验证暂停及代码原文保留通过；普通进度的说明槽在两种
状态下均为 40 CSS px。光标从独立行改为跟随文字，避免再次推移操作区。
打包恢复回归确认重启后同 Run 继续、历史 FAILED 关联续接无重复写入与重新
验证通过。release 与包内 Core 哈希一致。新体验包位于
`apps/desktop/out/fielora-agent-goal-progress-20260910/Fielora-win32-x64/Fielora.exe`；
详细验证与构建哈希见 `artifacts/agent-goal-progress-packaged/delivery.json`。


## 135. Agent 内置浏览器与按用例验收（2026-09-10）

用户确认补齐真实页面操作和验收。新增受既有 Harness 权限控制的 browser / browser_plan / browser_verify / browser_server；Core 通过 Main 专用 FIPC 调用现有 BrowserRuntime，Agent 打开目标页面时展开右侧浏览器。网页没有新增特权桥接；固定隔离世界适配器只接受有界数据和已观察元素引用。旧快照、断开控件、其他运行页面和不确定点击结果均不会伪装成功。

验收计划、各用例断言、当前工作区版本与截图沿用现有 ToolCall / VerificationReceipt / ScreenshotEvidence 持久化。构建成功不能替代缺失的 UI 用例，检查失败或后续修改使完成条件不满足。截图、DOM 断言和真实业务验证的范围分别说明，不声称页面打开即验证成功。

桌面检查同时定位到右侧 Dock 打开时祖先位移动画未同步原生网页位置，导致宽度被裁为零；BrowsePanel 在打开动画期间同步原生边界。测试使用独立本地到账弹窗，不修改用户的大猎/猎头项目、不提交真实财务记录、不发送真实模型请求。验收充分性仍依赖用例与需求的对应；本轮不宣称完整视觉理解或真实模型质量通过。

开发服务也由 Agent 经既有 WorkspaceRuntime 启动、查看有界输出和停止。Core 注入真实 Project 根目录；模型只提供 Node/npm/pnpm/yarn 和字面参数。每轮最多一个、总计四个运行中服务；停止及 Core 重启/应用退出清理自己创建的进程树。普通 run_command 会等待退出，不能假装承担持续开发服务生命周期。服务启动不记为验证通过。

Cross Gate、UI/UX Gate、开发版浏览器 E2E、打包版浏览器 E2E 与打包版恢复回归均通过。隔离弹窗先检测错误文案，再修改并完成六个有截图的验收用例；缺少用例、旧快照操作、Core 重启后的自有服务清理和截图持久化均有断言。打包测试的首次失败检查保留了六条失败文案断言，但截图未成功保存，不能算通过；后续六个成功用例各有截图。另有注入截图失败的回归证明，即使 DOM 断言通过，缺失截图仍返回失败。真实供应商质量、目标业务站点及完整视觉等价性尚未验证。证据与新包哈希见 `artifacts/agent-browser-packaged/ANALYSIS_AND_VALIDATION.md` 和 `delivery.json`。

## 136. 图片续跑、草稿与诊断上下文修复（2026-09-10）

真实故障记录确认：旧对话带图请求在第一步被 HTTP 400 拒绝；新对话长任务累计 68 次模型调用、2,392,059 输入 / 10,183 输出 token，期间已有 5 次上下文整理。前 56 次触发累计输入预算；继续后只把“发票 ID”字面量改为“发票号码”，相同翻译 ID 仍覆盖字面量。不能把这视为修复错误表单字段。未保存供应商拒绝正文，无法确定其历史 400 的精确原因。

确认的实现缺陷包括：普通 assistant 消息携带空 tool_calls 数组；草稿在切换时清空；原始图片从内存取出即删除且未持久化；search_text 命中单行翻译字典却只返回行首，实际命中内容不可见。修复分别落在 Model adapter、Conversation UI、Harness Context/Continuity 与 Tools。普通助手省略无意义可选字段，拒绝正文仅有界读取并归为固定错误码；图片沿用内容 Blob 与 Checkpoint 保存，resume 可恢复历史消息附件，已有原图不允许被替换。没有新 Migration 或权限范围。

General 初始自动材料降为最多 4 文件 / 16 KiB；历史约 64 KiB 触发整理至约 40 KiB，保留原始要求/图片、早期及近期工具观察、完整近期工具交换。重复及多次无结果搜索给予换策略提示，累计预算保持。search_text 返回命中附近的 UTF-8 片段并明确字面搜索语义。草稿按 Project/Conversation 隔离，覆盖切换与工作区重挂载；未发送草稿不承诺应用退出后持久恢复。模型仍负责理解与诊断，Harness 和工具改善不等于保证任何模型一次完成。

本轮不修改用户财务项目，不发起真实模型自动请求。验证结果与体验包见 artifacts/agent-context-drafts-packaged/DELIVERY.md。

最终 Cross：239 项 TypeScript、303 项 Rust、13 项集成通过，UI/UX 23 项通过。开发与打包 Electron 均通过草稿/原图恢复与既有续跑回归；旧格式任务恢复图片时保留原暂停原因，续额成功。新包浏览器用例回归通过，release 与包内 Core SHA-256 一致（3d190ad0a727957828d894df6be27177aa8abd61ec6586268e13a65c47e325de）。体验入口为 apps/desktop/out/fielora-agent-context-20260910/Fielora-win32-x64/Fielora.exe；真实供应商与财务业务验收未执行。


## 137. 任务目标驱动的共享执行生命周期（2026-09-11）

真实运行 01a08e9b-f722-7d13-b644-030825825469 在 Focused Edit 内部 min(16) 边界失败，尽管 Run 的 max_steps 为 4096。16 次模型请求均未收到图片；第 15 步替换因文本匹配失败，第 16 步重读后被策略上限终止。本轮没有成功修改文件。不是全局额度真的耗尽，也不能把“添加备注”的模型推测当成用户要求。

Focused Edit 现在复用 General 的循环、上下文整理、资源计量、进度反馈和完成核验；分类只影响初始定位策略，不再隐藏浏览器/验证工具或施加 16 步任务终点。Fast Edit 保留局部优化，无法完成时通过既有 Checkpoint 在同一 Run 接续共享循环，保留工具回执，不能把策略尝试用尽当成任务结束。

任务目标、原始输入、已执行事实、当前验证和剩余义务进入原有 Work Checkpoint。缺少动作或验证时反馈具体义务继续做；连续相同结论且没有新增工具动作才暂停。最新失败检查不能被旧成功覆盖；成功也必须对应当前版本。桌面 UI 任务即使模型没主动使用浏览器，仍要求其声明的浏览器验收全部通过。原始需求到验收项的语义覆盖仍依赖模型理解，不能宣称机器已证明所有用户意图。

明确引用历史图片的新一轮任务从当前 Conversation 最近原图恢复，UI 兼容旧消息附件，Core 使用已有持久 Blob。找不到被引用的图片时，在调用模型前暂停，防止无图猜测。未引用图片的普通新任务不自动携带图片。总资源预算/用户停止、未知执行结果、持续停滞仍是明确暂停或停止边界；不以无上限循环代替进度判断。

没有新增 Schema、Runtime、Permission 或 Verification authority；不修改业务财务项目，不调用真实模型自动测试。证据和体验包见 artifacts/agent-goal-lifecycle-packaged/DELIVERY.md。

共享工具目录还移除了旧的中国模型固定白名单/16 工具裁剪；Qwen 等行为配置可以提供提示和协议兼容，不能因此失去浏览器、已激活工具或核验能力。启动与暂停竞态也被修正：排队阶段暂停沿用同一运行控制信号，不会被随后启动覆盖。

本轮最终 Cross：240 项 TypeScript、306 项 Rust、13 项集成通过，UI/UX 23 项通过。交付 EXE 上目标生命周期、图片/草稿、浏览器验收、恢复和暂停消息队列均通过；Qwen 配置路径覆盖 Focused 第 25 步完成、三次上下文整理及 Fast 同 Run 接续。打包 Core SHA-256 为 611b8aadb11c6308ee5461fa2a731d131bafca80076417c8ac5ae2c7383c6609。具体证据和未验证边界见 artifacts/agent-goal-lifecycle-packaged/DELIVERY.md 与 delivery.json。

## 138. 历史图片重试与缺图暂停恢复（2026-09-11）

实际运行 01a08f9f-f962-7f31-a549-cab2496b35e0 是旧失败轮次的重试。RUN_CREATED 的 input_attachment_count 为 0；没有 MODEL_STARTED，step 0 即因 AGENT_REFERENCED_IMAGES_UNAVAILABLE 暂停。上一轮修复覆盖了普通发送的历史图片查找，遗漏 retry/resume 对文字引用消息的历史图库恢复。图片可在聊天中显示，不代表进入了模型输入。

Retry/Resume 现在共用旧消息附件解析：优先原消息自身图片，否则按明确引用读取同一 Conversation、原消息及之前的最近图库，不读取后来的图片。Core 历史输入回退也遵守原消息边界。缺图暂停且尚未调用模型/工具的现代 Run 可以恢复原图并持久化到原 Run；普通文字任务或已有输入的执行中任务不能借恢复替换图片。提示改为继续工作尝试恢复原图。无新 Schema、权限或模型绑定；回归覆盖这两条真实 UI 入口，真实供应商和业务页面验收另计。

验证：Cross 241 项 TS、306 项 Rust、13 项集成与 UI/UX 23 项通过；交付 EXE 上图片恢复和目标生命周期回归通过。新包及证据见 artifacts/agent-image-references-packaged/DELIVERY.md，包内 Core SHA-256 为 b75e0d42aa7999f0589001fd16bd6ba86d25f23c9e3ba5ebb7b342e580fb114b，与 release 一致。真实模型和财务业务页面未验收。


## 139. 修改范围、源代码证据与验证进度（2026-09-11）

实际失败 Run 01a08f9f-f962-7f31-a549-cab2496b35e0 的 60 次模型请求均带两张图片，期间完成 11 次上下文缩减；并非没收到图片或没有压缩。它仍把指令内已有 action 135 银行加载逻辑当成外层控制器缺失功能，并修改了被其他页面共用的翻译键；没有进行页面或命令验证，累计输入达到约 202 万而暂停。

现有 Harness 工具记录增加 work_plan，保留预期差异、文件范围、不变行为、带当前文件 hash 的原文引用及未验证的解释。直接 UI 文件编辑前需工作计划或既有浏览器计划；声明范围外的直接写入需先有新读取证据和计划修订理由。共享翻译键修改会扫描范围外静态消费者并反馈局部修正路径。计划不是授权，也不是验收证据；该检查不覆盖任意 shell 写入或动态翻译引用。

计划随现有 Checkpoint 保留并重新进入每次模型请求，不增加独立状态库。模型写入后仍未核验时显示“修改已保存，等待验证”；任务仍以当前版本的检查证据判定结束。重复查询同一文件版本的相同行、重复读取已覆盖区间和空搜索不再重置进展信号。移除固定每 8 步的泛化复盘，以实际计划和未验证状态提供反馈。搜索工具识别被误写成正则的空查询；Git 工具在启动进程前拒绝重复子命令。最终 Cross 的 242 项 TypeScript、310 项 Rust、13 项集成与 UI/UX 23 项通过。开发版及 r2 新包均通过修改范围、共享翻译保护、原计划/证据跨整应用重启恢复、实际弹窗六项检查和未验收不得完成的回归；新包图片/草稿与目标生命周期回归通过。首次打包检测到运行工具目录漏注册 work_plan，已修正并补充目录一致性断言。交付为 apps/desktop/out/fielora-agent-scoped-execution-20260911-r2/Fielora-win32-x64/Fielora.exe，说明与证据位于 artifacts/agent-scoped-execution-packaged-r2/。Release 与包内 Core SHA-256 同为 10166c9d5474ea720086d77f974ee622476cd83963592c2827e4dacb86260e55；真实模型质量与财务业务验收未执行。


## 140. 计划门槛导致的续作循环修正（2026-09-11）

同一实际 Run 后续出现 32 次引用不匹配、1 次旧引用过期，只有 1 次计划成功后模型继续补充未经要求的客户抬头数据源。实际源码引用与带行号的工具输出比较导致多行误拒；自己改过文件使旧证据整份失效。此前“计划约束”没有证明需求理解正确，反而锁住了错误计划。这是已确认的 Harness 规划/证据恢复缺陷；模型把正确的七字段目标改成新增客户抬头也属于理解与执行偏移。

work_plan 改为可选辅助记录，模型声明的文件列表不再阻止正常直接编辑。可选代码引用自动处理行号，未变化片段允许刷新，失效引用明确排除于已确认事实，计划仍可保留；不需要反复重填计划。写文件并发哈希、既有权限、共享翻译影响检查及结果核验保持。续作在上下文整理后重新提供原任务与核对要求：已写入代码和旧计划不能证明用户要求增加某字段。补充 apply_patches 参数结构恢复提示和计划记录 UI，旧错误保留可理解的解释。

本轮不改财务业务项目，不调用真实模型，不把 fixture 完成当成实际模型质量证明。验证结果见 artifacts/agent-plan-recovery-packaged/DELIVERY.md。

最终验证：Cross 243 项 TS、312 项 Rust、13 项集成，UI/UX 23 项通过。开发与交付 EXE 的辅助计划/整应用重启恢复/六项真实页面检查通过；交付 EXE 上目标生命周期和跨轮原图恢复通过。新包为 apps/desktop/out/fielora-agent-plan-recovery-20260911/Fielora-win32-x64/Fielora.exe，Release 与包内 Core SHA-256 同为 191f96ccf28f7923965c3048df660b5f61f396660a975e98049d3a8c01466489。真实 Qwen 业务执行尚未验收。


## 141. 浏览器假成功与开发服务地址恢复（2026-09-11）

同一 Run 第 171 步因尚未验证暂停。模型访问 localhost:150 两次，回执 success=true、text 为空、elements=[]、navigation_generation=0，却推断为需要登录。实际配置引用 host=127.0.0.2、port=8019，当前监听也在该地址；--150 不能当作端口声明。服务回执此前仅报告进程 RUNNING，没有检查网站可访问性。模型仍添加不属于正确参考七字段的客户抬头，因此此前运行机制修复不等于需求理解被证明正确。

BrowserRuntime 现在独立保留主文档加载错误，失败或未提交的导航不再产生成功快照；提供网络错误和请求/已提交地址。成功文档区分空内容与可见密码输入框，密码值仍不返回。browser_server 可选 url 只探测固定回环 IP 的 TCP 监听，不发 HTTP、不跟随重定向，不将进程存活或端口监听冒充页面可用。恢复提示保留原任务并要求查实际配置/输出，兼容旧版空白假成功回执。界面解释页面未加载和服务未检查；不增加新计划门槛、状态库或无上限重试。财务项目和实际服务未被本次修复修改或停止。

验证与新包结果见 artifacts/agent-browser-load-packaged/DELIVERY.md；真实模型对业务参考图的语义一致性仍单独验收。

最终验证：Cross 246 项 TS、313 项 Rust、13 项集成与 UI/UX 23 项通过。开发和交付 EXE 的失败地址恢复、空文档/密码表单区分、七张页面截图与六项页面断言通过；交付 EXE 的任务生命周期与历史原图恢复通过。初次开发启动发现新模块扩展名重写解析问题，修复 Main Webpack 解析后完整重跑桌面验证。新包 apps/desktop/out/fielora-agent-browser-load-20260911/Fielora-win32-x64/Fielora.exe，包内与 Release Core SHA-256 一致为 e73bb0c188889d678adc18dec8537c30f390b198f4425ac0295f043f4498b980；没有实际模型请求或生产业务事务，未自动修正财务项目已有错误修改。


## 142. 非预算暂停后续作立即耗尽与服务恢复误判（2026-09-11）

用户在新版 browser-load EXE 中继续同一 Run，第 171→175 步只运行约 17 秒就再次暂停。实际已携带 1,894,974 输入 token，本次四次调用后为 2,024,231；此前因核验暂停而未获资源续额。四次调用均带两张图片，文本上下文约 35–56 KiB；没有整段从零开始。服务端口 127.0.0.2:8019 仍在监听，但新 Host 丢失旧进程关联并返回 NOT_STARTED，模型误解成服务不存在。续作指引缺少去重标记，旧工作计划又被重复投射到 goal.acceptance_cases。

修复明确用户继续时的本轮资源续额，保留历史账本和累计步骤，自动恢复/重试不续额。历史启动命令和真实服务/页面状态跨检查点保留，未跟踪进程不等于服务不存在；可对已运行的本地地址检查，不能停止或接管不属于本任务的进程。续作提示每次请求只保留一份，旧模型计划不再充当目标验收要求；界面耗时明确为累计。原任务与图片继续优先，没有修改财务业务文件、执行真实业务或调用真实 Provider。验证和交付结果见 artifacts/agent-resume-allowance-packaged/DELIVERY.md。

2026-09-12 最终验证：Cross 247 项 TS、315 项 Rust、13 项集成，UI/UX 23 项通过。开发与交付 EXE 上，近预算且因未验证暂停的任务经 Core 重启后继续第 6–9 步完成，没有重复修改；续作指引仅一份。两宿主均通过独立本地服务检查且不接管/停止、整应用重启恢复、原图恢复、页面六项断言和未验证不能完成。交付包负例一次截图捕获失败保持失败，修正后的六项页面截图均通过。新包 apps/desktop/out/fielora-agent-resume-allowance-20260911/Fielora-win32-x64/Fielora.exe，Core SHA-256 为 79b86fd8c16156ac6038976b0a748a3d816b0920c652125c271363323d1e4f4f，与 Release 一致。实际模型与财务业务验收仍未执行。


## 143. 过早页面快照、冻结的构建日志与登录交接（2026-09-12）

实际 Run 在第 230 步后继续，54 次调用使用 2,003,473 输入 token，暂停于 284；各次均有两张原图，并存在上下文压缩。成功导航在异步页面渲染前返回 EMPTY，此后没有再 inspect。三次服务状态的 8,192 字符输出完全相同。源码确认终端累计发出 512 KiB 后直接 return，使最新日志尾部也冻结在旧构建进度。这一轮不是续额未生效，也不是未压缩上下文；Model 重复读源码、尝试以代码检查代替页面验证仍属执行偏移。

工具层保留原终端显示上限，同时持续维护有限长度的最新输出；只读页面观察等待异步内容短暂稳定，最多 4 秒，并重新确认导航身份，超时明确标记，不重放点击/填写。已加载页面、密码框存在与请求用户登录状态保留到现有检查点。浏览器工具增加 request_login：需新鲜快照且 Host 再次观察到密码框，随后沿用 RunPaused 明确等待用户在侧栏登录；不读取密码、不将页面存在冒充已验证、不因任何密码表单自动暂停。

用户继续后保持同一 Run、修改和验收义务，优先重新观察页面。没有新增状态库、权限轴、Schema 或更大预算。测试与交付记录见 artifacts/agent-browser-handoff-packaged/DELIVERY.md；真实模型和财务业务验收不由 fixture 代替。

2026-09-12 最终验证：Cross 244 项 TS、316 项 Rust、13 项集成及 UI/UX 23 项通过，最终前端错误码修正后类型/lint/244 项测试重跑通过。开发与交付 EXE 验证延迟 SPA 表单、空页/旧快照拒绝、密码脱敏、登录交接及同一 Run 继续检查后完成；包内目标生命周期回归通过。Release/包内 Core SHA-256 同为 f25b8c46fa25b1f1dc0d064206c6bb862254fd5baac3641b87708aadb2b27df9。新包为 apps/desktop/out/fielora-agent-browser-handoff-20260912/Fielora-win32-x64/Fielora.exe。失败记录、原生页面截图、边界与完整验证见交付说明；真实 Provider/财务验收未执行。


## 144. 浏览器输入阶段与窄侧栏导航恢复（2026-09-12）

生产 Run 在点击已观察的“发票”链接后 9 ms 收到 UNKNOWN，回执丢失 Host 原错误；继续时按 NETWORK 高风险未知操作直接 FAILED。已确认当前 DOM 可见性没有区分屏幕外导航，跨 Electron 抛错被包装，而 Host 根据动作名称猜测是否未知。此次真实点击具体在哪一步失败已无法从旧回执确定。

修复沿用 browser Tool：返回结构化预检错误和明确输入阶段，报告链接地址、视口与命中状态；未发出输入可重新观察并改正动作；已发出输入而观察失败只补观察，不自动重复点击；真正不确定的输入仍保留 UNKNOWN 和原 Host 诊断。未知只读观察可重新读取；历史未知输入继续时保持待核对暂停，不再直接宣告任务失败。未增设状态库、权限、Schema 或预算。

当前实际接通的是内置浏览器受控 DOM/原生输入工具，不是完整 Windows computer use。原先单表单测试未覆盖收起菜单导航；本次增加窄 WebContentsView 遮挡、屏幕外菜单、展开导航、路由进入发票和打开弹窗验证。交付与已运行验证见 artifacts/agent-browser-interaction-packaged/DELIVERY.md；不得以 fixture 代替真实 Qwen 或业务验收。

本次实际桌面回归进一步确认：HTTP 文档有 DOM/visible/focus 时，原生输入仍可能没有页面事件；最小 Electron 对照中，输入前完成一次 capturePage 后同一坐标生效。先截图的旧测试掩盖了此问题。输入前增加有界且不保存像素的画面就绪检查，再核对页面身份和命中；固定 Chromium 鼠标命令逐步等待回执。焦点或更换输入 API 本身不能解决该就绪问题。

最终 Cross（248 TypeScript、318 Rust、13 Core integration）、23 UIUX、完整开发版与打包浏览器回归以及打包目标生命周期回归通过。窄窗口首次原生操作早于任何验证截图，3 次真实点击完成导航和弹窗，11 项检查通过。新包位于 apps/desktop/out/fielora-agent-browser-interaction-20260912/Fielora-win32-x64；包内与 release Core SHA-256 同为 67233accb3913f952fcca80802709b07d541d96666a630ca9cb842e62db659a4。以上使用隔离 fixture，外部模型请求和生产交易均为 0，原业务任务未被替代验收。


## 145. 搜索循环与诊断上下文修复（2026-09-12）

最新生产 Run 01a09553-7a96-7f82-baa5-b78b40157b9c 的 56 次调用只有 34 次搜索、21 次读文件、1 次目录读取，零编辑/浏览器验证。9 次正则形状查询因旧字面量契约失败；13 次泛化复盘和 7 次压缩没有推动模型改换验证方法。当前业务模板中的 T:12045/12046/12047/12048 与字典值不符，模型却把模板中文当成最终标签，并从旧截图推断另一个组件；本次只读取业务代码，不修改它。

search_text 增加受限正则和显式匹配模式，兼容先字面量、无匹配才对正则形状查询进行已披露回退；报告扫描限制/省略文件。WorkProgress 按实际位置和版本判断新信息，结果条数变化和重叠读取不冒充进展；模型输入保留最新完整工具交换，去掉较早的重复成功读/搜交换，压缩保留不同源事实而不累积重复诊断。复盘列出实际重复文件/查询以及缺失的当前页面观察，不增加强制计划、权限、状态库、完成权威或额度。工程验证和模型能否正确选择下一步必须分别报告。

本轮最终检查：248 TypeScript、324 Rust、13 Core integration、typecheck/lint/contracts/context 通过，Clippy 修正后复验通过；开发版/打包版目标生命周期与打包版完整浏览器回归通过。新增重复观察场景 4 次实际读取保留回执、3 个旧模型交换去重，随后修改和检查于第 8 步完成。交付在 artifacts/agent-search-convergence/DELIVERY.md；新包目录 apps/desktop/out/fielora-agent-search-convergence-20260912/Fielora-win32-x64，Core SHA-256 为 8610bc8f8254cf89dabee8bde5659aa2be5772d5b98258e123a6e52971c04ee1。真实模型语义收敛和原业务任务未验收，外部模型请求和生产交易均为 0。


## 146. 截图进入模型与编辑反馈修复（2026-09-13）

继续同一生产 Run 后累计 169 次工具调用：18 次补丁把 expected_sha256 放在根层，12 次浏览器观察 text 为空，4 次截图仅进入 Evidence 而未送入模型视觉输入。成功的控制器行替换额外插入闭合括号，页面实际编译失败。两张原始图片仍完整保存（原会话第一张大猎错误状态、第二张 X-GIANTS 参考），不能将此次问题描述成图片被压缩删除。模型仍反复改变字段目标。

Harness 现在将当前 Run/Conversation/Tool 所有权和内容完整性校验后的最新浏览器截图投影为 Model 多模态观察，明确与原始用户图片分开。续跑/压缩保留原图稳定编号；旧截图不替代目标，也不授予完成权。Tools 观察同源 iframe 中的有界文字、图标 title 和渲染错误线索；跨源框架仅披露不可读。单文件且无哈希冲突的补丁格式在已有 Policy/写入预检之前归一化，其他错误仍拒绝并保留具体恢复信息。

没有加次数或预算，没有新的状态库/权限/迁移。验证与包见 artifacts/agent-visual-feedback/DELIVERY.md。确定性模型替身只证明反馈链路，不能证明真实 Qwen 的图像理解、需求收敛或原业务项目已完成。

最终验证：Cross 249 项 TS、326 项 Rust、13 项集成通过；最后调整后 98 项 Core、clippy、类型/lint 通过。开发版和交付包真实 Electron 复现通过，同源错误可读、跨源框架保持不可读、title 图标可操作、截图像素进入请求、语法检查与九项页面断言通过；打包任务生命周期回归通过。包内与 release Core SHA-256 均为 10487ccb57fe290b71f37a852763c63048e6a3902e936a07eb18802685403603。新包为 apps/desktop/out/fielora-agent-visual-feedback-20260913/Fielora-win32-x64/Fielora.exe。测试未调用外部模型、未写生产业务项目，真实语义验收仍未运行。


## 147. 真实空图标与浏览器观察循环修复（2026-09-13）

用户运行 visual-feedback 新版续跑后，仍报告错误翻译、重复操作与未完成。本轮只读核对生产任务 calls 170–320：151 次工具调用含 68 次读取与 54 次浏览器操作；其中 36 次浏览器回执的实际内容重复，旧身份计算只认出 2 次；4 次观察已包含错误翻译。业务源中 T:12045/12046/12047/12048 分别实际查到 Excel导出、正在导出，请稍候！、基本工资、知识管理，源码的回退中文不能证明显示正确；新增客户抬头也不属于用户正确参考图。

确认的 Tools 故障是过滤了 CSS 绘制、innerText 为空的 span 图标，即使带 title/ng-click 也没有 ref；此前 button 夹具不足以覆盖真实写法。Harness 故障包括用 snapshot/capture 身份计新进展、健康页面检查后重复注入 inspect 指令，以及浏览器回执去重后压缩摘要不再保留实际页面文字。本次保留命名/可交互 DOM 的 refs，仍执行签名、遮挡与原生输入校验；进展按内容/可操作性/真实像素变化判断；完整旧观察可去重，但输入和错误不得丢弃；压缩保留有界页面文字的首尾。

验证针对真实脱敏回执回放、相同快照内容与变化标签/像素/遮挡的区分、上下文压缩后错误标签仍存在，以及空 span/CSS 图标的真实 Electron 操作。详细结果以 artifacts/agent-observation-convergence/DELIVERY.md 为准。未对配置中的 Coding Plan 凭据进行自动真实模型验收，不据此承诺 Qwen 完成率或速度；不改业务仓库或生产数据库，不宣称 Windows 全桌面 Computer Use。


## 148. 代码验证策略与独立桌面视口（2026-09-13）

用户指出此前修复方向仍存在根本设计问题：字段代码修改被强迫进入网页启动、登录和页面操作流程。已确认 Harness 的 requires_browser 曾匹配 modal/页面/表单、UI 文件扩展名、任意浏览器工具调用；has_fresh_verification 又将旧 RunStarted 推断标记和图片引用视为永久浏览器验收要求。循环诊断提示也强制要求检查运行页面。相关代码完成后仍不能结束，属于验证策略设计错误，不能归结为模型能力不足。

本轮将 UI 相关性与用户明确要求浏览器验证分开：局部字段/翻译/绑定修改可用当前版本的针对性代码检查完成；浏览器用于实际布局/交互或明确的浏览器验收。旧自动推断标记不再控制续跑，但真实失败断言、失败命令、文件版本及原图可用性检查保留。不增加次数、预算或强制计划，不把语法通过描述为视觉一致。循环纠偏也先指向实际翻译结果和绑定，不自动扩大为启动网站。

Tools 在现有 BrowserRuntime 增加有界、逐页面的临时桌面视口。网页可按 1280×900 CSS 像素布局，再缩放到窄面板；原生点击按实际预览缩放转换坐标。首轮桌面测试发现坐标未转换而失败，修正后复测通过。点击先用原生命中测试寻找可见位置，需要时进行普通滚动并等待布局稳定；失败直接返回新快照和遮挡物信息，保持未派发/结果未知的区别。没有修改网站样式或调用 Angular 内部业务函数。

开发版确定性回归已通过：七个字段、翻译映射与绑定的源检查在第 4 次模型替身响应完成，零浏览器调用；非自适应布局、固定表头、内层滚动、部分遮挡和缩放坐标场景可原生打开弹窗。明确浏览器验收仍不能被代码检查替代。最终 Gate、包和限制见 artifacts/agent-verification-strategy/DELIVERY.md。此处模型替身不证明真实 Qwen 语义收敛或一两分钟完成，未修改生产业务项目，未调用配置中的 Coding Plan 作自动验收。


本轮最终验证：250 TS、333 Rust、13 Core integration 与开发/打包浏览器及目标生命周期专项通过，最终 104 Core 和 Clippy 复验通过。包为 apps/desktop/out/fielora-agent-verification-strategy-20260913/Fielora-win32-x64/Fielora.exe，Core SHA-256 为 9b7107dc1cdb5e59d556986dfa4868c8b115e6336070ab654ac7f69f60deb37e。PreMerge 中 Phase 02/Browse 桌面通过，Foundation 在第 48 行 Logo 像素断言失败；上一交付包独立复测同样失败，因此保留为既有 Gate 缺口，后续 Foundation 未验收，未放宽断言或宣称全量通过。详见本轮 DELIVERY.md 与 validation.json。


## 149. 精确源码观察与视口设置顺序修复（2026-09-13）

最新生产续跑的 49 次工具调用已能根据遮挡反馈打开弹窗，但模型仍误认为字段匹配。实际 T 过滤器只读检查确认 12045/12046 会把模板中文字覆盖为 Excel 导出提示。search_text 的逐行 find 只返回压缩 JSON 同行的第一个命中，却报告未截断；read_file 多次返回整行 64,266 字节，单次模型输入升至约 60k token。存在上下文压缩，问题不等于没有压缩，也不能把模型的错误推断全归因于工具。

Tools 现在枚举有界的全部命中；read_file 提供现有权限与整文件哈希下的 JSON Pointer 精确取值、缺失报告和 UTF-8 字节窗口。默认读取在追加长行前限制到 16 KiB，披露续读位置。另确认原输出脱敏按空格切词后重新拼接，损坏缩进和 JSON 值中的连续空格；现保留原空白/CRLF，只替换敏感片段。Harness 保留不同 JSON 查询/字节窗口，不误合并为同一行的重复证据。BrowserRuntime 允许在同一 Run 的临时页面绑定中先保存视口，不创建标签页；随后 open 创建页面并使用该配置。配置回执明确没有页面观察或验证。

没有增加预算、次数限制、强制计划或第二套状态/权限/证据。保留共享翻译键保护，避免把已有导出标签全局改成到账标签。验证、范围及真实模型限制见 artifacts/agent-precise-source-observation/DELIVERY.md；原业务文件保持只读，确定性夹具不能宣称 Qwen 已完成原任务。


## 150. 浏览器输入与截图可用性分开（2026-09-14）

打包多页面回归确认点击预检返回 `Current display surface not available for capture`，尽管当前 DOM、视口和控件命中信息可读。之前额外要求先捕获 PNG 才能派发原生点击，混淆了观察能力与输入能力。仅统一捕获选项/首帧重试未消除该故障。

现在原生点击依据当前 Run 页面、导航代次、两次 DOM 命中检查和 Chromium 输入确认派发，不再以 PNG 捕获成功作为前置条件。遮挡、过期引用、错误页面、未派发与未知输入结果的约束保持。输入完成后仍观察实际结果；需要截图的结果验证仍执行截图，不把点击确认算任务完成。最终包与工程回归见 artifacts/agent-precise-source-observation/DELIVERY.md；不构成完整 Windows computer use 或真实模型语义验收。

## 151. Windows 原生窗口遮挡与浏览器输入失效（2026-09-14）

继续回归表明仅移除 PNG 门槛不足：Chromium 已确认派发的点击没有产生页面事件。独立 BrowserRuntime 复现排除 Model、Core、业务代码；宿主窗口 visible/focused，但 document.visibilityState 为 hidden，页面截图报 display surface unavailable。关闭尺寸模拟、改变首次可见状态、移除非活动原生子视图、禁用单页后台节流均未恢复；仅关闭 CalculateNativeWinOcclusion 后，三个页面全部成为 visible、截图成功且真实点击计数通过。此证据定位到该 Windows 环境下的原生遮挡处理，不证明所有旧业务失败均由它引起，也不把宿主 CDP 截图的空白区域作为内嵌原生视图的像素证据。

Main 在 Chromium 启动前禁用这一 Windows 遮挡启发式，合并保留已有 disable-features；保持显式标签页/窗口隐藏、默认后台节流、沙箱、页面权限与网页内遮挡检查。被其他窗口覆盖的活动网页可能增加绘制，未做功耗基准。完整开发/打包 Agent 浏览器和打包任务生命周期回归已通过，含多页面、登录交接、嵌入编译错误、800×600 预设、1280×900 桌面视口、真实点击/内层滚动和七字段结果；80 KB 压缩字典定点读取后，一次局部修改与源码检查在 5 步内完成，零浏览器调用。包为 apps/desktop/out/fielora-agent-source-browser-20260914/Fielora-win32-x64/Fielora.exe，Core SHA-256 为 3678cc6e526f6b5aaccda1fd76144b3202884d8ed1046619a7658e4b3e2d04ce。模型替身不构成真实 Qwen 验收，已知 PreMerge 缺口及最终证据以本轮 DELIVERY.md 为准。


## 152. 参考项目源码读取与完成证据（2026-09-14）

生产任务 01a09d86-432d-77a1-8afa-1e4ee29882e6 使用上一交付新包仍暂停：59 次模型调用、56 次工具调用、累计输入 2,012,193 token，15 次上下文缩减、27 次重复操作提示。第 41 次工具调用才尝试读取用户指定的猎头参考项目，被 AGENT_WORKSPACE_ESCAPE 拒绝，整轮没有成功参考源码读取。当前目标模板仍存在错误翻译键，包括新增账号标签 12049 对应删除文件夹确认。服务器回执为 RUNNING/NOT_LISTENING，不能据此断言正在编译。

修复复用既有 ToolRuntime 的 read_file/search_text/list_files/stat_path；从 RunCreated.user_message_id 指向的原始用户消息提取本地参考路径，附件正文、模型计划与子任务不能授予范围。明确文件保持单文件；源码目录以最近的 Git/package 项目边界允许读取模板、翻译等依赖，未识别项目时保持指定目录。相对路径继续指向目标，写入仍受目标范围限制。回执标识实际绝对来源；完成证据按用户指定的源码比较目录逐一检查真实非空读取，不能以读过同一个参考项目或读取了目标项目代替。读取只是比较的必要证据，不保证业务语义正确。

Harness 在原有循环中保留未读参考项和 NOT_LISTENING 事实，既不提高预算，也不创建第二套权限、状态或证据。源码候选与最终验证、包路径以 artifacts/agent-reference-read/DELIVERY.md 为准。生产数据库与业务代码未由本轮修改；确定性回归不构成真实 Qwen 已完成批量到账业务的结论。


参考读取候选已完成 Cross Gate（340 Rust、250 TS、13 Core integration）、最终 106 Core/Clippy 与打包生命周期/浏览器专项。两目录参考读取与提前结束拦截在 7 次模型替身调用内完成，参考文件不变；这不是 Qwen 实际业务验收。包为 apps/desktop/out/fielora-agent-reference-read-20260914/Fielora-win32-x64/Fielora.exe，Core SHA-256 为 d3544bb429dbd6a473cbb748f682ba37b12ba97e8e3e45b6f3bac51391d2c62c。首次 Electron 重复下载被同版本本机缓存替代后成功封装，未改变依赖版本。完整证据和既有全量 Gate 缺口见 artifacts/agent-reference-read/DELIVERY.md。

## 153. Agent 设计与实现错误专门记录（2026-09-14）

用户要求专门记录设计实现 Fielora Agent 时的错误、解决办法并持续更新。
现已建立 [Agent 设计与实现错误记录](../engineering/AGENT_DESIGN_IMPLEMENTATION_LESSONS.md)，
首批按既有生产诊断与交付整理 AE-001 至 AE-012，覆盖真实解题验收缺口、模型误判、
源码/参考读取、图片传递、上下文恢复、强制计划、验证策略、进展判定、服务/页面状态、
原生输入与续作额度。已确认原因与推测分开，保留错误方案和失败尝试，并分别维护原因、
机制修复及原始任务验收状态。

AGENTS.md 与开发工作流要求后续相关调查、修复、撤回、复发或验收在同一 changeset
更新对应条目。按需阅读相关案例，不新增完整历史阅读或审批流程。本轮仅整理文档，
没有产品代码、模型调用、业务数据变更或新的真实任务验收；原有未验证事项保持。

## Apache-2.0 正式开源（2026-09-15）

用户明确选择 Apache-2.0，用于 IDR 与 Fielora。Fielora 新增根目录 LICENSE、NOTICE，Cargo 与 npm 包元数据统一为 Apache-2.0，README 指向完整协议。项目自有源码与文档按此声明开放；第三方材料保留原许可证。private/publish 标记保留，不发布 npm/crates 包，不修改运行时或既有验收结论。此次授权不追溯重写历史 Evidence。详情见 [开源决定](../engineering/APACHE_2_0_ADOPTION.md)。

## 154. 设置模型计费统计（2026-09-15）

用户授权设置新增带图表的逐任务 token / 模型计费统计。实现新增只读 Core 查询，由现有 AgentRun / AgentEvent 按真实 provider/model 与回执日期汇总；包含输入/输出趋势、模型分布、分页任务、活动模型和下次发送选择。切换模型不改变旧任务归属，续作和重启不清零。补齐新子任务 MODEL_COMPLETED usage，历史缺失不伪造。

单价可按模型手动设置（每百万输入/输出 Token，CNY / USD），按币种分别估算；当前单价变更重算历史估算，不代表服务商实际账单。缺失回执、流式中途、失败/中断与订阅/缓存/阶梯计费边界在页面披露。无新 Migration、权限或 Runtime；不调用真实付费模型。验证及限制见 artifacts/model-usage-statistics/DELIVERY.md。


## 155. 当前请求上下文与历史执行证据（2026-09-17）

用户授权先落实上下文修正。新确认具体触发点：“为什么这次没有改成功”中的“改成功”包含动作词“改成”，使结束判定误要求修改/验证。修正这一假阳性；不把关键词表提升为完整语义路由器。

现有 Harness 每轮刷新当前请求及来源，同一对话提供有界历史 Run 索引与 read_run_history 只读查询。历史消息按原消息截断、历史回执不算当前验证，原因回答完成不会完成或恢复旧实现任务。逐轮记录输入哈希/来源和结束判定原因；复用现有存储/Policy/工具链，无 Migration 或第二套 Runtime。工程及桌面验证见 artifacts/agent-turn-context/DELIVERY.md；真实 Qwen 原业务任务尚未验收。

## 156. 访问确认问题的执行范围与及时结束（2026-09-18）

真实 Run `01a0b22b-c5b3-79a2-983a-81c9a0478799` 已把访问问题判为非修改要求，但完成 49 次观察和一次文件写入后才因缺少验证暂停。当前任务约束未接入工具准入，且只有无工具回复才判断结束；不能归因于未配置参考路径。

修复为独立访问确认接入有界只读流程：原用户消息提供范围，正常、已批准/恢复及观察工具入口复查；指定来源的实际读取/列目录回执成立即回答结束。失败不伪造成功，已有未知副作用/写入不隐瞒。混合“查看并修改”、明确继续及未识别请求保留原流程；不反向使用动作启发式建立通用写入开关，不是完整自然语言分类器。无 Migration、平行 Runtime 或权限扩张。验证及限制见 artifacts/agent-access-question/DELIVERY.md。

## 157. 历史图片追问的真实输入恢复（2026-09-18）

生产只读核对：报表 Run `01a0b339-3650-7560-a62d-da9cbeb6bc16` 的 4 次模型请求均有 1 张图片，1920×912 原图 blob 哈希完整；追问 Run `01a0b357-78b8-7c23-b4cc-1c4977751f0b` 与 `01a0b358-25a1-7b91-a0e6-cfbd9d044130` 各 4 次请求均为 0 图。双关键词恢复门槛漏掉“图片里面”和“我最近发给你的这张”；最初误解划线删除不能归因于当时没有图片。

Core 对无新附件请求在同 Project/Conversation、原消息边界内检查最近 12 个合格运行，恢复最近图库作为历史上下文，不再以固定措辞作为准入条件。新附件优先；图库按原消息时间排序，重试旧任务不把旧图升级为最新上传；保留最初来源，历史图片/旧回复不续期旧任务；新增图片哈希清单用于核对实际模型输入。损坏来源暂停并仅重试同一来源，不能静默改选旧图；恢复原始有效字节后可继续同一任务。旧附件 UI 回退兼容路径保留；无 Migration、跨对话访问或新 Runtime。验证、独立包及未验证范围见 artifacts/agent-image-followup/DELIVERY.md。

## 158. 解释问题中的动作词不再具有不可纠正的完成权威（2026-09-18）

生产 Run `01a0b3a3-4efc-7cb1-b914-95b911af3572` 在 3 次携图回答后因“应隐藏/删除”中的“删除”被强制要求操作回执并暂停；这次不是图片未恢复。同时模型实际把用户明确指定的删除红线误解为保留，语义问题独立存在。

主模型可在原工具循环记录引用当前用户原文的请求解释，Harness 绑定当前 Run/请求哈希并据此修正结束义务；没有解释时的关键词仅是保守回退，不是无法纠正的用户意图。已有副作用、未知结果与新鲜验证继续强制执行，模型解释不授予权限。上下文强调用户纠正、UI 当前状态与人工标注的区别。无 Migration 或第二运行时；工程替身和真实模型理解分别验收，见 artifacts/agent-request-intent/DELIVERY.md。

## 159. 能力事实、澄清续作与暂停反馈（2026-09-18）

Archify 生产运行确认：静态能力目录误报 web.search/web.fetch 可用，八次 run_command 均失败；模型把工具名当程序并猜测仓库，最终来源问题被通用完成门槛吞掉。修复实际目录投影、程序启动错误分类及原 Run 提问/回答恢复；不接入未知网络服务、不安装未知 Archify 包。暂停按钮/loading 同步真实 Run 状态，回答通过显式消息关联恢复，不新建任务。工程及真实模型验收分开，见 AE-016。

## 160. 反问输入已送达与澄清反馈修正（2026-09-23）

同一 Archify Run 后续事件确认反问已被接受、恢复并再次调用模型；重建 Context 哈希与实际调用清单一致。模型再次查询得到无注册搜索服务后，仍原样提问；不是入口 URL 校验或 UI 复显。当前修正最新回复的原生对话投影、同题重问的可见解释和调用来源诊断，沿用原 Run/ToolCall/消息账本，不新增搜索服务或权限。工程验证见 artifacts/agent-clarification-feedback/DELIVERY.md，真实模型与原安装任务仍独立待验。

## 161. 首轮假完成与明确结果协议（2026-09-23）

用户最新复测确认新 Run 在 0 工具调用后直接索要来源，却被记为 SUCCESS：未命中动作关键词且没有模型解释被错误当作普通回答。用户授权按高标准修复。General loop 现由原生 finish_task 提议明确 completed/blocked，Harness 校验当前回执、实际副作用、未知结果和新鲜验证；纯文本不再决定完成，等待信息沿用 request_user_input，阻塞保存为 PAUSED。没有新增分类器、状态库、权限或 Migration。搜索 API 与现有浏览器能力分别报告；工程与真实模型验收仍分开，见 artifacts/agent-task-outcomes/DELIVERY.md 和 AE-016。

## 162. 安装资源缺失、验收与恢复修复（2026-09-24）

用户复测已通过浏览器访问 GitHub，并在当前 Run 写入 Archify SKILL.md；44 步中的 8 次结束均因无验证回执被拒。只下载入口、缺失引用资源，父目录列举过滤 Skill 子树、历史成功误用和重复观察清零终止拒绝计数均已确认。用户认可此次诊断方式，要求今后按“执行链、证据、机制、责任、验证边界”解释，已写入 AGENTS 与开发流程。

本轮沿既有执行链增加只读 verify_skill 结构检查、显式目录真实列举、项目 catalog 刷新、bundle 摘要版本绑定、可执行 Skill 的针对性检查要求及当前副作用固定投影。完成拒绝解释缺项，普通观察不再重置终止拒绝计数；混合代码修改不能仅靠 Skill 检查结束。不新增网络下载/解包权限、不自动执行外来资源，无 Migration 或第二 Runtime。机制验证与独立包见 artifacts/agent-skill-recovery/DELIVERY.md；真实模型/原 Archify 完整安装与功能验收仍分开记录。

## 163. 真实续跑中的浏览器就绪误判（2026-09-24）

同一 Archify Run 继续到 60 步：新 verify_skill 已真实报告缺失资源，验证门槛再次拦住改 intent 假完成；两次 browser.open 返回 BROWSER_PAGE_NOT_READY，随后模型误用本地 read_file(URL)，并将含混错误解释为 GitHub 不可达后索要来源。历史错误没有具体就绪字段，不能确认当时是哪一条件。隔离原生复现证明仅隐藏已加载网页面板即可触发同错，独立公开地址探测则成功。

当前修复把已提交文档的只读观察与原生表面输入/截图要求分开；保持页面归属和输入安全，返回导航、加载、表面及页面失效的事实，等待可取消有界。恢复上下文不再把导航失败当成点击遮挡，保留实际来源和具体错误；本地读取 URL 明确返回通道误用。另修复长网页静默截断和基于截断内容的 absent 假通过，续跑补记当前构建身份。不增加完整仓库下载/解包器或生产数据变更。诊断与验收边界见 artifacts/agent-browser-readiness-20260924/DIAGNOSIS.md 和 DELIVERY.md；真实 Qwen/完整 Archify 安装仍未验收。

## 164. 状态查询允许报告否定发现（2026-09-24）

真实新 Run 询问“现在有装好archify这个skill吗”，正确只读检查、记录 answer_only 并提出“未完全安装”，却因 verify_skill.success=false 被 finish_task 的统一成功证据规则连续拒绝。未调用浏览器或写入；当前包身份匹配。旧安装已取消，本次状态回答不应续期安装目标。

现沿既有结果协议区分观察证据与动作成功证据：纯只读状态回答可引用终态否定/失败观察并报告边界，不能让未知结果、写入/执行或浏览器验收义务消失。FAIL 回执不变，当前回答完成不更新历史任务；无修复义务时不再投影 REPAIRING。前轮测试漏掉不完整 Skill 的状态问答，已增加此边界回归。无 Schema、权限或第二状态系统；证据与验收范围见 artifacts/agent-negative-findings-20260924/DIAGNOSIS.md 和 DELIVERY.md。


## 165. 完整 Skill 来源获取与受控安装（2026-09-24）

用户授权补齐实际缺失的联网获取能力。新增 skills.search / skills.prepare / skills.install，分别沿既有 Network 与 WorkspaceWrite 决策。公开 GitHub 发现不是通用搜索引擎；固定提交后按完整清单获取指定 Skill 目录，或获取完整公共 HTTPS ZIP；下载与安装不会自动执行外来代码。Core 绑定同 Run 成功准备回执，完整目录暂存检查、当前摘要保护覆盖、旧目录备份与未知结果禁止重放。verify_skill 和针对性运行检查继续控制完成。管理位置仍为项目 .agents/skills/<name>，经现有 Skill catalog 刷新发现。

原因确认是 Tools 完整获取链路缺口，另有旧 Model 答复把浏览器故障推广成无联网能力。Harness 的上下文/权限/连续性/验证/可观察性同步接入真实工具，不能用提示代替下载实现。真实联网测试与桌面模型/网络替身验收分开；最终状态见 artifacts/agent-skill-acquisition-20260924/DELIVERY.md。生产 Archify 目录与用户数据库未由此测试覆盖。


## 166. Agent 三视图与 IDR 退出生产（2026-09-24）

历史记录：三平面正式定位已由 §167 撤回；能力实现与 IDR 退出决定保留。

用户接受 Model + Harness + Tools 责任基线、三平面与共享基础设施工程视图、九层诊断视图，并要求先去除未证明实际收益的 IDR。现有生产默认不读 Human Model、不生成个性化投影、不曝光学习工具；旧 schema/迁移/数据与隔离历史机制测试保留，不能从旧 Run 自动重新启用。Agent Profile 与当前用户约束仍保留。

能力查询补充本轮工具定义/来源/绑定、后端状态、调用权限待查和目标未探测等独立事实，精确详情与摘要绑定分页复用现有 catalog。网络不可达、工具未暴露和任务未验证不再混为一个布尔值；目录查询不主动探测或授权。工程与剩余能力表见 docs/architecture/AGENT_ENGINEERING_VIEWS_V0.1.md；本轮验证见 artifacts/agent-engineering-views-20260924/DELIVERY.md，真实模型验收单独记录。


## 167. 撤回三平面正式定位，统一主架构（2026-09-24）

历史组织口径：其中 Tools 顶层和九层仅诊断已由 §168 更新；三平面撤回及功能保留继续有效。

用户认为三平面与原基线不贴合，经讨论要求更改。当前只有 Model + Harness + Tools 一个主架构；九层保留为诊断视图，工程模块直接映射主架构。Control 与 Harness 重复、Execution 再次拆分调用控制/工具后端且容易模糊 Model 归属，因此撤回三平面作为正式工程架构的定位，而非再建一套分类。

已实现的能力目录、详情/分页、来源和状态区分、完整 Skill 获取/安装均保留，IDR 继续退出生产。本次只修订架构、上下文与一个模块注释，无运行行为/Schema/权限变更，不重新打包；此前包的功能验收保持历史事实。本次检查为文档清单、引用与差异检查，不冒充新运行测试。


## 168. Harness 九层与 Capability 顶层（2026-09-24）

用户最新明确要求 Harness 改为九层能力、Tools 改为 Fielora 拥有的 Capability。现主架构为 Model + Harness + Capability；Harness 九层既为正式逻辑职责，也用于诊断，取代 §167 中“九层仅诊断/七域”的定位。Capability 容纳已有工具定义/发现/执行、Skill、资源访问、适配器与本地插件包装，Tool 为子集；不恢复三平面，不增加第二系统。

L3 负责模型调用控制，智能与 Provider adapter 属于 Model；L5 负责能力调用控制，具体后端属 Capability。Work Scope & Goal 纳入 L4，权限与验收保留于 L7/L8。当前只读子任务由 Harness 编排，不等于已实现 Agent Blueprint 平台。IDR 继续退出；通用 Resource 注册、完整插件市场、任意 OS Computer Use 等仍未实现，不因改名升级状态。此次只更新正式文档及其引用，未变更产品代码/运行行为，检查文档清单、链接和差异，不重新打包。

## 169. 能力逐项对照与第一批候选查找（2026-09-24）

用户要求按清单逐项补能力，现以 [36 项能力清单](../architecture/CAPABILITY_INVENTORY_V0.1.md) 维护代码事实、缺口、归属与次序。Scheduler 已有真实本地服务；Web Search/Fetch adapter 虽存在，默认产品构造未注册，不能报当前对话可用。MCP stdio、受限子任务、本地声明式 Plugin 与 OS Computer Use/Chrome 会话/SSH/Blueprint 等缺失项明确区分。

第一批沿 capability_status 增加名称/描述词面、provider/source/effect 筛选；查询与目录双摘要保护分页。复用已准入 ToolSpec，不建第二 Registry 或 Resolver Runtime，不把筛选当权限/可靠性排名/语义选工具。旧空参数、精确查找和无过滤分页兼容。无 schema、凭据和生产数据变更，IDR 继续退出。机制和桌面验证见 [本批交付](../../artifacts/capability-candidates-20260924/DELIVERY.md)；后续优先补 Web 产品接入，真实模型和原 Archify 任务仍单列验收。

## 170. 执行展示偏好与真实压缩状态（2026-09-24）

用户要求精简逐条灰色操作、可展开命令、详细模式、压缩提示与淡灰圆角悬浮时间。沿既有本地 UI preferences 增加 COMPACT/DETAILED，默认精简；同一 AgentTurn 渲染当前和历史记录。共享 Tooltip 使用真实消息/事件时间；不生成展示专用模型叙述。Harness L6 的压缩阈值与内容保持，L9 补开始事件并投影既有完成回执，常规与重试路径均覆盖，无新 schema/运行状态系统。快速操作不人为延时，字节数不冒充 token。

代码、自动测试与独立包见 [交付记录](../../artifacts/agent-display-20260924/DELIVERY.md)。旧命令输出原文未保存仍明确标识；本次不解决模型目录重复输入或工具选择遗漏，也不修改生产 Archify。截图和桌面替身验证不等于用户最终体验确认或真实模型任务通过。

## 171. Archify 实际安装与精简分类修正（2026-09-25）

生产 Run 01a0d680-0d29-7dd3-be3c-09fca4d61041 的源发现成功、子目录总预算超时及整仓 ZIP 两次请求超时已核对。下载器现提供固定树内的有界分发 ZIP 候选与 immutable blob raw 获取；超时返回进度和同版本续传身份。该机制不认证发布者、不改变权限或自动执行脚本。

原 Fielora 项目 .agents/skills/archify 已通过维护调用现有安装器替换为官方 2.17.0-dev.1 完整分发包（79 文件），12 项入口引用及 doctor 均通过；原目录保留在 .agents/.skill-transactions 的备份中。此结果是当前项目真实安装，不是临时项目测试；没有改写旧暂停 Run，也未验证真实 Qwen 自动恢复。精简 UI 按连续工作类型归类，保留展开明细及失败、审批、暂停边界，成功内部控制步骤仅详细视图显示。证据与独立包见 artifacts/skill-recovery-20260925/DELIVERY.md。
## 172. Skill 使用中的命令重试与压缩连续性（2026-09-25）

Archify 生成失败已对齐生产 Run：56 次模型调用、9 次压缩、6 次命令失败及一次错误去重，最终预算暂停；与 §171 下载问题不同。按 Model + Harness + Capability 原基线修复 L5 参数去重/错误标记和 L2/L6 Skill 与命令诊断保留。Process 新提案沿现有 Policy/Approval，未知操作保持暂停，不新增权限或持久原始命令输出。实际图已通过已安装 Archify 生成并作桌面尺寸/明暗主题检查；真实 Qwen 自主完成仍未验收。详细证据见 AE-020 与 artifacts/archify-generation-20260925/DELIVERY.md。


## 173. 可配置长任务预算与模型设置合并（2026-09-25）

用户同意开放数小时任务额度，并要求模型服务和计费统计合并为一个菜单。现“模型配置”含模型服务、用量统计、任务预算三个 Tab；设备偏好即时保存，交互任务开始和主动继续时传入 Core，沿 RunCreated/RunResumed 记录并恢复。默认 1h/2M 输入/65,536 输出不变，最高可配 8h/50M/1M；累计执行时间独立于单次超时，旧事件兼容，不新增 Schema。

失败恢复在既有工作状态中投影最多 12 条尝试和结果比较，同一执行段内三次相同已知命令失败后要求改变输入或策略。继续任务可重新尝试外部修复后的条件；未知副作用、权限、结果验证不绕过。该机制不保证模型能选对方案，也不将扩大预算写成 Archify 真实模型验收。验证与独立包见 artifacts/long-task-budget-20260925/DELIVERY.md。


## 174. 环境发现与按影响审批的工具安装（2026-09-25）

针对 Archify 恢复仍失败，增加 environment.inspect（PATH 全候选与有界运行时目录发现）、tools.prepare（官方 Node/ripgrep 或未认证 HTTPS 便携 ZIP）、tools.install（同 Run 准备回执绑定的隔离发布）。用户确认：可信来源、实际下载不超过 20 MiB、仅项目隔离目录、不改系统/PATH、不运行安装脚本可免安装确认；其他需人工确认，包括 FullControl。既有网络审批和 ReadOnly 约束保留；不承诺自动安装任意格式。目录为 .fielora/tools/<name>/<SHA-256>，版本检查及实际任务验证仍独立执行。

修正 Artifact content 外层字符串诊断、失败变参虚假进展与压缩目标/重复触发。实际普通 PATH 下发现 Node 12/14/20/22/24，使用兼容绝对路径通过 Archify doctor 与既有规格的 deliver；真实官方 ripgrep 便携包隔离下载/安装/version 通过。以上是维护执行证据，不是真实 Qwen 自治验收。完整验证与独立桌面包以 artifacts/tool-acquisition-20260925/DELIVERY.md 为准。


## 2026-09-26 — 时间额度与 Node 再次误诊

新生产 Run 01a0d919-6068-7dc3-b50b-3a658c4f0cbd 实际已发现 Node 20/22/24，并成功运行绝对 Node20 --version；失败包含绝对项目 cwd 被误拒、重复把 executable 放进 argv，以及回到默认 Node14。不能继续称没有其他版本；部分后续现代 Node 命令实际启动但退出非零，持久回执仅哈希，不能追溯具体 stderr。时间额度改为唯一累计资源约束，默认1小时、1–1440分钟自定义；Token计量保留、旧caps不再暂停。工具修复项目内绝对 cwd，并从既有回执保留成功版本探测。证据与验证边界记入 AE-020；生产原任务未自动重跑。


## 2026-09-26 — 执行恢复与精简呈现候选

根据真实Archify 308轮失败诊断，已实现普通Skill读取保留、结构化命令诊断精简和按入口比较重试；编辑/读文件不清除该失败停滞，4次反馈/8次暂停，主动继续另起尝试段。精简UI收起重复准备说明、完成压缩和代码全文，保留发现/审批/交付。沿既有Model + Harness + Capability，不改Schema/权限或完成验收。工程及桌面证据见artifacts/convergence-compact-20260926/DELIVERY.md；原生产模型任务未自动续跑，不能将机制通过当作其验收。


## 2026-09-29 — Archify 真实复发修复候选

上一轮新版真实Run仍失败：默认Node14、错误cwd/输入路径、误判schema、目录大回执与重复说明。当前新增Skill加载时的相关运行时候选发现，诊断分层与保守恢复投影、目录分页和模型输入去重、准备说明折叠。沿现有权限/状态/ToolRuntime，无迁移、全局环境切换或安装。原输入的本地工具对照及工程检查通过；真实qwen原任务未续跑，架构图仍未完成。交付和桌面检查边界见artifacts/recurrence-repair-20260929/DELIVERY.md。
