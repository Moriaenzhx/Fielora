# 国产模型编码能力：OpenCode 对照协议

日期：2026-10-11。状态：源码审计及四组交互任务已准备；真实 OpenCode/Fielora 对比 NOT_RUN。用户目标是现阶段达到 OpenCode 编码能力，并在明确能力上超过它，不将功能表数量当能力。

Fielora现已有编码循环候选：共用最终请求预算、按需工具、观察版本绑定编辑、无强制复盘。工程与最终包证据见artifacts/agent-coding-loop-20261010/DELIVERY.md；后续交互对比须使用该次实跑指纹，不能沿用上一失败版指纹。没有新增真实模型调用，也没有对照成绩。

## 比较条件

- OpenCode v1.18.35 / `53d1eabb61e21162157817bf677da0a4ad3332e3`；Fielora 必须记录实跑构建指纹，不使用起始 Run 的旧指纹。
- 同一模型精确 ID、服务商和端点类型、推理设置、输出上限、任务说明、源码/依赖、机器、权限范围、时间额度。先以当前 Qwen3.7-plus 作为首轮；结果只适用于实测配置，不泛化为所有国产模型。
- 第一组采用匹配参数辨别 Harness 差异；若另测两边各自推荐默认配置，独立报告，不能混算。
- 每次用新隔离副本与新会话；另测同任务暂停/冷恢复。每组交替两边先后顺序，保留所有失败和中止，不挑最好的一次。
- Coding Plan 只允许用户交互式编码验收，不运行自动模型评测或自动重试批次。只有用户另行选择合规自动评测配置后，才按其授权安排自动运行。离线准备、外部评分和机制回归不调用模型。
- 不复制凭据，不让 Agent 修改外部评分器，不把答案/隐藏断言注入模型上下文。模型自己的测试通过只是证据之一。

## 本轮已具备的材料

复用 `scripts/agent-convergence-case.py`，未另造测试框架。项目位于本机 ignored artifact：

`artifacts/agent-opencode-baseline-20261010/interactive/{fielora,opencode}/{repair,regression_only}`

两边每组文件哈希完全一致，记录在 interactive-manifest.json。读取对应 REQUEST.txt 作为唯一初始任务；regression_only 明确保护已经正确的 ledger.py。评分从项目外运行：

```sh
python3 scripts/agent-convergence-case.py verify <本次项目目录>
python3 scripts/agent-convergence-case.py verify-tests <本次项目目录>
```

第一个检查实际行为，第二个检查提交的测试能否发现指定故障。还须比较 input.csv 哈希、审阅改动范围与最终声明；regression_only 的 ledger.py 哈希应保持。已完成的是 oracle 自检与样本准备，两个引擎真实结果均 NOT_RUN。

## 完整代表集

两组小样本用于早期排错，不足以宣称达到 OpenCode。完整验收固定八类任务及评分，再开始比较：单文件错误修复、跨文件功能、两个大文件的诊断/修改、正确实现补回归、HTTP 错误路径与数据保护、突变检测器防误报、冷恢复继续、用户中途更正。至少包含 Python 与 TypeScript 项目。复用现有 golden/CN 资产，但没有可执行项目与独立断言的文字清单不计完成用例。

突变检测器防误报任务已补齐，入口复用 `scripts/agent-convergence-case.py` 的 `--case detector`。它包含实际检测器错误和不调用检测器的弱测试；外部评分直接调用候选函数，并把候选函数分别改成始终接受、始终拒绝、忽略退出码、忽略运行错误和子串匹配，验证提交的测试会因真实断言失败而变红。运行错误不算检出。跨文件功能样本见下文，余下四类实体样本/独立断言尚未建齐；必须诚实保留此缺口。首轮固定模型每类 3 次，共 24 个配对观察；这只是本地产品门槛，样本规模不足以支持一般统计优越性宣传。其他模型单独记录。

```sh
python3 scripts/agent-convergence-case.py self-test --case detector
python3 scripts/agent-convergence-case.py prepare <全新项目目录> --case detector
python3 scripts/agent-convergence-case.py verify <交互完成后的项目目录> --case detector
python3 scripts/agent-convergence-case.py verify-tests <交互完成后的项目目录> --case detector
```

当前两边的检测器样本位于本机 `artifacts/agent-detector-upgrade-20261011/interactive/{fielora,opencode}`，文件哈希相同。仅交付 REQUEST.txt 和项目文件，评分器留在项目外；不把外部参考实现加入模型上下文。离线自检纳入 `pnpm test:eval:china-model`，不产生真实模型成绩。

## 跨文件功能样本

