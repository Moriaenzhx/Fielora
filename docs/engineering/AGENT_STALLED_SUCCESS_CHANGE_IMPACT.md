# 成功观察停滞恢复与验收范围反馈

2026-10-09。用户授权优化；沿 Model + Harness + Capability 和现有账本实施。

用户流程：多项任务完成观察和部分检查后继续剩余工作；参数失败可定向修正；结果展示区分已执行检查与尚未绑定证据的计划项。

- work_plan 的有界 criteria 容量调整为 32，schema 与运行时共享上限。参数检查复用该工具 schema 并返回受控字段路径、类型/数量和限制，不回显任意错误值。可选计划不成为执行或授权门槛。
- 复用 WorkProgress 的真实信息增量识别同一停滞阶段。连续成功重复读取可进入一次现有 corrective review；同一证据下不反复启动，协议修正沿原来一次上限；review/计划不算业务进展。新源码、效果或不同检查结果才能再次提供恢复机会。保留12轮暂停、预算和冷恢复源码重取语义。
- CurrentWork 对未绑定逐项检查的计划项显式标为 unassessed，复盘和最终用户文本使用同一投影。它们是模型建议范围，不能变成用户强制要求、验证通过或永久完成阻塞。未记录计划仍可工作；UNKNOWN 保持 UNKNOWN。
- 不通过测试名或任意源码字符串推导 HTTP 覆盖，不声称可自动证明任意业务语义。以弱断言/真实 HTTP 反例验证工程样本的区分能力。

无 Schema/Migration、权限或第二运行系统。现有 checkpoint 增加可选停滞证据标识，旧事件缺失时保守兼容；不留存新生产源码/提示正文。用户原业务不修改，Coding Plan 不用于自动评测。

验证：真实失败顺序回归、同证据重复/冷恢复/新证据/无效复盘控制、字段诊断与10项计划、未核对项呈现；真实 Electron/Core/Python HTTP 的开发与打包专项。工程通过不替代真实模型交互验收或原任务完成。

## 2026-10-12: Browser progress identity

The original workshop finally paused at step 292 with AGENT_REPEATED_ACTIONS and stalled_turns=12. The existing safeguard works, but identical rendered states can appear new because native input coordinates and explicit settled/known flags differ between receipts. Repeated browser_verify also includes fresh snapshot arguments in its identity, and browser_plan was not excluded as intent.

Within WorkProgress, exclude native input coordinates and explicit known/settled adapter flags; preserve unknown/unsettled observations. Identify executed checks by observed targets, assertions/results and workspace revision. Resolve control refs and order-check targets to their observed element/index, without treating changed snapshot/case names or assertion ordering as progress. Browser plans remain intent. Keep actual DOM/input/hit-target changes, diagnostics, pixel changes and checks against new source versions meaningful. The original receipts, 12-turn pause threshold, host freshness policy, Assessment and completion authority remain unchanged. No schema, credential, permission or second runtime. Code-only rollback.

Three pre-fix failing tests cover transport churn, repeated checks and repeated plans. Real Electron must stop a model substitute that repeats the same passing check with fresh snapshots, while allowing the existing cross-compaction selection/save/reload case. Guidance asks the model to check its test conditions against the original requirement; no workshop-specific rule is introduced. Mechanism PASS cannot establish correct model business reasoning or original-task completion.
