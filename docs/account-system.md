# 持久匿名身份与权限

当前实现由 Better Auth 1.7.7 管理匿名用户、session cookie 和一次性令牌。Better Auth 使用 MIT 许可；匿名 session 和单次跨设备凭据都交给现成库处理，项目不手写签名或认证，也没有把该库打包进浏览器。正式注册/登录、密码管理及第三方账号以后再做；HTTP Basic Auth 由部署者自行配置，项目不实现 Basic Auth 认证或代理配置。详见 [Anonymous 插件](https://better-auth.com/docs/plugins/anonymous)、[One-Time Token 插件](https://better-auth.com/docs/plugins/one-time-token)和[Session Management](https://better-auth.com/docs/concepts/session-management)。

## 身份与 session

- `POST /api/auth/sign-in/anonymous` 创建匿名用户并设置 Better Auth session cookie。首次访问资料 API 或连接空间时，服务端为 user 建立项目资料。匿名 user 和资料存于 SQLite；同一浏览器刷新时由 cookie 恢复身份，换浏览器需绑定。
- session 默认有效期 30 天，默认 `updateAge` 为一天。`/api/me` 通过 Better Auth 验证 cookie，并会把库刷新后的 `Set-Cookie` 响应头转发给浏览器。Colyseus 入房时也从 cookie 验证身份，但禁用 session 刷新，不会刷新浏览器 cookie；`client.sessionId` 只是一次房间连接标识。入房后每条受保护房间消息都使用入房时验证的 session token，由 Better Auth internal adapter 重新查验 session 是否有效，再读取最新资料和角色；不会从每条消息重新解析 cookie。
- `GET /api/auth/get-session` 查询当前 session；`POST /api/auth/sign-out` 撤销当前 session。绑定设备使用同一个 session，因此该 session 失效后，所有使用它的设备都会失效并需重新绑定。匿名用户删除被禁用。
- 公共 `space` 房间对任何持有有效匿名身份的用户开放。身份不提供好友、私密房间或房间成员权限。

## 资料与跨设备绑定

个人资料仅包含昵称 `name` 和占位头像 `avatar`。`GET /api/me` 读取当前用户资料，`PATCH /api/me` 更新昵称和头像；`role` 会随资料返回供界面显示，但更新接口不接受角色修改。角色只能由本地 CLI 设置。绑定码兑换会把当前浏览器切换到原身份；不会合并当前浏览器原身份的资料或留言。cookie 丢失或会话过期且没有其它有效 session 时，目前没有账号恢复方式。

在已绑定的设备中生成绑定码会调用 `GET /api/auth/one-time-token/generate`。在新设备的身份区域输入绑定码会调用 `POST /api/auth/one-time-token/verify`，兑换后新设备获得同一 session cookie 和同一资料。绑定码使用哈希存储，3 分钟后过期且只能成功兑换一次。它等同于短时 session 凭据：通过 HTTPS 传输，不要放入日志、聊天或截图；获得绑定码的人会取得该身份及其权限。应在交换完成后清除显示的绑定码。前端身份 API 始终请求当前站点同源 `/api`；`VITE_SERVER_URL` 只控制 Colyseus 连接地址。

所有携带 cookie 的状态变更请求都须通过 Better Auth 的可信来源/CSRF 检查；`PATCH /api/me` 也要求 JSON，并在提供 `Origin` 时校验它属于 `IDENTITY_TRUSTED_ORIGINS`。原生客户端也必须发送当前 session cookie 和符合配置的 `Origin`，否则状态变更请求会被拒绝。

界面复用现有风格的资料详情区域，提供生成和输入绑定码的控件；绑定前需要先离开空间。进入空间前会载入并显示已有昵称和头像。

## 留言权限

留言创建时，服务端从已验证的 Better Auth user 取作者身份，并将其写入 `board_notes.author_user_id`。请求不能指定作者 user id 或管理员角色。作者可以删除自己的留言；`admin` 角色可以删除其他作者的留言及无法关联作者的历史留言。两种删除都要求当前连接者仍在对应留言板区域，并受每连接 500ms 操作间隔限制。管理员角色本身不绕过位置、身份有效性或速率限制。

数据库 v3 为留言新增 nullable `author_user_id`。v1/v2 留言只有临时 `author_session_id`，不能可靠映射到稳定身份；迁移后保持 NULL，不按昵称猜测或自动认领。管理员可在留言板区域清理这些旧留言。已有关联的留言权限以 user id 为准，换设备不影响。

## 本地管理员 CLI

在后端使用的同一 `.env` 和 `DATABASE_PATH` 下运行：

```sh
npm run identity -- list
npm run identity -- role <userId> admin
npm run identity -- role <userId> member
```

`list` 显示数据库资料及 user id；`role` 只接受现存 user id 和 `admin`/`member`。先让目标用户创建匿名身份，再通过身份详情区域读取 user id，之后由能访问服务器 SQLite 文件的操作者运行 CLI。该命令直接更新本地数据库，不提供远程管理员授予 API。仅安装生产依赖时，构建后可在项目根目录运行 `node --env-file-if-exists=.env apps/backend/build/identity-cli.js role <userId> admin`。WAL 和 5000ms busy timeout 支持服务在线时操作；每次房间消息都会重新读取数据库中的最新资料和角色，role 修改在线生效。仅可信主机用户应能读取数据库或运行命令。

## 数据库迁移与部署配置

项目自己的 `PRAGMA user_version` 迁移负责 v1-v3 项目表；v3 增加资料名称/角色及留言作者 user id。Better Auth 的 `auth_user`、`auth_account`、`auth_session`、`auth_verification` 等表在 `betterAuth` 实例化前，由 `getMigrations(identityOptions).runMigrations()` 按当前 schema 独立创建/更新，不共享 `user_version`。上线前备份 SQLite 文件并确认部署进程使用目标 `DATABASE_PATH`；旧留言作者列保持 NULL。

生产环境必须显式设置随机且至少 32 字符的 `IDENTITY_SECRET`、公开站点 origin 对应的 `IDENTITY_BASE_URL` 和 `IDENTITY_TRUSTED_ORIGINS`；启动会拒绝缺少这些变量或仍使用示例 development secret 的配置。trusted origins 仅列真实部署来源，不沿用示例 localhost 列表。推荐同源反向代理 `/api`、`/matchmake` 与 Colyseus WebSocket，使用 HTTPS/WSS。SQLite 按单后端实例部署并挂载持久卷。

## 验收

已执行 `npm run check`，109 项 Node 测试、strict 类型检查与构建通过；客户端最后调整后再次执行类型检查和构建。NixOS Chromium 下 `npm run test:e2e` 的 8 项测试通过，覆盖刷新恢复资料和留言权限、跨浏览器绑定。Node 检查还覆盖绑定码哈希/并发单次消费/过期、session 撤销与重连拒绝、cookie 续期、角色防伪和即时降权、旧留言迁移，以及真实磁盘上的管理员 CLI。详见 [测试说明](testing.md)。
