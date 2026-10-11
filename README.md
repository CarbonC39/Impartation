# Virtual Workspace

一个以 Phaser、Colyseus 和 Tiled 为基础的 2D 虚拟社交空间。当前包括访客昵称与占位头像、多人移动、房间文字聊天、留言板和共享番茄钟。登录账号尚未实现；影音共享和白板仍是预留功能。

## 当前范围

- `apps/frontend`：Vite + Phaser 3.90 客户端。
- `apps/backend`：Colyseus 0.18 权威房间服务，使用 `@colyseus/core`、`@colyseus/ws-transport` 和 `@colyseus/tools`。
- `packages/shared`：Colyseus Schema、Zod 输入校验和地图几何/移动规则。
- `assets/maps/lobby.tmj`、`tiles.png`：Tiled 正交大厅地图。
- SQLite 使用 `better-sqlite3`，默认位于 `data/world.sqlite`。v2 迁移持久化留言内容；`profiles` 仍是预留表，不表示已实现账号或持久化访客身份。

留言板按 Tiled `resourceId` 共享，每个资源最多 100 条，每条最多 500 个字符。当前连接且身处对应留言板区域的访客可以发布，也只能删除当前会话发布的留言。20 秒自动重连保留原会话权限；离开或刷新后会得到新会话，不能再删除旧留言。暂不支持编辑或管理员清理。共享数据库会让容量分房的房间看到相同留言。

番茄钟在各房间内按资源共享：专注 25 分钟、休息 5 分钟，可开始、暂停、继续和重置；结束后需手动开始下一轮。只有当前连接且处于对应计时器区域的访客可以控制。服务端截止时间是计时依据，客户端用服务端时间快照和 `performance.now()` 显示倒计时。计时状态属于房间运行状态，不写入 SQLite；房间销毁或后端重启后计时会重置。

## 追踪清单

- [x] TypeScript monorepo、客户端/服务端开发与构建命令
- [x] Phaser + Colyseus 联机、访客外观选择、移动、碰撞、文字聊天与重连
- [x] SQLite 连接、版本化迁移、Tiled 地图与功能触发区约定
- [x] 留言板与共享番茄钟基础行为
- [x] 单元、真实 WebSocket 集成、Chromium 端到端测试框架
- [x] 项目须知、架构边界、Agent 协作规范
- [ ] 正式账号与登录（已启动范围讨论，见 [账号方案草案](docs/account-system.md)）
- [ ] 私密房间、好友邀请与成员权限
- [ ] 共享影音、白板
- [ ] 正式 avatar 素材与换装
- [ ] CI、部署、备份与监控

已执行 `npm run check:all`：strict 类型检查、生产构建、96 项 Node 单元/联机测试与 7 项 Chromium 端到端测试通过，包含双页面留言、番茄钟控制及 390px 布局。本轮浏览器使用 NixOS Chromium，通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定。当前 JS 约 399KB gzip，仍有 Phaser 包体积提示。分阶段任务见 [docs/roadmap.md](docs/roadmap.md)。

## 本地运行

要求 Node.js 24 或更新版本、npm。

```sh
cp .env.example .env
npm ci
npm run dev
```

打开 <http://localhost:5173>。后端健康检查地址为 <http://localhost:2567/health>。开发时 Vite 会把健康检查、Colyseus matchmaking 和 WebSocket 流量代理到后端。

常用命令：

```sh
npm run check   # typecheck、Node 测试和生产构建
npm run test:e2e # Chromium 浏览器测试；首次需要安装浏览器
npm run check:all # 包含上述两组检查
npm run build   # 构建 shared、backend、frontend
npm start       # 启动已构建的后端；不会启动/托管前端
```

浏览器首次准备：`npx playwright install chromium`。Linux 如缺系统库，可使用 Playwright 的 `install --with-deps chromium`。测试隔离方式与覆盖范围见 [docs/testing.md](docs/testing.md)。

## 配置与部署注意

- `.env.example` 列出 `PORT`、`DATABASE_PATH`、`MAP_PATH` 和可选的 `VITE_SERVER_URL`。默认数据库和地图分别是 `data/world.sqlite` 与 `assets/maps/lobby.tmj`。
- 根目录 `.env` 同时用于后端与 Vite；开发代理会跟随其中的 `PORT`。修改环境变量后重启开发服务。
- 修改地图文件后需重启后端，地图在服务启动时载入并校验。
- SQLite 适合单实例运行；部署时需给数据库目录挂载持久卷，不要让多个后端实例共享同一 SQLite 文件。留言板跨房间广播依赖同一进程中的共享数据库和通知；多进程部署需另行设计广播与存储。
- 生产构建的前端需单独托管。设置构建时的 `VITE_SERVER_URL` 指向后端公开地址；生产环境使用 HTTPS 时应部署 HTTPS/WSS，并配置同源反向代理或正确的跨域/WebSocket 代理。
- 现在没有账号认证或好友/房间权限控制。任何能连接服务的访客都可能进入公共房间并看到房间聊天与留言；不要将它作为私密空间产品使用。留言删除权只依赖当前临时会话，不是正式身份权限。
- 一个房间上限 32 人；`joinOrCreate` 在满员后创建另一房间。聊天仅实时广播，不保留历史；昵称可重复，离开后不会保存访客资料。重连仅处理 20 秒窗口内的网络断开，服务端重启后不能恢复原房间或计时器。

## 地图入口

地图支持有限的 Tiled 正交、非无限地图；层必须包含 `ground` tile layer，以及 `spawns`、`collisions`、`interactions` object layer。地图约定、属性和功能区行为见 [docs/tiled.md](docs/tiled.md)。总体模块边界和后续设计见 [docs/architecture.md](docs/architecture.md)，工作顺序见 [docs/roadmap.md](docs/roadmap.md)。

## 项目须知

维护要求见 [AGENTS.md](AGENTS.md)：服务端权威、TypeScript strict、不要自行实现认证或 CRDT、账号系统先讨论范围，并准确记录验证结果。代码变更应及时在本地 git commit；远程 push 由用户自行处理。

Colyseus skill 官方安装方式：`npx skills add colyseus/skill`，见 [官方指南](https://docs.colyseus.io/getting-started)。当前 Codex 环境已安装，其他环境需自行安装。版本/API 以 lockfile 和对应官方文档为准。
