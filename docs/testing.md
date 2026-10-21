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

GitHub Actions 对每次 push 执行 `npm run check`；`main` 通过后发布 Release 与 amd64/arm64 Docker 镜像。浏览器测试和容器在目标主机的运行验证不在该工作流中。

Playwright 自动启动独立开发服务和临时地图 registry；测试使用 5174/2569 端口，与开发服务的 5173/2567 分开。Linux 缺系统依赖时按 Playwright 提示安装，或通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定现有 Chromium。NixOS 可使用：

```sh
nix-shell -p chromium --run 'PLAYWRIGHT_CHROMIUM_EXECUTABLE="$(command -v chromium)" npm run check:all'
```

## 覆盖范围

| 测试 | 覆盖行为 | 文件 |
| --- | --- | --- |
| 共享协议 | 输入类型、长度与数值边界，剥离伪造身份与计时字段；语音信令、ICE 配置和距离资格 | [protocol.test.ts](../apps/backend/test/protocol.test.ts) |
| 地图与移动 | Tiled 语义与渲染约束分离、嵌套/偏移层、命名出生点、Portal 目标、碰撞、边界与移动步长；动作点朝向/偏移、同格动作匹配、非法动作锚点和方向输入朝向 | [world.test.ts](../apps/backend/test/world.test.ts) |
| 显式交互制作 | 选择器单/多变体、数字对象引用、分组偏移、未知属性保留和非法配置拒绝 | [interaction-authoring.test.ts](../apps/backend/test/interaction-authoring.test.ts) |
| 场景多人交互 | 并发独占、变体同步、取消/移动/断线/Portal 清理；私密成员平等权限、重入、完整脚底边界/动作偏移/Portal 准入、空置重置及同图传送；私密区域聊天与语音隔离 | [scene-interactions.test.ts](../apps/backend/test/scene-interactions.test.ts) |
| Tiled 属性与模板 | Custom Classes 默认值、typed properties、直接与嵌套 object references、模板继承与 GID 映射、动画帧校验 | [tiled-normalizer.test.ts](../apps/backend/test/tiled-normalizer.test.ts) |
| 瓦片动画浏览器 | WebGL/Canvas 普通层、ySort、abovePlayers 和变体目标的真实帧像素变化、帧时长与深度 | [tiled-animation.spec.ts](../apps/frontend/e2e/tiled-animation.spec.ts) |
| 多边形语义 | 凹多边形、绕序、图层偏移、包围框空角、边界接触、脚底碰撞、私密区域重叠与非法几何 | [polygon.test.ts](../apps/backend/test/polygon.test.ts) |
| 角色帧选择 | 角色图集尺寸与方向帧索引有效性、走路帧选择、idle/动作姿态回退 | [character.test.ts](../apps/backend/test/character.test.ts) |
| WebTool 配置 | 跨地图资源一致性、embed/external mode、手动外链与同源选项、非法 JSON/URL 与额外凭据字段拒绝 | [web-tools.test.ts](../apps/backend/test/web-tools.test.ts) |
| 交互架构 | 通用前后端分发、handler 清理、消息冲突、展示策略与 shared 协议一致性 | [architecture.test.ts](../apps/backend/test/architecture.test.ts) |
| 多地图与 Space 服务 | registry/API、Space 顺序与 metadata、多图层和外置 TSJ 资源、Space 内 Portal 转换/成员地图校验、目标地图碰撞和身份保留；同名对象按地图隔离 | [portal.test.ts](../apps/backend/test/portal.test.ts) |
| SQLite | v1-v6 迁移、旧留言归入 `main`、按 Space/resource 持久化、作者权限、saved outfits 持久化 | [db.test.ts](../apps/backend/test/db.test.ts) |
| 管理员 CLI | 真实磁盘子进程创建账号、role/list、冻结/解冻、重置链接、kick 队列和删除；密码仅从 stdin 输入、危险操作要求确认 | [identity-cli.test.ts](../apps/backend/test/identity-cli.test.ts) |
| Space 交互与并发 | 初始地图、复用地图下的选择器/私密区域隔离、runtime 容量与并发满员拒绝 | [scene-interactions.test.ts](../apps/backend/test/scene-interactions.test.ts) |
| 后端容量配置 | 默认值、环境覆盖和非法上限拒绝 | [config.test.ts](../apps/backend/test/config.test.ts) |
| 正式账号 | 用户名唯一与显示名称重复、登录与密码修改、重置令牌单次使用和过期、session 撤销、三槽造型隔离与输入校验、管理员权限和删除清理 | [accounts.test.ts](../apps/backend/test/accounts.test.ts) |
| HTTP 与 WebSocket | Space 必填 join、每 Space 单 room、满员拒绝与配置容量、Space runtime 隔离；账号按 Space 单连接（同登录 session、不同登录 session、并发加入、跨 Space、重连保留及离开/超时清理）；用户名账号注册策略、登录、session、profile、冻结与撤销、saved outfits、管理员操作权限、留言权限、聊天限流、正在输入状态、移动、重连、计时器、公开配置 API；角色动作身份校验、服务端锚点匹配、姿态同步和移动取消；语音 opt-in、地图/距离、节点容量、信令转发和范围退出 | [space.test.ts](../apps/backend/test/space.test.ts) |
| 浏览器 | Space 列表顺序、选择后的初始地图与玩家隔离；注册/登录、跨浏览器登录、个人资料与留言权限；聊天、移动、留言、计时器、窄屏；屏幕方向按钮的 pointer 按住/松开与权威移动；角色资源加载、帧切片、脚点锚定、相机缩放下的世界/屏幕尺寸及窗口调整、行走与 idle 帧；窄屏动作列表、动画选项及移动取消动作；聊天气泡、聊天折叠与未读数；衣橱单品预览、服务端三个造型槽位的保存/覆盖确认/刷新恢复和跨账号隔离、自定义界面配色、昵称显隐和聊天背景偏好的保存；多地图 Portal 与多图层/tileset；区域上方入口提示、显式打开 embed/external、电视框窗口居中/拖动/关闭、手动外链和离开区域清理；语音点击麦克风键授权、开麦/闭麦、断开语音、喇叭键静音来声、双浏览器音轨交换和离开清理；进入前准备的开麦/不开麦/返回、只请求一次麦克风、静音进入；说话时自己和对方头顶的麦克风标识；正在输入省略号的显示、发送后消失与设置关闭；方向键手柄提示、双击进入布局调整、缩放方向键、拖动方向键与动作按钮并保存 | [space.spec.ts](../apps/frontend/e2e/space.spec.ts) |

