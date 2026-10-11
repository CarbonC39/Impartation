# Virtual Workspace

一个以 Phaser、Colyseus 和 Tiled 为基础的 2D 虚拟社交空间。当前包括持久匿名身份、跨设备绑定、访客资料、多人移动、房间文字聊天、留言板和共享番茄钟。正式注册/登录、影音共享和白板仍未实现。

## 当前范围

- `apps/frontend`：Vite + Phaser 3.90 客户端。
- `apps/backend`：Colyseus 0.18 权威房间服务，使用 `@colyseus/core`、`@colyseus/ws-transport` 和 `@colyseus/tools`。
- `packages/shared`：Colyseus Schema、Zod 输入校验和地图几何/移动规则。
- `assets/maps/lobby.tmj`、`tiles.png`：Tiled 正交大厅地图。
- SQLite 使用 `better-sqlite3`，默认位于 `data/world.sqlite`。项目迁移 v1-v3 管理资料和留言；Better Auth 的用户、账户、会话及验证表另由 Better Auth schema migration 管理。两套迁移各自独立。

匿名身份在数据库持久化，访客资料包含昵称和占位头像；同一浏览器刷新后由 HttpOnly 会话 cookie 恢复身份，换浏览器需使用绑定码。会话最长 30 天，活跃会话默认每天刷新有效期。跨设备绑定码 3 分钟有效、单次使用；兑换会切换当前浏览器到原身份，旧身份及其留言不会合并。退出或撤销共享 session 会使使用它的设备失效。cookie 丢失或会话过期且没有其它有效会话时，目前无法恢复身份；正式登录/账号恢复以后再做。

留言板按 Tiled `resourceId` 共享，每个资源最多 100 条，每条最多 500 个字符。持有有效匿名身份且身处对应留言板区域的访客可以发布，也可以删除自己的留言；管理员还可删除其他人和旧版无法关联作者的留言。操作仍由服务端校验区域及 500ms 限流。SQLite v3 给旧留言新增可空作者 user id；历史留言不按昵称自动认领。共享数据库会让容量分房的房间看到相同留言。

番茄钟在各房间内按资源共享：专注 25 分钟、休息 5 分钟，可开始、暂停、继续和重置；结束后需手动开始下一轮。只有当前连接且处于对应计时器区域的访客可以控制。服务端截止时间是计时依据，客户端用服务端时间快照和 `performance.now()` 显示倒计时。计时状态属于房间运行状态，不写入 SQLite；房间销毁或后端重启后计时会重置。

## 追踪清单

- [x] TypeScript monorepo、客户端/服务端开发与构建命令
- [x] Phaser + Colyseus 联机、访客外观选择、移动、碰撞、文字聊天与重连
- [x] SQLite 连接、版本化迁移、Tiled 地图与功能触发区约定
- [x] 留言板与共享番茄钟基础行为
- [x] 单元、真实 WebSocket 集成、Chromium 端到端测试框架
- [x] 项目须知、架构边界、Agent 协作规范
- [x] 持久匿名身份、跨设备绑定、个人资料和留言权限（含管理员）
- [ ] 私密房间、好友邀请与成员权限
- [ ] 共享影音、白板
- [ ] 正式 avatar 素材与换装
- [ ] CI、部署、备份与监控

已执行 `npm run check`、`npm run typecheck`、`npm run build` 和 `npm run test:e2e`：strict 类型检查、生产构建、109 项 Node 测试与 8 项 Chromium 测试通过。浏览器使用 NixOS Chromium，通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定；前端 JS 约 400KB gzip，仍有 Phaser 包体积提示。分阶段任务见 [docs/roadmap.md](docs/roadmap.md)。

## 本地运行

要求 Node.js 24 或更新版本、npm。

```sh
cp .env.example .env
npm ci
npm run dev
```

打开 <http://localhost:5173>。后端健康检查地址为 <http://localhost:2567/health>。开发时 Vite 会把健康检查、身份 API、Colyseus matchmaking 和 WebSocket 流量代理到后端。

常用命令：

```sh
npm run check   # typecheck、Node 测试和生产构建
npm run test:e2e # Chromium 浏览器测试；首次需要安装浏览器
npm run check:all # 包含上述两组检查
npm run build   # 构建 shared、backend、frontend
npm start       # 启动已构建的后端；不会启动/托管前端
npm run identity -- list # 列出本地数据库中的身份资料
npm run identity -- role USER_ID admin # 授予管理员
npm run identity -- role USER_ID member # 移除管理员
```

CLI 使用与跨设备绑定 API 见 [身份说明](docs/account-system.md)。管理员角色只能通过本地 CLI 设置。

浏览器首次准备：`npx playwright install chromium`。Linux 如缺系统库，可使用 Playwright 的 `install --with-deps chromium`。测试隔离方式与覆盖范围见 [docs/testing.md](docs/testing.md)。

## 配置与部署注意

- `.env.example` 列出服务地址、数据库/地图路径及身份配置。生产环境必须显式设置至少 32 字符的 `IDENTITY_SECRET`、`IDENTITY_BASE_URL` 和仅包含部署来源的 `IDENTITY_TRUSTED_ORIGINS`；启动会拒绝缺少这些变量或继续使用示例开发 secret。
- 根目录 `.env` 同时用于后端与 Vite；开发代理会跟随其中的 `PORT`。修改环境变量后重启开发服务。
- 修改地图文件后需重启后端，地图在服务启动时载入并校验。
- SQLite 适合单实例运行；部署时需给数据库目录挂载持久卷，不要让多个后端实例共享同一 SQLite 文件。留言板跨房间广播依赖同一进程中的共享数据库和通知；多进程部署需另行设计广播与存储。
- 生产构建的前端需单独托管。推荐通过同源反向代理提供 `/api`、`/matchmake` 和 Colyseus WebSocket 流量；设置 `IDENTITY_BASE_URL` 为公开站点 origin，`IDENTITY_TRUSTED_ORIGINS` 只列实际部署的前端来源。前端身份 API 始终请求当前站点同源 `/api`；`VITE_SERVER_URL` 只控制 Colyseus 连接地址。
- 公共空间允许任何持有有效匿名身份的访客加入并查看实时聊天与留言；匿名身份不提供私密房间或成员准入。服务端通过会话授权操作，不接受客户端自报身份或角色。具体权限与部署配置见 [身份说明](docs/account-system.md)。
- 一个房间上限 32 人；`joinOrCreate` 在满员后创建另一房间。聊天仅实时广播，不保留历史；昵称可重复。20 秒自动重连保留原房间连接，重启服务后不能恢复原房间或计时器，但有效身份资料仍可恢复。

## 地图入口

地图支持有限的 Tiled 正交、非无限地图；层必须包含 `ground` tile layer，以及 `spawns`、`collisions`、`interactions` object layer。地图约定、属性和功能区行为见 [docs/tiled.md](docs/tiled.md)。总体模块边界和后续设计见 [docs/architecture.md](docs/architecture.md)，工作顺序见 [docs/roadmap.md](docs/roadmap.md)。

## 项目须知

维护要求见 [AGENTS.md](AGENTS.md)：服务端权威、TypeScript strict、不要自行实现认证或 CRDT、持久匿名身份以服务端 session 授权，并准确记录验证结果。代码变更应及时在本地 git commit；远程 push 由用户自行处理。

Colyseus skill 官方安装方式：`npx skills add colyseus/skill`，见 [官方指南](https://docs.colyseus.io/getting-started)。当前 Codex 环境已安装，其他环境需自行安装。版本/API 以 lockfile 和对应官方文档为准。
