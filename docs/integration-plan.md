# Integration 展示配置

地图中的外置工具区域统一使用交互类型 `web`。区域的 `resourceId` 在 `EXTERNAL_TOOLS` 中查找页面配置。进入区域只在区域上方显示小提示；用户点击提示后，展示模式才决定打开新标签页，或在居中、可拖动的电视框窗口中挂载 iframe。

项目原生交互负责地图位置、距离、角色动作、地图世界状态和项目内访问控制；完整业务域由外置服务负责，包括协作文档、面向绘师的共同作画和同步媒体。WBO、Drawpile Web 浏览器入口、SyncTV 和 Etherpad 是预期服务示例，不表示项目已完成这些服务的端到端验收。`external` 默认以新标签页打开，是面向不同浏览器和部署环境的通用访问路径；`embed` 可按需启用，但可用性受服务 CSP、认证、浏览器策略和部署设置影响。Portal 仍由服务端负责转换，留言板和番茄钟保持内置。地图角色动作、`variantSelector`、`privateArea` 和原生衣柜界面属于项目地图交互范围，不承接外置服务的业务状态。

## 外置入口配置

宿主机部署服务并确认目标用户的浏览器可访问后，在根目录 `.env` 配置 `EXTERNAL_TOOLS`。未指定展示模式时默认使用 `external`：

```dotenv
EXTERNAL_TOOLS='{"shared-canvas":{"url":"https://board.example.com/boards/workspace"}}'
```

资源键对应地图 `resourceId`。配置项为 `{ url, mode?, manualExternalOpen?, allowSameOrigin? }`：`url` 必填；`mode` 可为 `embed` 或 `external`，省略时默认为 `external`；两个布尔选项默认均为 `false`。`manualExternalOpen: true` 仅在点击打开 embed 后，于 iframe 旁提供一个手动外链。旧 `fallback: "external"` 仍作为该选项的兼容写法接受，但推荐改用 `manualExternalOpen`；显式的 `manualExternalOpen: false` 优先于旧字段。两者都不检测加载失败或自动切换。旧 `{ kind, url }` 配置不再使用；请移除 `kind`，对应 Tiled 区域使用统一的 `web` 类型。

`external` 是无需依赖 iframe 兼容性的通用访问路径。只有在目标服务允许嵌入且认证方式适用时才配置 `embed`；请在实际部署和目标浏览器中核验 CSP、登录和交互行为。仓库现有配置/入口检查不等同于对外部服务端到端可用性的验收。

例如，可信的自托管页面需要同源能力时可以配置：

```dotenv
EXTERNAL_TOOLS='{"shared-document":{"url":"https://docs.example.com/p/workspace","mode":"embed","manualExternalOpen":true,"allowSameOrigin":true}}'
```

迁移旧配置时，将地图 `media`、`whiteboard`、`drawing`、`document` 类型统一改为 `web`，保留原 `resourceId`；从 `EXTERNAL_TOOLS` 项中删除 `kind`，确保每项有 `url`。`native` mode 已移除且不再接受。

URL 必须是绝对 HTTP(S) 地址，不得嵌入用户名或密码。不要配置 token、项目 user id、role 或邀请凭据。手机的 `localhost` 指向手机自身，Docker 内部服务名也不是公开页面地址。Drawpile 应配置其浏览器 Web 客户端入口，而非 TCP 服务端口。配置变更后重启后端。

### WBO 白板示例

仓库的 [Compose 部署示例](hosting.md#compose-站点示例)以注释提供 WBO 服务和 Caddy `/board/` 路由，需由托管者启用。启用后可把 `shared-canvas` 配到 `https://<VW_HOST>/board/boards/workspace`。WBO 自行保存白板数据；未另外配置 WBO 访问控制时，知道地址的人可能访问白板。正式部署时由托管者配置所需的代理门禁。

现有示例资源可在自定义地图中复用。下列服务是预期接入示例；名称只说明用途，前端不包含服务适配代码，具体页面由 URL 决定。它们的外部协作能力及浏览器可用性需由部署者按目标环境验收：

| resourceId | 预期服务 | 用途 |
| --- | --- | --- |
| `shared-canvas` | WBO | 白板 |
| `shared-drawing` | Drawpile Web 浏览器入口 | 面向绘师的共同作画 |
| `lounge-screen` | SyncTV | YouTube/Bilibili 同步观看 |
| `shared-document` | Etherpad | 协作文档 |

## World API 与资源

`GET /api/world` 公开返回 `{ maps, spaces }`。`spaces` 按 registry 顺序列出 Space 元数据及各自的初始地图和成员地图；Portal 只能在所选 Space 内转换地图。每个地图条目包含 `id`、地图 JSON `url`、`defaultSpawn` 和服务端提取的权威 `world` 语义数据。规范化 Tiled JSON 位于地图条目的 URL；明确引用的图像资源通过其相对 API 路径提供。API 不要求 session。

`GET /api/tools` 公开返回配置的 WebTool 描述（`resourceId`、`url` 及可选展示选项）。响应不得包含凭据；客户端按当前 `web` 区域的 `resourceId` 查找配置。地图与工具地址都是公开给浏览器的配置，不应放私密邀请 token。

## 展示模式与安全边界

- `external`：用户点击“打开”后，在新标签页打开配置 URL，使用 `noopener noreferrer`。
- `embed`：用户点击“打开”后才挂载沙盒 iframe；离开区域或连接断开时移除。sandbox 默认开放 `allow-scripts allow-forms allow-popups`，referrer policy 为 `no-referrer`。
- `manualExternalOpen: true`：仅对 embed 显示额外的手动外链；它不是 iframe 加载错误检测或自动回退。旧 `fallback: "external"` 是兼容别名。
- `allowSameOrigin: true`：仅对 embed 额外开放 `allow-same-origin`。默认不开放。只为可信的自托管页面启用；若工具与宿主同源，同时允许脚本和同源会显著削弱 iframe 沙盒隔离。无法嵌入的服务应使用 external。

显示入口不构成访问授权。项目的区域状态来自服务端权威位置，但工具 URL 是公开配置，点击打开不会向项目服务端申请跨服务权限。外置工具自己管理身份、session、权限和状态；项目不代理工具流量、不签发工具凭据、不传递项目身份或管理员角色，也没有 iframe bridge、postMessage API 或服务适配层。代理门禁由部署者配置。Portal 等项目内请求仍由服务器验证身份和位置。

前端交互由 `src/interactions/index.ts` 组装；`dispatcher.ts` 只负责区域、连接和清理事件，不包含留言板或番茄钟分支。`web/handler.ts` 根据 `resourceId` 获取 WebTool 并交给 `web/presentations.ts`。服务端交互在 `src/interactions/index.ts` 组装，`registry.ts` 合并消息和生命周期并拒绝重复消息名。
