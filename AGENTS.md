# Fielora Agent Instructions

## 0. 最高规则

Fielora 是一个长期产品项目。

任何 Agent / Codex 在进行设计、编码或重构前，必须读取最少当前事实；不再要求先阅读全部历史文档或生成新的阅读报告。当前 canonical repository 的首次只读 Gate 已历史性完成，不能继续成为日常开发阻塞。

## 1. 最小必读

开始任务前只需完整读取：

1. `README.md`
2. `docs/product/RAPID_DESKTOP_EXECUTION_V0.1.md`
3. `docs/context/02_PROJECT_REALITY.md` 的最新两节
4. `docs/context/03_DECISIONS.md` 的最新决策
5. `docs/architecture/TECHNICAL_BASELINE_V0.1.md`
6. `artifacts/phase04/KNOWN_ISSUES.md`
7. 与本次修改直接相关的代码和测试

涉及 Agent、Model、Harness、Tools、Aegis、IDR、AG-UI 或 Agent/DXE
integration 的任务，还必须完整读取
`docs/architecture/FIELORA_V0.1_AGENT_ARCHITECTURE_SPEC.md`。后续 Agent
能力只能在该 `Model + Harness + Capability` 基线上扩展，不得建立第二套
Core/Runtime/State/Permission/Evidence。

2026-09-24 最新补充：主架构为 `Model + Harness + Capability`，Harness 按九层职责组织，
同时用于诊断；精确分工与 Fielora 现有能力见
`docs/architecture/AGENT_ENGINEERING_VIEWS_V0.1.md`。Tool 是 Capability 子集，
Skill/Resource/Plugin 不都可执行。九层不要求九个服务，不恢复三平面或第二套运行系统。
IDR 已按用户要求退出生产 Agent 链路，不再属于当前能力建设；历史数据、迁移和
实验代码保留，不能凭旧八域文档或历史 Run 自动重新启用。

历史 Phase、Freeze、Conversation Archive 与 Evidence 只在修改相应旧 Contract、调查回归或追溯决定时按需阅读。不得为了“上下文完整”阻塞普通 UI、Conversation、Project 或 Provider 工作。

## 2. 快速执行规则

- 当前路线以 `RAPID_DESKTOP_EXECUTION_V0.1.md` 为准；旧 Phase 04→10 Remap 是历史设计，不再控制开发顺序。
- 普通可逆 UI/功能直接按纵向切片实现、测试、交付，不制作 Freeze Package。
- Schema/Migration、credential、安全边界、破坏性执行或不可回滚架构变化，先写一页以内 Change Impact。
- 不再生成或等待用户确认 `CODEX_READING_REPORT.md`。
- 保留现有用户工作和历史 Evidence；不得因路线调整擅自删除旧代码、Migration 或 Artifact。

## 3. 产品核心原则

### 3.1 Fielora 不是 AI Sidebar Browser
禁止把 Fielora 简化成 `Chromium + AI Sidebar + Agent`。

### 3.2 Project first，Field/Reality 延后证明

近期用户可见一级单位是普通 `Project`：本地文件夹、Conversation、Task、File、Diff、Terminal 与 Provider。现有 Field 可以作为兼容存储继续使用，但不得因为命名不同声称它不是 Project，也不得继续扩展没有产品行为的 Reality 概念。

### 3.3 Conversation 是近期一等产品对象

Conversation 必须持久、可切换、可恢复，并与 Project/Task/变更关联。`Conversation is history; Field State is reality` 保留为未来研究假设，不再压过近期 Codex-like 工作流。

### 3.4 AI 可以成为 Desktop Foundation 主工作面

近期允许 Chat/Agent 成为 Project 的主要工作面，以快速形成可用产品。仍禁止在普通 Browse 页面强塞永久 AI Sidebar。

### 3.5 能力常驻系统，不常驻屏幕
系统内部可以复杂，默认 UI 必须简洁。

### 3.6 不重复制造成熟专业工程软件
Fielora 自己做跨场景、高频、核心、轻量能力；Blender、CAD、专业剪辑、专业 DAW 等通过 Capability Connector 连接。

### 3.7 Coding 是一等工作流，但不复制现有 IDE
研究成熟高质量开源 IDE / Editor 的基础设计，再结合 Field / Agent / Context / Verify 重设计；不得直接照搬源码或产品结构。

