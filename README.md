# Virtual Workspace

一个以 Phaser、Colyseus 和 Tiled 为基础的 2D 虚拟社交空间骨架。当前基础功能包括访客昵称、三个占位头像、多人移动、房间文字聊天、20 秒断线重连和服务器端矩形碰撞。登录账号尚未实现；影音、白板、留言板、番茄钟和完整换装也尚未实现。

## 当前范围

- `apps/frontend`：Vite + Phaser 3.90 客户端。
- `apps/backend`：Colyseus 0.18 权威房间服务，使用 `@colyseus/core`、`@colyseus/ws-transport` 和 `@colyseus/tools`。
- `packages/shared`：Colyseus Schema、Zod 输入校验和地图几何/移动规则。
- `assets/maps/lobby.tmj`、`tiles.png`：Tiled 正交大厅地图。
- SQLite 使用 `better-sqlite3`，数据库默认位于 `data/world.sqlite`。目前仅初始化预留的 `profiles` 表，没有持久化访客身份或实现账号登录。

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
npm run build   # 构建 shared、backend、frontend
npm start       # 启动已构建的后端；不会启动/托管前端
```

当前测试和检查状态：**待主 agent 执行并填写验收结果**。不要根据脚本存在就推断检查已通过。

## 配置与部署注意

- `.env.example` 列出 `PORT`、`DATABASE_PATH`、`MAP_PATH` 和可选的 `VITE_SERVER_URL`。默认数据库和地图分别是 `data/world.sqlite` 与 `assets/maps/lobby.tmj`。
- 修改 `PORT` 时，也要同步修改 `apps/frontend/vite.config.ts` 的开发代理目标。
- 修改地图文件后需重启后端，地图在服务启动时载入并校验。
- SQLite 适合单实例运行；部署时需给数据库目录挂载持久卷，不要让多个后端实例共享同一 SQLite 文件。
- 生产构建的前端需单独托管。设置构建时的 `VITE_SERVER_URL` 指向后端公开地址；生产环境使用 HTTPS 时应部署 HTTPS/WSS，并配置同源反向代理或正确的跨域/WebSocket 代理。
- 现在的房间没有账号认证或好友/房间权限控制。任何能连接服务的访客都可能进入公共房间并看到房间聊天；不要将它作为私密空间产品使用。

## 地图入口

地图支持有限的 Tiled 正交、非无限地图；层必须包含 `ground` tile layer，以及 `spawns`、`collisions`、`interactions` object layer。地图约定、属性和当前限制见 [docs/tiled.md](docs/tiled.md)。总体模块边界和未来同步内容设计见 [docs/architecture.md](docs/architecture.md)，工作顺序见 [docs/roadmap.md](docs/roadmap.md)。

## 项目须知

维护要求见 [AGENTS.md](AGENTS.md)：服务端权威、TypeScript strict、不要自行实现认证或 CRDT、尊重“登录以后再做”的范围约定，并准确记录验证结果。代码变更应及时在本地 git commit；远程 push 由用户自行处理。