显式交互浏览器用例检查选择器按钮和目标 GID 画面、私密区域锁定按钮，以及镜子打开原有衣橱、保存/返回后保留房间和 session。自动化用例使用临时测试地图和独立 Space fixtures；仓库另提供可从大厅进入的交互试验场，手动体验路径见 [地图说明](tiled.md#交互试验场)。

账号浏览器用例检查注册、登录、退出、修改密码、跨设备资料与造型槽，以及同源标签页切换账号后的草稿隔离。空间用例验证同账号新连接替换旧连接、旧重连 token 失效、普通断线恢复原 session、刷新后立即重进、合成 pagehide/pageshow 缓存恢复，以及延迟 matchmaking 响应完成后的连接释放；合成事件不代表验证了各浏览器的真实缓存命中策略。[accounts.spec.ts](../apps/frontend/e2e/accounts.spec.ts) 的管理员面板与重置表单用 HTTP 响应替身检查二次确认、自我管理限制、链接展示和重置 token 的地址清理；真实管理员授权、重置令牌生命周期及 session 撤销由 Node HTTP/WebSocket 测试验证。

角色帧索引及本地帧选择由 Node 测试检查；浏览器断言检查 Phaser 纹理的帧切片、脚点锚点、相机缩放与调整视口后的屏幕尺寸，并检查行走和 idle 帧选择。动作动画用例通过测试生成的八行图验证静态列 1、动画列 2–4 和移动取消；不替换产品素材。浏览器动作用例保存截图供视觉检查，不做像素快照比较。当前 `walk.png` 仍为 64×96 行走图，完整动作图集尚待提供；动作显示暂用方向 idle 帧。

工具入口浏览器测试拦截 `/api/tools` 提供固定配置，以 HTML 替身模拟工具页面，并检查目标 URL、opener 和 referrer。真实 HTTP 配置响应由 Node 集成测试验证。它们不验证真实服务的编辑、绘画与播放功能。

语音浏览器测试使用模拟麦克风检查点击后才捕获、静音、离开清理，以及两个附近浏览器间的真实 WebRTC 音轨交换；用持续音调模拟说话以检查麦克风标识。切换麦克风设备、真实语音阈值是否合适未自动化验证。短期 TURN 凭据接口的鉴权、撤销、冻结、HMAC 与有效期由 HTTP 测试验证；浏览器使用接口替身检查新建连接前刷新过期凭据。自动化检查不验证真实麦克风权限提示、NAT 穿透、音质或多种浏览器/网络组合；这些项目需在 HTTPS 或 localhost 与目标 STUN/TURN 配置下手动验收。

## 隔离与排查

- Node 联机测试使用 2568 端口和内存数据库；SQLite 持久化及 CLI 测试使用临时目录。
- 浏览器测试使用 5174/2569 端口、内存数据库和临时 Tiled fixture；自动化测试不改写产品地图；大厅自带的交互试验场用于手动体验。测试不复用已有开发服务。运行中修改源码或重建 shared 会触发 Vite 重载，应待测试结束后编辑。
- 断线超时用例将测试房间的重连窗口缩短至 0.1 秒；正常重连用例仍使用默认 20 秒。
- 非法载荷用例会产生预期校验日志，以退出码和测试统计为准。
- Playwright 失败时保存 trace 到 `test-results/`，可用 `npx playwright show-trace TRACE_FILE` 查看。

## 未覆盖项

私密区域隔离聊天和语音，但不隔离 Schema 可见性（位置、正在输入标识）；浏览器端的私密消息标记和进出提示未自动化验证。区域形状支持不重叠矩形或简单多边形，复杂门禁拓扑与永久 ACL 未实现。

真实工具服务、跨设备工具登录与权限、YouTube/Bilibili 实际播放、绘画笔压和协作持久化需要服务级验收。浏览器自动化只覆盖 Chromium；Firefox、WebKit、移动触控和弱网络压力测试尚未提供。测试验证 iframe 容器和 external 打开行为，不验证第三方站点允许嵌入或真实服务功能。
