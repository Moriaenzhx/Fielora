# 本地凭据与 Agent 启动修复 Change Impact

2026-10-03；用户明确要求 API Key 直接存数据库，测试连接与任务复用，取消每次系统密码提示。该决定覆盖历史系统凭据库限定，不需要再次审批。

流程：保存模型 Key → 重启 → 测试连接/启动与恢复 Agent，均通过原 CredentialStore 接口读取同一份本地 SQLite 数据。StorageWorker 保持唯一写入者；新增 migration 0019，不修改旧迁移。Key 不返回 Renderer、日志、Agent 事件、同步或可移植导出；本机数据库及本机备份包含凭据，采用当前用户文件访问权限，不宣称数据库加密。系统凭据只作兼容来源：禁止交互式读取，成功后写入 SQLite；无法静默读取时提示重新保存 Key。删除/覆盖留下本地决策，避免旧钥匙串值复活。保留旧系统条目，不触发删除授权弹窗。

故障链：生产 Run 01a1023d-76ae-7fb2-bd86-321796cd3369 的启动之前同步调用钥匙串读取；Electron FIPC 默认10秒超时不取消 Core 中的调用。截图证明弹窗与启动超时，账本证明请求随后创建并运行5轮，终态 PAUSED/AGENT_USER_INPUT_REQUIRED。未取得按请求记录的密码等待时长，不宣称精确耗时。项目绑定空目录 /Users/solan/Downloads/测试，list_files('.') 成功返回0项、list_files('input') 缺失；另一次 record_request_intent 因弯/直引号差异被拒。构建指纹343e5e6b…，模型qwen3.7-plus。

改动：本地凭据消除系统对话框阻塞源；引用校验只容忍等价引号并保存原始原文，绝不移除否定或授权边界。超时作为状态未知处理并核对实际 Run，不把失去回执等同执行失败或自动重发。

验证：新/旧schema升级、保存覆盖删除/重启、拒绝旧key复活、导出物无凭据、敏感值不进入公开DTO/事件；真实Core与打包Electron的保存→连接测试→重启→任务链使用隔离合成Key和模型替身。真实付费模型原项目验收单独报告；不因工程通过宣称原项目完成。历史证据与用户任务不重写；测试材料不足不通过虚构数据掩盖。

结果：Cross、开发及最终macOS ARM64包专项均PASS，原生Keychain兼容读取与SQLite重启复用分别验证；无真实外部模型请求。交付、指纹与验证边界见 [DELIVERY](../../artifacts/local-credentials-fonts-20261003/DELIVERY.md)。生产旧Key迁移和原始工作室任务仍未验收。
