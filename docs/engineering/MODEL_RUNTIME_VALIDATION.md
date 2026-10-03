# 模型能力与推理设置：实现与验收

2026-10-02，开发分支 `phase/complete-agent-v0.1`。用户授权先实施模型能力、实际推理配置及有界兼容验证。变更边界见 [Change Impact](MODEL_RUNTIME_CHANGE_IMPACT.md)，案例 AE-022。

## 使用

设置 → 模型配置 → 模型服务 → 选择一个服务。连接与模型能力在同一页显示；新增/编辑不再弹出旧版模态窗口。

- 能力由 Core 统一下发，官方声明、未知能力和实测分项分别显示。Qwen 官方 DashScope 的已声明混合模型有默认/开/关；DeepSeek 官方当前思考模型有默认/关/低/高/最高。其他模型/代理只使用服务默认，不按模型名称自动授予能力。
- 每次回复输出上限256–16384，默认4096。直连文本和Agent用同一设置；默认不发送推理覆盖。保存的请求参数可展开查看，发送参数不等于服务端证明执行相同推理强度。
- 新Run首次模型调用时将配置和非敏感参数固定在既有检查点。既有Run恢复保留其快照；换端点后恢复会明确拒绝不匹配配置，不静默切换。
- “检查Agent兼容性”单独于“测试连接”。最多4次调用，每次输出最多1024Token、全程90秒，可取消，可能产生费用。仅使用合成无副作用回声工具，不读项目。分项为文本流、工具调用、工具报错后的重试、工具结果续接。
- 通过只代表当前端点/模型/配置的有限测试。图片、结构化输出和长任务可靠性没有因此被认证；不验证服务端实际推理强度，不自动升档。
- 凭据仍在系统凭据库。DeepSeek的私有协议续接状态在受限内存中保留，Debug脱敏，不进公共DTO、日志、对话或数据库。进程重启后用明确标记的历史工具事实恢复，不伪造私有状态。

## 验证

- Cross Lane通过：279项TS、workspace Rust测试、rustfmt、Clippy、生成契约、context audit、13项Core集成。模型模块新增5项HTTP/取消/恢复测试，连同2项声明与参数测试；存储新增2项升级与隔离测试。最终计数429项Rust通过，另有5项既有ignored。
- 本地HTTP替身验证：分段SSE工具参数、合成报错→纠正→工具结果续接、DeepSeek reasoning_content回传、报告/Debug无私有内容、畸形参数拒绝、待响应取消以及DNS前已取消。没有生产endpoint override；HTTP注入仅在`cfg(test)`编译。
- Schema16→17：保留已有Provider，幂等迁移、失败事务回滚、设置持久化、端点/模型隔离、过期revision拒绝、配置/凭据更新使证据失效。
- Core真实进程：在任务暂停时修改默认设置，杀进程重启并继续，原Run保留2048快照且不重复添加；后续新Run使用4096。
- `pnpm test:e2e:model-runtime`（dev）通过；`pnpm test:e2e:model-runtime:packaged`（原生ARM64）通过。真实Electron + preload/Main + Core + SQLite，覆盖UI保存、实际参数预览、Core拒绝不支持档位、重启、未知端点隔离、失败报告不假绿、配置变更失效、Run快照。最终包另检查深色920px宽窗口，截图已核对。合成凭据在测试结束时从Keychain删除。
- `pnpm verify:ui-ux`通过23项检查。打包采用当前release Core；本机`.app`已更新。
- 完整`pnpm verify:premerge`的Cross和Phase02桌面通过，仍在既有Browse关闭页面的WebContents残留断言失败（2个目标而期望1个）。未调整断言或修改无关浏览器逻辑；该次执行未进入Desktop Foundation。不能宣称完整PreMerge通过，也没有合并main。

最新专项证据：

