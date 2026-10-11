# Integration 展示配置

Integration 由地图中的交互区域触发。交互类型与展示模式分开：Tiled `class`/`type` 选择注册的 integration，presentation mode 决定前端如何呈现。

## 外置入口配置

宿主机部署服务并确认浏览器可访问后，在根目录 `.env` 配置 `EXTERNAL_TOOLS`。旧格式继续有效，默认使用 `external`：

```dotenv
EXTERNAL_TOOLS='{"shared-canvas":{"kind":"whiteboard","url":"https://board.example.com/boards/workspace"}}'
```

资源键对应地图 `resourceId`。配置项包含 `kind`，并可选 `mode`、`url` 和 `fallback`。mode 仅为 `native`、`embed` 或 `external`；旧 `{ kind, url }` 格式未指定 mode 时按 `external` 处理。`embed` 和 `external` 必须提供 `url`；`native` 不需要 URL。若 native kind 没有已注册 handler，可设置 `fallback: "external"`，此时必须提供 `url`。

URL 必须是绝对 HTTP(S) 地址，不得嵌入用户名或密码。不要配置 token、项目 user id、role 或邀请凭据。手机的 `localhost` 指向手机自身，Docker 内部服务名也不是公开页面地址。Drawpile 应配置其浏览器 Web 客户端入口，而非 TCP 服务端口。配置变更后重启后端。

现有示例资源可在自定义地图中复用：

| resourceId | kind | 功能 |
| --- | --- | --- |
| `shared-canvas` | `whiteboard` | 白板 |
| `shared-drawing` | `drawing` | 共同作画 |
| `lounge-screen` | `media` | 同步观看 |
| `shared-document` | `document` | 协作文档 |

## World API 与资源

`GET /api/world` 公开返回初始地图 ID 和 registry 地图目录。每个地图条目包含 `id`、地图 JSON `url`、`defaultSpawn` 和服务端提取的权威 `world` 语义数据。规范化 Tiled JSON 位于地图条目的 URL；明确引用的图像资源通过其相对 API 路径提供。API 不要求 session。

`GET /api/tools` 公开返回配置的 presentation 描述。响应不得包含凭据；客户端按当前交互的 `kind`/`resourceId` 和 mode 展示入口。地图与工具地址都是公开给浏览器的配置，不应放私密邀请 token。

## 展示模式与安全边界

- `native` 按 integration kind 查找 handler。通过 `PresentationRegistry.registerNative(kind, handler)` 显式注册；board/pomodoro 现有面板 handler 属于 native。外置 integration 设置 native 不会自动提供 UI。可将自定义 registry 传给 `createInteractions(room, presentations)`。
- `embed` 将配置页面放在沙盒 iframe 容器中。sandbox 开放 `allow-scripts allow-forms allow-popups`，不开放 `allow-same-origin`，referrer policy 为 `no-referrer`。服务需要其他浏览器能力或禁止 iframe 时，应选 external；工具仍负责自身登录与权限。
- `external` 打开可访问的原生页面。
- `fallback: "external"` 可用于 native handler 缺失时打开 `url`；该 fallback 要求 URL。

显示入口不构成访问授权。服务器仍需校验有效身份、当前连接、玩家所在地图、真实位置和操作速率。Portal 请求也由服务器校验当前玩家位置与目标地图/出生点。项目不代理工具流量、不签发工具凭据、不传递项目身份或管理员角色；代理门禁由部署者配置。

交互 handler 的接入点为 `features.ts` 的 composition root；通用 `InteractionDispatcher` 只负责区域、连接和清理事件，不包含留言板或番茄钟分支。服务端 integration 在 `integrations/index.ts` 注册，消息和生命周期由 `registerServerInteractions` 合成，并拒绝重复消息名。