### 3.8 LLM Provider 中立
不得把 Agent、Field、UI 或业务逻辑绑定单一模型供应商。V0.1 不做本地 LLM。

### 3.9 当前现实可实施优先
任何能力进入 V0.1 前必须检查技术成熟度、工程可实现性、可验证性、成本与实际用户价值。

### 3.10 Permission、Mandate 与 Semantic Authority 分离

`Capability Boundary / Mandate / Approval Routing / Semantic Authority` 必须保持正交。Model、Provider、网页、Connector metadata 不能 self-grant；广泛 execution access 不能推出 Reality 或 Verification authority。用户可见 preset 可由 DXE 简化，但不得把 Observe/Work/Ask/Auto-review/Full control 固化成单轴 Domain Contract。

### 3.11 差异机制后置验证

近期允许产品与 Codex 高度同构；可用性优先于差异化。Explicit Lifecycle、Operational Work State、Persistent Work Lineage + Verification 与 DXE 降为后续假设，不得先为它们制造空 Domain 或 UI。Aegis 必须等真实 long-task execution state 存在后接入；DXE 必须等稳定 Project/Conversation/Task state 存在后接入。

## 4. 实现前两问

实现前只回答：

1. 它完成哪一条当前用户流程？
2. 完成后如何在真实桌面应用中验证？

只有涉及 Schema、安全、credential、破坏性动作或不可回滚架构时，才增加设计审查。

## 5. 工程约束

当前 V0.1 语言职责：

- TypeScript / React：UI、Browser UI、Surface、交互；
- Rust：Field Runtime、State、Context、IDR、Agent orchestration、Capability、Evidence、Persistence、Native/Project integration；
- Python：Research / Eval / Benchmark；
- C++：只有未来 Chromium 深度集成确实需要时才使用。

当前 V0.1 平台：Windows 11 x64；Electron/Chromium 作为验证宿主；不直接 Fork Chromium；Rust Core 优先 Sidecar Process；本地优先持久化；多 LLM API Provider。

Phase 01 精确工具链与实现边界以已冻结的 `TECHNICAL_ARCHITECTURE_V0.1.md`、`CORE_CONTRACTS_V0.1.md`、`SCHEMA_FREEZE_V0.1.md`、`PHASE_01_IMPLEMENTATION_SPEC_V0.1.md` 为准。Canonical Local Worktree 已确认为 `F:\项目\Fielora`。Phase 01 Core Vertical Slice 已完成 Engineering、Desktop Reality 与 Human Experience Gate，用户于 2026-08-14 正式裁决 `PHASE_01: COMPLETE`。

用户于 2026-08-14 基于 `main@1419b8541a188e59af7ed2966f869bdde2dc7ada` 授权 Phase 02 Implementation。实现严格遵守三份 Frozen Phase 02 specs，并完成 Engineering、Desktop Reality、Human Experience、Post-correction Full Gate、Packaged Smoke 与 Portable Smoke。用户最终裁决 `PHASE_02_FINAL_ACCEPTANCE: GRANTED`、`PHASE_02: COMPLETE`；证据位于 `artifacts/phase02/`。

Phase 02 完成只授权 closeout 与 merge main，不会自动构成 Phase 03 Authorization；该历史 Gate 已由用户随后单独关闭。用户于 2026-08-14 以稳定 `main@7dc1aac593a4d478b7e175e5e197cf99466c1f47` 正式授权 `Phase 03 — Browse Foundation`，按 Real Web Runtime、Page Lifecycle、Browse/Field Boundary、Security Boundary、Desktop Experience 五个纵向 Slice 推进。不得继续扩展 Phase 02 或自行改变 Frozen semantics；Phase 03 不授权新的 durable Browser schema/Migration、privileged Web bridge 或 Chromium Fork。

Phase 03 Slice 01 首次 Human Experience Gate 于 2026-08-14 正式失败：真实网页已加载并同步 URL/title，但 WebContentsView 因零高度不可见；Fields 一级导航错误进入 Now。现有自动 Gate 被裁决为 `PASS_BUT_INSUFFICIENT`。只允许修复这两个 Blocker 与对应假绿 E2E；`SLICE_01_ACCEPTED: NO`、`SLICE_02_AUTHORIZED: NO`，必须等待用户重新完成人工体验后才能推进。

