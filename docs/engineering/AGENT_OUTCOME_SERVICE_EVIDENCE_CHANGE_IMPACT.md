# 活跃服务的完成证据判断修正 — 2026-10-06

用户在优化后的真实续跑中再次提交失败记录。生产Run seq8093–8933最终为AGENT_OUTCOME_EVIDENCE_INVALID。引用的browser_server回执实际为COMPLETED/success=true/status=RUNNING/exit_code=null；旧successful将存在的null退出码当作非零退出。修正的是成功动作识别，不能把服务存活当业务验收。

沿原finish_task裁决，只有browser_server的server-start/server-status且明确RUNNING、success=true，允许null表示尚未退出；普通命令、失败/拒绝/未知状态、非零/畸形退出码仍不通过。已有当前验证、任务义务、未知动作对账及权限规则不变。不改Schema或迁移。失败反馈列出具体引用回执的状态/退出码；缺少验证时明确直接测试入口及打印脚本限制，UI显示可理解的暂停原因。

回归先复现旧判定失败，再验证：活跃服务加当前合格页面验证可完成；只有服务和普通打印命令仍须验证；普通命令null退出、服务退出失败仍拒绝。真实Electron/Core/Python/HTTP/页面链路在开发和最终包测试；模型为隔离替身，不代表原业务已验收。只修改Fielora和隔离测试，原业务源码、数据库、CSV和Run不操作。原因、反例及剩余语义问题更新AE-029。
