# Fielora V0.1 Technical Baseline

状态：V0.1 Technical Architecture Freeze（2026-08-13）；Phase 01 COMPLETE；Phase 02 COMPLETE；Phase 03 Browse Foundation COMPLETE（2026-08-16）；下一阶段尚未定义或授权。

## 1. 目标平台

V0.1 唯一正式验收平台：**Windows 11 x64** 本地桌面应用。

第一版不以 Browser Extension 或 Web SaaS 作为主产品形态。

架构从第一天必须跨平台。Core、Field Model、UI、Agent、Provider、Capability Contract 不得依赖 Windows-specific 假设。未来目标包含 macOS、Linux，并进一步支持跨设备 Field Continuity；这不是 V0.1 多平台交付承诺。

## 2. 语言

### TypeScript + React
负责 Fielora Shell、Scheduled、Inbox、Browse UI、Project Conversation / Composer、Provider Setup、DXE Surface、Code Workspace UI。当前产品不再提供独立 Summon UI 或侧边聊天入口。

UI 业务状态与组件 Contract 不得直接编码 Windows-only 假设；平台差异通过受控 Platform Adapter / capability exposure 进入。

### Rust
负责 Field Runtime、Field State、Context、Harness（包括未来
`IDR / Individualized Disposition Runtime`）、Agent orchestration、Model
Provider、Capability、Evidence、Persistence、Existing Project analysis、
Files / Git / Native integration。IDR 是 Harness 一级职责域，不是与 Harness
并列的 Runtime。

Core 业务模块保持 OS-neutral；Files / Git / Native、process、shell、PTY、credential storage 等 OS-specific 实现进入 Platform Adapter。

### Python
仅 research / eval / benchmark / experiments / test data tooling。

### C++
V0.1 不作为主语言。只有未来 Chromium 深层集成确实需要时进入薄 Adapter Layer。

## 3. Browser Host

V0.1 使用 **Electron + bundled Chromium**。

原因：优先验证 Fielora 产品范式、避免第一版陷入 Chromium C++ 大工程、保留 Browser Runtime、快速打包 Windows 桌面产品。

当前禁止第一阶段直接 Fork Chromium，也不要让 Electron API 渗入 Field Core。

完整 Chrome Extension compatibility 不属于 V0.1 验收条件，只保留 future compatibility target，不得因该目标提前 Fork Chromium。

## 4. 进程基线

```text
Fielora.exe
  ├─ Electron Main
  │   ├─ Browser / WebContents
  │   └─ Desktop lifecycle
  ├─ Renderer
  │   └─ React / TypeScript UI
  └─ fielora-core.exe
      └─ Rust Sidecar
```

Rust Sidecar 便于 Core 与 Electron 解耦、独立测试、崩溃隔离，并降低未来替换 Browser Host 的代价。

Electron Main 监督 Sidecar 生命周期。Sidecar 将 parent-owned stdin pipe EOF 视为权威 shutdown signal：停止接收请求，安全完成或回滚 transaction，关闭 storage/logs，并在 2 秒内退出，不得成为 orphan；Sidecar 不自行重启。

## 5. 通信边界

Renderer → Electron Main：Browser / window / desktop actions。

Renderer → Rust Core：通过受控 IPC Client。

Rust Core 不直接操作 React DOM。

Electron Main 不拥有 Field business truth。

Field / State / Evidence 的事实源位于 Core / Persistence 层。

## 6. 模块建议

```text
fielora/
├─ apps/desktop/
├─ packages/
│  ├─ ui/
│  ├─ surfaces/
│  ├─ browser-ui/
│  ├─ editor-ui/
│  └─ ipc-client/
├─ crates/
│  ├─ field/
│  ├─ state/
│  ├─ context/
│  ├─ agent/
│  ├─ capability/
│  ├─ model/
│  ├─ evidence/
│  ├─ project/
│  ├─ storage/
│  ├─ platform/
│  └─ native/
├─ research/
├─ evals/
└─ tests/
```

该目录仅为历史模块建议，不要求每个逻辑职责域对应一个 crate。特别是 IDR、
Memory、Agent Profile、Work Scope 不得为了架构对称创建空模块、平行 Runtime
或独立状态系统；物理拆分必须由真实实现压力另行授权。

## 7. Persistence

V0.1 原则：**Local-first**。