2026-08-15 Slice 01 Human Re-Gate 再次失败：显示、输入、滚动和同页导航已恢复，但所有 window-open 请求被无条件 `deny`，导致百度搜索结果等 `target=_blank` / `window.open()` 链接无反应。Slice 01 只允许单 Browse Page；合法目标必须经过既有 Browser Navigation Policy 后在当前 WebContentsView 导航，非法 protocol 继续拒绝。不得借此进入 Page/Tab Lifecycle；修复后仍须等待用户最终 Human Gate。

同一轮最终地址栏体验又确认无协议输入不能一律补 HTTPS。Slice 01 Omnibox 必须区分显式 HTTP(S)、明确域名、localhost/IP 与普通搜索词；不得把 `bilibili` 猜成 `bilibili.com`。Search Provider 必须在 Browser Policy 集中定义并保持可替换，Omnibox 不得与具体 Provider 强耦合；Slice 01 默认为 Google，query 必须正确编码，不新增设置 UI。初始 New/Blank Surface 不强制进入 Chromium navigation history，禁止为 Back 返回空白页插入 `about:blank`。

用户于 2026-08-15 明确确认可继续 Phase 03，因此 Slice 01 Human Experience Gate 视为通过，Slice 02 Basic Page Lifecycle 已授权。Slice 02 只实现内存中的新建、切换、关闭、链接打开与 title/URL 同步；每个 Page 拥有隔离 `WebContentsView`，只有 active Page 可见，共享既有 untrusted Browse session。普通链接在当前 Page 导航；合法 `target=_blank` / `window.open()` 经现有 Browser Policy 后创建受控新 Page，非法 protocol 继续拒绝。Page ID 是 Electron Main 内部、ephemeral runtime identity，不进入 Field/Object identity、Schema 或 Migration。Slice 02 自动验证通过不替代 Human Experience Gate，未授权进入 Slice 03。

Slice 02 Human Experience Gate 最终明确：最后一个 Page 无论已加载还是干净空白，都必须真正关闭到 0 Page，不自动补建 Page，也不隐藏关闭动作。0 Page 是合法的 ephemeral Browse Runtime 状态，保持既有 Browse 空状态；`+` / `Ctrl+T` 可显式创建空 Page，用户也可直接在仍可用的 Omnibox 输入 URL 或搜索词并提交，由 Runtime 创建第一个 Page 后完成导航。

用户随后要求“继续回归 Phase 3 主线”，因此 Slice 02 视为获得继续裁决并进入 Slice 03 Loose Browse / Field Boundary。Slice 03 不新增产品面：`BrowseScreen` 只接收窄化 browser capability，lint 禁止它直接访问全量 `window.fielora`；Desktop E2E 必须证明普通浏览和 Now/Fields/Field 往返前后，Field 列表、Field、Resume、State、Reference、Relation、Activity 均未改变，同时 Browse Page collection 保持。该约束不改变 runtime security、FIPC、Schema、Migration 或 Field/Object identity。

用户随后明确授权进入 Slice 04 Web Security Boundary。Remote WebContents 必须使用集中冻结的 untrusted WebPreferences、独立 session、无 preload/Node/app bridge/webview、sandbox/contextIsolation/webSecurity、safe dialogs 与 permission deny；remote navigation/fetch/iframe/window-open 不得进入 `file://` 或 `fielora://app`。Browser Policy 拒绝继续由 Main/Browser Runtime 强制执行，但 Renderer 必须把受控错误码映射为稳定产品提示，对未知 Electron/IPC/loadURL 异常使用统一兜底，禁止把原始异常文本暴露到 UI。该 Slice 不改变 trusted origin/FIPC 模型，不新增 privileged web bridge；自动 Gate 不替代 Human Experience Gate，Slice 05 未授权。

