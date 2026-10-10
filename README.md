# Virtual Workspace

一个以 Phaser、Colyseus 和 Tiled 为基础的 2D 虚拟社交空间骨架。当前基础功能包括访客昵称、三个占位头像、多人移动、房间文字聊天、20 秒断线重连和服务器端矩形碰撞。登录账号尚未实现；影音、白板、留言板、番茄钟和完整换装也尚未实现。

## 当前范围

- `apps/frontend`：Vite + Phaser 3.90 客户端。
- `apps/backend`：Colyseus 0.18 权威房间服务，使用 `@colyseus/core`、`@colyseus/ws-transport` 和 `@colyseus/tools`。
- `packages/shared`：Colyseus Schema、Zod 输入校验和地图几何/移动规则。
- `assets/maps/lobby.tmj`、`tiles.png`：Tiled 正交大厅地图。
- SQLite 使用 `better-sqlite3`，数据库默认位于 `data/world.sqlite`。目前仅初始化预留的 `profiles` 表，没有持久化访客身份或实现账号登录。

## 追踪清单

- [x] TypeScript monorepo、客户端/服务端开发与构建命令
- [x] Phaser + Colyseus 联机、访客外观选择、移动、碰撞、文字聊天与重连
- [x] SQLite 连接、版本化迁移、Tiled 地图与功能触发区约定
- [x] 单元、真实 WebSocket 集成、Chromium 端到端测试
- [x] 项目须知、架构边界、Agent 协作规范
- [ ] 正式账号与登录（按你的要求留到以后）
- [ ] 私密房间、好友邀请与成员权限
- [ ] 共享影音、白板、留言板
- [ ] 番茄钟、正式 avatar 素材与换装
- [ ] CI、部署、备份与监控

分阶段任务和后续决策见 [docs/roadmap.md](docs/roadmap.md)。

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
npm run check   # typecheck、测试和构建
npm run test:e2e # Chromium 浏览器测试；首次需要安装浏览器
npm run check:all # 包含上述两组检查
npm run build   # 构建 shared、backend、frontend
npm start       # 启动已构建的后端；不会启动/托管前端
```

浏览器首次准备：`npx playwright install chromium`。Linux 如缺系统库，可使用 Playwright 的 `install --with-deps chromium`。测试隔离方式与覆盖范围见 [docs/testing.md](docs/testing.md)。

已验收：TypeScript 检查、生产构建、**62 项单元/联机测试和 5 项 Chromium 端到端测试**。浏览器验证包括双页面联机聊天、外观状态、键盘移动、输入暂停、离开后重入与 390px 布局。当前构建包含完整 Phaser，压缩后 JS 约 397KB gzip，会有包体积提示；后续优化拆包。

## 配置与部署注意

- `.env.example` 列出 `PORT`、`DATABASE_PATH`、`MAP_PATH` 和可选的 `VITE_SERVER_URL`。默认数据库和地图分别是 `data/world.sqlite` 与 `assets/maps/lobby.tmj`。
- 根目录 `.env` 同时用于后端与 Vite；开发代理会跟随其中的 `PORT`。修改环境变量后重启开发服务。
- 修改地图文件后需重启后端，地图在服务启动时载入并校验。
- SQLite 适合单实例运行；部署时需给数据库目录挂载持久卷，不要让多个后端实例共享同一 SQLite 文件。
- 生产构建的前端需单独托管。设置构建时的 `VITE_SERVER_URL` 指向后端公开地址；生产环境使用 HTTPS 时应部署 HTTPS/WSS，并配置同源反向代理或正确的跨域/WebSocket 代理。
- 现在的房间没有账号认证或好友/房间权限控制。任何能连接服务的访客都可能进入公共房间并看到房间聊天；不要将它作为私密空间产品使用。
- 一个房间上限 32 人；`joinOrCreate` 在满员后创建另一房间。聊天仅实时广播，不保留历史；昵称可重复，离开后不会保存访客资料。重连仅处理 20 秒窗口内的网络断开，服务端重启后不能恢复原房间。

## 地图入口

地图支持有限的 Tiled 正交、非无限地图；层必须包含 `ground` tile layer，以及 `spawns`、`collisions`、`interactions` object layer。地图约定、属性和当前限制见 [docs/tiled.md](docs/tiled.md)。总体模块边界和未来同步内容设计见 [docs/architecture.md](docs/architecture.md)，工作顺序见 [docs/roadmap.md](docs/roadmap.md)。

## 项目须知

维护要求见 [AGENTS.md](AGENTS.md)：服务端权威、TypeScript strict、不要自行实现认证或 CRDT、尊重“登录以后再做”的范围约定，并准确记录验证结果。代码变更应及时在本地 git commit；远程 push 由用户自行处理。

Colyseus skill 官方安装方式：`npx skills add colyseus/skill`，见 [官方指南](https://docs.colyseus.io/getting-started)。本轮已安装到当前 Codex 环境，其他环境需自行安装。版本/API 以 lockfile 和对应官方文档为准。
