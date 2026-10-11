# 外部工具入口

走进地图功能区后，点击链接在新标签页打开工具原生页面。工具使用自己的账号、权限、内容存储和协作机制；项目提供地址配置，不启动容器、不嵌入 iframe、不同步项目身份和管理员权限。

## 配置

在宿主机部署工具，先确认其页面能从使用设备访问，再将地址写到根目录 `.env`：

```dotenv
EXTERNAL_TOOLS='{"shared-canvas":{"kind":"whiteboard","url":"https://board.example.com/boards/workspace"}}'
```

替换示例域名和路径。可以只配置需要的资源，默认 `{}` 表示全部未配置。完整示例见 [`.env.example`](../.env.example)。修改后重启后端，无需重建前端。

| 默认 resourceId | kind | 功能 |
| --- | --- | --- |
| `shared-canvas` | `whiteboard` | 白板 |
| `shared-drawing` | `drawing` | 共同作画 |
| `lounge-screen` | `media` | 同步观看 |
| `shared-document` | `document` | 协作文档 |

`EXTERNAL_TOOLS` 必须是 JSON 对象，key 为地图 `resourceId`，value 只包含 `kind` 和 `url`：

- `kind` 必须与引用该资源的所有地图区域一致，只接受表中的四类。
- `url` 必须是绝对 HTTP(S) 地址，不得内嵌用户名或密码；配置不能额外加入 token/role 等字段。
- 地址可指向固定白板、文档或房间，也可指向工具大厅。同一资源的所有入口使用同一 URL，资源创建与成员设置由工具管理。
- 使用浏览器可访问的地址；手机的 `localhost` 指向手机自身，Docker 内部服务名也不是发布地址。Drawpile 需填写 Web 客户端页面，TCP 服务端口不能作为网页入口。

非法 JSON、未知资源、类型不符或非法 URL 会导致后端启动失败。自定义地图格式见[地图说明](tiled.md)。

## API

`GET /api/tools` 公开返回已配置入口，响应设为 `Cache-Control: no-store`：

```json
[
  {
    "resourceId": "shared-canvas",
    "kind": "whiteboard",
    "url": "https://board.example.com/boards/workspace"
  }
]
```

该 API 不要求匿名 session，不创建身份或签发工具凭据。配置地址会公开发送到浏览器，因此不要放管理凭据或私密邀请 token。

## 访问行为

未配置的区域提示缺少工具地址。配置 API 加载失败或返回非法数据时显示错误，重新进入空间后再请求；不影响移动、聊天、留言板和番茄钟。工具本身不可用时，由新标签页显示错误，项目不探测或重试工具服务。

链接使用 `noopener noreferrer`；离开区域或空间后隐藏链接，已打开的工具会话继续由工具管理。地图入口的显示不构成访问授权，项目 session 失效或管理员角色变化不会撤销工具权限。

项目不代理工具请求，也不在 URL 中附加身份、角色或 Basic Auth 凭据。浏览器仍按目标地址与 Cookie/HTTP 认证规则携带已有凭据，同域子路径部署尤其如此。代理门禁由部署者配置。

内置与外置工具的分类和权限边界见[接入说明](integrations.md)；入口测试和真实服务验收的区别见[测试说明](testing.md)。
