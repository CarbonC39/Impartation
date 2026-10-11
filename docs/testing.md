# 测试

## 运行

安装项目依赖后执行：

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

| 命令 | 执行内容 |
| --- | --- |
| `npm test` | Node 协议、存储、配置、HTTP 和真实 WebSocket 测试 |
| `npm run typecheck` | 所有 workspace 及 E2E 代码的 strict 类型检查 |
| `npm run check` | 类型检查、Node 测试和生产构建 |
| `npm run test:e2e` | Chromium 浏览器测试 |
| `npm run check:all` | `check` 后执行浏览器测试 |

Playwright 自动启动开发服务；非 CI 环境会复用已运行的服务。Linux 缺系统依赖时按 Playwright 提示安装，或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定现有 Chromium。NixOS 可使用：

```sh
nix-shell -p chromium --run 'PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)" npm run check:all'
```

## 覆盖范围

| 测试 | 覆盖行为 | 文件 |
| --- | --- | --- |
| 共享协议 | 输入类型、长度与数值边界，剥离伪造身份与计时字段 | [protocol.test.ts](../apps/backend/test/protocol.test.ts) |
| 地图与移动 | 地图格式、出生点与功能区、碰撞、边界、斜向速度、延迟步长 | [world.test.ts](../apps/backend/test/world.test.ts) |
| 工具配置 | 四类资源映射、未知资源、类型不符、非法 JSON/URL、内嵌密码与额外凭据字段拒绝 | [external-tools.test.ts](../apps/backend/test/external-tools.test.ts) |
| SQLite | v1-v3 迁移、旧留言保留、持久化、容量与作者权限 | [db.test.ts](../apps/backend/test/db.test.ts) |
| 管理员 CLI | 真实磁盘子进程执行 role/list，持久化角色并拒绝无效参数 | [identity-cli.test.ts](../apps/backend/test/identity-cli.test.ts) |
| HTTP 与 WebSocket | 匿名 session、资料、绑定码单次/过期、撤销与降权、留言权限、聊天限流、移动、重连、计时器、公开工具目录 | [space.test.ts](../apps/backend/test/space.test.ts) |
| 浏览器 | 跨浏览器身份绑定、聊天、移动、留言、计时器、窄屏；四类工具区域、独立标签页、离开区域清理链接及配置失败提示 | [space.spec.ts](../apps/frontend/e2e/space.spec.ts) |

工具入口浏览器测试拦截 `/api/tools` 提供固定配置，以 HTML 替身模拟工具页面，并检查目标 URL、opener 和 referrer。真实 HTTP 配置响应由 Node 集成测试验证。它们不验证 WBO、Drawpile、SyncTV 或 Etherpad 的实际编辑、绘画与播放功能。

## 隔离与排查

- Node 联机测试使用 2568 端口和内存数据库；SQLite 持久化及 CLI 测试使用临时目录。
- 浏览器测试使用 5173/2567 端口，自动启动时设内存数据库。复用现有服务时会写入测试身份、资料和留言，使用独立测试服务可避免污染本地数据。
- 断线超时用例将测试房间的重连窗口缩短至 0.1 秒；正常重连用例仍使用默认 20 秒。
- 非法载荷用例会产生预期校验日志，以退出码和测试统计为准。
- Playwright 失败时保存 trace 到 `test-results/`，可用 `npx playwright show-trace TRACE_FILE` 查看。

## 未覆盖项

真实工具容器、跨设备工具登录与权限、YouTube/Bilibili 实际播放、绘画笔压和协作持久化需要服务级验收。浏览器自动化只覆盖 Chromium；Firefox、WebKit、移动触控和弱网络压力测试尚未提供。
