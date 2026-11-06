# 参与 Fielora

欢迎帮忙修复问题、改善桌面体验、完善模型适配，或把文档写得更容易上手。

## 先运行起来

按 [README](README.md#快速开始) 安装依赖。当前开发分支是 `phase/complete-agent-v0.1`；提交改动前请确认分支，`main` 不一定包含最新功能。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Mac 细节见 [macOS 开发指南](https://github.com/Moriaenzhx/Fielora/blob/b5ac134b5fe934f1ba0c97682b9ed8dbbf358d06/docs/engineering/MACOS_DEVELOPMENT.md)。请使用隔离的测试项目和数据，不要把日常数据库、模型密钥或私人文件放进测试样例。

## 提交问题

请说明你原本想完成什么，以及实际在哪一步遇到问题，并附上：

- 操作系统、应用版本或提交号。
- 尽可能短的复现步骤。
- 预期和实际结果。
- 相关截图、错误文字或已脱敏日志。

模型相关问题也请写明服务类型和模型名称，不要粘贴 API Key。截图中请避开私人文件、账号与敏感内容。

## 修改代码

先读 [AGENTS.md](https://github.com/Moriaenzhx/Fielora/blob/b5ac134b5fe934f1ba0c97682b9ed8dbbf358d06/AGENTS.md) 中的最小当前事实和[开发工作流](https://github.com/Moriaenzhx/Fielora/blob/b5ac134b5fe934f1ba0c97682b9ed8dbbf358d06/docs/engineering/DEVELOPMENT_WORKFLOW_V0.1.md)，再查看相关代码与测试。不需要通读全部历史阶段文档。

尽量让一次改动解决一个具体问题。涉及新交互时，请说明用户如何完成操作，并在真实桌面窗口中检查。截图可以帮助解释，但不能代替行为验证。

| 改动范围 | 常用检查 |
| --- | --- |
| 文档 | `pnpm verify:dev:docs` |
| 界面 | `pnpm verify:dev:ui` |
| Rust Core | `pnpm verify:dev:core` |
| 跨层契约与集成 | `pnpm verify:dev:cross` |
| 合入 main | `pnpm verify:premerge` |

打包相关改动还需要对应的打包运行检查。数据库迁移、凭据和权限边界等修改，按开发工作流先说明影响范围。

修改上下文清单覆盖的文档后，可以运行 `node scripts/refresh-context-manifest.mjs` 更新文件摘要，再执行文档检查。先查看差异，避免把其他未完成的改动一起提交。

## Pull Request

用几句话讲清楚原来的问题、现在的行为，以及如何验证。界面修改附上真实截图；没有执行的测试直接注明原因。

请保留已有用户改动与历史记录，不提交本机数据、密钥、临时安装包或无关构建产物。模型输出和工具回执也可能包含私人内容，提交前需要检查。

贡献按项目的 [Apache-2.0 许可证](LICENSE) 提供。新增第三方代码或资源时，请保留来源与许可信息。
