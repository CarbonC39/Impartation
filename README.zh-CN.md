# Impartation

[English](README.md) | [简体中文](README.zh-CN.md)

基于 Phaser 4、Colyseus 和 Tiled 的 2D 多人互动空间。创建角色，与他人探索地图、交流并使用内置互动，也可打开外部协作工具。账号、世界状态和地图访问由服务端管理。

## 本地运行

需要 Node.js 24 或更新版本及 npm。

```sh
cp .env.example .env
npm ci
npm run dev
```

打开 <http://localhost:5173>。注册默认开放；设置 `REGISTRATION_MODE=code` 并提供 `REGISTRATION_CODE` 可启用注册码，设置 `REGISTRATION_MODE=admin` 可关闭公开注册。生产身份配置见[账号与权限](docs/account-system.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 类型检查、Node 测试和生产构建 |
| `npm run test:e2e` | Chromium 浏览器测试 |
| `npm run check:all` | 执行以上两组检查 |
| `npm run build` | 构建所有 workspace |
| `npm start` | 启动已构建的后端 |

首次运行浏览器测试前，用 `npx playwright install chromium` 安装 Chromium。覆盖范围和环境说明见[测试文档](docs/testing.md)。

## 配置与部署

本地开发可从 `.env.example` 开始配置。部署时设置至少 32 字符的随机 `IDENTITY_SECRET`、`IDENTITY_BASE_URL` 和 `IDENTITY_TRUSTED_ORIGINS`。当前使用单后端实例和 SQLite；请持久化并备份 `data/world.sqlite`。

[托管指南](docs/hosting.md)介绍 Space、地图、Docker 挂载、部署与回滚。仓库提供 [Docker Compose 示例](compose.example.yml) 和 [Docker 镜像](https://github.com/carbonc39/impartation/pkgs/container/virtualworkspace)。

地图几何与互动由 Tiled JSON 定义，见[地图制作](docs/tiled.md)。[互动说明](docs/integrations.md)介绍内置功能和外部服务边界；配置 `EXTERNAL_TOOLS` 请参阅[外部工具入口配置](docs/external-tools.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [托管指南](docs/hosting.md) | Space、地图部署、Docker、更新和排查 |
| [架构](docs/architecture.md) | 模块、状态归属和功能边界 |
| [账号与权限](docs/account-system.md) | 注册、session、造型保存和管理员操作 |
| [地图制作](docs/tiled.md) | 制图与地图验证契约 |
| [集成说明](docs/integrations.md) | 内置互动与外部服务边界 |
| [测试](docs/testing.md) | 命令、覆盖范围和未覆盖项 |
