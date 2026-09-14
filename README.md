# 归云·知脉

把知乎内容中的关键文段由用户手动归档为可回跳节点，再辅助连接、总结节点和总结网络。

这个目录是从完整归云 `F:\GY\gy-913` 中抽出的黑客松交付版：保留来源锚点、多知识网络、稳定图布局、节点/关系编辑和 AI 审批约束，去掉比赛 Demo 不需要的 PostgreSQL、MinIO、邮件与本地 RAG 运行时，便于直接发布为单个 Node 22 容器。

## 已实现

- 搜索知乎、知乎热榜与明确标注的无凭证演示降级；
- 在归云网络页手动选择两个节点，创建、编辑或删除带类型和说明的关系；
- 在网络页手动新建标题与说明节点，新节点进入待整合队列且不会自动调用 AI；
- 文段/整篇来源锚点、原文回跳、内容移动后的上下文恢复与快照兜底；
- 多知识网络、确定性力导向布局、曲线关系、查看/编辑/删除和级联清理；
- 阅读归档与网络工作台分为独立页面，归档后可进入对应网络，节点可返回原文位置；
- 归档阶段不调用 AI；网络页会汇总待整合的新节点，由用户一键生成关系草案并逐条确认；
- OpenAI Next、Qwen、DeepSeek、Kimi、OpenAI 五种服务仅生成连接或总结草案，拒绝不写入、确认后才写入；
- 用户可在当前标签页临时配置自己的 API Key，或登录知乎后使用按用户累计 Token 的站点试用；
- 登录用户的网络、来源、高亮、回收站和对话通过 Upstash Redis 跨设备同步，匿名用户继续保存在本地；
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

没有配置知乎凭证时，搜索会使用明确标注的活动内容降级。AI 可使用当前标签页配置的个人 Key；只有同时配置站点模型 Key、Upstash Redis 和知乎 OAuth 后，站点试用才会开放。

## 环境变量

| 变量 | 用途 |
|---|---|
| `PORT` / `HOST` | HTTP 监听端口与地址；托管平台通常自动注入端口 |
| `PUBLIC_BASE_URL` | 公网 HTTPS 根地址，用于部署与回调一致性检查 |
| `ZHIHU_ACCESS_SECRET` | 搜索、热榜、直答、额度及 OAuth 用户创作列表 |
| `ZHIHU_OAUTH_APP_ID` | 赛事项目 OAuth App ID |
| `ZHIHU_OAUTH_APP_KEY` | 仅服务端使用的 OAuth App Key |
| `ZHIHU_OAUTH_REDIRECT_URI` | 必须与赛事页面登记的公网 HTTPS 回调完全一致 |
| `AI_TRIAL_PROVIDER` / `AI_TRIAL_MODEL` | 站点试用所用的供应商和模型；OpenAI Next 使用 `openai-next` / `gpt-5.6-sol` |
| `AI_TRIAL_API_KEY` | 站点承担费用的模型 Key，只能配置在服务端 |
| `AI_TRIAL_TOKEN_LIMIT` | 每个知乎登录用户的累计试用 Token，默认 `20000` |
| `AI_MAX_OUTPUT_TOKENS` | 单次模型输出上限，默认 `2000` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 公网试用额度的持久化、原子计数存储 |
| `NODE_ENV` | 生产设为 `production`，启用 Secure Cookie 与 HTTPS 校验 |

禁止把真实 Secret、App Key、OAuth Token 或 `.env` 写入源码、Git、日志、截图和视频。

## 验证

```bash
npm run check
```

健康检查位于 `/api/health`。它只返回能力是否配置，不返回任何凭证。

阅读归档入口位于 `/`，独立网络工作台位于 `/network`，知乎用户资料页位于 `/profile`。登录后点击右上角用户名进入资料页，可查看关注的人与创作信息并继续加载。阅读与网络页面共享同一状态；登录且配置 Upstash 后会自动同步到云端。

只检查登录后资料页的前端样式时，可在本地服务启动后访问 `/profile?preview=1`。该预览只在 `localhost`、`127.0.0.1` 或 `::1` 生效，使用明确标注的模拟资料，不代表已经完成知乎登录；公网访问同一参数仍会执行正常登录校验。

## 公网发布

详细步骤见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。最短流程是：把本目录推送到代码托管平台，通过 `render.yaml` 创建服务，取得 HTTPS 域名后设置 `PUBLIC_BASE_URL`，在知乎赛事页面登记 OAuth 回调，再配置四个知乎环境变量并重新部署。

代码边界和后续迁移说明见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 当前边界

- 不自动拆文章或创建节点；
- 不运行完整归云 RAG；
- AI 不能创建节点，只能提供待确认连接与总结；
- OAuth Session 仍在单进程内存中，服务重启后用户需要重新登录；
- Upstash 适合当前黑客松规模，长期运营及复杂协作仍建议复用 `gy-913` 的 PostgreSQL、Drizzle 和对象存储实现。
