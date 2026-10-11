# Virtual Workspace

基于 Phaser 4、Colyseus 和 Tiled 的 2D 多人空间。Tiled JSON 是地图几何与交互的源数据；服务端地图 registry 可登记多张 16×16 tile 的有限正交地图，Portal 在同一房间中切换地图与命名出生点。

地图中的外置工具统一使用 `web` 交互类型，以 `resourceId` 匹配 `EXTERNAL_TOOLS` 页面配置。页面可用 `external` 新标签页或 `embed` 沙盒 iframe 展示；外置服务保留自己的账号和权限。项目不提供编辑器、画笔或播放同步实现。正式注册/登录、账号恢复和私密房间尚未实现。移动使用 WASD 或方向键，暂不提供触屏移动控件。

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

根目录 [`.env.example`](.env.example) 提供配置示例。后端和 Vite 都读取根目录 `.env`；修改配置后重启服务。`MAP_REGISTRY_PATH` 默认读取 `assets/maps/registry.json`；地图文件相对 registry 路径解析。地图契约与渲染边界见[地图制作](docs/tiled.md)。

生产环境需设置至少 32 字符的随机 `IDENTITY_SECRET`、公开站点 `IDENTITY_BASE_URL` 和实际前端来源 `IDENTITY_TRUSTED_ORIGINS`。前端单独托管，通过同源反向代理连接 `/api`、`/matchmake` 和 Colyseus WebSocket。`VITE_SERVER_URL` 仅控制 Colyseus 连接地址，身份、地图与工具配置 API 始终使用同源 `/api`。

SQLite 按单后端实例部署，默认数据文件为 `data/world.sqlite`，需持久化并备份。HTTP Basic Auth 由部署者的代理提供。

用 `EXTERNAL_TOOLS` 将地图 `resourceId` 关联到 `{ url, mode?, fallback? }`。URL 必填；`mode` 可为 `embed` 或 `external`，默认 `external`。`fallback: "external"` 会在嵌入容器旁提供手动打开链接，不会检测 iframe 加载失败。项目不启动 Docker 容器，实际工具的部署和使用需另行验证。地图目录由 `GET /api/world` 提供，服务端发布规范化 Tiled JSON 和地图显式引用的资源。

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
