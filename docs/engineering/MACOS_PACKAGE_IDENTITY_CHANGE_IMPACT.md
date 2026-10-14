# macOS 本地包签名与身份修复

2026-10-13；用户授权修复。当前为实现与实机验证阶段。

- 用户流程：从正常 Fielora 应用启动，已授权的用户通过既有 computer 能力完成桌面操作。验证必须区分包签名完整、真实系统权限、真实输入结果。
- 已确认缺陷：最终包没有配置签名，主程序仍带 Electron linker ad-hoc 签名；`codesign --verify` 失败，Info.plist 和资源未封印。正常 Core 调用的 TCC subject 为主程序路径；主应用其他请求为 bundle ID。身份差异与权限 false 已确认，签名是否为唯一原因待对照。
- 修改范围：沿 Forge/Packager 对最终 macOS bundle 及内部 Mach-O 从内到外签名；本地开发使用明确的 ad-hoc 签名，不查找或创建证书。失败必须使打包失败，最终身份/完整性检查通过后才允许既有包提升流程。Windows 不变，无 schema、第二 Runtime、控制工具或权限所有者。
- 安全边界：保留当前本地开发的非 Hardened Runtime 基线，不新增 entitlement、自定义宽松 designated requirement、私有 Apple entitlement、TCC 修改、系统开关或 Gatekeeper 绕过。不自动取得 Accessibility。ad-hoc 不是开发者分发签名/公证，后续构建可能需要再次人工授权；不能许诺跨版本信任稳定。
- 验证：独立输出目录 fresh package；严格递归签名、主应用 identifier/Info.plist/资源检查及 Core 单独验证；篡改包副本必须拒绝；真实打包桌面启动及 Core/FIPC/浏览器流程；正常启动身份与一次 computer.status；权限实际具备时再做合成窗口真实输入保存。隔离测试继承启动者权限不能替代正常生产启动。
- 回滚：只更新校验后的包，保留前一包及诊断证据；不改用户数据库和测试项目。系统权限若仍不匹配，保留原始回执并在具体操作前让用户确认，不反复让模型重试。

参考：[Electron Forge signing](https://www.electronforge.io/guides/code-signing/code-signing-macos)、[Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)。本机锁定 @electron/osx-sign 1.0.5、Packager 18.3.5；Packager 默认 continueOnError=true，需要显式改为 false。

验收更新：UI Lane 361 项与 Docs PASS；真实签名篡改/错误身份拒绝、独立包网页下载/冷恢复和原生中文 emoji 保存（79 字节，13 工具，暂停旧快照拒绝）PASS。最终包 282 个文件/链接与专项测试包逐项相同，已正常更新 canonical。生产 Qwen 只读 Run 01a135f7-f820-7771-925c-b6ddbac30fe2 单次 status 后 COMPLETED；TCC subject 已从主程序路径变为 com.fielora.desktop，证明身份归属修复生效，但 Accessibility/PostEvent 仍 REQUIRED。系统设置仍显示 ON，重新登记该应用授权须用户确认；未改开关、未做生产输入、未宣称原长任务完成。无完整 PreMerge 重跑，既有 Browse 关页问题不在本次修复范围。证据 artifacts/macos-package-identity-20261013/。
