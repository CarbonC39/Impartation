# 架构

## 模块

| 路径 | 职责 |
| --- | --- |
| `apps/frontend` | Phaser 4 客户端、地图展示和 integration presentation handlers，通过 `@colyseus/sdk` 订阅状态 |
| `apps/backend` | Colyseus 0.18 权威房间、地图 registry/API、HTTP API、匿名身份与 SQLite 存储 |
| `packages/shared` | Colyseus Schema、`SpaceProtocol`、Zod 校验、Tiled 语义解析、地图 registry 和移动规则 |
| `assets/maps` | Tiled JSON 源地图及 `registry.json` |

地图几何与语义以 `.tmj` 为源数据。后端通过 `MAP_REGISTRY_PATH` 读取地图 registry，校验地图和 Portal 目标，并提供 `GET /api/world`。响应包含 `initialMap` 和 `{ id, url, defaultSpawn, world }` 地图条目；`url` 指向服务端规范化后的 Tiled JSON，地图显式引用的图片等资源由地图资源 API 提供。前端按地图 ID 加载目录、渲染地图并筛选对应玩家。

解析器只约束项目语义对象：命名出生点、碰撞矩形、交互矩形和 Portal。语义层可嵌套在 group 中并使用层偏移。地图必须是有限、正交、16×16 tile；渲染器只支持其实际实现的 Tiled 特性，不承诺完整 Tiled 兼容。服务端每 50ms 权威更新移动和区域。客户端提交经过验证的输入；服务端按玩家 `mapId` 计算碰撞和交互，并验证位置后执行留言板、番茄钟或 Portal 操作。

## 状态与存储

| 数据 | 归属与生命周期 |
| --- | --- |
| 匿名 user、session、绑定凭据 | Better Auth 管理，写入 SQLite |
| 昵称、所选角色形象 ID、member/admin 权限角色 | 项目 `profiles` 表，跨设备共享 |
| 玩家位置、地图 ID、连接和区域 | Colyseus 房间状态；自动重连窗口为 20 秒 |
| 聊天 | 房间内实时广播，不保留历史；地图切换不改变房间 |
| 留言板 integration 数据 | SQLite 按 `resourceId` 保存，同一进程的房间共享内容与变更通知 |
| 番茄钟 integration 数据 | 每个房间按资源独立计时，房间销毁或后端重启后重置 |
| integration presentation 配置 | 后端启动时校验；公开所需 URL、mode 和 fallback |
| 第三方工具内容与会话 | 第三方服务管理，不复制到 Colyseus Schema 或项目数据库 |

Portal 在同一房间内改变玩家 `mapId` 和位置；不创建新房间。地图 registry 的 `defaultSpawn` 选择加入时出生点，Portal 的 `targetSpawn` 选择转换后的出生点。碰撞和交互均按该玩家当前地图解析。角色形象 `avatar` 与权限 `role` 分离；角色精灵图目前仍由彩色圆形占位。

项目表通过 `PRAGMA user_version` 迁移；Better Auth 表通过其 schema migration 独立管理。SQLite 使用 WAL 和 5000ms busy timeout，支持本地 CLI 在线修改角色。旧留言作者 user id 保持 NULL，不按昵称认领。

## Integration 边界

共享的泛型 `InteractionRegistry<T>` 按 Tiled `class`/`type` 注册交互定义和校验。前端 presentation registry 与后端行为 handlers 分离：留言板、番茄钟保留各自 handlers；外部工具使用 integration 配置。Presentation mode 为 `native`、`embed` 或 `external`。`PresentationRegistry.registerNative(kind, handler)` 按 integration kind 显式注册 native handler；客户端可将 registry 传给 `createInteractions(room, presentations)`。native 不需要 URL；若找不到 handler，可配置 `fallback: 'external'`，此时必须提供 URL。embed 使用沙盒 iframe，embed/external 均需要 URL。

`EXTERNAL_TOOLS` 兼容既有 `{ kind, url }` 配置，默认 mode 为 `external`，并可选 mode 和 fallback。board/pomodoro 现有面板 handler 属于 native；外置 integration 选择 native 时，只有存在对应显式注册 handler 才能展示，不会自动产生 UI。项目不启动容器、不签发第三方凭据、不映射项目身份或管理员权限。iframe 展示不等于工具授权，外置工具仍管理自己的用户、权限、内容和会话。白板与面向绘师的共同作画是独立功能；视频通话和屏幕共享不在范围内。身份 SSO、跨服务权限映射与自行实现协作协议不在当前范围内。

身份细节见[匿名身份与权限](account-system.md)，地图契约见[地图说明](tiled.md)，integration 配置见[外置入口](integration-plan.md)。

## 部署约束

前端静态资源需单独托管；后端提供 HTTP 与 WebSocket，同源代理方式见 [README](../README.md)。地图 registry 和其引用文件必须随后端部署；服务端公开规范化地图与显式引用的资源。SQLite 按单实例部署；多进程运行需要额外的存储与变更通知方案，不能让多个后端直接共享同一 SQLite 文件。