Slice 04 Human Regate 修正了 target-only scheme whitelist：`file://` 不再全局禁止。用户从 trusted Fielora Omnibox 明确提交本地文件时，可在现有 untrusted Browse WebContentsView 中作为隔离 Local Page 打开；Local Page 与 Remote Page 共用无 Node、无 preload、无 app bridge 的安全基线。任何 HTTP(S) Remote Page 发起的 navigation/window-open/iframe/fetch 到 `file://` 仍由 Main/Browser Runtime 拒绝；`fielora://app` 对 Loose Browse 的 USER/LOCAL_PAGE/REMOTE_PAGE 发起者一律拒绝。安全裁决必须同时使用 initiator 与 target，不能退回全局 scheme whitelist。独立 `browser-errors` 模块曾导致 fresh Electron Main 无法解析 `./browser-errors.js`，稳定错误码现与 Browser Policy 同模块交付；Browse Desktop E2E 必须先精确清空 `apps/desktop/.webpack`，再 fresh build + fresh Electron launch，防止旧 bundle 掩盖运行时依赖回归。该修复候选仍等待 Human Gate，Slice 05 未授权。

用户随后明确要求读取既有 Slice 05 范围并开始实现，因此 Slice 04 获得继续裁决，Slice 05 Desktop Experience 正式授权。Slice 05 只验证并硬化真实 Browser Host 体验：普通文本网站、复杂 JS、登录页/session、长页面、`target=_blank`、Reload、多 Page 切换、Resize 与 Browse/Field 往返；不新增下载、历史、书签、Profile/Sync、OAuth privileged opener、AI 或其他 Browser 产品面。稳定 Desktop E2E 必须补足异步 JS hydration、登录 POST/redirect、HttpOnly cookie、Reload 后 session 与第二 Browse Page 共享 session，但 fixture 不替代用户在真实网站上的 Human Experience Gate。当前自动候选通过后仍不得自行宣布 Slice 05 或 Phase 03 COMPLETE。

Slice 05 首次 Human Experience Gate 因四项 Desktop Reality 问题失败：窄窗口下真实网站呈现明显低于日常 Chromium、网页 Clipboard 不完整、缺少基于网页上下文的右键菜单、导航/Reload 无清晰 loading feedback。Repair 只能优先使用 Electron/Chromium 原生能力，不得注入脚本模拟网页或扩入 History/Bookmarks/Profile/Sync。当前修复将新 WebContents 显式置于 100% CSS zoom，窄窗 Browse shell 收敛为紧凑导航；Main 基于真实 `ContextMenuParams` 提供原生链接/选择/编辑/图片/导航菜单；UI 直接反映 `did-start-loading`/`did-stop-loading`。Desktop E2E 必须核对远程 `innerWidth` 与 native bounds、`visualViewport.scale`、Shell/Remote DPR、窄窗响应式渲染像素，并实际执行 Chromium Ctrl+C/Ctrl+V、右键事件与慢速导航/Reload。自动 Repair Gate 不替代用户重新进行 Human Gate。

后续 Human Re-Gate 又指出工具栏 Reload 按钮旋转不自然、trusted Omnibox/Page 标签没有右键反馈、Page 标签缺少站点 favicon，并质疑本地测试站点的全宽红色提示。Loading 现在采用 Chromium 风格的 tab favicon-slot throbber + 2px 页面进度线，Reload 按钮保持静态。地址栏使用 trusted WebContents 原生 edit context menu；Page 标签通过严格校验 ephemeral page ID 的 trusted Browser IPC 显示 reload/copy URL/close 原生菜单。favicon 由 untrusted Browse session 获取，限 HTTP(S)/data、受限 MIME 与 64KB，Main 解码/尺寸检查后重新编码成 32px PNG data URL，trusted renderer 不直接请求远程图标。相同 991×590 CSS viewport 对照确认测试站点为 zoom 1/DPR 1.25，红色提示来自站点自己的 `.system-notice { position:fixed; width:100%; font-size:30px; ... }`；Fielora 不得注入 CSS 改写第三方页面。该轮结束时 Slice 05 仍等待用户 Human Re-Gate，随后由下述最终裁决关闭。

用户于 2026-08-16 明确裁决“Phase 3 先完结”，因此 Slice 05 Human Experience Gate、Phase 03 Final Acceptance 与 Phase 03 均为 COMPLETE。正式 `pnpm verify:phase03` 已在 dev、packaged 与 fresh-directory portable 三种宿主中同时跑通 Phase 02 Field Reality 与 Phase 03 Browse E2E；证据、portable 与 closeout 位于 `artifacts/phase03/`。Phase 03 完结不定义或授权下一阶段，也不自动授权 commit/merge；后续设计必须先讨论并由用户另行裁决范围。

