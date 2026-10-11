# 架构

## 模块

| 路径 | 职责 |
| --- | --- |
| `apps/frontend` | Vite + Phaser 客户端，渲染地图与玩家，通过 `@colyseus/sdk` 订阅房间状态 |
| `apps/backend` | Colyseus 0.18 权威房间、HTTP API、匿名身份与 SQLite 存储 |
| `packages/shared` | Colyseus Schema、Zod 校验、Tiled 解析和移动规则 |
| `assets/maps` | 前后端共用的大厅地图与图块 |

后端在启动时读取并验证地图，以 50ms 步长处理移动和碰撞。客户端提交方向或功能输入，服务端计算玩家位置、交互区域、留言作者和计时截止时间。权限由有效的 Better Auth session、最新项目角色、可信连接和玩家位置共同决定；客户端不能指定授权身份或角色。

## 状态与存储

| 数据 | 归属与生命周期 |
| --- | --- |
| 匿名 user、session、绑定凭据 | Better Auth 管理，写入 SQLite |
| 昵称、所选角色形象 ID、member/admin 权限角色 | 项目 `profiles` 表，跨设备共享 |
| 留言板 integration 数据 | SQLite 按地图 `resourceId` 保存，同一进程的房间共享内容与变更通知 |
| 玩家位置、连接、区域 | Colyseus 房间状态；自动重连窗口为 20 秒 |
| 聊天 | 房间内实时广播，不保留历史 |
| 番茄钟 integration 数据 | 每个房间按资源独立计时，房间销毁或后端重启后重置 |
| 工具入口地址 | 后端环境配置，启动时验证，经 `/api/tools` 发布 |
| 第三方工具内容与会话 | 第三方服务管理，不复制到 Colyseus Schema 或项目数据库 |

一个房间最多 32 人，`joinOrCreate` 在满员后创建另一房间。角色形象由预设列表选择，`avatar` 保存形象 ID，客户端据此渲染角色；权限角色单独使用 `role`。角色精灵图渲染目前仍由彩色圆形占位。

项目表通过 `PRAGMA user_version` 迁移 v1-v3；Better Auth 表通过其 schema migration 独立管理。SQLite 使用 WAL 和 5000ms busy timeout，支持本地 CLI 在线修改角色。旧留言的作者 user id 保持 NULL，不按昵称认领。

## 边界

主体负责空间、匿名身份、角色形象选择、项目权限和 integration 入口。留言板、番茄钟属于当前内置 integrations，业务规则见[内置与外置接入](integrations.md)。身份模块提供可信 user id 和权限角色，各 integration 执行自己的操作规则。

外部 integrations 优先使用宿主机 Docker 服务，编辑器、画笔、正文协作、媒体解析和播放同步由第三方负责。

工具入口是原生页面链接。项目不代理工具流量或签发工具凭据，项目管理员不自动获得工具管理员权限，离开地图也不撤销工具会话。白板与面向绘师的共同作画是独立功能；同步观看需覆盖 YouTube 和 Bilibili。视频通话与屏幕共享不在范围内。

正式注册/登录、账号恢复、工具 SSO 和跨服务权限映射留待后续需求；不自行实现认证、密码存储、CRDT 或协作同步协议。

## 部署约束

前端静态资源需单独托管；后端提供 HTTP 与 WebSocket，同源代理方式见 [README](../README.md)。SQLite 按单实例部署；多进程运行需要额外的存储与变更通知方案，不能让多个后端直接共享同一 SQLite 文件。

身份细节见[匿名身份与权限](account-system.md)，地图契约见[地图说明](tiled.md)，工具配置见[外部工具入口](integration-plan.md)。
