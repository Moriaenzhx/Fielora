# Fielora Agent：Model + Harness + Capability

状态：CURRENT，2026-09-24 按用户最新决定修订。顶层 Tools 扩展为 Capability；Harness 按九层职责组织，同时沿用这九层诊断。取代此前“七域 + 仅诊断九层”的口径，不恢复三平面，不恢复 IDR。原文件路径保留以维持链接。

## 1. 主架构

```text
Agent
├── Model
│   └── 理解、推理、生成、行动提案；Provider-neutral 接口与适配器
├── Harness
│   ├── L1 Ingress
│   ├── L2 Context
│   ├── L3 Model Runtime
│   ├── L4 Orchestration / Control
│   ├── L5 Capability Invocation / Execution Control
│   ├── L6 Continuity
│   ├── L7 Governance
│   ├── L8 Verification & Recovery
│   └── L9 Observability
└── Capability（Fielora 当前具备的能力与资产）
    ├── Catalog：工具定义、发现、来源/版本、能力状态与精确查询
    ├── Skill：内置/项目/插件 Skill；发现、加载、获取、安装与结构检查
    ├── Tool：文件、受控命令、Git、浏览器、网络和产物操作
    ├── Resource Access：项目文件、Skill 资源、文档提取与产物读取
    ├── Integration：ToolProvider、MCP stdio、已实现的 Web/本地适配器
    ├── Plugin：本地声明式插件，当前贡献 Skill
    └── Execution Backends：ToolExecutor、ToolRuntime、BrowserRuntime 等

共享基础设施：存储、检查点、产物、凭据、通信、取消与缓存
```

Model 提供智能与候选行动；Harness 控制如何使用智能；Capability 提供 Fielora 可发现、可加载、可调用的能力资产及具体实现。Tool 是 Capability 的组成部分，不能将 Skill、Resource、Plugin 都视为可执行 Tool。

九层是 Harness 的逻辑职责，不要求九个服务、crate、数据库或顺序执行阶段。共享基础设施不是第四个 Agent 层，Capability 也不是另一个 Harness。

## 2. Harness 九层职责与当前实现

| 层 | 负责什么 | 当前实现与边界 |
| --- | --- | --- |
| L1 Ingress | 输入接入、来源、附件、当前消息与继续操作的绑定 | AgentCoordinator、agent_user_input、agent_turn_context；不替模型做通用语义判断 |
| L2 Context | 内容选择、预算、Skill/资源加载后的上下文准入、历史投影 | ContextCompiler、Skill context、ContextSnapshot；来源内容不自授权 |
| L3 Model Runtime | 构造/调度模型调用，工具 schema 注入，流响应消费、预算/取消/调用错误处理 | Coordinator 调用 fielora-model；Provider wire adapter 仍属于 Model，LLM 智能不搬进 Harness |
| L4 Orchestration / Control | 当前目标与工作范围、下一步、策略、计划、委派、任务推进 | 既有循环、agent_request_scope、agent_request_intent、agent_work_state；Work Scope & Goal 在此保留 |
| L5 Capability Invocation / Execution Control | 解析工具、绑定实现、应用 L7 决策、分发、ToolCall 生命周期和收集回执 | 既有 dispatch、RoutedToolExecutor、ToolExecutor 接口；不在此重复实现文件/浏览器后端 |
| L6 Continuity | Run/历史/检查点、暂停、重启恢复与未完成操作核对 | StorageWorker、事件/ToolCall 账本和内容检查点；不是第二数据库 |
| L7 Governance | 当前范围、权限、审批、凭据准入和执行不变量 | PolicyEngine、Approval、受信任范围检查；Capability 后端强制落实本地边界 |
| L8 Verification & Recovery | 完成标准、当前版本证据、结果校验、失败恢复决策 | agent_task_outcome、agent_skill_verification、verify_skill、VerificationReceipt；L4 执行恢复策略，L6 保存恢复状态 |
| L9 Observability | 调用来源、事件、回执、构建身份、错误分类、诊断与审计 | 现有持久事件与回执、诊断清单；日志或模型解释不等于事实与验证 |

九层同时用于故障归因，但不是九项已全部成熟的产品能力。具体成熟度由实际代码、测试与真实任务证据决定。

## 3. Capability 当前范围与调用边界

