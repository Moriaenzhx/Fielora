# 联网搜索设置

进入 **设置 → 能力与扩展 → 联网搜索**。选择服务，填写该服务所需字段，点击“保存为默认服务”，再点击“测试搜索”。选择尚未保存时不会改变 Agent 使用的服务。测试会发送公开的 Rust 文档查询；连接成功不证明研究结论正确。

| 服务 | 配置 | 查询发送到哪里 |
| --- | --- | --- |
| Exa | 可不填 Key；也可保存自己的 Exa API Key | Exa 托管搜索服务；免 Key 入口仍受外部服务限额约束 |
| Brave Search | 必须保存独立的 Brave API Key | Brave 官方搜索 API；按你的账户额度和计费规则使用 |
| SearXNG / 自建兼容服务 | 填写搜索接口，例如 `http://127.0.0.1:8080/search` | 你指定的服务；SearXNG 通常还会向所配置的上游搜索引擎查询 |

模型服务的 Key 与搜索服务的 Key 分开。Exa 和 Brave 各自保存凭据，切换或移除其中一家不会移除另一家的 Key。界面只显示是否已保存，不回显密钥。失败时不会自动改用另一家服务；可查看原因后在设置中手动切换。更改只影响后续请求，已发出的请求仍使用原服务。

Fielora 自己实现工具调用、结果解析、网页读取和来源展示；这里的“免 Key”和“内置适配器”不表示内置全网索引。若自行开发搜索后端，可实现下面的兼容协议；实际数据可来自自建索引或合法接入的上游服务。

## 自建接口协议

支持公网 HTTPS 或明确的本机回环地址（`localhost`、`127.0.0.1`、`::1`）。当前不转发登录信息或 Key，不支持非回环局域网地址。不接受 URL 内的用户名、密码、查询参数或片段；接口不能重定向。只填写网站根地址时补为 `/search`；已有路径按完整接口使用。

请求为 `GET`，参数是 `q`、`format=json`、`categories=general`，以及可选 `language`。必须启用 SearXNG 的 JSON 输出；未启用时可能返回 403。响应为 UTF-8 JSON，`Content-Type: application/json`：

```json
{
  "results": [
    {
      "title": "来源标题",
      "url": "https://example.org/article",
      "content": "来源摘要",
      "publishedDate": "2026-10-12"
    }
  ]
}
```

`title`、`url` 必填；`content` 和 `publishedDate` 可省略。来源必须是公共 HTTP(S) URL。结果为空应返回 `{"results":[]}`；HTML 登录页、错误页或缺失 `results` 不会被当成成功的零结果。响应限 2 MiB，查询限 8 秒，最多向 Agent 返回 10 条来源。自建服务的域名筛选在返回结果上执行；不提供精确发布时间范围或国家过滤，模型工具定义会省略这些字段。不同服务的可用过滤条件各自反映在工具定义中，不静默忽略。

这个本机搜索入口不会放宽普通网页读取权限，也不提供任意内网访问。搜索结果、网页正文和模型结论仍是不同层次：对话会显示实际来源、有限摘录和是否取得正文；仅命中链接不等于已读原文。

参考官方说明：[Exa MCP](https://exa.ai/docs/get-started/exa-mcp)、[Brave 身份验证](https://api-dashboard.search.brave.com/documentation/guides/authentication)、[SearXNG Search API](https://docs.searxng.org/dev/search_api.html)。接入时核对日期：2026-10-12。
