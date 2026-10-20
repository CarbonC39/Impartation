# 账号、资料与权限

Better Auth 负责用户名/密码凭据、cookie session、密码校验和重置 token；身份信息及项目资料存于 SQLite。项目不自行实现密码存储或认证协议，也不实现 HTTP Basic Auth；如需额外入口保护，由部署者配置反向代理。用户使用自己的账号在各设备登录。

## 注册与登录

用户名经校验后转为小写，长度为 3–30 个 ASCII 字母、数字、下划线或点；显示名称长度为 1–24；密码长度为 8–128。注册成功后自动登录。登录使用用户名和密码，session cookie 有效期为 30 天，cookie cache 关闭。

用户名唯一且不提供修改接口；显示名称独立、可重名、可修改。Better Auth 必需的 email 字段使用服务端生成的唯一 `@accounts.invalid` 占位地址，不收集邮箱，也不提供邮箱登录或邮件恢复。旧匿名登录与设备绑定入口已关闭；已有匿名资料和公共内容保留，不自动转换成正式账号。

`REGISTRATION_MODE` 控制公开注册：

| 值 | 行为 |
| --- | --- |
| `open` | 任何人可注册，默认值 |
| `code` | 注册时必须提供 `REGISTRATION_CODE`；未配置注册码时服务器拒绝启动 |
| `admin` | 关闭公开注册，仅已登录管理员能在账号管理界面创建账号 |

注册走 `POST /api/register`；用户名登录由 Better Auth 的 `POST /api/auth/sign-in/username` 处理。认证路由只允许项目明确列出的 Better Auth 方法，其它路径返回 404。部署需配置至少 32 字符的随机 `IDENTITY_SECRET`、公开站点 `IDENTITY_BASE_URL` 和实际来源列表 `IDENTITY_TRUSTED_ORIGINS`。

## Session 与资料

`GET /api/me` 返回已验证 session 对应的资料；`PATCH /api/me` 更新显示名称、地图角色形象和当前换装外观。`avatar` 是预设地图角色形象 ID，不是个人头像；权限角色 `member`/`admin` 独立保存，资料更新不能修改权限。进入 Colyseus 房间及每次受保护的消息处理时，服务端验证 session 仍有效、账号未冻结，并读取服务端 profile；客户端提交的 user ID、session ID 或 role 不作为授权依据。

修改密码使用 `POST /api/me/password`，需要当前密码。成功后撤销该账号的所有 session，并清除当前浏览器 cookie。重置密码由管理员生成一次性 URL；生成链接本身不撤销 session，用户成功设置新密码时 Better Auth 会撤销该账号的所有 session。重置链接带有短期 token，应私下交给目标用户，不要写入公开日志或聊天。

重置链接有效期为一小时，成功使用一次后即失效；重新生成会使之前的重置链接失效。密码修改和重置完成时同时断开该用户所有 Space 的连接。`POST /api/auth/sign-out` 只撤销当前设备的 session，其余独立登录的设备不受影响。

资料响应中 `displayName`、`currentAppearance` 是显示名称和当前角色外观，兼容字段 `name`、`appearance` 与它们对应同一份持久数据。PATCH 接受这两组名字，同时提供时以 `displayName` 和 `currentAppearance` 为准。

浏览器的账号操作携带可选 `X-Account-Id`，服务端仅将它用于检测同源标签页切换账号后的陈旧界面；若与已验证的 session 身份不符则返回 409。该值不用于授权，省略或伪造它也不能访问其它账号的数据。

`GET /api/me/outfits` 返回当前账号的三个造型槽位；`PUT /api/me/outfits/:index` 以 `0`、`1` 或 `2` 指定单个槽位，body 为 `{ name, appearance }` 或 `null`。每次只改一个槽位，避免并发设备互相覆盖其它槽位。名称需为 1–12 个字符，外观按共享 `appearanceSchema` 验证。造型保存在 `saved_outfits` 表中，账号删除时一并清除；不从旧浏览器 localStorage 自动导入。

## 管理员操作

管理员界面由服务端以 session 对应 profile 的 `admin` role 授权，可列出账号、创建账号、提升/降级、冻结/解冻、生成密码重置链接、让在线连接下线或删除账号。管理动作使用 `POST /api/admin/users/:id/:action`，要求 JSON `{ "confirmed": true }`，浏览器还需二次确认；提供的 Origin 必须可信。创建账号使用 `POST /api/admin/users`，不会切换管理员的登录 session。服务端拒绝操作者删除、冻结或降级自己。管理员不绕过房间权限与交互校验。

冻结账号会撤销现有 session、拒绝新 session 并使在线连接下线；解冻后用户可用原密码重新登录。踢下线只断开该时刻已连接的会话，不冻结账号，也不阻止重新登录。在线断开命令写入 `moderation_commands`，运行中的房间每秒轮询；部署仅支持共享同一个 SQLite 文件的单后端实例。

本地维护命令使用与服务相同的 `.env` 和 `DATABASE_PATH`：

```sh
npm run identity -- list
npm run identity -- role USER_ID admin --yes
npm run identity -- role USER_ID member --yes
npm run identity -- suspend USER_ID --yes
npm run identity -- unsuspend USER_ID --yes
npm run identity -- delete USER_ID --yes
npm run identity -- reset-password USER_ID --yes
npm run identity -- kick USER_ID --yes
```

创建账号时密码仅从标准输入读取，不作为命令行参数传递：

```bash
printf 'Password: '
read -r -s ACCOUNT_PASSWORD
printf '\n'
printf '%s\n' "$ACCOUNT_PASSWORD" | npm run identity -- create USERNAME 'Display Name' --password-stdin
unset ACCOUNT_PASSWORD
```

`list` 输出账号资料及冻结状态。`reset-password` 在终端输出一次性重置 URL；`kick` 提示断开命令已排队，在线服务器通常在一秒内处理。破坏性权限或账号操作必须明确提供 `--yes`。CLI 直接访问 SQLite，因此仅可信主机用户应能运行它或读取数据库文件。

首次部署（包括 `admin` 注册模式）先用 CLI `create` 创建账号，再用 `list` 找到其 ID，通过 `role USER_ID admin --yes` 建立首位管理员。生产依赖部署可在构建后以 `node --env-file-if-exists=.env apps/backend/build/identity-cli.js ...` 运行相同子命令。

## 数据库与部署

项目自己的 SQLite `PRAGMA user_version` 已到 v6。v6 增加无 auth 外键的 `saved_outfits` 和 `moderation_commands` 表；无外键可避免 Better Auth 尚未迁移 auth 表时的顺序耦合。账号删除通过 Better Auth 生命周期钩子删除 profile 和已保存造型。Better Auth 自己的用户、密码凭据、session 和 verification 表由其迁移管理。升级前备份 SQLite 文件。

SQLite/WAL 部署要求单后端实例并使用持久卷。生产需 HTTPS/WSS 和同源反向代理；HTTP Basic Auth 若有需要由代理提供，不由项目配置。

## 测试

身份 API、注册策略、密码/session、管理员操作、三槽造型、SQLite 迁移和 CLI 覆盖位置见[测试说明](testing.md)。
