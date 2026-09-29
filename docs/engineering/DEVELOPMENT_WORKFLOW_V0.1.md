# Fielora Development Workflow V0.1

> 2026-08-17 Rapid Desktop override：普通可逆 Project/Conversation/UI/Provider 工作不再先制作 Phase Freeze Package，直接按最小纵向切片实现并运行对应 Lane。只有 Schema/Migration、credential、安全、破坏性执行或不可回滚架构变化需要短 Change Impact。正式历史 Phase Gate 仅用于回归旧交付，不再阻断 Codex-like Desktop Foundation。

状态：`ACTIVE / VERIFIED`

生效基线：`main@e757d050b97a3f0dd3b6812bccefc1e433571c8f`

## 1. 目标

这套工作流解决两个现实问题：普通迭代不应反复打包解压，跨边界修改也不能只凭“页面能打开”进入 main。它只收紧开发与验证节奏，不改变产品范围、Frozen semantics 或 Phase Gate。

## 2. 长期运行开发模式

日常开发与人工体验继续长期运行：

```powershell
pnpm dev
```

普通 UI/Core 迭代不生成 packaged/portable。需要重启 Electron 或 Rust Core 时按受影响边界处理，不把“每改一次就正式打包”作为默认循环。

## 3. 分层 Gate

| Lane | 命令 | 适用范围 | 覆盖 |
|---|---|---|---|
| Docs | `pnpm verify:dev:docs` | context、decision、report、manifest only | manifest 文件、bytes、SHA-256、required reading |
| UI | `pnpm verify:dev:ui` | renderer、view state、CSS、纯 UI validation | typecheck、lint、TS unit |
| Core | `pnpm verify:dev:core` | Rust domain/runtime/storage/platform only | rustfmt、Rust unit、Clippy |
| Cross | `pnpm verify:dev:cross` | Contract、preload/Main bridge、Core↔UI、schema/persistence | Docs audit、contracts、UI、Core、real FIPC integration |
| PreMerge | `pnpm verify:premerge` | 任何准备进入 main 的变更 | Cross 全部 + real Desktop E2E |

所有 Lane 都在首个失败处停止，并输出稳定的 `GATE_START` / `GATE_PASS` / `DEVELOPMENT_GATE` 标记。日常 Gate 不覆盖正式 Evidence 日志，避免把临时验证伪装成阶段验收。

PreMerge Desktop E2E 将截图隔离到系统临时目录并在完成后清理；同时给冷 Forge 启动最多 120 秒 target wait。正式 Phase Gate 不设置这些开发变量，仍按冻结流程写入阶段 Evidence并使用自身 Gate 配置。

## 4. 风险升级规则

- 纯文档/manifest：Docs；进入 main 前仍跑 PreMerge，除非用户对纯历史/拼写修订另有明确裁决。
- renderer-only：开发中跑 UI；涉及 Resume、Surface、security-visible presentation 时追加 real Desktop E2E。
- Rust-only：开发中跑 Core；影响 persistence、resume、events、supervision 时升级到 Cross。
- Contract、generated DTO、Main/preload、FIPC、Migration/schema：直接跑 Cross。
- Electron/Forge config、entry、ASAR/resource、sidecar path、production origin/protocol、userData、runtime/权限/签名：除 PreMerge 外，必须追加 targeted packaged smoke。
- 正式阶段 Gate：仍运行该阶段冻结的完整 verify 命令，包含 Release、Package、Packaged Smoke、Portable、Portable Smoke 与 Human Experience；PreMerge 不能替代它。

如一个变更跨越多个类别，选择最高风险 Lane，不拆分成多个低风险 PASS 来规避更高 Gate。

### 4.1 Agent 故障记录随修复维护

Agent 相关调查、修复、错误方案撤回、复发或真实任务验收，应在同一 changeset
更新 [Agent 设计与实现错误记录](AGENT_DESIGN_IMPLEMENTATION_LESSONS.md) 的相关条目。
开始工作只查索引和相关案例；发现新事实时记录原因、责任域、解决办法、失败尝试、
验证及剩余缺口。分别报告机制测试与真实用户任务结果，未运行的真实模型验收不能由
fixture PASS 代替。这是轻量交付记录，不新增审批 Gate 或全量历史阅读要求。

诊断与修复说明采用用户于 2026-09-24 确认的方法：实际执行链 → 持久证据 →
代码机制 → Model/Harness/Tools（必要时映射九层）责任 → 验证边界。先回答本次
失败位置，与此前故障区分；核对可取得的 Run/构建/工具/终态，明确反证模型自述。
分别解释直接原因、促成因素和未证明的推测，交代上一轮修复的覆盖与遗漏。
修复后同时报告动作、结果和验收，不以层名、提示词增加或绿色替身代替因果证明。

## 5. main 准入

进入 main 前必须满足：

1. 变更范围与授权一致；
2. 对应开发 Lane 已通过；
3. `pnpm verify:premerge` 通过；
4. packaging-sensitive 变更已有 targeted packaged smoke；
5. manifest/required reading 同步；
6. Frozen spec 冲突为 0，或已停止并上报；
7. worktree 无未解释修改。

