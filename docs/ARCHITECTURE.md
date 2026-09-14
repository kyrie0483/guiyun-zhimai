# 代码结构与扩展边界

本目录是从完整归云中抽出的黑客松单体版。它保留“用户主动归档、来源可回跳、AI 只提草案、确认后写入”的核心，不携带 `gy-913` 的 PostgreSQL、MinIO、Better Auth 和本地 RAG 运行时，因此可直接作为一个 Node 22 容器部署。

```text
index.html / src/app.js       搜索、阅读、选区与归档页面
network.html / src/network-app.js  独立网络工作台与图谱交互
assets/styles/                当前样式与保留的界面演进稿
src/domain/                   与平台无关的归云核心
src/server/application.mjs    HTTP、安全头、路由与静态文件边界
src/server/config.mjs         环境变量和公网地址校验
src/server/zhihu-client.mjs   知乎开放平台及活动内容适配器
src/server/oauth.mjs          知乎 OAuth、state 与服务端会话
src/server/ai-client.mjs      四供应商模型网关、响应校验与实际 Token 读取
src/server/ai-quota.mjs       公网试用额度的原子预留与持久化计数
src/server/user-data-store.mjs 登录用户状态的 Redis 持久化与版本冲突保护
src/cloud-state.js            本地数据首次合并、自动同步与跨设备冲突恢复
tests/                        核心约束和平台适配器测试
```

## 必须保持的平台边界

- `src/domain/` 不读取环境变量，也不直接调用知乎 API；以后接入其他内容平台时无需改归云网络模型。
- Access Secret、App Key 和 OAuth Token 只停留在服务端。浏览器只收到归一化后的内容和随机会话 Cookie。
- 搜索、热榜、活动故事和用户创作都只是“阅读来源”；只有用户主动选择后才能创建节点。
- 四种外部模型只返回候选关系或总结草案，不能创建节点，也不能绕过确认写入。
- 用户自带 API Key 只保存在标签页会话；站点试用 Key、额度存储 Token 和 OAuth Token 均只停留在服务端。
- 新归档节点以 `integrationStatus: "new"` 进入待整合队列；只有网络页的用户操作会调用整合接口，候选关系必须至少接触一个待整合节点。
- `/` 与 `/network` 复用同一领域模型；匿名状态保存在浏览器，登录后使用 Redis 中按用户哈希隔离的状态；页面之间只通过网络、节点 ID 导航。
- 云端写入使用版本号做乐观并发控制；首次登录会按对象更新时间合并本地与云端网络、来源、高亮、回收站和对话。
- 正式多实例部署前，仍需把 `oauth.mjs` 的进程内 Session 替换为共享存储；长期运营可再迁移到完整归云的 PostgreSQL 数据模型。

## 已预留的知乎接口

| 路由 | 用途 | 鉴权 |
|---|---|---|
| `GET /api/zhihu/search` | 知乎搜索 | Access Secret |
| `GET /api/zhihu/hot` | 热榜 | Access Secret |
| `GET /api/ai/config` | 四供应商目录与当前试用状态 | 无；登录后返回个人额度 |
| `GET /api/ai/quota` | 当前登录用户的站点试用额度 | OAuth Session |
| `GET /api/user/state` | 读取当前用户的云端知识状态 | OAuth Session |
| `PUT /api/user/state` | 按版本写入当前用户的云端知识状态 | OAuth Session |
| `POST /api/zhihu/ai` | 四供应商生成待确认草案 | 自带 Key，或 OAuth Session + 站点额度 |
| `GET /api/zhihu/stories` | 黑客松故事列表 | 无 |
| `GET /api/zhihu/knowledge` | 黑客松知识列表 | 无 |
| `GET /api/zhihu/me/contents` | 当前 OAuth 用户创作摘要 | Access Secret + OAuth Token |
| `GET /api/zhihu/me/followees` | 当前 OAuth 用户关注列表 | Access Secret + OAuth Token |

活动故事与知识接口是 `zhihu_hackathon_2026_p2` 专用能力，不应作为长期通用 API 依赖。
