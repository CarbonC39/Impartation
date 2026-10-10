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

`check` 包含全部 workspace 和浏览器测试代码的 TypeScript 检查、Node 测试及生产构建。`test:e2e` 使用 Chromium，并自动启动开发服务；本地已有服务时会复用它。首次需要下载浏览器；Linux 缺系统依赖时按 Playwright 提示安装。可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定现有 Chromium。

## 覆盖范围

| 层级 | 覆盖行为 | 文件 |
| --- | --- | --- |
| 共享协议 | 昵称/头像合法与非法值、长度边界、trim、所有方向、NaN/Infinity、聊天类型与长度、去除额外身份/位置字段 | `apps/backend/test/protocol.test.ts` |
| 地图/移动 | 出生点、触发区资源、斜向速度、延迟步长限制、边界、墙面滑动、角落碰撞、无输入；ground/atlas、缺层、重复层、非法几何与数据 | `apps/backend/test/world.test.ts` |
| SQLite | WAL/外键配置、迁移版本、幂等重开、保存数据后重新连接、新版本拒绝 | `apps/backend/test/db.test.ts` |
| 真实 WebSocket | 多人同房、外观与位置同步、输入过期、障碍、非法入房与消息、聊天限流/冷却恢复、触发区进出、容量分房、主动离开、重连保持状态、超时清理与令牌失效、健康检查 | `apps/backend/test/space.test.ts` |
| 浏览器 | 两个页面双向纯文本聊天及 avatar 状态、发送聊天后重新聚焦地图移动、输入文字时暂停、离开后重入、窄屏布局、Vite HTTP/WS 代理与资源加载 | `apps/frontend/e2e/space.spec.ts` |

本轮验收结果为 62 项 Node 测试、5 项 Chromium 浏览器测试通过；类型检查和生产构建通过。这是已实现骨架的行为覆盖，不代表未来账号、影音、白板等功能已完成，也没有声称 100% 行覆盖率。

## 隔离与失败排查

- Node 联机测试使用 `@colyseus/testing`、真实 SDK 和 2568 端口；数据库设为 `:memory:`。SQLite 持久化测试使用临时目录，结束后删除。
- 浏览器测试使用 5173/2567 端口；自动启动时设内存数据库。复用已有开发服务时会出现测试访客，但不写入账号数据。
- 断线超时测试由服务端把测试房间的重连窗口缩短至 0.1 秒，生产默认仍为 20 秒；真实成功重连使用默认窗口。
- 非法载荷测试会出现框架预期的校验错误日志。以测试统计及退出码为准；非法消息应关闭发送方连接并立即释放其座位。
- Playwright 失败时保留 trace 到忽略的 `test-results/`，可用 `npx playwright show-trace <trace.zip>` 排查。
- 浏览器测试当前覆盖 Chromium；Firefox、WebKit、移动设备触控和弱网络压力测试留待对应需求阶段。当前移动支持键盘，没有触屏摇杆。

## 后续功能验收边界

账号阶段应增加会话失效、房间授权和资料持久化；影音阶段增加播放控制/晚加入对齐/自动播放限制；白板阶段增加并发编辑/断线合并/持久化。相关测试随实际功能加入，当前不创建无法验证的空测试。
