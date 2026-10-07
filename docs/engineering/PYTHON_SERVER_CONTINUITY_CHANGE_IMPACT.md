# Python 开发服务与执行连续性 Change Impact

2026-10-05；对应 AE-029。用户流程：Fielora 创建 Python 网站后，托管服务、在正确地址验证、在暂停恢复后保留实际执行事实。

确认缺口：browser_server 仅接受 Node，Python 启动被参数校验拒绝；run_command 是有限作业，父进程退出会清理进程组，nohup 不能提供受管服务。压缩后的命令摘要没有参数/目标；进展指纹包含全工作区 revision，使日志变化可能把重复检查视为新证据。

修改范围：沿原 browser_server → Policy/Approval → Electron AgentBrowserHost → WorkspaceRuntime 增加 python/python3 及明确的 Python 解释器路径（含项目 venv），仍逐参数引用、不接受 shell 作为 program。执行身份、Process effect、审批矩阵、四服务限制、取消/退出清理不变；不新增 Python 安装器，不修改系统 Python/PATH，不声称具备命令沙箱。现有 Node 路径保留。

连续性：有界保留命令身份、目标参数和实际回执；摘要是历史观察，不是当前就绪、验证成功或重放授权。去掉进展比较中的无关工作区版本，实际输出/退出状态变化继续算新证据。验证指导区分测试脚本错误、HTTP状态、页面内容和业务结果；不通过扩大预算、放宽断言或默认完成来结束任务。

数据与回退：无Schema/Migration/凭据变更；不保存全量模型响应或新增原始日志。原生产Run和input不改；新解释器路径可通过移除匹配分支回退，旧历史仍可读。正常退出清理只处理本Run已持有的进程组，不按端口或进程名杀其他服务。

验证：参数注入拒绝与合法路径、真实Python服务启动/跨调用存活/HTTP访问/停止、Node回归、跨重复压缩的命令目标与结果保留、相同输出遇日志变化不算进展；开发和最终包隔离场景。原工作室应用的真实模型闭环另记，不能以替身通过替代。

桌面实测新增：macOS 原生截图含 iCCP，现有 Core 静态 PNG 准入明确拒绝它，导致页面检查全过但截图回执失败。沿可信截图生成端使用 Electron 43 的 toBitmap sRGB 像素重新创建 NativeImage 再编码；不放开 Core 对外来 PNG 元数据、尺寸、CRC、动画、尾随数据和完整解码的检查。只规范化真实截图，不处理用户原图，不修改页面。需真实 Electron/Core 截图入库与像素核对；仅重新编码仍有元数据时另行明确处理，不能吞掉准入错误。
