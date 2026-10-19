# Virtual Workspace

[English](README.md) | [简体中文](README.zh-CN.md)

基于 Phaser 4、Colyseus 和 Tiled 的 2D 多人互动空间，支持用选取的角色形象移动、互动、使用工具、文字交流。角色外观预设用于地图中的精灵形象，不是个人头像图片。

Tiled JSON 是地图几何与交互的源数据；服务端地图 registry 可登记多张 16×16 tile 的有限正交地图，Portal 在同一房间中切换地图与命名出生点。

地图作者直接选择 `action`、`variantSelector`、`privateArea`、`wardrobe`、`web` 或 `Portal` 类型。选择器独占动作点并切换目标图块；私密区域支持平等成员、锁定和服务端物理准入，连续 60 秒无成员在区域内时重置；镜子入口复用现有衣橱。新类型需在 Tiled 中显式制作，见[制图示例](docs/tiled.md)。聊天和附近语音按私密区域隔离：区域内的人只与同一区域内的人互通文字和语音，区域外的人留在公共频道；位置、正在输入标识等同步状态仍对整个房间可见。

地图中的外置工具统一使用 `web` 交互类型，以 `resourceId` 匹配 `EXTERNAL_TOOLS` 页面配置。进入区域只在区域上方显示小提示；点击提示后才用 `external` 新标签页打开，或在居中、可拖动的电视框窗口中展示 `embed` 沙盒 iframe；外置服务保留自己的账号和权限。正式注册/登录与账号恢复留待以后。

## 本地运行

需要 Node.js 24 或更新版本、npm。

```sh
cp .env.example .env
npm ci
npm run dev
```

打开 <http://localhost:5173>，在开始页选择世界，进入试衣间换装后进入空间。衣橱里每件衣服都直接穿在当前造型上预览；每个图层都提供糖果色预设和自由取色器，取色器左上角虚线框标出柔和区，可选“锁定在柔和区”。试衣镜可转身、预览坐姿；造型可从预设随机搭配、撤销，并保存到本浏览器的 3 个可命名造型槽位（保存时同时更新身份资料，资料随跨设备身份同步）。界面配色在开始页和试衣间右上角切换，提供 6 套预设和由四个颜色生成的自定义配色，按浏览器保存。素材放在 `assets/characters/{body,face,hair,top,bottom,shoes,accessories}/` 对应目录，构建时自动按文件夹生成分类；PNG 文件名就是素材 ID。上衣、下装、鞋子和配饰可选择“不穿”。预览与地图使用相同图层、16×24 帧和脚点；每层保存素材 ID 与可编辑的 RGB 颜色。没有账号和密码：开始页直接使用持久匿名身份，并提供跨设备一次性绑定码。世界选择目前是前端原型，世界名称只影响界面标签；后端使用地图 registry。地图内昵称显示在角色脚下，坐下时不变；HUD 可隐藏昵称，并把聊天栏背景切换为透明、半透明（默认）或实心，这些显示偏好按浏览器保存。

使用 WASD、方向键或屏幕方向按钮移动。触屏上按住或在方向键上滑动即可走动（支持斜向）；拖动中间的手柄可移动方向键；单击或长按手柄会在旁边显示提示，双击手柄（或设置里的“调整按键布局”）进入布局调整，可缩放方向键大小、把方向键和动作按钮拖到任意位置，或一键复原。布局保存在本浏览器。动作列表来自 shared 的动作目录 `CHARACTER_ACTIONS`（目前只有“坐下”），服务端拒绝目录外的动作名。点击列表中的动作即执行；按 E 执行角色脚下锚点的动作，不在锚点上时执行上次选择的动作；动画选项只对有动画帧的动作生效。移动会取消当前动作。在地图上按 Enter 打开聊天输入；输入框聚焦时所有按键都用于编辑文字（方向键移动光标）。按 Enter 发送并自动回到地图继续行走；按 Esc 或 Tab 不发送直接退出，草稿保留。其他输入框聚焦时键盘移动也会暂停。聊天框可拖动标题栏移动、拖右上角调整大小，双击标题栏或在设置中复原。服务端根据玩家权威位置验证动作请求并查找锚点。

聊天显示在可折叠的半透明面板中，同时以短暂的气泡显示在发言角色头顶；折叠时显示未读数。有人在聊天框里输入内容时，其他人会看到其角色头顶的跳动省略号；在设置中关闭“让别人看到我正在输入”即不再发送这一提示。昵称、气泡、省略号和说话麦克风与角色在同一帧绘制在地图画布上，走动时不会延迟跟随。

进入世界前会显示“进入前准备”：选择是否开麦进入、使用哪个麦克风（带实时音量条）、是否先静音；不打开麦克风就不会采集，选择保存在本浏览器。地图右上角的麦克风键开麦/闭麦（首次点击开启语音，之后闭麦仍保持连接、可继续听），喇叭键开关所有收到的语音（选择保存在本浏览器）；“设置”→“附近语音”中可切换麦克风（已连接的语音会直接换成新设备，无需重连），或断开语音并释放麦克风。昵称显隐在“设置”→“显示”中切换。本浏览器听到某个角色说话时（以及自己未静音说话时），角色头顶会显示麦克风标识；是否在说话由本地音量判断，不向服务端额外发送数据。语音使用浏览器间的 WebRTC 点对点音频。浏览器扫描已有玩家状态，服务端按连接状态、权威位置和地图 ID 校验每个信令连接，并通过 `GET /api/voice-config` 提供 ICE 配置；默认连接半径为 160 地图像素，断开半径为 192 像素，每个客户端最多连接 6 个语音节点。连接和断开半径之间的缓冲可避免在边界反复切换。语音需要麦克风权限和安全浏览器上下文（HTTPS 或 localhost）。ICE 配置会发送给浏览器，因此不要在其中放长期 TURN 凭据；需要中继时应使用 TURN 服务商签发的短期凭据。项目不运行 SFU，也不提供 TURN 服务。

