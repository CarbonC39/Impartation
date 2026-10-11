# Integrations：内置与外置接入

Integrations 是通过地图接入的小工具。内置接入由项目代码实现，使用项目身份和权限；外置接入打开独立服务的原生页面，由服务自己管理账号、权限、协作和内容。

## 内置接入

| 功能 | 地图类型 | 默认 resourceId | 数据范围 |
| --- | --- | --- | --- |
| 留言板 | `board` | `message-wall` | SQLite 按资源保存，同一进程的所有房间共享 |
| 共享番茄钟 | `pomodoro` | `focus-corner` | 每个房间按资源独立维护，不持久化 |

在 Tiled 的 `interactions` 对象层添加矩形，填写类型和 `resourceId` 即可使用；地图制作见[地图说明](tiled.md)。两种工具都要求有效身份、当前连接且位于对应区域，每连接操作间隔至少 500ms。身份来源见[匿名身份与权限](account-system.md)。

### 留言板

每个资源最多 100 条留言，每条 1–500 个字符。服务端生成作者、留言 ID 和时间，客户端不能指定作者身份或管理员角色。

作者可删除自己的留言；项目 `admin` 还可删除其他作者和无法关联作者的历史留言。管理员不绕过区域、身份有效性或速率限制。作者归属使用持久 user id，换设备或重新入房不改变归属。

数据库 v3 增加 `board_notes.author_user_id`。旧留言只有临时 `author_session_id`，迁移后作者 user id 保持 NULL，不按昵称自动认领，可由管理员清理。

存储实现见 [board.ts](../apps/backend/src/board.ts)，消息与权限检查见 [SpaceRoom.ts](../apps/backend/src/rooms/SpaceRoom.ts)。

### 共享番茄钟

支持专注 25 分钟、休息 5 分钟，以及开始、暂停、继续和重置；完成后需手动开始下一轮。有效身份且位于对应区域的成员均可控制。计时以服务端截止时间为准，客户端结合服务端时间快照平滑显示。

计时器不跨房间共享，房间销毁或后端重启后重置。计时与权限检查见 [SpaceRoom.ts](../apps/backend/src/rooms/SpaceRoom.ts)，面板见 [features.ts](../apps/frontend/src/features.ts)。

## 外置接入

| 功能 | 地图类型 | 默认 resourceId |
| --- | --- | --- |
| 白板 | `whiteboard` | `shared-canvas` |
| 共同作画 | `drawing` | `shared-drawing` |
| YouTube/Bilibili 同步观看 | `media` | `lounge-screen` |
| 协作文档 | `document` | `shared-document` |

优先使用宿主机上的 Docker 服务。先部署服务并确认浏览器可以访问，再通过 `EXTERNAL_TOOLS` 配置资源到页面地址的映射；配置格式和公开 API 见[外置入口配置](integration-plan.md)。未配置地址的区域显示提示，点击已配置入口会在新标签页打开工具。

项目不启动容器、代理工具流量或签发工具凭据，也不把编辑器、正文、笔触或播放状态复制到项目中。项目身份和管理员角色不与外置服务互通；离开区域、项目 session 失效或角色变化都不撤销工具自己的会话。服务的登录、权限、持久化、升级和备份由该服务及部署者负责。

白板与面向绘师的共同作画是独立功能；视频通话和屏幕共享不在范围内。

## 测试

内置工具的存储、权限、计时与浏览器面板，以及外置入口的配置校验和页面打开行为，见[测试说明](testing.md)。外置服务自身的绘画、编辑、真实双平台播放和跨设备访问需另行验收。
