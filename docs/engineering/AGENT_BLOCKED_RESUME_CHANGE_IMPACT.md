# 受阻恢复与完成证据 — Change Impact

用户流程：用户继续受阻任务后，恢复普通工具执行；完成报告明确未做事项，并为浏览器等明确验收方式提供相符的回执。继续沿用 Model + Harness + Capability、Run events、ToolCall、CurrentWork，无新增数据库、权限或验证系统。

已确认：工作坊后续 Run 在新构建恢复时重放旧 PENDING handoff，只获得提交/继续工具；返回执行后引用恢复前 Node 检查，仍把“浏览器交互未验证”作为 completed 接受。浏览器能力已暴露，不是权限或沙箱隔离证据。

实现：BLOCKED pause 结束旧 handoff，协议修复/预算暂停仍保留合法 handoff。从既有事件派生受阻恢复边界，提交必须引用恢复后的实际观察/执行，不能仅引用旧检查、重新记录意图或计划。提交协议增加 remaining_work 与 required_evidence（来源原句、检查种类、回执 IDs）；completed 拒绝非空未做事项，检查种类必须匹配成功且适用的实际回执。提交上下文保留当前 permission 和可用工具名称。旧持久化报告仍可读；新提交使用新工具定义，缺字段只修复协议，不重做文件。

边界：这些字段是模型解释，不是用户授权或完整覆盖证明；不增加自然语言关键词裁决，不把计划提升为用户要求，不把 goal_satisfied/requirement_coverage 改为已证实。适配器、权限、凭据和命令清理规则不变。回滚恢复代码，不删除历史。

验证：先复现 blocked→冷恢复仍处于 handoff、旧 Node 回执完成、声明剩余任务仍完成等反例；检查正常协议恢复、只读回答、实际浏览器回执及新观察可以继续。运行 Core/Cross 和真实 Electron packaged 回归；模型替身与真实模型原任务分别记录，原工作坊必须实际验证排课、冲突、预算、保存恢复和导出。L4/L6 修复恢复阶段，L8 校验声明与证据，L2 保留当前能力事实；模型是否遗漏用户要求仍由真实任务验收检验。

真实任务追加发现：容量修复引入未定义 cIdx，页面只剩静态标题，browser 回执没有运行时异常。补充仅 Agent 所属页面的原生 console-message error 观察，按文档生命周期清空、去重、有界，来源 URL 不保留 query/fragment/credentials；不采集普通浏览日志，不将日志当指令或验证。沿现有 Browser receipt 传给模型，无新 bridge/权限/schema。用真实 Electron 证明加载异常、点击异常、刷新清空和页面隔离，错误文本本身不自动改变业务验证终态。

实际点击追加反例：导航后 Chromium 复位实际 viewport，而宿主仍缓存旧 emulation key，点击用了失效的缩放比例，按钮不响应但 input_state=DISPATCHED。主文档导航清除 appliedEmulation，加载完成用现有 layout 恢复 Run viewport；保留经真实 Electron 多尺寸测试验证的坐标映射。同页跳转、snapshot/hit-point/可见性与权限保持。不用回执成功替代控件状态变化。