相机默认采用整数倍率，使地图图块尽量接近 48 像素，并限制在 1x–6x；16×16 图块会显示为 48×48（3x）。在“设置”→“地图缩放”中可选择自动或 1x–6x 的固定整数倍率，选择立即生效并保存在本浏览器。动作锚点定义角色位置、动作和可选朝向，不绘制家具；地图作者可在 Tiled 视觉层独立摆放家具。`assets/characters/body/walk.png` 目前只有行走帧，因此动作暂时显示对应方向的 idle 帧，等待动作帧图集。帧尺寸和帧内脚点单独配置；替换图集时要同步检查角色定义中的帧尺寸和 `groundAnchor`。

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

生产环境需设置至少 32 字符的随机 `IDENTITY_SECRET`、公开站点 `IDENTITY_BASE_URL` 和实际前端来源 `IDENTITY_TRUSTED_ORIGINS`。单独托管前端时，通过同源反向代理连接 `/api`、`/matchmake` 和 Colyseus WebSocket；下方 Docker 镜像则在同一端口提供前后端。`VITE_SERVER_URL` 仅控制 Colyseus 连接地址，身份、地图与工具配置 API 始终使用同源 `/api`。

[GitHub Actions 工作流](.github/workflows/build-release.yml)在每次 push 后执行 `npm run check`。`main` 分支检查通过后，以该提交创建并标记为 **Latest** 的 Release，附带 `virtual-workspace.tar.gz`；同时发布 `ghcr.io/carbonc39/virtualworkspace:latest` 和 `sha-<提交哈希>` 镜像，支持 `linux/amd64` 与 `linux/arm64`。压缩包包含编译后的代码与资源；解压后执行 `npm ci --omit=dev`，配置生产环境变量，将 `FRONTEND_DIST_PATH` 指向解压目录下的 `apps/frontend/dist`，再执行 `npm start`。仓库 Actions 需要 Release 和 GHCR 的写入权限；若镜像包为私有，部署主机还需拉取权限。

Docker 镜像在 `2567` 端口同时提供前端、API 和 WebSocket。配置自己的 HTTPS 反向代理后，可用持久化 SQLite 卷运行：

```sh
docker run -d --name virtual-workspace --restart unless-stopped \
  -p 127.0.0.1:2567:2567 -v virtual-workspace-data:/app/data \
  --env-file .env.production \
  ghcr.io/carbonc39/virtualworkspace:latest
```

按上文要求在 `.env.production` 中设置 `IDENTITY_SECRET`、`IDENTITY_BASE_URL` 和 `IDENTITY_TRUSTED_ORIGINS`，后两者填写实际公开的 HTTPS 来源。替换容器时保持 secret 不变。镜像包含仓库中的地图和角色资源；外部工具仍需单独运行。

SQLite 按单后端实例部署，默认数据文件为 `data/world.sqlite`，需持久化并备份。HTTP Basic Auth 由部署者的代理提供。

用 `EXTERNAL_TOOLS` 将地图 `resourceId` 关联到 `{ url, mode?, manualExternalOpen?, allowSameOrigin? }`。URL 必填，mode 默认 `external`。embed 在点击后挂载，离开区域时移除；`manualExternalOpen: true` 在已打开的 iframe 旁提供手动外链，不检测加载失败。`allowSameOrigin` 默认 false，仅供可信自托管工具启用；旧 `fallback: "external"` 仍作为手动外链别名接受。项目不启动 Docker 容器，实际工具的部署和使用需另行验证。地图目录由 `GET /api/world` 提供，服务端发布规范化 Tiled JSON 和地图显式引用的资源。

近距离语音配置见 `.env.example`：`VOICE_ICE_SERVERS` 是 WebRTC ICE server 条目的 JSON 数组（默认包含一个公共 STUN 服务）；`VOICE_CONNECT_RADIUS` 默认 `160`，`VOICE_DISCONNECT_RADIUS` 默认 `192`，`VOICE_MAX_PEERS` 默认 `6`，`VOICE_SCAN_INTERVAL_MS` 默认 `1000`。后端通过 `GET /api/voice-config` 发布 ICE 列表；修改配置后需重启后端。STUN 可帮助发现直连路径；受限网络下需要中继时应配置 TURN。浏览器可见这份公开配置中的任何 TURN 凭据。静态凭据轮换需更新环境变量并重启后端；当前版本不签发 TURN 凭据。

如果在 `http://127.0.0.1:5173/` 仍提示浏览器 API 不可用，可在该页面的开发者工具 Console 运行 `({ secure: isSecureContext, mic: !!navigator.mediaDevices?.getUserMedia, rtc: !!window.RTCPeerConnection })`。三项都应为 `true`；若有 API 缺失，检查浏览器或内嵌预览的设置。其它设备访问需要 HTTPS。

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
