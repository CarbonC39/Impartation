# Virtual Workspace

[English](README.md) | [简体中文](README.zh-CN.md)

基于 Phaser 4、Colyseus 和 Tiled 的 2D 多人互动空间，支持用选取的角色形象移动、互动、使用工具、文字交流。角色外观预设用于地图中的精灵形象，不是个人头像图片。

Tiled JSON 是地图几何与交互的源数据；服务端地图 registry 可登记多张 16×16 tile 的有限正交地图，Portal 在同一房间中切换地图与命名出生点。

地图中的外置工具统一使用 `web` 交互类型，以 `resourceId` 匹配 `EXTERNAL_TOOLS` 页面配置。页面可用 `external` 新标签页或 `embed` 沙盒 iframe 展示；外置服务保留自己的账号和权限。正式注册/登录、账号恢复和私密房间尚未实现。

## 本地运行

需要 Node.js 24 或更新版本、npm。

```sh
cp .env.example .env
npm ci
npm run dev
```

打开 <http://localhost:5173>，按界面引导选择昵称、DIY 角色外观后进入空间。换装选择支持预览、随机搭配和保存，资料会跨设备身份同步。角色图层素材待导入；目前地图角色只用上衣颜色作为占位配色。登录页和世界选择目前是前端原型：表单不执行密码认证，世界名称只影响界面标签；后端仍使用持久匿名身份和地图 registry。

使用 WASD、方向键或屏幕方向按钮移动。在地图作者放置的动作锚点所在格按 E 或点击“坐下”执行动作，也可启用动画选项。移动会取消当前动作；输入文字时键盘移动暂停。服务端根据玩家权威位置验证动作请求并查找锚点。

相机缩放由 `VITE_CAMERA_ZOOM` 控制，默认值为 `2`，接受任意有限正数且独立于 tile 尺寸；修改 `.env` 后重启 Vite。动作锚点定义角色位置、动作和可选朝向，不绘制家具；地图作者可在 Tiled 视觉层独立摆放家具。`assets/characters/walk.png` 目前只有行走帧，因此动作暂时显示对应方向的 idle 帧，等待动作帧图集。帧尺寸和帧内脚点单独配置；替换图集时要同步检查角色定义中的帧尺寸和 `groundAnchor`。

后端健康检查为 <http://localhost:2567/health>。开发服务器会代理 `/api`、`/health`、Colyseus matchmaking 和 WebSocket。

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
