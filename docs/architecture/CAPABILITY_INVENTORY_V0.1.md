# Fielora 能力对照与逐项补齐

日期：2026-09-24。基线：Model + Harness + Capability，Harness 九层；IDR 不恢复。

这是用户提出的 36 项能力的代码审计和实施清单。**已有实现、接入当前 Run、目标调用成功、真实任务验收是四个不同状态。** 下表的“已有”只指列出的有限范围；不表示真实模型全部验收通过。“缺失”指未发现该产品链路，不能从通用 shell、MCP 或浏览器间接执行的可能性推导为已有。

## 1. 逐项对照

| # | 能力名称 | 当前事实 | 要补的具体内容 / 下一验收 |
| --- | --- | --- | --- |
| 1 | Capability Registry | 部分：ToolSpec 已准入目录，SkillCatalog 与插件快照分别管理；没有统一资产注册服务 [A][B] | 复用现有目录形成资产类型索引；不复制注册数据库 |
| 2 | Capability Discovery | 已有受限发现：内置、配置的 ToolProvider、MCP 工具、项目/插件 Skill [A][B][C] | 本轮增加当前工具目录的过滤检索；在线资产搜索不等于本机准入 |
| 3 | Capability Resolver | 已有精确工具名→绑定路由；本轮补描述/来源/副作用候选筛选 [A] | 当前仅词面候选查找，不是自然语言语义匹配、自动规划或自动切换 provider；后续补任务级选择评测 |
| 4 | Browser Runtime | 已有：Electron 隔离页面、导航、DOM 观察/交互、截图和校验 [D] | 扩展真实网站稳定性验收；页面就绪失败不能推断网络全局不可达 |
| 5 | CDP / DevTools | 部分：内部使用受限 debugger 命令完成输入；测试也使用 CDP [D] | 未向 Agent 开放任意 CDP 会话。需要具体调试用户流程再增受控操作 |
| 6 | Web Search | **适配器已实现，默认产品未接入**：Brave backend、schema、凭据接口与测试存在 [E][F] | 配置入口、准确凭据绑定、注册与真实搜索验收；不能把 skills.search 冒充通用搜索 |
| 7 | Web Fetch | **适配器已实现，默认产品未接入**：PublicWebFetcher 有界抓取、DNS/redirect 校验 [E][F] | 优先独立接入无搜索凭据的公开网页 fetch；验证页面文本与字节下载的边界 |
| 8 | MCP Client | 已有受限实现：rmcp stdio 握手、发现、调用、超时/取消 [C] | 尚未形成 HTTP/SSE、OAuth、Resources/Prompts 的完整产品支持 |
| 9 | MCP Provider Adapter | 已有：MCP 工具经 ToolProvider 准入和 RoutedToolExecutor 执行 [A][C] | 新传输复用此接口和治理链，不另建 MCP Agent |
| 10 | Skill System | 已有：发现/加载、公共来源查找、完整 bundle 准备/安装和验证 [B] | 私有来源、更新/卸载体验、更多真实 Skill 验收；结构通过不等于脚本运行通过 |
| 11 | Skill Registry | 已有本地 SkillCatalog：名称冲突、来源、版本、digest、诊断 [B] | 尚无完整在线市场或统一远程仓库注册产品 |
| 12 | Skill Loader | 已有：按需加载、上下文预算、来源与版本检查 [B] | 加载不执行资源、不接受 allowed-tools 自授权；继续补大资源与失效体验 |
| 13 | Plugin System | 部分：用户配置的本地解包插件，目前贡献 Skill [B][F] | 在线分发、安装/更新/卸载、依赖兼容；无任意插件代码/UI/hooks 运行 |
| 14 | Plugin Manifest | 已有：fielora.json 类型校验、引擎约束、路径约束与快照 [B] | 后续贡献类型必须逐个定义合同，不能接受未知字段直接运行 |
| 15 | Connector System | 部分：ToolProvider/MCP/Web 已提供适配接缝 [A][C][E] | 通用账号连接、授权撤销、连接健康和 Connector 设置产品尚缺；不重造执行链 |
| 16 | Artifact Runtime | 已有：持久 Document/Presentation/Diagram/Spreadsheet、版本/历史/导出 [G] | Office 高级功能、PDF 导出、视觉验收不能由现有导出推导 |
| 17 | Credential / Secret Broker | 已有受限实现：WinCred、CredentialStore、精确静态绑定、MCP 环境注入 [A][C][H] | 通用 OAuth/短期凭据与轮换产品仍缺；查询目录不读取 secret |
| 18 | Resource System | 部分：文件、Skill resources、文档提取、Library/Artifact 读取 [B][G] | 缺统一资源描述/读取协议及 MCP Resource；先围绕本地引用实现，不造新存储 |
| 19 | Agent Blueprint | 缺可配置产品；bundled AgentProfile 是宿主定义，不是用户蓝图 [F] | 声明式角色/能力子集/预算/输出约束，实例仍走现有 Run；不得自授权限 |
| 20 | SubAgent Runtime | 已有受限只读 delegate_readonly，子 Run 仍由原 Harness 管理 [F] | 并行协作、写入隔离、结果汇合和蓝图选择；不创建第二运行时 |
| 21 | Computer Use | 缺任意 OS 桌面操作链；网页 DOM 与受限输入不能等同 [D] | 先选一条 Windows 本地应用流程，定义目标应用、输入授权、截图证据、取消/恢复 |
| 22 | Chrome Session Access | 缺现有 Chrome 用户会话接入 [D] | 显式用户选择的会话、只读发现到受控交互；不可复用 Fielora Browse 隔离会话的结论 |
| 23 | SSH / Remote Execution | 缺专门远程连接/执行产品 | 主机身份校验、凭据引用、工作目录、取消与未知结果；不把可运行 ssh 命令当产品支持 |
| 24 | Event / Trigger | 部分：现有 Run 事件、UI 动作和时间触发 [F][I] | 文件/连接器/webhook 等可配置触发器缺失；需去重、来源、授权与重放约束 |
| 25 | Scheduler | 已有：ONCE/DAILY/WEEKLY、JSON 持久化、15 秒轮询，回调进入 Agent [I] | 当前依赖应用运行；计算使用主机本地时区，存储 timezone 不等于按任意时区调度；需并发/崩溃窗口/补跑策略 |
| 26 | Human-in-the-loop | 已有：澄清、暂停/回答续跑、浏览器登录交接 [F][J] | 继续补跨重启/重复回复与复杂交接体验；“等待用户”不等于成功 |
| 27 | Approval | 已有：PolicyEngine、审批记录与执行前检查 [A][F] | 沿 L7 完善具体新能力的授权，不能成为一个可绕过 Harness 的普通能力 |
| 28 | Knowledge Search | 部分：项目 search_text、历史 Run 按来源检索、文档提取 [A][J] | 缺跨文档知识索引、引用位置与权限过滤检索闭环；读取文档不等于知识搜索 |
| 29 | Vector / Semantic Search | 缺实际向量检索产品；Storage UI 的 VECTOR_INDEX 显示 NOT_PRESENT [K] | 在知识检索流程上补分块、模型版本、增量/删除、来源和权限过滤；不先堆向量库 |
| 30 | Environment Model | 部分：项目 root、平台/浏览器状态、目录事实及 ContextSnapshot [A][D][F] | 缺按来源/时效查询的统一环境描述；不引入自主“世界模型”或第二事实库 |
| 31 | Execution Evidence | 已有：ToolCall、事件、检查点、内容摘要、VerificationReceipt [F][H] | 新能力必须接同一账本；动作成功、结果验证及历史证据分别表达 |
| 32 | Capability Versioning | 部分：来源/版本、schema/目录 digest、Skill/plugin 快照与固定来源提交 [A][B] | 跨版本兼容策略、依赖选择与受控升级/回退体验尚缺 |
| 33 | Capability Permission / Scope | 已有：effect、Policy、当前工作范围、路径/页面/凭据绑定 [A][D][F] | 新后端逐个补负向越权测试；目录过滤不是权限撤销或授权 |
| 34 | Capability Provider Management | 部分：provider identity/availability、配置 MCP 连接与准入 [A][C][F] | 统一配置/健康/诊断和 Web 接入缺口；模型 Provider 设置不能代替能力 provider 管理 |
| 35 | Capability Evaluation / Benchmark | 部分：大量 unit/integration/E2E、模型 preflight/live eval 脚本 [L] | 缺统一按能力/版本/场景对比质量、延迟、成本和失败的评测集；不能以绿色 fixture 宣称真实可靠 |
| 36 | Record-to-Skill | 缺从执行记录生成并验收 Skill 的产品 | 先从用户选择的脱敏事件产出待审 Skill，再验证重放泛化；禁止自动把失败轨迹固化或自动启用 |

