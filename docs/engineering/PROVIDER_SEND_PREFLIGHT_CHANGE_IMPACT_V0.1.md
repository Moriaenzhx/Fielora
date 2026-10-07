# Provider send preflight — Change Impact (2026-10-04)

用户流程：本地密钥或模型配置无法使用时，保留输入草稿，不创建空会话或已发送消息；推理设置按模型实际支持的开关/强度展示。

已确认：Renderer 仅检查 credential_present，先创建 Conversation/USER message，再由 Agent start 读取密钥。历史 Keychain 元数据存在不代表能静默读取，导致 CREDENTIAL_REENTRY_REQUIRED 之前已提交消息。上一轮非交互迁移修复没有覆盖此顺序。

变更：在既有 trusted Provider IPC 增加 prepare_send(provider_config_id, model_id)，通过现有 Core、模型参数校验与 LocalCredentialStore 读取检查。仅返回 null 或稳定错误码，密钥不进入 Renderer。检查可触发既有非交互迁移，不产生模型请求或 Run。普通发送、回答问题、队列启动和重试使用同一检查；创建可见消息之前完成。实际 Agent start/resume 仍执行原有检查，preflight 不授予任何权限。

边界：无新数据库表、凭据副本、运行系统或权限裁决。检查只能证明本地配置可读，无法保证远端凭据有效、服务可用或后续执行成功；不自动付费探测、不自动重发，不删除已有历史。检查与启动之间仍可能发生外部状态变化，运行期错误沿用现有错误处理。

推理 UI：复用 Core profile.reasoning_modes 和现有 wire mapping；强度、深度思考开关、模型默认分别展示。回复 Token 上限与强度分开说明，不把 Token 预算伪装为低/中/高。

验证：trusted IPC 精确字段校验、Core 缺失凭据/协议错误/成功读取且零网络请求；真实 Electron 中失败发送不新增会话/消息/Run且草稿不变，补存后可发送；按 Qwen、DeepSeek、默认模型验证控件与请求参数；Cross 检查与 macOS 打包专项。真实付费模型及原工作室项目任务不由这些 fixture 验证替代。