需要持久化 Fields、State、Capture、Inbox、Library refs、Requirements、Project Reality、Evidence、Resume Snapshot、Provider config metadata。

DB 已冻结为 SQLite + `rusqlite 0.40.2` `bundled`，由 Rust Core 单一 Storage Worker 持有 connection；migration 内嵌且校验 checksum。不要让 UI localStorage 成为核心事实源。

Field / Object 必须使用与本地文件路径分离的稳定 identity。本地路径、设备上的应用定位和其他本机资源引用属于 `Device Binding`；Persistence 不得用 Windows absolute path 充当跨设备对象主键。

Field / Object / Activity 等核心模型需为未来多主体和交换预留 owner / actor / visibility / share_scope / permissions / provenance 语义，但 V0.1 不因此建设完整账号、同步、通信或共享服务。

## 8. Model Provider

必须定义统一 Provider Interface，不得在 Agent / Field 逻辑中直接写死厂商 SDK。

至少抽象 chat/responses、tool calling、streaming、usage、errors、model capabilities。

V0.1 不实现本地模型 Runtime。

## 9. Capability Connector

统一抽象外部工具能力，未来 Backend 可来自 MCP / API / CLI / Plugin / Browser Extension / Native Bridge。

V0.1 必须定义 Contract 并实现一个最小真实 Connector，优先采用 `Generic MCP Connector` 验证 `Contract → Call → Result → Evidence` 闭环。Technical Architecture 已冻结 Connector Contract、Capability Invocation/Policy/Result/Evidence 与 Adapter 边界；具体 MCP 协议范围、client/runtime 选择、process/network transport、discovery、authentication、timeout/cancellation 与 capability negotiation 在 Phase 09 开工前冻结。

Connector Contract 本身保持跨平台；transport 与 OS integration 通过 Adapter 隔离。禁止把未实现 Connector 或失败 Call 伪装成成功。

## 10. Browser Capability

V0.1 需要 navigation、current page、selection、screenshot where feasible、page metadata、downloads、DevTools access、browser preview。

完整 Chrome Extension compatibility 不属于 V0.1 验收条件，也不作为 Electron V0.1 已解决事实。它只保留为 future compatibility target；若未来成为核心需求，应单独立项评估 Chromium 深度集成。

## 11. Security

至少区分 read、local write、external send、destructive action、credentials、payments、permission elevation。

Agent 重要动作必须可追溯。V0.1 先实现真实可验证的最小权限边界，不做“万能 Agent 权限”。

生产 App UI 的唯一 trusted local application origin 是 `fielora://app`；开发态只在非 packaged 模式下接受 Forge renderer entry 的当次精确 loopback origin。禁止 wildcard localhost/127.0.0.1、任意端口、`file://` 或远程 origin。Browse/remote WebContents 使用隔离 session，不加载 Fielora preload，也不获得 typed app bridge。

## 12. 未来 Chromium 路线

只有当完整 extension compatibility、Browser Process 深层控制、Profile、Network、自定义 Chromium capability、更严格 sandbox 或 Electron 无法实现的 Browser UX 成为核心阻塞时再评估。

路线：`Electron Validation → Browser Adapter Boundary → Deeper Chromium Integration → Fork only if justified`

## 13. Platform Adapter

至少需要为 filesystem/path、process/shell、terminal PTY、credential/secure storage、window/desktop lifecycle、default browser/app launch、permissions 等 OS-specific 能力建立 Adapter 边界。Technical Architecture 已冻结 Phase 01 `fielora-platform` 边界、path/device identity 与 process lifecycle；PTY、credential 等后续接口粒度和 Windows 首实现方案在所属 Phase 开工前冻结。

核心层使用平台无关的 URI/identity/metadata 表达对象；Windows path 只存在于 Windows Device Binding。未来 macOS/Linux Adapter 不应要求改写 Field Model、Agent、Provider 或 Capability Contract。

## 14. Fielora Exchange 模型预留

长期 Exchange 可承载 Message / Object / Request / Task / Proposal / Result / Field Invite。V0.1 只要求核心实体与 Activity 不假设永久单用户本地环境，并预留 owner / actor / visibility / share_scope / permissions / provenance。

Core Contracts 与 Phase 01 Schema 已冻结 principal、owner、actor、visibility/share_scope/permission/provenance 的语义边界及首阶段所需物理字段；future Exchange 的完整 ID namespace、权限继承、provenance chain 与跨设备迁移策略仍延后。V0.1 不新增完整通信协议、IM、共享 Field、身份服务、云同步或 Steward-to-Steward 自动协作。