## 2. 归属与补齐顺序

这些名称不全是 Capability 后端。Human-in-the-loop 跨 L1/L4/L6；Approval 与 Scope 属 L7；Execution Evidence 跨 L6/L8/L9；Evaluation 支撑 L8/L9。Scheduler/Trigger 是向原 Harness 提交工作的产品服务。Registry/Discovery/资产与执行后端属于 Capability，候选选择由 Model/L4 决策，实际绑定由 L5 执行。

按真实用户流程逐批推进，每批交付代码、对应回归与限制；没有实现的行保持缺失，不建立空服务：

1. **本批：当前工具目录候选查找。** 在 capability_status 增加结构化筛选和分页查询摘要。无需预知准确工具名即可发现候选；复用 ToolSpec，不新建 Registry/Resolver 状态库。Registry/Discovery/Resolver 的通用资产支持仍是部分完成。
2. **下一优先：Web Fetch 产品接入、Web Search provider 配置/诊断。** 先补代码到默认运行的缺口，再验证真实请求、失败分类与权限；浏览器渲染、API 搜索、静态抓取、Skill 下载保持独立。
3. **资源与知识：** 本地 Resource 读取合同 → 有来源的 Knowledge Search → 需要时增加 Vector Search；复用 Library/Artifact/Context 和项目范围。
4. **扩展资产：** Skill/Plugin 管理和版本兼容 → Connector/provider 管理 → Agent Blueprint 与受限 SubAgent 扩展。
5. **持续任务：** Scheduler 时区/并发/恢复 → Event/Trigger → 环境事实和跨重启交接。
6. **新执行边界：** 按具体用户流程逐一接 Computer Use、Chrome 会话、SSH；需要各自短 Change Impact 和边界回归。
7. **持续评测与沉淀：** 每批补能力评测样例；有可靠成功轨迹后做 Record-to-Skill，不等最后才验证。