| 类别 | 已有实现 | 不应推导出的能力 |
| --- | --- | --- |
| Catalog | ToolSpec/ToolProvider 目录、capability_status 分页/摘要/详情 | 注册不代表目标可达、调用获准或任务完成 |
| Skill | SkillCatalog、list/load、公共 GitHub 搜索、固定目录/ZIP 准备、项目安装及检查 | 不是工作流引擎；无私有来源凭据、自动脚本执行或完整在线市场 |
| 文件/开发 Tool | 受控读写、精确修改、命令、typed Git | 不等于无限制 shell 或完整 IDE/PTY |
| Browser / Web | 受控页面观察/交互/检查；Web provider 接口与已实现适配器 | 通用搜索是否可用取决于本轮已准入 provider；不是任意 OS Computer Use |
| 文档/产物 | PDF/DOCX/PPTX/XLSX 有界提取，Document/Presentation/Diagram/Spreadsheet 产物，DOCX/PPTX/SVG/XLSX 导出 | 非完整 Office 编辑、PDF 导出、OCR、公式计算或全面视觉验收 |
| Resource Access | 现有项目文件、Skill 引用资源及产物读取 | 尚无完整通用 Resource 注册平台，不能声称已支持全部 MCP Resource |
| Integration | ToolProvider、MCP stdio 连接发现/激活/调用、现有受控本地适配器 | MCP 是协议，不是任务控制者；API/SDK/Native 全覆盖不是现有事实 |
| Plugin | 本地 fielora.json 声明式插件与 Skill 贡献 | 不包含任意插件代码、Hooks/UI 扩展、市场或自动升级 |
| 子任务调用 | 受限只读 delegate_readonly 入口 | 实例与执行生命周期属于 Harness L4/L6；尚无可配置 Agent Blueprint 产品 |

调用链：Model 提案 → Harness L4 组织当前行动 → L5 查定义并应用 L7 决策 → Capability 的执行接口/后端 → 事实回执 → L8 验证与完成裁决。L6 保持连续性，L9 记录过程。

Skill/Resource 的加载路径：Capability 目录与资产 → Harness L2 准入 → Model 使用；涉及脚本或其他动作时仍需返回正常工具调用链。Plugin 是分发容器，不获得任务状态、审批或完成裁决权。共享存储不共享语义修改权。

L3 Model Runtime 是调用控制，Model 是智能与 Provider 适配；L5 是执行控制，Capability 后端是真实执行。两组边界都不得通过命名合并成第二 Runtime。IDR 保持退出状态。

## 4. IDR 当前处置

生产运行链路移除 IDR 参与；无 Human Model 读取、个性化注入或学习工具曝光。旧数据、迁移与历史实验代码保留以保证兼容和审计，隔离测试可显式运行历史机制。IDR 不属于当前建设范围或默认 Harness 活跃职责。旧文档“八域/IDR frozen”是历史实现事实，不再代表生产启用状态。是否有益未通过真实任务证明，不表述为科学证明无用。

## 5. 能力事实合同

能力不能只有一个 AVAILABLE 布尔值。现有目录查询应分别表达：当前目录准入、绑定身份/版本/协议、后端报告状态、调用权限是否已判定、目标可达性是否已实测、任务验证是否成立。目录查询不自发探测网络、读取 secret 或授予权限。

capability_status 的空参数保留兼容；可分页列举本次目录，按精确工具名读取定义。目录摘要保护跨页一致性；未暴露不等于产品永久不支持，provider 自报可用不等于指定目标可达。读取全量目录前不得从缺失页推导能力不存在。Skill 元数据/资源沿 list_skills/load_skill、插件快照沿现有目录，不复制另一个资产状态库。

## 6. 能力差距及交付边界

用户后续提出的 36 项能力已逐项核对，见 [能力对照与补齐清单](CAPABILITY_INVENTORY_V0.1.md)。尤其 Web Search/Fetch 的 adapter 存在不代表默认产品已注册；第一批沿 capability_status 补候选筛选，其他缺口按表分批交付。

| 能力 | 当前状态/本轮措施 | 验收方式 |
| --- | --- | --- |
| 完整 Skill 获取/安装 | 上轮已实现；本轮回归 | 真实来源证据 + 目录完整性 + 受控安装/验证 |
| 目录事实、精确详情、分页 | 本轮补充 | 不可用/过滤/变化/分页及真实桌面回执 |
| IDR 退出生产 | 本轮实施 | 非空旧数据不注入、不学习，重启保持退出 |
| 主架构与 Harness 九层职责 | 本文固化 | 代码所有权映射与上下文文档检查 |
| 通用 Resource 注册、可配置 Agent Blueprint | 仍未实现完整产品 | 后续必须以实际资源/子任务用户流程定义契约 |
| 任意桌面 Computer Use、全面 Sandbox | 不由已有 Browser 能力推出 | 需独立具体操作范围及安全验收 |
| 完整 Plugin 市场/更新、远程执行和分布式队列 | 不在本轮实现 | 不创建占位服务或宣称可用 |
| 真实模型可靠选工具与完成原 Archify 安装 | 尚待真实验收 | 不能以替身或本轮重命名关闭 |

补能力沿纵向用户流程推进；此表区分已交付、实际缺口和扩展方向，不能把所有图中名词视为当前产品承诺。
