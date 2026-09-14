# 公网部署

项目已提供 `Dockerfile`、`render.yaml` 和 `/api/health`，可部署到任意支持 Node 22 或 Docker、HTTPS 和 Secret 环境变量的平台。

## 上线顺序

1. 将本目录提交到 GitHub/Gitee；提交前确认 `.env` 没有进入仓库。
2. 在 Render 通过 Blueprint 导入 `render.yaml`，或在其他平台从 `Dockerfile` 构建。
3. 第一次部署先不启用 OAuth，取得平台分配的固定 HTTPS 域名。
4. 设置 `PUBLIC_BASE_URL=https://你的域名`。
5. 在知乎赛事项目页登记 `https://你的域名/api/auth/zhihu/callback`。
6. 将同一个完整地址写入 `ZHIHU_OAUTH_REDIRECT_URI`，并配置其余三个知乎 Secret 后重新部署。
7. 打开 `/api/health`，确认 `zhihuConfigured`、`oauthConfigured` 和 `deployment.redirectMatchesPublicUrl` 都为 `true`。
8. 在 Upstash 创建 Redis，向 Render 配置 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`。
9. 配置 `AI_TRIAL_PROVIDER`、`AI_TRIAL_MODEL`、`AI_TRIAL_API_KEY` 和每用户累计额度 `AI_TRIAL_TOKEN_LIMIT`；站点 Key 不得写入仓库。
10. 用无痕窗口实际完成登录、搜索、归档、站点试用、自带 Key、AI 草案、拒绝和确认写入。

`PUBLIC_BASE_URL` 与回调地址的协议、域名、端口、路径和尾部斜杠必须完全匹配。生产 OAuth 回调必须是 HTTPS。

站点试用采用登录后的知乎 UID 做不可逆哈希键，并在模型请求前原子预留 Token；成功后按供应商返回的实际用量校准。缺少 Upstash 持久化存储时，站点试用会保持关闭，避免 Render 重启后用户额度被重置。用户自带的 API Key 仅保存在当前浏览器标签页的 `sessionStorage`，经本站服务端转发到固定供应商地址，关闭标签页后自动清除。

## 当前数据边界

这是适合比赛展示的单实例版本：OAuth Session 保存在进程内，知识网络和个人 Markdown 保存在当前浏览器 `localStorage`。平台重启会要求重新登录，但不会删除该浏览器的网络数据。若后续要多实例或长期运营，应复用 `F:\GY\gy-913` 中的 PostgreSQL、Drizzle、对象存储和用户隔离实现。