这不是所有条目已实现的承诺，也没有创建后台自动续建任务。已授权的后续工作沿本清单继续，不需要为日常可逆修改重新审批。

## 3. 本批调用合同与验收

用户流程：让 Agent 查找当前可用的 Skill 获取工具 → 读取候选与精确定义 → 由模型选择 → 进入原 Policy/执行/验证链。

```json
{"filter":{"text":"skills.","effect":"NETWORK"},"limit":1}
```

使用原生 `capability_status`。`text` 是名称/描述上的大小写不敏感子串匹配，空白分词后全部匹配；不翻译、不理解自然语言意图。可同时按 `provider_id`、`source_kind`、`effect` 精确过滤。保留所有匹配的已准入候选，包括后端自报不可用的候选，避免隐去失败与恢复信息；返回顺序是原目录顺序，不是可靠性评分。

下一页重复 filter，并传回 `offset`、`catalog_sha256`、`query_sha256`；目录/schema/后端报告或查询条件改变时必须从第一页重查。`catalog_page.total` 是匹配数，`catalog_total` 是整个工具目录大小，`complete` 表示本次查询覆盖；能力组摘要始终基于全目录。无 filter 的旧请求兼容。结果不会选择/执行工具，不探测网络，不读取凭据，不更改权限。

验收：目录筛选/空结果/过界参数/跨查询分页/不可信描述/不可用 provider 单元回归；通过真实 Desktop→Core→模型替身→工具→持久回执→完成链路检查新 schema 与分页。机制证据见 [本批交付](../../artifacts/capability-candidates-20260924/DELIVERY.md)。真实模型语义选工具与原 Archify 安装另行验收。