用户随后确认 `CODEX_READING_REPORT.md` 的 Phase 04–09 / Alpha 竞品审计，并授权重排 Phase 04 → Alpha Phase Map。当前路线候选位于 `docs/architecture/PHASE_04_ALPHA_REMAP_CANDIDATE_V0.1.md`；Phase 04 逐能力候选位于 `docs/architecture/PHASE_04_CAPABILITY_DEFINITION_CANDIDATE_V0.1.md`。两者状态均为 `CANDIDATE / USER REVIEW REQUIRED / NOT FROZEN`。该授权只允许定义 Phase 边界、Goal、能力、纵向 Slice、Differentiation Hypothesis、依赖、Gate/Evidence、Alpha 闭环与原路线能力处置；`PHASE_04_FREEZE: NOT_YET`、`PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED`。任何 Agent 不得把 Candidate 当成已冻结 Phase 04 spec 或实现授权。

用户于 2026-08-16 随后明确裁决进入 Phase 04 Freeze Package 的编写与审查，不再进行战略层重排。既有 Remap 与 Capability Definition 因此成为 Freeze input；Product、Contract、Migration 0004、Implementation、Test 与 Review 六面 Candidate 已形成，入口为 `docs/architecture/PHASE_04_FREEZE_PACKAGE_CANDIDATE_V0.1.md`。当前仅为 `READY_FOR_USER_REVIEW`；`PHASE_04_FREEZE: NOT_YET`、`PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED`，不得修改产品代码、依赖、migration registry 或 schema version。

用户同日正式接受 Remap、Capability Definition 与 Freeze Package 进入 Final Probes/Amendment，并接受 trusted credential FIPC 特例、Phase 03 Installer 历史例外、OpenAI Responses + Anthropic Messages，以及 synthetic/fixed-budget 真实 credential probes。Final Freeze 前新增 Provider-retention 不变量：Fielora local non-retention 不等于 Provider non-retention；OpenAI Phase 04 默认且不可覆盖 `store:false`，但不得宣称 ZDR；首次 external send 显示 Provider policy disclosure。Migration、WinCred、Provider fixture、endpoint policy 与 Context/Capture probes 已 PASS；真实两家 Provider probe 因未提供四个专用 test credential/model 环境变量而 SKIP。证据见 `artifacts/phase04/freeze/PHASE_04_FREEZE_PROBE_REPORT.md`。当前仍 `PHASE_04_FREEZE: NOT_YET`、`PHASE_04_IMPLEMENTATION: NOT_AUTHORIZED`。

用户进一步确认 Phase 04 当前没有新的 architecture blocker；Final Freeze Candidate 唯一剩余 blocker 是两家真实 Provider bounded probe。它只验证 auth、stream、normalized text/usage、cancel/terminal 与 representative error mapping，不得扩入 tools、conversation continuity、reasoning、structured output、prompt caching、batch、computer use 或其他高级能力。PASS 必须证明不同 wire events 归一化为相同 `STARTED / OUTPUT_TEXT_DELTA / USAGE / COMPLETED|CANCELLED|FAILED` semantics，并证明脱敏 Evidence 中 prompt/response body、credential bytes、Authorization headers 与 secret-bearing logs 全部为 0。Probe source 位于 `scripts/freeze/phase04/`，`artifacts/phase04/freeze/` 只保存 Evidence；凭据只允许通过四个专用环境变量安全注入本地进程。真实 probe 完成前不得形成 Final Freeze Candidate，且 Freeze 仍不授权产品实现。

用户已将 `FREEZE_GATE: LOCKED` 正式锁定。真实 probe 前禁止继续修改 Phase 04 Product/Contract/Schema/Implementation Spec、禁止进入 Slice 01。唯一允许的顺序是安全环境注入 → fixed-budget real probe → normalized complete/cancel/failed 与五类零泄露 PASS → 脱敏 Evidence → Cross-review → Final Freeze Candidate → 用户 Final Freeze Review。任何 probe 或 Candidate PASS 都不能自行把 `PHASE_04_FREEZE` 或 `PHASE_04_IMPLEMENTATION` 改为已授权。

