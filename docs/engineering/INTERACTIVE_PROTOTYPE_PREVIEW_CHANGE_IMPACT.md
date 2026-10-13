# 可交互原型预览：Change Impact

日期：2026-10-12。用户流程：在对话中请求原型，Agent 用既有受控写入生成独立 HTML，最终结果引用打开交互预览；继续提出修改后生成新的文件版本和引用。

- **范围**：复用 `PROJECT_FILE` 结果引用、项目文件、Conversation、Skill 目录与 Model + Harness + Capability。新增桌面只读预览桥和临时 HTML 响应注册表；不新增 Agent 工具、数据库、Migration、Runtime 或完成权威。Model 生成设计和代码，内置 Skill 提供创作指导，Harness 继续治理写入、验证和结果引用。
- **边界**：仅已解析、带 SHA-256 的 `.html/.htm` 项目文件可预览；Main 复用项目根/路径检查，读取完整文件并核对版本，最大 256 KiB。注册表有界、只存临时不可变副本，不映射目录、不接受任意 URL 或网页回传命令；关闭释放，重启从原文件重新读取。旧引用内容变动时明确拒绝。
- **隔离**：独立 `fielora-prototype:` 协议，嵌入 iframe 与响应头均使用 sandbox（仅 allow-scripts）；不允许 same-origin、Node、应用桥、存储、弹窗、下载、表单提交或任意父页面操作。响应 CSP 仅准入内联脚本/样式和 data 图片/字体，禁止外部依赖、fetch、子框架和对象；Main 额外拒绝进入外部/应用/本地文件文档，保留可信主框架 IPC 校验。`about:blank` 与 `document.open/write` 可建立受限本地空文档，但原生 policy container、opaque sandbox 与禁网规则继承，不能逃逸；实际操作负例验证这条边界，不把空文档一概当成权限逃逸。trusted app 的 script-src 不放宽，只增加精确预览 frame-src。普通 Markdown、代码块和流式片段不会执行。
- **原生联网补充**：真实 dev 和同 Electron 43.4.0 / Chromium 150 二进制对照已证实，sandbox、CSP 和 session 拒权仍允许 WebRTC STUN 发出 UDP。仅预览响应设置 `Connection-Allowlist: ()`，启动时保留已有 flags 并启用 `OverrideConnectionAllowlistOriginTrial`，由 Chromium 在构造 RTCPeerConnection 前原生拒绝。此 header 仍是实验能力；feature 开关全进程启用解析/执行支持，空 allowlist 只作用于预览文档，不全局禁止普通 Browse WebRTC。同二进制 header-only 仍有 UDP、flag-only 普通文档仍有 UDP、flag+header 返回 NotAllowedError 且零 UDP；Electron 升级必须重跑实际构造器和 UDP 负例。
- **版本事实**：最终文件引用与 Storage 准入同步识别成功内置文件工具的实际回执，包含 `PATCH_SET_APPLIED.patches[]` 的逐文件新 hash 和移动目标；不从参数、失败/无变化操作或其他 Run 推造版本。删除/移走源不能回退到此前读取。原有结果引用 schema 不变，补齐既有批量修改后的保存链路。
- **兼容/回滚**：原文件打开、编辑、引用持久化和 Agent 检查语义不变；旧无 hash 引用继续作为文件链接。可移除预览 UI/桥/协议，原文件和对话继续可读。代码更新需重启桌面宿主。
- **验证**：Cross；真实 Electron dev/packaged 原型输入、按钮/状态切换、源码、重载/重启恢复与版本冲突；负例覆盖路径越界/符号链接、无效 hash/扩展名/大小、过期句柄、应用桥/父 DOM/存储/联网/导航/弹窗/下载。机制、宿主、真实模型和原用户任务分别报告。测试通过不自动证明模型设计质量或原型业务完整性。
- **限制**：首版自包含前端原型；不接 CDN、相邻文件、真实 API 或持久用户数据；预览交互状态重载后重置，源码保存在项目。未引入每原型 CPU/内存配额，文件大小/注册表数量限制不等于运行时资源配额。需要服务端/多文件应用时继续用既有项目和 Browser 工作流。本轮不实现 DXE 或模型生成 Fielora 自身 UI。

隔离实现参考：[Electron frame navigation](https://www.electronjs.org/docs/latest/api/web-contents#event-will-frame-navigate)、[Protocol](https://www.electronjs.org/docs/latest/api/protocol)、[Chromium 150 原生 WebRTC 构造器](https://chromium.googlesource.com/chromium/src/+/150.0.7871.224/third_party/blink/renderer/modules/peerconnection/rtc_peer_connection.cc)、[对应原生开关](https://chromium.googlesource.com/chromium/src/+/150.0.7871.224/third_party/blink/renderer/platform/runtime_enabled_features.json5)、[Connection Allowlist 提案](https://wicg.github.io/connection-allowlists/)。