## 4. 代码证据索引

- [A] [工具目录、策略与执行绑定](../../crates/fielora-agent/src/lib.rs)，[当前目录投影与候选筛选](../../crates/fielora-agent/src/capability_catalog.rs)。
- [B] [SkillCatalog/Loader](../../crates/fielora-agent/src/skills.rs)，[完整获取](../../crates/fielora-agent/src/skill_acquisition.rs)，[结构检查](../../crates/fielora-agent/src/skill_verification.rs)，[Plugin manifest](../../crates/fielora-agent/src/plugins.rs)。
- [C] [MCP stdio](../../crates/fielora-agent/src/mcp.rs)，[连接快照](../../crates/fielora-agent/src/mcp_connections.rs)。
- [D] [BrowserRuntime](../../apps/desktop/src/browser-runtime.ts)，[Agent Browser Host](../../apps/desktop/src/agent-browser-host.ts)，[Core browser bridge](../../crates/fielora-core/src/agent_browser.rs)。
- [E] [WebToolProvider / Brave / PublicWebFetcher](../../crates/fielora-agent/src/web.rs)。
- [F] [AgentCoordinator](../../crates/fielora-core/src/agent_runtime.rs)：`new` 以空 ToolProvider 向量初始化，`with_user_config_root` 只补 MCP/plugin 配置路径；`with_brave` 未被产品构造调用。浏览器与已激活 MCP 沿专有现有接缝加入目录。
- [G] [Artifact 操作](../../crates/fielora-agent/src/artifact.rs)。
- [H] [Storage / 证据](../../crates/fielora-storage/src/lib.rs)，[平台进程与凭据](../../crates/fielora-platform/src/lib.rs)。
- [I] [ScheduledTaskService](../../apps/desktop/src/scheduled-tasks.ts)，[Main 服务接入](../../apps/desktop/src/main.ts)。
- [J] [人工澄清](../../crates/fielora-core/src/agent_user_input.rs)，[历史来源检索](../../crates/fielora-core/src/agent_turn_context.rs)。
- [K] [存储索引现状](../../apps/desktop/src/storage-manager.ts)。
- [L] [开发验证 Lane](../../scripts/verify-development.ps1)，[模型 eval preflight](../../scripts/eval-agent-china-preflight.mjs)，[真实模型脚本](../../scripts/eval-agent-qwen-live.mjs)。脚本存在不等于已运行或通过。


## 工具依赖获取补充（2026-09-25）

- Environment Model：新增 environment.inspect，列出 PATH 全部程序候选及有界标准目录；不把发现等同于版本或兼容性验证。
- Capability Provider Management / Permission：新增 tools.prepare / tools.install，官方 Node、ripgrep 便携 ZIP 及需审批的公开 HTTPS ZIP；同 Run 回执解析、实际包摘要与体积、隔离发布。可信 <=20 MiB 免安装确认，其他 Ask，沿现有权限和审批事件。
- 未覆盖：完整包管理器生命周期、自动安装脚本、MSI、TAR、多平台、自动全局 PATH 更新。常见 npm/pip/winget/npx 等获取命令要求审批；这不是任意脚本语义分析或全面进程沙箱。
- Execution Evidence：真实普通 PATH 发现兼容 Node 并执行 Archify、真实官方 ripgrep 下载发布/version 已有维护证据；模型主动选择能力仍须真实任务验收。
