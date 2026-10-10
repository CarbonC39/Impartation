# 测试与验收

## 命令

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
# 或在浏览器准备好后一次执行：
npm run check:all
```

根目录 `check` 依次运行全部 workspace 和 E2E 代码的 TypeScript 检查、Node 测试和生产构建；它不运行浏览器测试。`test:e2e` 使用 Chromium，并自动启动开发服务；本地已有服务时会复用它。首次需要下载浏览器；Linux 缺系统依赖时按 Playwright 提示安装。可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定现有 Chromium。

NixOS 上下载的通用 Linux 浏览器可能缺动态库，可用 Nix 提供的 Chromium：

```sh
nix-shell -p chromium --run 'PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)" npm run check:all'
```

## 覆盖范围

| 层级 | 覆盖行为 | 文件 |
| --- | --- | --- |
| 共享协议 | 昵称/头像合法与非法值、长度边界、trim、所有方向、NaN/Infinity、聊天类型与长度、留言板文本/资源 ID/UUID、番茄钟 action/mode、剥离伪造身份与计时字段 | `apps/backend/test/protocol.test.ts` |
| 地图/移动 | 出生点、触发区资源、斜向速度、延迟步长限制、边界、墙面滑动、角落碰撞、无输入；ground/atlas、缺层、重复层、非法几何与数据 | `apps/backend/test/world.test.ts` |
| SQLite | WAL/外键配置、v1 到 v2 迁移、幂等重开、留言持久化、100 条容量、资源隔离/删除权限、新版本拒绝 | `apps/backend/test/db.test.ts` |
| 真实 WebSocket | 多人同房、外观与位置同步、输入过期、障碍、非法入房与消息、聊天限流、触发区进出、容量分房、跨房间留言同步/当前会话删除权限、番茄钟控制/晚加入/到期/房间隔离、重连、超时清理、健康检查 | `apps/backend/test/space.test.ts` |
| 浏览器 | 双页面聊天与 avatar、移动和输入暂停、离开后重入、窄屏布局、Vite 代理与资源加载；地图触发面板、双页面留言/删除权限/重入保留、番茄钟控制及晚加入同步、390px 功能面板 | `apps/frontend/e2e/space.spec.ts` |

本次已执行 `npm run check:all`，96 项 Node 测试、7 项 Chromium 浏览器测试、strict 类型检查及生产构建通过。浏览器使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定 NixOS Chromium；默认下载路径未安装匹配的浏览器，已有通用 Linux 浏览器缺动态库，使用 NixOS 版本后完整通过。已查看留言板和番茄钟的 390px 截图。这些结果不代表未来账号、影音、白板的验收。

## 隔离与失败排查

- Node 联机测试使用 `@colyseus/testing`、真实 SDK 和 2568 端口；数据库设为 `:memory:`。SQLite 持久化测试使用临时目录，结束后删除。
- 浏览器测试使用 5173/2567 端口；自动启动时设内存数据库。复用已有开发服务时会出现测试访客和测试留言，不写入账号数据；应使用独立测试服务以免留下留言。
- 断线超时测试由服务端把测试房间的重连窗口缩短至 0.1 秒，生产默认仍为 20 秒；真实成功重连使用默认窗口。
- 非法载荷测试会出现框架预期的校验错误日志。以测试统计及退出码为准；非法普通消息关闭发送方连接并释放座位，非法功能 request 返回错误且不修改状态、不关闭连接。
- Playwright 失败时保留 trace 到忽略的 `test-results/`，可用 `npx playwright show-trace <trace.zip>` 排查。
- 浏览器测试当前覆盖 Chromium；Firefox、WebKit、移动设备触控和弱网络压力测试留待对应需求阶段。当前移动支持键盘，没有触屏摇杆。

## 功能边界

留言板数据写入 SQLite v2；计时器只存在于各个房间运行状态中，房间销毁或后端重启后重置。番茄钟由房间服务端每秒核对截止时间，客户端用服务端时间快照和 `performance.now()` 平滑显示倒计时。功能请求按访客会话限流 500ms，并要求访客当前连接且处于地图中的对应功能区。

留言删除权限只绑定 Colyseus 当前 session：20 秒断线重连保留 session；正常离开或刷新后新 session 无权删除旧会话留言。没有编辑或管理员清理功能。账号阶段仍需增加稳定身份、会话失效、房间授权和资料持久化；影音阶段增加播放控制/晚加入对齐/自动播放限制；白板阶段增加并发编辑/断线合并/持久化。
