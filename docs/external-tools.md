# 外部工具入口配置

本文说明如何把地图 `web` 互动的 `resourceId` 关联到可打开的网页。项目不安装或管理外部服务；部署与权限边界见[互动功能与外部服务](integrations.md)。

## 配置入口

在项目运行环境中设置 `EXTERNAL_TOOLS`。本地开发可在根目录 `.env` 中设置。Compose 示例中应在 `compose.example.yml` 的服务环境变量处启用并编辑 `EXTERNAL_TOOLS`；`compose.env` 只为 Compose 文件提供变量插值，不会自动传入容器。每个配置键必须对应某张 Space 地图中的 `web` 互动 `resourceId`。

```dotenv
EXTERNAL_TOOLS='{"shared-canvas":{"url":"https://board.example.com/boards/workspace"},"shared-document":{"url":"https://docs.example.com/p/workspace","mode":"embed","manualExternalOpen":true}}'
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `url` | HTTP(S) URL | 必填 | 浏览器打开的目标地址；不能包含用户名或密码 |
| `mode` | `external` / `embed` | `external` | 在新标签页打开，或在项目窗口中嵌入 |
| `manualExternalOpen` | boolean | `false` | `embed` 打开后，额外显示手动新标签页链接 |
| `allowSameOrigin` | boolean | `false` | `embed` iframe 增加 `allow-same-origin` 权限 |

示例：

```dotenv
EXTERNAL_TOOLS='{"nekobrowser":{"url":"https://browser.example.com/"}}'
```

更改配置后重启后端。服务启动时会解析配置，并检查每个配置项至少对应一个 `web` 区域；某个资源 ID 在地图中重复使用时，所有匹配区域都必须是 `web` 类型。

## 打开方式

- `external` 在玩家点击入口时通过浏览器新标签页打开 URL，并设置 `noopener noreferrer`。
- `embed` 在玩家点击入口后才创建 sandbox iframe；离开互动区域、断开连接或关闭窗口时会移除 iframe。默认沙盒权限为 `allow-scripts allow-forms allow-popups`，referrer policy 为 `no-referrer`。
- `manualExternalOpen: true` 只提供额外链接，不监测 iframe 是否加载失败，也不会自动切换到新标签页。
- `allowSameOrigin: true` 仅对 `embed` 生效。只对可信的自托管服务开启；结合允许脚本运行会削弱 iframe 的隔离效果。

默认优先使用 `external`。启用 `embed` 前，在实际浏览器确认服务允许被嵌入且登录方式可用。无法嵌入的服务应使用 `external`。

## 访问控制

`GET /api/tools` 公开返回配置的 `resourceId`、URL 和展示选项，供浏览器按地图区域匹配入口。因此 URL 对所有访问者可见，不要在其中放置 token、密码、项目 user ID、管理员角色或私密邀请凭据。

进入 `web` 区域只决定何时显示入口，不代表用户已获外部服务授权。项目不传递账号身份、不代理工具请求，也没有 iframe `postMessage` bridge。外部服务及其反向代理负责验证用户和控制内容访问。手机上的 `localhost` 指向手机本身；Docker 内部服务名通常也不能作为浏览器可访问地址。

## 已有示例

Compose 文件注释中包含可选的 WBO 白板和 Etherpad 服务及代理路由。启用后还需在 `EXTERNAL_TOOLS` 中配置对应 URL，并按部署需要设置代理访问控制。Compose 示例不是已运行服务的保证，也不代表已完成目标浏览器的验收。其它协作绘画或同步观看服务需单独部署。
