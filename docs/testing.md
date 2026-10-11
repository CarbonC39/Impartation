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
| SQLite | WAL/外键配置、项目 user_version v1-v3 升级、幂等重开、旧留言数据保留及 NULL 作者迁移、资料和留言存储、新版本拒绝 | `apps/backend/test/db.test.ts` |
| 本地 CLI（真实磁盘子进程） | 创建匿名身份后启动真实 `npm run identity` 子进程执行 role/list；验证 admin/member 写入已打开的磁盘数据库，并拒绝未知 user、非法角色和多余参数 | `apps/backend/test/identity-cli.test.ts` |
| HTTP 与真实 WebSocket | 匿名身份、profile 读写与 role 防伪、无效身份拒绝、持久作者归属、管理员/普通成员留言删除权限、旧留言清理、绑定码哈希/单次/过期/session 恢复、聊天限流、房间移动和重连、番茄钟 | `apps/backend/test/space.test.ts` |
| 浏览器 | 双页面聊天、身份初始化和会话恢复、跨浏览器绑定同一身份/资料/留言权限、移动、留言与番茄钟面板、窄屏布局 | `apps/frontend/e2e/space.spec.ts` |

本轮已执行 `npm run check`：strict 类型检查、109 项 Node 测试和生产构建通过；最后的客户端调整再次通过 `npm run typecheck` 和 `npm run build`。`PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向 NixOS Chromium 后运行 `npm run test:e2e`，8 项浏览器测试通过。这些检查结果也不代表未来正式账号、影音或白板的验收。

## 隔离与失败排查

- Node 联机测试使用 `@colyseus/testing`、真实 SDK 和 2568 端口；数据库设为 `:memory:`。SQLite 持久化测试使用临时目录，结束后删除。
- 浏览器测试使用 5173/2567 端口；自动启动时设内存数据库。复用已有开发服务时会写入测试匿名身份、资料及留言；应使用独立测试服务以免留下留言。
- 断线超时测试由服务端把测试房间的重连窗口缩短至 0.1 秒，生产默认仍为 20 秒；真实成功重连使用默认窗口。
- 非法载荷测试会出现框架预期的校验错误日志。以测试统计及退出码为准；非法普通消息关闭发送方连接并释放座位，非法功能 request 返回错误且不修改状态、不关闭连接。
- Playwright 失败时保留 trace 到忽略的 `test-results/`，可用 `npx playwright show-trace <trace.zip>` 排查。
- 浏览器测试当前覆盖 Chromium；Firefox、WebKit、移动设备触控和弱网络压力测试留待对应需求阶段。当前移动支持键盘，没有触屏摇杆。

## 功能边界

留言板数据写入 SQLite v2/v3 表；旧作者 user id 为 NULL。计时器只存在于各个房间运行状态中，房间销毁或后端重启后重置。番茄钟由房间服务端每秒核对截止时间，客户端用服务端时间快照和 `performance.now()` 平滑显示倒计时。留言操作要求匿名 session 有效、当前连接且处于对应功能区，并按连接限流 500ms；管理员权限只扩大可删除留言范围。

留言删除权限绑定 Better Auth 持久 user id；20 秒断线重连保留房间连接，新的 Colyseus session 仍能以同一有效身份管理自己的留言。session 撤销或过期会阻止后续入房和功能操作。正式注册/登录仍待后续；影音阶段增加播放控制/晚加入对齐/自动播放限制；白板阶段增加并发编辑/断线合并/持久化。