用户随后通过 `docs/architecture/PHASE_04_PROVIDER_GATE_AMENDMENT_V0.1.md` 正式纠正前述 Gate：真实 Provider proof 从 pre-Freeze blocker 移至 implemented-product Phase Exit Acceptance debt；OpenAI Responses 与 Anthropic Messages 是 reference adapters，Fielora 内部标准只有 provider-neutral `ModelInvocation`。用户明确裁决 `PHASE_04_FREEZE: GRANTED`、`PHASE_04_IMPLEMENTATION: AUTHORIZED`，并要求连续完成 Slice 01–05、严格自动测试及人工验收清单，无需逐 Slice 停等。不得把未运行的真实 probe 写成 PASS；Mock/fixture 可以完成 Engineering Gate，不能单独宣布 `PHASE_04: COMPLETE`。服务条款禁止 automation/API testing 的 Coding Plan credential 不得用于真实 Acceptance。

Phase 04 Slice 01–05 已于 2026-08-17 完成产品实现；正式 `pnpm verify:phase04` 在 context/contracts/static/unit/clippy/release/Core integration 以及 dev、packaged、fresh-directory portable 的 Phase 02/03/04 桌面 Gate 全部 PASS。Evidence 位于 `artifacts/phase04/`，portable SHA-256 为 `0c5b3d255f2bde7ea74d393ca89201eaa64cd665f5fd140317525a257f6ddff4`。当前 `PHASE_04_ENGINEERING_GATE: PASS`，但真实 eligible-provider product acceptance 尚未运行且用户 Human Experience Gate 待执行；因此 `PHASE_04_FINAL_ACCEPTANCE: NOT_YET`、`PHASE_04: NOT_COMPLETE`。不得把 fixture complete/cancel/fail 或 0 external request 改写为真实 Provider PASS。

Phase 04 首次 Human Experience Gate 随后正式失败并进入限定 remediation：只允许 fixed React/deterministic presentation，不改 Frozen Core/Contract/Migration/Security/Provider semantics，不进入 Phase 05，不实现完整 DXE。Summon 现为 Ask-first；Context progressive disclosure；Sensitivity exception-driven；Provider Setup 与 Inbox 独立；Inbox 使用 bounded preview 与自然语言动作；Quick Capture 不打断 Browse。`DXE_DESIGN_PRINCIPLES: PARTIALLY_APPLIED`、`DXE_SURFACE_RUNTIME: NOT_IMPLEMENTED`。Remediation Phase 04 E2E 在 dev/packaged/fresh portable 20/20 PASS，新 portable SHA-256 为 `3a2bfdcca925dc0a70c81971c62253144294b387aa368969428308d0a3a9f662`。但完整 Gate fresh rerun 当前被 Windows Clipboard `Access denied` 阻断在 Phase 03 原生 Ctrl+C/Ctrl+V 硬断言，未跳过或放宽；因此既有 Engineering PASS 仅作为 remediation 前 baseline，`PHASE_04_REMEDIATION_ENGINEERING_REVALIDATION: PENDING_ONE_ENVIRONMENT_CHECK`、`PHASE_04_HUMAN_EXPERIENCE_GATE: PENDING_RETEST`、`PHASE_04_REAL_PROVIDER_ACCEPTANCE: PENDING`、`PHASE_05: NOT_AUTHORIZED`。

用户于 2026-08-17 进一步确认竞争重定位：ChatGPT Desktop/Codex 已覆盖绝大多数原“功能表面”，Fielora 后续只以 Explicit Lifecycle、Operational Work State、Persistent Work Lineage + Verification 与 DXE 四项机制裁决差异；产品一级抽象为 work-centered environment，不再用“AI Chat vs AI Work Environment”比较。路线编号不变，Phase 10 Alpha Closure 增加最小 bounded DXE Runtime proof。该决策不改 Phase 04 Frozen Contract 或 Exit 状态，不授权 Phase 05；`DXE_SURFACE_RUNTIME: NOT_IMPLEMENTED` 保持。

用户随后再次纠正上述顺序：当前 Reality 与 Codex Project 在实际体验上没有成立差异，DXE/Aegis 也尚不能直接作用于 Fielora，因此不再以四项差异 Gate 阻断基础产品。当前先快速交付 Codex-like multi-provider desktop：Project/local folder、persistent Conversations、Provider/Model settings、coding/diff/terminal/test/restart loop；之后依次建立 stable long tasks、Aegis、DXE、Personal Steward。旧 Phase 04→10 execution order 已被 `docs/product/RAPID_DESKTOP_EXECUTION_V0.1.md` supersede；Phase 01–04 代码和 Evidence 保留复用，旧 Phase 04 未关闭 Gate 不再阻断 Desktop Foundation。