## 15. 冻结工具链

Phase 01 精确值：Electron 43.4.0、Node 24.18.1 LTS、pnpm 11.21.0、Rust 1.97.1 / Edition 2024、rusqlite 0.40.2 `bundled`、Electron Forge + Webpack + TypeScript + React。

本机 Node 由 `D:\AppInstall\nvm\nvm` 下的 NVM 管理；Node 24.18.1 已安装并设为 active，pnpm 11.21.0 已准备。Rust 1.97.1 已设为 default toolchain，并安装 rustfmt/clippy。Repo 使用 `.node-version` 与 `rust-toolchain.toml` 固定版本；Phase 01 package/Cargo workspace 已创建，依赖分别由 `pnpm-lock.yaml` 与 `Cargo.lock` 锁定。

## 16. 工程仓库前置条件

Canonical Local Worktree 已确认为 `F:\项目\Fielora`，Git 默认分支为 `main`，`origin` 为 `git@github.com:SolanCheung/Fielora.git`。Baseline Commit `bfdcbe0147b142cdf73ba06986fe7f35aaf2a604` 只包含冻结 Context Pack/docs、`.gitignore` 与精确工具链 metadata。用户随后明确授权 Phase 01；实现与三项 Gate 已完成，用户于 2026-08-14 裁决 `PHASE_01: COMPLETE`。

用户于 2026-08-14 先裁决 `PHASE_02: APPROVED_FOR_FREEZE`，随后基于精确 main baseline 单独授权并完成实现。Phase 02 精确边界仍以原文未改的 `PHASE_02_IMPLEMENTATION_SPEC_V0.1.md`、`PHASE_02_CONTRACT_DELTA_V0.1.md` 与 `PHASE_02_MIGRATION_0002_V0.1.md` 为准；Engineering、Desktop Reality、Human Experience、Post-correction Full Gate 与 Final Acceptance 均已通过，用户裁决 `PHASE_02: COMPLETE`。Phase 02 本身没有授权 Phase 03；用户随后以独立裁决和 `main@7dc1aac593a4d478b7e175e5e197cf99466c1f47` 授权 Phase 03 Browse Foundation。

## 17. 仍开放的技术决定

Phase 03 Slice 01 已选择 Electron `WebContentsView` + 独立 untrusted persistent session 作为真实 Web Runtime，并完成 Human Experience Gate。Slice 02 使用 Electron Main 内 ephemeral Page ID 与内存 collection；每个已加载 Page 拥有独立 `WebContentsView`并共享现有 untrusted session，只有 active Page 可见。Page 不是 Field/Object identity，不新增 durable Browser schema 或 Migration。普通链接同页导航；合法 window-open 目标经既有 Policy 后创建受控新 Page。Omnibox Search Provider 通过 `BrowserSearchProvider` 契约保持可替换，当前默认 Google；它不是 durable setting，不新增设置 UI。Slice 03 在 trusted renderer 内把 `BrowseScreen` 限定为只接收 browser capability，并以 lint 防止直接访问全量 app bridge；该编译期维护边界保证 Loose Browse UI 不接入 Field mutation，但不替代 remote WebContents 的安全隔离。Slice 04 集中冻结 Remote/Local Page 的 untrusted WebPreferences 与 permission-deny session policy。Navigation Policy 同时使用 initiator + target：trusted Omnibox 可显式加载隔离 `file://` Local Page，HTTP(S) Remote Page 的 navigation/fetch/iframe/window-open→`file://` 仍拒绝，Loose Browse 的任何发起者均不能进入 `fielora://app`；trusted origin 与 FIPC model 未改变。Fresh Browse E2E 清空精确 `.webpack` 输出后重新构建并启动 Electron Main，防止增量 bundle 掩盖运行时模块解析错误。不阻塞当前 Slice 的其他开放决定包括 code editor implementation、LSP host boundary、terminal PTY、project scan architecture、CodingAgentProvider/OpenCode/ACP viability、provider credential storage、updater/code signing/final installer technology、Evidence artifact retention/encryption、Generic MCP Connector 的协议范围与 transport，以及 future Exchange 的 ID/access 细节。

