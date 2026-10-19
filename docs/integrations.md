# Integrations：内置与外置接入

地图交互区域连接内置功能与外置页面。Tiled `class`/`type` 由共享 `InteractionRegistry<T>` 关联语义定义；前端和服务端分别组装各自的 interaction handlers。服务端负责身份、地图位置和操作权限。所有外置页面使用 Tiled 类型 `web`，以 `resourceId` 查找 WebTool 配置；`embed` 或 `external` 决定呈现方式。

边界按业务域划分：项目内置交互负责位置、距离、角色动作、地图世界状态和项目内访问控制；协作文档、面向绘师的共同作画、同步媒体等完整业务域由独立外置服务负责。`action`、`variantSelector` 与 `privateArea` 属于地图角色和世界状态交互；衣柜复用项目原生角色外观编辑界面。Portal 继续由服务器验证并执行地图转换，留言板和番茄钟继续作为内置功能。外置服务的账号、协作状态和业务规则仍由服务自身管理。

## 内置接入

| 功能 | 地图类型 | 默认 resourceId | 数据范围 |
| --- | --- | --- | --- |
| 留言板 | `board` | `message-wall` | SQLite 按资源保存，同一进程的所有房间共享 |
| 共享番茄钟 | `pomodoro` | `focus-corner` | 每个房间按资源独立维护，不持久化 |

在 Tiled 的 `interactions` 对象层添加矩形，填写类型和需要的属性即可使用；地图制作见[地图说明](tiled.md)。两种工具都要求有效身份、当前连接且位于对应地图的对应区域，每连接操作间隔至少 500ms。身份来源见[匿名身份与权限](account-system.md)。

### 留言板

每个资源最多 100 条留言，每条 1–500 个字符。服务端生成作者、留言 ID 和时间，客户端不能指定作者身份或管理员角色。

作者可删除自己的留言；项目 `admin` 还可删除其他作者和无法关联作者的历史留言。管理员不绕过区域、身份有效性或速率限制。作者归属使用持久 user id，换设备或重新入房不改变归属。

数据库 v3 增加 `board_notes.author_user_id`。旧留言只有临时 `author_session_id`，迁移后作者 user id 保持 NULL，不按昵称自动认领，可由管理员清理。

存储实现见 [board/store.ts](../apps/backend/src/interactions/board/store.ts)，消息见 [留言板 handler](../apps/backend/src/interactions/board/handler.ts)，权限检查见 [SpaceRoom.ts](../apps/backend/src/rooms/SpaceRoom.ts)。

### 共享番茄钟

支持专注 25 分钟、休息 5 分钟，以及开始、暂停、继续和重置；完成后需手动开始下一轮。有效身份且位于对应区域的成员均可控制。计时以服务端截止时间为准，客户端结合服务端时间快照平滑显示。

计时器不跨房间共享，房间销毁或后端重启后重置。计时与权限检查由[服务端番茄钟 handler](../apps/backend/src/interactions/pomodoro/handler.ts)执行；[前端面板 handler](../apps/frontend/src/interactions/pomodoro/handler.ts)接收用户操作并显示同步状态。

## 外置接入

| 功能 | 预期服务 | 地图类型 | 默认 resourceId |
| --- | --- | --- | --- |
| 白板 | WBO | `web` | `shared-canvas` |
| 面向绘师的共同作画 | Drawpile Web 浏览器入口 | `web` | `shared-drawing` |
| YouTube/Bilibili 同步观看 | SyncTV | `web` | `lounge-screen` |
| 协作文档 | Etherpad | `web` | `shared-document` |

优先使用宿主机上的 Docker 服务。具体示例包括 WBO 白板、Drawpile Web 浏览器入口、SyncTV 和 Etherpad；这些是预期接入服务，不代表已完成对应服务的集成验收。先部署服务并确认目标浏览器可以访问，再在地图中为外置入口使用 `web` 类型，并通过 `EXTERNAL_TOOLS` 以 `resourceId` 配置 URL；配置格式和公开 API 见[入口配置](integration-plan.md)。`external` 是默认且跨浏览器环境最直接的打开路径；`embed` 是可选展示方式，是否可用取决于服务的 CSP、认证方式、浏览器策略和部署配置。进入区域只显示工具面板，点击“打开”后才按 `mode` 打开新标签页或挂载 iframe。配置可选 `manualExternalOpen`，在已打开的 embed 旁显示手动外链；旧 `fallback: "external"` 是兼容别名，没有加载失败检测或自动切换。`allowSameOrigin` 默认 false，仅供可信自托管页面按需启用。board 和 pomodoro 是项目内置交互，有独立面板 handler。

项目不启动容器、代理工具流量或签发工具凭据，也不把编辑器、正文、笔触或播放状态复制到项目中。`embed` 默认使用 `allow-scripts allow-forms allow-popups` 且不含 `allow-same-origin` 的沙盒 iframe；配置 `allowSameOrigin: true` 才增加该权限。离开区域会移除 iframe，但不会撤销工具自己的会话；项目身份和管理员角色不映射到外置服务。没有 iframe bridge、postMessage API 或服务适配层。服务的登录、权限、持久化、升级和备份由该服务及部署者负责。

白板与面向绘师的共同作画是独立功能；视频通话和屏幕共享不在范围内。

## 测试

内置工具的存储、权限、计时与浏览器面板，以及外置入口的配置校验和页面打开行为，见[测试说明](testing.md)。外置服务自身的绘画、编辑、真实双平台播放和跨设备访问需另行验收。
