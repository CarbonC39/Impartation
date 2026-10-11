# Integration 展示配置

地图中的外置工具区域统一使用交互类型 `web`。区域的 `resourceId` 在 `EXTERNAL_TOOLS` 中查找页面配置，展示模式决定打开新标签页或嵌入页面。

## 外置入口配置

宿主机部署服务并确认浏览器可访问后，在根目录 `.env` 配置 `EXTERNAL_TOOLS`。未指定展示模式时默认使用 `external`：

```dotenv
EXTERNAL_TOOLS='{"shared-canvas":{"url":"https://board.example.com/boards/workspace"}}'
```

资源键对应地图 `resourceId`。配置项为 `{ url, mode?, fallback? }`：`url` 必填；`mode` 可为 `embed` 或 `external`，省略时默认为 `external`；`fallback` 可省略或设为 `external`。旧 `{ kind, url }` 配置不再使用；请移除 `kind`，对应 Tiled 区域使用统一的 `web` 类型。fallback 仅在 embed 模式下显示一个手动打开链接，不会检测 iframe 加载失败或自动切换展示方式。

迁移旧配置时，将地图 `media`、`whiteboard`、`drawing`、`document` 类型统一改为 `web`，保留原 `resourceId`；从 `EXTERNAL_TOOLS` 项中删除 `kind`，确保每项有 `url`。`native` mode 已移除且不再接受。

URL 必须是绝对 HTTP(S) 地址，不得嵌入用户名或密码。不要配置 token、项目 user id、role 或邀请凭据。手机的 `localhost` 指向手机自身，Docker 内部服务名也不是公开页面地址。Drawpile 应配置其浏览器 Web 客户端入口，而非 TCP 服务端口。配置变更后重启后端。

现有示例资源可在自定义地图中复用。它们不再区分工具种类；具体页面由 URL 决定：

| resourceId | 用途 |
| --- | --- |
| `shared-canvas` | 白板 |
| `shared-drawing` | 共同作画 |
| `lounge-screen` | 同步观看 |
| `shared-document` | 协作文档 |

## World API 与资源

`GET /api/world` 公开返回初始地图 ID 和 registry 地图目录。每个地图条目包含 `id`、地图 JSON `url`、`defaultSpawn` 和服务端提取的权威 `world` 语义数据。规范化 Tiled JSON 位于地图条目的 URL；明确引用的图像资源通过其相对 API 路径提供。API 不要求 session。

`GET /api/tools` 公开返回配置的 WebTool 描述（`resourceId`、`url`、可选 `mode` 和 `fallback`）。响应不得包含凭据；客户端按当前 `web` 区域的 `resourceId` 查找配置。地图与工具地址都是公开给浏览器的配置，不应放私密邀请 token。

## 展示模式与安全边界

- `embed` 将配置页面放在沙盒 iframe 容器中。sandbox 开放 `allow-scripts allow-forms allow-popups`，不开放 `allow-same-origin`，referrer policy 为 `no-referrer`。服务需要其他浏览器能力或禁止 iframe 时，应选 external；工具仍负责自身登录与权限。
- `external` 打开可访问的原生页面。
- `fallback: "external"` 在 embed 容器旁提供手动打开页面的链接。它不是 iframe 加载错误检测或自动回退。

显示入口不构成访问授权。服务器仍需校验有效身份、当前连接、玩家所在地图、真实位置和操作速率。Portal 请求也由服务器校验当前玩家位置与目标地图/出生点。项目不代理工具流量、不签发工具凭据、不传递项目身份或管理员角色；代理门禁由部署者配置。

前端交互由 `src/interactions/index.ts` 组装；`dispatcher.ts` 只负责区域、连接和清理事件，不包含留言板或番茄钟分支。`web/handler.ts` 根据 `resourceId` 获取 WebTool 并交给 `web/presentations.ts`。服务端交互在 `src/interactions/index.ts` 组装，`registry.ts` 合并消息和生命周期并拒绝重复消息名。