Slice 05 Desktop Experience 不新增 runtime contract；它以现有共享 untrusted persistent session 验证登录 POST/redirect、HttpOnly cookie、Reload 与跨 Page session，以既有 WebContentsView/Page lifecycle 验证复杂 JS、长页、多 Page、Resize 与 Now/Fields/Field 往返。首次 Human Gate 因窄窗 viewport、Clipboard、网页上下文菜单与 loading feedback 不足而失败。Repair 保持原 Contract：WebContents 从 100% CSS zoom 启动，窄窗 Browse shell 收敛；Main 使用 `ContextMenuParams` 与 WebContents/Clipboard 原生命令；UI 由真实 load events 驱动。E2E 核对 remote viewport/native bounds/visual scale/DPR/响应式渲染像素，并执行真实键盘复制粘贴与右键事件。稳定 fixture 只负责防回归，真实网站仍必须由 Human Experience Gate 裁决。Slice 05 Repair Candidate 通过后才可由用户决定是否进入正式 packaged/portable/Installer Gate。

Slice 05 第二轮 Repair 继续不增加 durable contract：trusted Omnibox 的 edit menu 由 App WebContents Main handler提供；Page 标签菜单只接受现有 ephemeral `page_id` validator，仍属于 trusted Browser bridge。favicon 是 ephemeral Page presentation state，不能成为 Field/Object identity、Schema 或 Migration；remote favicon URL 只能由隔离 Browse session 获取，Main 限制协议/MIME/字节/尺寸并经 `nativeImage` 重编码为 PNG data URL，trusted origin 的 CSP 不放开 HTTP(S) image source。Loading 只迁移视觉表达，不改变 Electron load lifecycle。

用户于 2026-08-16 最终裁决 Phase 03 完结。正式 Phase Gate 在 dev、packaged 与从全新临时目录解压的 portable 宿主中运行相同 Browse E2E，并同步回归 Phase 02 Field Reality；全部 PASS。该 closeout 没有改变 Phase 02 Frozen Schema、Field Reality、FIPC/trusted-origin、Object identity 或 remote isolation，也没有建立新的 durable Browser contract。下一阶段仍须单独设计和授权。

Codex 不得在未评审情况下把这些设计成不可替换的深耦合实现。

Rapid Desktop Foundation 已在 additive Migration 0005/schema 5 中实现首个 Project/Conversation 工作闭环。Project 仍以 Field stable identity + `PROJECT_ROOT` device binding 表达；Conversation/Message 由 Rust Core/SQLite 持久化。Electron Main 提供 bounded filesystem/process adapter，trusted renderer 只获得精确 Project-scoped bridge，Remote Browse WebContents 不获得本地 workspace capability。当前文件工作面是 bounded UTF-8 editor/diff，并非完整 code editor；Terminal 是显式 PowerShell process adapter，并非 PTY。LSP、PTY、Git change model、agent multi-file transaction、installer/updater/code signing 与真实 Provider acceptance 仍是开放项。

## 18. Agent 架构兼容基线

当前 canonical baseline 为 FIELORA_V0.1_AGENT_ARCHITECTURE_SPEC.md，按用户
2026-09-24 最新决定采用 Model + Harness + Capability。旧 Tools 顶层拓宽为
Fielora 的能力资产与实现，现有 ToolExecutor/ToolProvider 接口不变；不存在第四个 Agent 层。

Harness 按 Ingress、Context、Model Runtime、Orchestration / Control、
Capability Invocation / Execution Control、Continuity、Governance、
Verification & Recovery、Observability 九层职责组织，并沿用作诊断框架。
模型智能和 Provider wire adapter 属于 Model；L3 负责调用控制。具体工具后端
属于 Capability；L5 负责绑定、调度和调用生命周期，L7 决策并由后端落实不变量。

工程映射、现有能力与尚未实现的范围见 AGENT_ENGINEERING_VIEWS_V0.1.md。
九层不是九个服务或顺序执行流水线，不恢复 Control/Capability/Execution 三平面。
Work Scope & Goal 纳入 L4，相关权限与验收仍分别归 L7/L8。

## 19. IDR 当前状态

IDR 已退出生产运行链路，保留历史代码/数据/迁移与实验测试。
旧八域和七域为历史组织口径，当前使用 Harness 九层。Agent Profile、当前用户约束和
对话历史不依赖 IDR；Memory 为跨域语义。此次架构文档调整不新增权限、状态、迁移或运行时。
