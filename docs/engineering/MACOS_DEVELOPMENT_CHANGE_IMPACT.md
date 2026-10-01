# macOS 开发基线 Change Impact

2026-10-02，用户授权补齐 Mac 开发准备项。基于 `phase/complete-agent-v0.1@bc16374`，保留既有 Windows 实现与数据。

- 用户流程：在 Mac 配置模型凭据、打开项目、执行/取消命令、验证修改、重启恢复，并打包本机应用。
- 凭据仍由既有 `CredentialStore` 控制；macOS 使用系统 Keychain，Windows 保持 Credential Manager。Provider/static target 与 2048-byte 限制不变，无明文文件兜底；查询静态凭据是否存在只查元数据。错误日志不含 secret，不把 key 放进命令行参数。
- 进程管理属于平台/Capability 后端，落实 Harness L5 的取消请求；macOS 使用应用创建的独立进程组，只终止该组。它不是 OS sandbox，不放宽 L7 权限、路径或凭据准入，不改变 L6 UNKNOWN/recovery 与 L8 verification。
- 数据继续使用当前 macOS application-support 路径；不迁移 Windows 数据，不新增 schema、permission 或 runtime。已有本机 profile 备份保留。
- Git 使用本仓库署名与标准 GitHub 登录；提交本地适配，远程发布独立于开发验证。
- 验证：真实 Keychain 合成凭据创建/更新/读取/删除、真实子进程树退出；TypeScript/Rust/契约/Core integration；隔离的 dev/packaged Electron 项目/会话、凭据、终端与重启流程。测试替身通过不代表真实模型质量；发布签名/公证需用户的 Apple 身份，不伪造。
- 回滚：源码可按独立提交回退；Keychain 测试条目按唯一 target 清理。新版数据库不交给旧 binary，必要时恢复保留的 profile 备份。