- dev：`/var/folders/h5/5l63m1vd4pn0pvz88__m_87w0000gn/T/fielora-model-runtime-evidence-iwqLYO/`
- 最终packaged：`/var/folders/h5/5l63m1vd4pn0pvz88__m_87w0000gn/T/fielora-model-runtime-evidence-Xy06un/`
- 完整PreMerge失败：`/var/folders/h5/5l63m1vd4pn0pvz88__m_87w0000gn/T/fielora-premerge-evidence-WQoE4o/`
- 日常数据库schema16升级前备份：`/Users/solan/Library/Application Support/Fielora/backups/before-model-runtime-17-20261002-094230/fielora.db`，SQLite backup并通过integrity_check。旧schema16程序不得直接打开升级后的数据库。

未调用真实付费模型，未验证Windows本轮构建，未推送GitHub。原Archify长任务成功与不同模型的真实行为仍需独立验收。注册表依据：[Qwen deep thinking](https://www.alibabacloud.com/help/en/model-studio/deep-thinking)、[DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)，复核日期2026-10-02。


## 统一设置与十个国产系列（本轮追加）

Core目录：`crates/fielora-model/src/provider_catalog.json`。对应厂商API、精确模型ID、参数映射和私有续传在同一Model层维护，UI经受信IPC读取目录。名单代表本轮覆盖范围，不是市场排名；模型可用性取决于账号与地域。

| 系列 | 默认预置 Model ID | 推理设置及差异 | 官方依据 |
| --- | --- | --- | --- |
| 通义千问 | `qwen3.7-plus` | 默认/关闭/开启；百炼通用与Coding Plan分开 | [文档](https://www.alibabacloud.com/help/en/model-studio/deep-thinking) |
| DeepSeek | `deepseek-flash` | 默认/关闭/低/高/最高；回传reasoning_content | [文档](https://api-docs.deepseek.com/guides/thinking_mode/) |
| Kimi | `kimi-k3` | K3默认/低/高/最高；K2.7强制思考，K2.6可切换 | [文档](https://platform.kimi.com/docs/guide/use-thinking-models) |
| 智谱 GLM | `glm-5.3` | 5.3默认/低/高/最高；GLM-5/4.7可切换思考 | [文档](https://docs.bigmodel.cn/cn/guide/capabilities/thinking) |
| MiniMax | `MiniMax-M3` | M3可切换；M2.7强制思考；拆分思考和max_completion_tokens | [文档](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| 豆包 | `doubao-seed-2-1-pro-260628` | 默认/关闭/开启；保留加密续传内容 | [文档](https://docs.volcengine.com/docs/ark/deep-thinking?lang=zh) |
| 腾讯混元 | `hy4-preview` | Hy4低/高；Hy3不承诺工具调用低档；TokenHub密钥 | [文档](https://cloud.tencent.com/document/product/1823/132252) |
| 百度文心 | `ernie-5.0` | 5.0/5.1版本选择，未确认的推理控制保持服务默认；5.1工具/图片能力标未知 | [文档](https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb) |
| 讯飞星火 | `spark-x`（X2） | X2/X2Flash可开关思考，各自专用地址；Ultra默认；函数工具不与web_search混传，纯文本关闭默认联网搜索 | [文档](https://www.xfyun.cn/doc/spark/X1http.html)、[Flash](https://www.xfyun.cn/doc/spark/X2-Flash.html) |
| 阶跃星辰 | `step-3.7-flash` | 3.7/5支持默认/低/中/高；3.5-2603低/高；基础3.5固定模型思考方式 | [文档](https://platform.stepfun.com/docs/zh/guides/developer/reasoning) |

接口/目录复核日期2026-10-02。任意未列入的端点、路径或Model ID仍可手动使用，但能力标未知，仅接受服务默认配置。保留API Key不会回显密钥；更换地址必须确认。本轮没有自动修正日常配置里的“千问3.7”，由用户在编辑连接中选择百炼服务类型后保存。

打包：标准`pnpm build`、desktop `package`/`make`在Forge成功后检查三个关键产物；成功标记写入后自动清理历史受管理开发包，保留1个。失败、未知目录、正式证据与用户数据保护不变。标准build/package先在隔离目录完成打包，再验证并替换固定路径；仅成功后删除旧受管理.app，打包失败保留原应用。

本轮最终源码验收：Cross通过（277项TS、434项Rust通过/5项忽略、13项真实Core IPC集成），包含30项Model测试及50项Storage测试；UI规范23项通过；产物清理4项通过。dev桌面通过：十系列入口、星火同ID版本地址、协议修正保留Provider/凭据、自定义同名同址无优化、拒绝不支持的推理档、重启持久化、能力/设置隔离、失败检查不冒充成功、Harness配置快照。

用户后续边界已落地：schema18持久化model_optimization，旧配置默认保留已知适配，新UI手动模式显式关闭。匹配官方版本也不自动打开；地址/版本/开关共同约束参数、行为提示和私有续传。自定义采用所选标准协议，不提供厂商推理覆盖。仅启用适配且精确地址+版本匹配时使用专用策略。新增[百度当前版本表](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en)核验。

本轮schema17升级前备份：`/Users/solan/Library/Application Support/Fielora/backups/before-provider-optimization-18-20261002-134452/fielora.db`，SQLite backup与integrity_check通过。dev证据：`/var/folders/h5/5l63m1vd4pn0pvz88__m_87w0000gn/T/fielora-model-runtime-evidence-mKOyPG/`。旧schema17程序不能打开升级后的数据库。


### 最终交付核验（2026-10-02）

`pnpm build`成功；新包装入`apps/desktop/out/Fielora-darwin-arm64/Fielora.app`，旧开发包删除1个，out仅保留新包。打包版模型设置E2E通过，内容与dev同组且覆盖真实打包Core、保存及多次退出重启。实际日常应用已重新启动，schema18、SQLite integrity_check=ok，原Provider配置/凭据引用逐项一致，包内Core哈希与release构建一致。

完整本轮证据：`artifacts/model-services-20261002/ACCEPTANCE.json`及同目录Cross/UI/产物清理/build日志、dev与packaged截图/验收JSON。此前已记录的PreMerge Browse问题未在此改动中处理；本轮只宣称Cross、UI门禁与聚焦桌面验收通过。没有调用十家真实付费服务，没有验证Windows包，没有推送GitHub。实际“千问3.7”仍保留旧连接配置，待用户确认通用API或Coding Plan后修正；没有猜测套餐或传送已保存密钥。

最后仅统一自定义协议提示文案（兼容OpenAI/Anthropic现有选项）后重新通过typecheck和打包版E2E，最终包证据：`artifacts/model-services-20261002/packaged/`；哈希已更新到ACCEPTANCE.json。


### Coding Plan connection repair (2026-10-02)

The user confirmed Coding Plan. Production settings were corrected through the UI, preserving the same Provider ID and saved credential: OPENAI_COMPATIBLE, https://coding.dashscope.aliyuncs.com/v1, qwen3.7-plus, built-in optimization. This supersedes the earlier note that the legacy configuration was intentionally unchanged. The restarted final package displays the corrected endpoint, adaptation and saved credential; SQLite integrity_check is ok. No secret was read or printed.

Core creation/update now rejects known catalog IDs on official OpenAI/Anthropic adapters. Model text and Agent sends apply the same guard before network access. UI displays the official target, blocks invalid saving and offers the matching vendor. Tests seed a stopped, isolated historical database to verify that old records remain readable and repairable; arbitrary custom compatible IDs remain allowed.

Final evidence: artifacts/provider-connection-repair-20261002/ACCEPTANCE.json and adjacent logs/screenshots. Cross passed: 277 TS, 436 Rust with 5 ignored, 13 Core integration; UI gate 23 passed. Dev and packaged model-settings E2E passed, including IPC rejection, old-record repair, credential identity and restarts. Final presentation wording was rechecked by TS tests/lint and build typecheck. pnpm build replaced the managed macOS package, removing one old package; only the new package remains. Packaged Core matches the release hash.

Real provider/key acceptance remains NOT_RUN. Coding Plan is not used for automated API acceptance under AGENTS.md; the user should exercise an actual interactive coding task. This does not establish key validity, account quota, live network success or completion of the earlier real model task. Official endpoint/model reference: https://help.aliyun.com/zh/model-studio/coding-plan. No GitHub push or Windows package verification was performed.
