# 完整 Skill 获取与安装 — Change Impact（2026-09-24）

用户授权补齐搜索、下载与安装能力。当前流程：按名称发现来源 → 固定来源版本 → 获取完整 Skill 目录或 ZIP → 检查资源与路径 → 独立授权写入项目 → verify_skill 与必要运行检查。开发验收使用隔离桌面项目及真实公开来源；模型替身与真实模型验收分开。

采用既有 Model + Harness + Tools，不添加第二 Runtime/状态/权限。首版来源发现是明确标记的 GitHub 公共仓库搜索，不冒充通用互联网搜索。支持固定 Git commit 的 GitHub 完整 Skill 子目录和明确公共 HTTPS ZIP URL；不支持私有仓库凭据、其他压缩格式、任意 shell 下载或自动执行安装脚本。

网络与写入使用既有单 effect 分开：Network `skills.search` / `skills.prepare` 只把经过限制的完整字节存入 Harness 的既有内容检查点；WorkspaceWrite `skills.install` 只能引用同 Run 已完成 prepare 的回执，写入 `.agents/skills/<name>`。下载成功不授予写入/执行权；源内容、星数、工具返回文本不构成权限或可信认证。无需 Schema/Migration 或扩展权限枚举。

复用 web.rs 的公共 IP 检查、DNS 地址固定、逐跳重定向检查、无代理/无凭据客户端；准备下载限定 HTTPS、字节/时间/重定向上限及取消。ZIP 拒绝路径穿越、绝对路径、Windows ADS/设备名、重复/大小写冲突、链接、加密、过量文件/压缩展开大小。完整目录落盘而非将浏览器摘录当源码；固定 commit/URL/归档 SHA 与文件摘要进入原有 ToolCall receipt。

安装先在同卷暂存完整候选并检查，再用现有 bundle digest 做覆盖前置条件；旧目录保留为备份，发布异常尝试回滚。中断状态由既有未知结果恢复检查，不盲目重放，不把部分安装记成功。远端大内容不进入 Prompt；准备结果返回有界候选和覆盖范围。后续 load 刷新既有 catalog；原 verify_skill 和针对性运行检查继续控制完成。

回归：受控网络解析/跳转/限额/取消；ZIP traversal/链接/重复/炸弹与损坏；无权限或伪造/跨 Run 回执不能安装；完整目录、覆盖保护、备份与失败恢复；源内容不执行；实际安装义务与重启连续性；真实公开 Archify 包在隔离项目检查，独立包桌面专项。原生产文件保留，测试不会冒充用户目录已安装。

参考（2026-09-24）：[Agent Skills 格式](https://agentskills.io/specification)、[GitHub 仓库 ZIP](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip)、[OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)、[OWASP 文件处理](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)。采用相关工程原则，不宣称认证。

实现调整：真实整仓 ZIP 探测遇到超时，GitHub 元数据 size=335121 KiB（不是当前 ZIP 大小）；固定提交树证明 archify/ 有 219 个普通文件、8,339,247 字节。GitHub 模式因此读取未截断树并只获取所选完整目录，raw 文件按固定 commit URL、清单大小和本地 SHA-256 留证；多个入口返回候选，由模型选择后再次准备。完整源文件清单存内容检查点，不塞入 Prompt。4 路有界并发、单 GET 有限重试、资源批次总时限、无脚本执行。DNS 每次重新验证，连接只在当次已验证公共地址中切换，最多 8 个；32 个主机的成功地址偏好只是性能缓存，旧地址不在新 DNS 中即不可使用。

失败恢复范围明确：一般发布错误尝试恢复旧目录；进程死亡或恢复失败保留 lock、journal 与备份，并由已有 UNKNOWN → MANUAL_REVIEW 流程阻止重放，不承诺崩溃期间两次 rename 的原子性或无人值守自动恢复。未新增后台更新器或 Skill 市场。

真实网络后续修正：raw 获取失败可使用同一 Git blob 的 GitHub 官方 raw API，仍是既有无凭据公共 IP/HTTPS 边界。已完成资源放入原有内容检查点，并以仓库/commit/路径/Git blob/大小构成隔离缓存键；缓存重用要检查 SHA-256 和长度。此缓存可丢弃、不授予安装权；安装仍必须有本 Run 完整准备回执。不完整 HTTP GET 是下载失败，不是工作区副作用 UNKNOWN。重试同提交仅补缺失资源。

最终边界：取消信号透传 Cancelled，不包装为普通下载错误；自动重定向可能携带短期签名查询，准备回执只保留 URL 的稳定 origin/path 和内容 hash，不持久附带这些查询参数。对应定向测试通过。