跨文件功能新增 `--case task-export`：标准库 Python CLI 任务列表，原始需求为状态/负责人组合筛选、排序、CSV 导出、错误输出与只读数据保护。只交付未实现新功能的七个项目文件；初始两个测试通过不代表新功能完成。项目外验收固定十二组行为，使用不同于种子的输入数据，在临时副本中调用实际 CLI。自检接受参考实现，并以断言失败拒绝漏筛选、错序、OR 代替 AND、导出忽略筛选、缺表头、错误退出码和改写输入七种缺陷；运行错误不算检出。

本机 Fielora 项目为 `/Users/solan/Downloads/Fielora验收-任务筛选导出`，OpenCode 同哈希种子和 manifest 在 `artifacts/agent-task-export-20261011/`。此前用户在其他项目新建检测器的运行不是匹配起点对照；新样本必须新建对应 Project/Conversation，仅发送原始 REQUEST.txt，不附参考实现或技术修法。评分规则在交互前固定，真实两边均 NOT_RUN。

```sh
python3 scripts/agent-convergence-case.py self-test --case task-export
python3 scripts/agent-convergence-case.py prepare <全新项目目录> --case task-export
python3 scripts/agent-convergence-case.py verify <交互完成后的项目目录> --case task-export
python3 scripts/agent-convergence-case.py verify-tests <交互完成后的项目目录> --case task-export
```

此样本的 `verify-tests` 仅在副本执行提交的 unittest，不声称证明测试区分能力；独立行为判定来自 `verify`。测试是否实际调用业务与 CLI、范围保护及报告准确性仍需审阅。上述评分器均不是生产 Run 的语义认证来源。

2026-10-11 实际进展：Fielora task-export-v1 原始需求交互一次完成，15模型轮、365秒，固定12组外部行为和提交26项测试通过，保护文件哈希保持。存在一次编辑版本前置拒绝和两次无效完成引用，自行恢复，无暂停/压缩。OpenCode配对种子尚未执行，不能算比较胜出；详见本机 artifacts/agent-task-export-real-acceptance-20261011/REVIEW.md。初始 manifest 保留 PREPARED_NOT_RUN 历史事实，成绩另存，不覆盖开跑前记录。

## 每次记录

- 正确完成：外部行为断言、测试区分能力（要求时）、范围/数据保护、报告准确性共同判断。
- 用时：总耗时、模型/工具耗时；失败/超时单列，不能从耗时统计消失。比较共同成功任务耗时并同时给完成率。
- Token：使用 Provider 实际 usage；缺失时写 UNKNOWN，不以字符估算冒充账单。记录辅助摘要/复盘等全部调用。
- 操作：读取/写入/执行次数、参数拒绝、压缩、纯复盘回合、无新信息的重复尝试、首次有效改动前调用数。
- 人工：完成前必须给出多少次技术提示、纠正或“继续”；权限确认单列，不算模型不会做。
- 恢复：是否保留已完成效果/当前错误；是否重放未知副作用；恢复到有效动作所需回合。
- 安全与真实性：数据越界、并发改动被覆盖、未知操作被算成功、未验证结果被宣称全部通过，分别记录。

## 判定

这些是预先规定的工程门槛，不是已经获得的成绩：

1. 原用户反复失败的修复/验收任务在隔离副本连续 3 次正确完成，不能靠人逐行指导；冷恢复、范围保护和准确报告同时成立。
2. 八类任务当前模型至少 20/24 正确完成，且不低于匹配配置的 OpenCode 完成数；安全/数据丢失及虚假完成为 0。20/24 是当前最低实用性目标，不是成功率置信下界。
3. 共同成功任务的中位耗时/Token 不超过 OpenCode 的 1.2 倍；小样本和服务端波动明确报告，不把任何一次快慢当机制结论。
4. 要声称“超过”，还须在预先选定的人工技术干预次数或无收益调用指标上降低至少 20%，并保持前述正确性门槛；OpenCode 指标为 0 时不得伪造比例改善，结果最多为持平。冷恢复/结果审阅等桌面优势另行验证，不能掩盖编码完成率低。
5. 机制单测、模拟模型、真实宿主、真实模型和原任务结果分栏报告。外部条件未满足时保留 NOT_RUN，而不是把工程 PASS 转成用户目标 PASS。

## 实现消融

当前 Fielora 是对照。候选按上下文预算、工具契约简化、去掉一般错误的强制复盘分别变化，再测组合；使用同一 Executor、Policy、Storage 和完成检查。不能创建第二内核、关掉安全门槛或只放大预算取得表面改善。没有真实比较之前，“提示太长是唯一根因”“国产模型能力不足”“比 OpenCode 更好”都不是结论。
