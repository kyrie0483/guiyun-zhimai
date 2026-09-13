# 归云·知脉

把知乎与个人阅读中的关键文段由用户手动归档为可回跳节点，再由 AI 辅助连接、总结节点和总结网络。

这个目录是从完整归云 `F:\GY\gy-913` 中抽出的黑客松交付版：保留来源锚点、多知识网络、稳定图布局、节点/关系编辑和 AI 审批约束，去掉比赛 Demo 不需要的 PostgreSQL、MinIO、邮件与本地 RAG 运行时，便于直接发布为单个 Node 22 容器。

## 已实现

- 搜索知乎、知乎热榜与明确标注的无凭证演示降级；
- 粘贴文章及导入 2 MB 内 Markdown，安全渲染并手动归档；
- 文段/整篇来源锚点、原文回跳、内容移动后的上下文恢复与快照兜底；
- 多知识网络、确定性力导向布局、曲线关系、查看/编辑/删除和级联清理；
- 阅读归档与网络工作台分为独立页面，归档后可进入对应网络，节点可返回原文位置；
- 归档阶段不调用 AI；网络页会汇总待整合的新节点，由用户一键生成关系草案并逐条确认；
- 归档节点先进入待整合队列，不自动调用 AI；网络页可一键整合全部新增节点；
- 知乎直答仅生成连接或总结草案，拒绝不写入、确认后才写入；
- 知乎 OAuth `state` 校验、服务端 Token 保管和独立用户资料页；
- OAuth 用户关注与创作信息的双凭证服务端接口，均支持分页加载；
- 黑客松故事与知识列表的无鉴权服务端接口；
- Docker、Render Blueprint、健康检查和公网回调一致性校验。

## 本地运行

要求 Node.js 22+。复制 `.env.example` 为 `.env`，然后运行：

```bash
npm start
```

开发时可使用自动重启：

```bash
npm run dev
```

没有配置知乎凭证时，搜索和 AI 会进入明确标注的演示模式；仍可完整测试人工归档、来源回跳和 AI 审批，但不能据此宣称真实接口已联调。

## 环境变量

| 变量 | 用途 |
|---|---|
| `PORT` / `HOST` | HTTP 监听端口与地址；托管平台通常自动注入端口 |
| `PUBLIC_BASE_URL` | 公网 HTTPS 根地址，用于部署与回调一致性检查 |
| `ZHIHU_ACCESS_SECRET` | 搜索、热榜、直答、额度及 OAuth 用户创作列表 |
| `ZHIHU_OAUTH_APP_ID` | 赛事项目 OAuth App ID |
| `ZHIHU_OAUTH_APP_KEY` | 仅服务端使用的 OAuth App Key |
| `ZHIHU_OAUTH_REDIRECT_URI` | 必须与赛事页面登记的公网 HTTPS 回调完全一致 |
| `NODE_ENV` | 生产设为 `production`，启用 Secure Cookie 与 HTTPS 校验 |

禁止把真实 Secret、App Key、OAuth Token 或 `.env` 写入源码、Git、日志、截图和视频。

## 验证

```bash
npm run check
```

健康检查位于 `/api/health`。它只返回能力是否配置，不返回任何凭证。

阅读归档入口位于 `/`，独立网络工作台位于 `/network`，知乎用户资料页位于 `/profile`。登录后点击右上角用户名进入资料页，可查看关注的人与创作信息并继续加载。阅读与网络页面共享当前浏览器中的本地网络数据。

## 公网发布

详细步骤见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。最短流程是：把本目录推送到代码托管平台，通过 `render.yaml` 创建服务，取得 HTTPS 域名后设置 `PUBLIC_BASE_URL`，在知乎赛事页面登记 OAuth 回调，再配置四个知乎环境变量并重新部署。

代码边界和后续迁移说明见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 当前边界

- 不自动拆文章或创建节点；
- 不运行完整归云 RAG；
- AI 不能创建节点，只能提供待确认连接与总结；
- OAuth Session 在单进程内存中，网络数据在当前浏览器 `localStorage`；
- 多实例、跨设备同步或长期运营时，应复用 `gy-913` 的 PostgreSQL、Drizzle、对象存储和用户隔离实现。
