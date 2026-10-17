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

Playwright 自动启动独立开发服务和临时地图 registry；测试使用 5174/2569 端口，与开发服务的 5173/2567 分开。Linux 缺系统依赖时按 Playwright 提示安装，或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定现有 Chromium。NixOS 可使用：

```sh
nix-shell -p chromium --run 'PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)" npm run check:all'
```

## 覆盖范围

| 测试 | 覆盖行为 | 文件 |
| --- | --- | --- |
| 共享协议 | 输入类型、长度与数值边界，剥离伪造身份与计时字段 | [protocol.test.ts](../apps/backend/test/protocol.test.ts) |
| 地图与移动 | Tiled 语义与渲染约束分离、嵌套/偏移层、命名出生点、Portal 目标、碰撞、边界与移动步长；动作点朝向/偏移、同格动作匹配、非法动作锚点和方向输入朝向 | [world.test.ts](../apps/backend/test/world.test.ts) |
| 角色帧选择 | 角色图集尺寸与方向帧索引有效性、走路帧选择、idle/动作姿态回退 | [character.test.ts](../apps/backend/test/character.test.ts) |
| WebTool 配置 | 跨地图资源一致性、embed/external mode、手动外链与同源选项、非法 JSON/URL 与额外凭据字段拒绝 | [web-tools.test.ts](../apps/backend/test/web-tools.test.ts) |
| 交互架构 | 通用前后端分发、handler 清理、消息冲突、展示策略与 shared 协议一致性 | [architecture.test.ts](../apps/backend/test/architecture.test.ts) |
| 多地图服务 | registry/API、多图层和外置 TSJ 资源、权威 Portal 转换、目标地图碰撞和身份保留；同名对象按地图隔离 | [portal.test.ts](../apps/backend/test/portal.test.ts) |
| SQLite | v1-v3 迁移、旧留言保留、持久化、容量与作者权限 | [db.test.ts](../apps/backend/test/db.test.ts) |
| 管理员 CLI | 真实磁盘子进程执行 role/list，持久化角色并拒绝无效参数 | [identity-cli.test.ts](../apps/backend/test/identity-cli.test.ts) |
| HTTP 与 WebSocket | 匿名 session、资料、绑定码单次/过期、撤销与降权、留言权限、聊天限流、移动、重连、计时器、公开配置 API；角色动作身份校验、服务端锚点匹配、姿态同步和移动取消 | [space.test.ts](../apps/backend/test/space.test.ts) |
| 浏览器 | 界面引导、身份绑定、聊天、移动、留言、计时器、窄屏；屏幕方向按钮的 pointer 按住/松开与权威移动；角色资源加载、帧切片、脚点锚定、相机缩放下的世界/屏幕尺寸及窗口调整、行走与 idle 帧；窄屏动作列表、动画选项及移动取消动作；聊天气泡、聊天折叠与未读数；多地图 Portal 与多图层/tileset；区域上方入口提示、显式打开 embed/external、电视框窗口居中/拖动/关闭、手动外链和离开区域清理 | [space.spec.ts](../apps/frontend/e2e/space.spec.ts) |

角色帧索引及本地帧选择由 Node 测试检查；浏览器断言检查 Phaser 纹理的帧切片、脚点锚点、相机缩放与调整视口后的屏幕尺寸，并检查行走和 idle 帧选择。动作动画用例通过测试生成的八行图验证静态列 1、动画列 2–4 和移动取消；不替换产品素材。浏览器动作用例保存截图供视觉检查，不做像素快照比较。当前 `walk.png` 仍为 64×96 行走图，完整动作图集尚待提供；动作显示暂用方向 idle 帧。

工具入口浏览器测试拦截 `/api/tools` 提供固定配置，以 HTML 替身模拟工具页面，并检查目标 URL、opener 和 referrer。真实 HTTP 配置响应由 Node 集成测试验证。它们不验证真实服务的编辑、绘画与播放功能。

## 隔离与排查

- Node 联机测试使用 2568 端口和内存数据库；SQLite 持久化及 CLI 测试使用临时目录。
- 浏览器测试使用 5174/2569 端口、内存数据库和临时 Tiled fixture；默认大厅源数据不增加测试 Portal 或测试目的地。测试不复用已有开发服务。运行中修改源码或重建 shared 会触发 Vite 重载，应待测试结束后编辑。
- 断线超时用例将测试房间的重连窗口缩短至 0.1 秒；正常重连用例仍使用默认 20 秒。
- 非法载荷用例会产生预期校验日志，以退出码和测试统计为准。
- Playwright 失败时保存 trace 到 `test-results/`，可用 `npx playwright show-trace TRACE_FILE` 查看。

## 未覆盖项

真实工具服务、跨设备工具登录与权限、YouTube/Bilibili 实际播放、绘画笔压和协作持久化需要服务级验收。浏览器自动化只覆盖 Chromium；Firefox、WebKit、移动触控和弱网络压力测试尚未提供。测试验证 iframe 容器和 external 打开行为，不验证第三方站点允许嵌入或真实服务功能。
