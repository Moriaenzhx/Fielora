# Fielora 架构图

[返回项目首页](../../README.md) · [交互版 HTML](fielora-architecture.html) · [JSON 源文件](fielora-architecture.json)

本图是当前主架构的概览，基于源码提交 `7919a64c4b6aa8409a61fcf4d39aa1b027460415`，使用 Archify 2.17 生成。节点附带该提交的源码链接。它表达 Model、Harness、Capability 与桌面 / 存储的职责关系，不是完整的进程部署图，也不表示所有能力均已成熟。

## 查看

- GitHub 首页直接展示[浅色](../media/architecture-light.png) / [深色](../media/architecture-dark.png) PNG。
- 在 HTML 文件页选择 **Download raw file**，保存后在浏览器打开，可以缩放、查看节点来源及导出图片。
- GitHub 不会直接执行仓库中的 HTML；此处没有启用 GitHub Pages 或外部托管。

## 重现

使用包含完整 `.agents/skills/archify/` 的开发分支和 Node 24.x。在仓库根目录运行：

```powershell
node .agents/skills/archify/bin/archify.mjs validate architecture docs/diagrams/fielora-architecture.json --repo-root . --quality showcase --json
node .agents/skills/archify/bin/archify.mjs deliver architecture docs/diagrams/fielora-architecture.json docs/diagrams/fielora-architecture.html --repo-root . --quality showcase --json
node .agents/skills/archify/bin/archify.mjs visual-check docs/diagrams/fielora-architecture.html --json
```

源码依据固定在 JSON 的 `meta.repository.revision`；后续更新图中的事实时，应同时更新版本与来源，再重新生成和检查。`--repo-root` 必须指向匹配仓库，远程地址应为 `Moriaenzhx/Fielora`。默认分支只收录公开图文，不因此获得开发分支中的完整 Skill 工具链。

## 本次验证

- `validate` / `deliver`：9/9 showcase 检查通过，0 错误、0 警告；8 个源码引用通过核对。
- `visual-check`：1440×900、1600×1000、1920×1080、2048×1320 均无页面横向 / 纵向溢出；明暗主题截图成功。
- 图片审阅：已检查明暗主题的文字、节点、连线、来源标记与卡片布局。
- 这证明文档图表的生成与展示，不证明 Fielora 内的真实模型已经自主完成原 Archify 任务。

脱除本机路径后的机器验证摘要与 SHA-256 见 [validation.json](validation.json)。原始自动化记录的 `visualReview: pending` 不等于未做后续图片审阅；这里把自动检查与人工可视审阅分别记录。

## 来源与许可证

- 图中 Fielora 架构内容采用项目 Apache-2.0 许可证。
- 生成器和 HTML 模板来自 [tt-a1i/archify](https://github.com/tt-a1i/archify)，保留 [MIT 许可证](ARCHIFY-LICENSE.txt)与[第三方声明](ARCHIFY-THIRD-PARTY-NOTICES.md)。
- 本图未启用第三方产品品牌标记。

首页 UI 图片来自 2026-09-29 的 Fielora 隔离桌面测试（`four-files-light.png`、`settings.png`），复制为公开文档资产，没有改写截图内容。测试项目和模型标识仍然可见；它们是交互示例，不是实际模型质量或商业使用案例。
