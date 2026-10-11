# 架构与功能边界

## 当前结构

这是一个 npm workspaces monorepo：

- `apps/frontend` 用 Vite 和 Phaser 3.90 呈现 Tiled 大厅、访客和聊天界面，并通过 `@colyseus/sdk` 连接服务。
- `apps/backend` 使用 Colyseus 0.18、`@colyseus/core`、WebSocket transport 和 tools 提供 `space` 房间。服务端校验访客加入、聊天、移动与功能操作，按 50ms 步长执行移动和碰撞；移动位置和访客状态通过 Schema 同步。
- `packages/shared` 保存共享 schema、Zod 输入约束、房间/头像枚举和 Tiled 地图几何规则。
- `assets/maps` 提供地图与图块；后端启动时读取并验证 `.tmj` 文件。
- `better-sqlite3` 持有本地 SQLite 数据库。项目 `user_version` v1-v3 管理 `profiles` 与 `board_notes`；v3 保存 Better Auth user id 作为留言作者，旧作者字段无法自动映射时留空。Better Auth 用户、session 和验证表在创建 auth 实例前通过 `getMigrations(identityOptions).runMigrations()` 独立管理。WAL 与 5000ms busy timeout 支持 CLI 在服务运行时修改角色；每条房间消息重查有效 session 和最新角色。

客户端提交经过校验的功能操作，服务端根据 cookie 验证得到的 Better Auth user/session、可信房间连接、当前玩家位置和地图区域决定是否接受。服务端计算留言作者、时间和番茄钟截止时间；客户端不负责权限判定或计时事实，也不能自报 user id 或 role。

## 当前已做与预留

- **身份与资料**：Better Auth 匿名插件创建持久匿名 user 和 cookie session；昵称、头像与 role 存在项目 `profiles` 表。同浏览器刷新可由 cookie 恢复；换浏览器需绑定。session 默认 30 天有效，活跃时默认每日刷新。一次性绑定码默认有效 3 分钟、哈希保存且只能使用一次；兑换会切换设备到同一 user/session，不合并原身份资料或留言。管理员 role 由本地 CLI 在线设置。项目不提供 cookie 丢失且无有效 session 时的账号恢复。正式注册/登录以后再做。
- **留言板**：每个 Tiled `resourceId` 最多保存 100 条，每条最多 500 个字符。v2 持久化内容，v3 增加 `author_user_id`；所有容量分房共享同一个资源留言，单实例进程会把变更同步到各个活动房间。有效身份且站在对应区域的访客可以发言并删除自己的留言；管理员还可删除其他作者和 NULL 作者的旧留言。功能操作按连接限制为每 500ms 一次。20 秒断线重连会保留房间连接；session 失效后服务端会踢出连接。
- **番茄钟**：每个房间的 Tiled 资源各有一个共享计时器。专注 25 分钟、休息 5 分钟，支持开始、暂停、继续、重置；结束后保持完成状态，由访客手动开始下一轮。处于相应功能区的访客均可控制。计时以服务端绝对截止时间为准，客户端结合服务端时间快照与 `performance.now()` 显示倒计时。状态仅在房间内存中；房间销毁或后端重启会重置计时器。
- 已有访客昵称和三个占位头像、多人移动、文字聊天、20 秒自动重连、矩形碰撞；匿名身份可在刷新和设备间恢复，个人资料可读写。
- Tiled 仍预留 `media` 和 `whiteboard` 区域类型；影音同步、白板和换装未实现。正式注册/登录以后再做。身份接口、CLI、迁移与权限见[身份说明](account-system.md)。

## 后续同步功能建议

- **白板**：优先评估 Yjs 搭配 Excalidraw 的可行性。实现前确认各自许可、打包体积、持久化/房间同步模型以及能否嵌入 Phaser 场景；不要自行造 CRDT。
- **影音共享**：使用 HTMLMediaElement 或合适的现成播放器 SDK。服务端只同步经验证的播放/暂停、时间位置等控制状态；不要由服务端抓取用户给出的媒体 URL。需要明确平台播放策略、媒体来源许可和跨客户端同步体验。
- **身份**：当前使用 Better Auth 匿名 user/session 做跨端关联，用户自行配置外部 HTTP Basic Auth 代理；不要把昵称或客户端提交的 user id 当作凭据。正式注册/登录按后续需求另行评估。
- **语音**：目前没有语音功能，也未选定方案。将来如需语音，应单独评估 WebRTC/托管服务、隐私和运营成本，不通过 Colyseus 房间转发原始音频。

部署早期保持单后端实例和持久化卷。SQLite 文件不适合多实例共享；跨进程运行留言广播需要额外的共享通知设施。水平扩展时再设计 PostgreSQL、房间 Presence/Driver 和迁移方案。