Development Workflow Hardening 已从稳定 `main@e757d050b97a3f0dd3b6812bccefc1e433571c8f` 建立。日常按 Docs/UI/Core/Cross Lane 验证，所有 main 准入运行 `pnpm verify:premerge`；packaging-sensitive 变更额外运行 targeted packaged smoke；正式 Phase Gate 不被替代。重大 Contract/Schema/Permission/Reality/Verification 变化还必须先形成 `CHANGE IMPACT`，并执行受影响 invariant、migration compatibility 与 Hero Flow regression。精确规则见 `docs/engineering/DEVELOPMENT_WORKFLOW_V0.1.md`。

## 6. 验证规则

“代码修改成功”不等于“功能验证成功”。必须区分 `Action completed` 与 `Result verified`。

### 6.1 Agent 修复同时解释设计

用户要求通过实际修复加深对 Agent 设计的理解。以后修复 Agent 问题时，在进展与交付说明中简要解释：

- 实际故障暴露了什么设计问题，区分已确认原因与推测；
- 问题属于 Model、Harness 或 Tools；属于 Harness 时指出相关职责域，并用通俗语言解释其作用；
- 原机制为何会导致该故障，修改后行为如何变化，以及对应的通用 Agent 设计原则；
- 用什么证据验证修复，哪些能力或场景仍未验证。

结合本次故障举例，避免只列术语或文件名；说明随修复一起完成，不增加额外审批或设计仪式。

### 6.2 Agent 错误与解决办法持续记录

专门记录位于 [`docs/engineering/AGENT_DESIGN_IMPLEMENTATION_LESSONS.md`](docs/engineering/AGENT_DESIGN_IMPLEMENTATION_LESSONS.md)。

- Agent 相关设计或修复前，查阅该记录索引和本次相关条目；不要求普通工作通读全部历史。
- 调查发现新原因、实施修复、撤回错误方案、问题复发或完成真实任务验收时，在同一 changeset 更新对应条目；未修复也记录证据和待查项。没有新事实不制造流水账。
- 写清现象、已确认原因与推测、Model/Harness/Tools 责任、失败尝试、解决办法、验证证据及未验证范围；保留旧判断被推翻的过程。
- 分别维护原因、机制修复、原始用户任务的状态。确定性模型替身/工程 PASS 不得写成真实模型已解决原任务；没有实际运行的解决办法标为待验证。
- 重大决定仍同步 Project Reality、Decisions 与受影响 Spec。记录不增加审批或 Freeze 流程，不改变现有执行授权。

### 6.3 Agent 诊断的固定方法

用户于 2026-09-24 确认采用 Archify 失败调查的说明方式。以后 Agent 诊断按
“实际执行链 → 证据 → 代码机制 → 分层责任 → 验证边界”展开：

- 先回答这次具体在哪一步失败，与上一次是否同因；可取得时核对 Run、构建指纹、实际工具和终态，不仅复述模型自述。
- 对照用户预期与真实动作；区分动作成功、结果可用、验证通过，明确纠正被回执反证的说法。
- 分开已确认原因、促成因素和未证明的推测；解释代码怎样导致行为，不用层名或“模型不够聪明”代替因果分析。
- 标注 Model / Harness / Capability 责任（具体 Tool 是 Capability 子集）；需要对照九层时映射相应职责，不另造一套 Runtime。
- 交代上一轮修复解决了什么、遗漏了什么；测试替身、真实宿主、真实模型和原用户任务各自报告，未验证不写成已解决。
- 修复和交付继续使用这套说明，更新对应 AE 条目；不增加审批或全量日志/敏感数据留存。

## 7. UI 约束

默认禁止：永久 AI Sidebar、永久 Field State Dashboard、永久 Agent Activity 面板、五个 Mode 按钮常驻、多等权重 Dashboard 卡片、任意 LLM 生成 React UI、因内部状态多而全部暴露。

Field 默认一主焦点，最多两个辅助区域。

## 8. 变更项目事实

重大产品、架构、范围决定发生后，应同步更新：

- `docs/context/02_PROJECT_REALITY.md`
- `docs/context/03_DECISIONS.md`
- 受影响的 Product / Architecture Spec

不要只把重大决定留在 Codex 对话里。
