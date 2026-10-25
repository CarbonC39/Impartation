# 测试

## 运行

安装依赖后可按需执行：

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

| 命令 | 覆盖 |
| --- | --- |
| `npm test` | Node 协议、存储、配置、HTTP 和 WebSocket 测试 |
| `npm run typecheck` | workspace 与 E2E 代码的 strict 类型检查 |
| `npm run check` | 类型检查、Node 测试和生产构建 |
| `npm run test:e2e` | 生产构建后的 Chromium 浏览器测试 |
| `npm run check:all` | `check` 后运行浏览器测试 |

Playwright 会启动独立服务和临时地图 registry，使用 5174/2569 端口，不复用开发服务（5173/2567）。Linux 缺少系统依赖时按 Playwright 提示安装；也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 Chromium。NixOS 示例：

```sh
nix-shell -p chromium --run 'PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)" npm run check:all'
```

## 覆盖范围

Node 测试覆盖 shared 协议与输入校验、Tiled 解析和地图规则、权威移动与交互权限、账号和管理员操作、SQLite 迁移、Space/Portal 隔离、WebRTC 信令及工具配置。

浏览器测试覆盖账号流程、地图和角色渲染、移动与动作、聊天和内置交互、Space 导航、断线恢复、外部工具入口及近距离语音。测试采用临时数据库和地图，不修改产品地图。详细测试文件位于 `apps/backend/test/` 和 `apps/frontend/e2e/`。

自动化验证不等于目标环境验收。真实外部服务的登录、绘画、协作持久化和 YouTube/Bilibili 播放需单独验证；浏览器测试目前只覆盖 Chromium，未覆盖 Firefox、WebKit、真实触屏设备或弱网络压力。

## 已知边界

- 角色素材图集为 64×192，包含行走和坐下姿势；目前可触发的地图动作只有坐下。
- 私密区域隔离聊天和语音受众，但位置、正在输入标识等 Schema 状态对同一 Space 的成员可见；永久 ACL 未实现。
- 外部工具测试使用页面替身，不验证真实服务是否允许 iframe 嵌入或目标部署的访问控制。
- 语音自动化使用模拟麦克风。真实权限提示、NAT 穿透、音质及多种浏览器/网络组合需在 HTTPS 或 localhost 和目标 STUN/TURN 环境中检查。
- GitHub Actions 执行 `npm run check` 并发布 Release 与多架构镜像；浏览器测试和目标主机部署不在工作流中。