## 6. 不在本次 Hardening 中做

- 不增加依赖、Git hook manager、远程 CI 服务或新的发布平台；
- 不自动根据路径跳过 Gate；Lane 由责任人按风险显式选择；
- 不修改 Phase 02 产品实现或重新打开 Phase 02；
- 不定义、不授权、不开始 Phase 03。

需要更深的 CI、并行测试、缓存、flaky-test quarantine 或 Evidence automation 时，必须作为后续独立基础设施任务评审，不能在产品 Phase 中隐式扩张。

## 7. Change Safety / Compatibility Discipline

Change Safety 是贯穿所有 Phase 的工程纪律，不是新的产品 Phase，也不是用户可见的重型治理系统。它解决：局部 Contract、Schema、Adapter 或 UX 变化不能在远处静默破坏 Reality、Resume、Permission、Verification、Migration 或 Hero Flow。

重要变化开始前必须形成 bounded `CHANGE IMPACT`：

```text
Proposed change
  → affected contracts
  → affected modules/adapters
  → affected persistent data/migrations
  → affected invariants
  → affected Hero Flows
  → backward compatibility / rollback
  → required verification and evidence
```

至少回答：

```text
What depends on this?
What happens when this changes?
```

### 7.1 Change Impact 分类

| 变化 | 最低要求 |
|---|---|
| UI-only、无语义变化 | 受影响 UI tests；涉及主流程时补 Human/visual check |
| Domain/Contract | dependency search、contract tests、architecture invariants、受影响 Hero Flow |
| FIPC/Adapter | 双端 contract、degraded/unknown behavior、integration/E2E |
| Schema/Migration | old DB fixture → migration → semantic probe；失败行为、backup/rollback disposition |
| Permission/Security | negative tests、deny precedence、scope non-expansion、secret/privileged boundary |
| Verification/Reality | target revision mismatch、stale propagation、Resume/Completion regression |
| Packaging/runtime | packaged/portable smoke，按风险追加 Installer checkpoint |

### 7.2 Architecture Invariants / Fitness Functions

以下不变量必须逐步转成自动测试；所属能力尚未实现时先保留为后续 Phase Gate：

1. Provider/model switch 不改变 Field、Requirement、Task 或 Evidence identity；
2. Requirement/source revision 改变后，旧 Verified Result 不得保持 `CURRENT`；
3. Execution `SUCCEEDED` 不得自动推出 Requirement `VERIFIED`；
4. 非幂等 `UNKNOWN_OUTCOME` 不得盲目 replay；
5. Conversation/Memory 删除不得删除 authoritative Reality；
6. Model、Provider、网页或 Connector metadata 不得扩大 permission；
7. Auto-review/reviewer replacement 不得扩大 Capability Boundary；
8. Context Package 不得被当作 Current Reality；
9. 旧 Field 经 migration 后不得丢失 identity、lineage 或 Resume semantics；
10. 外部 Adapter/Runtime 重构不得把其内部 identity 泄漏成 Fielora Domain identity。

### 7.3 Contract 与 Migration Compatibility

- 对外或跨进程 Contract 发生不兼容变化时必须显式版本化；优先采用 `reads old + new / writes new` 的 bounded compatibility window；
- 不得通过同时修改 producer、consumer 与 fixture 来掩盖旧数据/旧 Adapter 已不兼容；
- Migration 必须验证旧版本真实结构、checksum、重复运行/失败行为与 semantic outcome；“SQL 执行成功”不等于 migration 语义正确；
- Plugin/Connector/Provider Adapter 只能依赖稳定 Fielora Contract，不依赖另一个 Adapter 的私有结构。

### 7.4 Hero Flow Regression

Alpha 前至少维护以下关键回归链：

```text
Capture → Inbox → Promote → Field → restart → Resume

Existing Project → Requirement → Development
→ FAIL → Fix → Replay → Verified Result

Capability Request → Governed Execution
→ Result / UnknownOutcome → Evidence → Reality

Provider A → Provider B → human revision → Provider C
→ restart → same authoritative Reality
```

不是每个 CSS 修改都运行全部 Hero Flow。开发 Lane 先跑受影响测试；Contract/Schema/Permission/Reality/Verification 的变化必须升级到对应关键回归，正式 Phase Gate 仍运行冻结的完整矩阵。

### 7.5 Change Acceptance Gate

重大变化只有在以下条件同时满足时才能被接受：

1. impact scope 已记录；
2. 受影响 Contract 与持久数据已有兼容/迁移方案；
3. 相关 architecture invariants 与 negative tests 通过；
4. 受影响 Hero Flow 已重跑；
5. Evidence 能说明仍然成立什么、尚未证明什么；
6. 失败或回滚路径明确；
7. 重大产品/架构结论已同步 Project Reality、Decisions 与受影响 Spec。

AI Coding 特别容易把当前局部修改做通而漏掉远端语义，因此 `CHANGE IMPACT` 是高风险变更的实现前输入，不得由“本地测试绿”替代。
