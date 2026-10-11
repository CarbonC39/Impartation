# Virtual Workspace

基于 Phaser、Colyseus 和 Tiled 的 2D 多人社交/协作/活动空间，支持自定义地图事件和许多小工具。

外部工具在新标签页打开，使用各自的账号和权限；项目不提供编辑器或播放同步。正式注册/登录、账号恢复和私密房间尚未实现。移动使用 WASD 或方向键，暂不提供触屏移动控件。

## 本地运行

需要 Node.js 24 或更新版本、npm。

```sh
cp .env.example .env
npm ci
npm run dev
```

打开 <http://localhost:5173>，后端健康检查为 <http://localhost:2567/health>。开发服务器会代理 `/api`、`/health`、Colyseus matchmaking 和 WebSocket。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | strict 类型检查、Node 测试和生产构建 |
| `npm run test:e2e` | Chromium 浏览器测试，自动启动开发服务 |
| `npm run check:all` | 执行以上两组检查 |
| `npm run build` | 构建 shared、backend 和 frontend |
| `npm start` | 启动已构建的后端，前端需单独托管 |
| `npm run identity -- list` | 列出本地身份资料 |
| `npm run identity -- role USER_ID admin` | 授予项目管理员 |
| `npm run identity -- role USER_ID member` | 移除项目管理员 |

浏览器测试首次运行前执行 `npx playwright install chromium`。覆盖范围、隔离方式和 NixOS 配置见[测试说明](docs/testing.md)。

## 配置与部署

根目录 [`.env.example`](.env.example) 提供配置示例。后端和 Vite 都读取根目录 `.env`；修改配置后重启服务。

生产环境需设置至少 32 字符的随机 `IDENTITY_SECRET`、公开站点 `IDENTITY_BASE_URL` 和实际前端来源 `IDENTITY_TRUSTED_ORIGINS`。前端单独托管，通过同源反向代理连接 `/api`、`/matchmake` 和 Colyseus WebSocket。`VITE_SERVER_URL` 仅控制 Colyseus 连接地址，身份与工具配置 API 始终使用同源 `/api`。

SQLite 按单后端实例部署，默认数据文件为 `data/world.sqlite`，需持久化并备份。HTTP Basic Auth 由部署者的代理提供。

用 `EXTERNAL_TOOLS` 关联已有工具的页面地址，默认 `{}` 表示未配置；设置方法见[外部工具入口](docs/integration-plan.md)。本项目不启动 Docker 容器，实际工具的部署和使用需另行验证。

## 文档

| 文档 | 内容 |
| --- | --- |
| [架构](docs/architecture.md) | 模块、状态归属和功能边界 |
| [匿名身份与权限](docs/account-system.md) | 跨设备绑定、身份 API、管理员 CLI 和迁移 |
| [地图制作](docs/tiled.md) | Tiled 制图步骤、碰撞、交互区和验证 |
| [外部工具入口](docs/integration-plan.md) | 地址配置、公开 API 和入口行为 |
| [Integrations](docs/integrations.md) | 内置工具与外置服务的接入和权限 |
| [测试](docs/testing.md) | 命令、覆盖范围和未覆盖项 |
| [待办](docs/roadmap.md) | 尚未实现的功能 |
| [协作约定](AGENTS.md) | 实现、验证和提交要求 |
