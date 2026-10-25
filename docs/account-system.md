# 账号、资料与权限

项目使用 Better Auth 管理用户名、密码和登录 session；SQLite 中的项目资料保存显示名称、地图角色形象、外观、权限角色和已保存造型。登录 session 证明账号身份，`member`/`admin` 是项目权限，两者都不能由客户端资料字段自行指定。

## 注册与账号资料

注册策略由 `REGISTRATION_MODE` 控制：

| 值 | 行为 |
| --- | --- |
| `open` | 任何人可注册，默认值 |
| `code` | 注册时提供 `REGISTRATION_CODE`；注册码未配置时服务拒绝启动 |
| `admin` | 关闭公开注册；管理员仍可在管理界面创建账号 |

用户名为 3–30 位 ASCII 字母、数字、下划线或点，不区分大小写且不能修改；显示名称为 1–24 个字符，可重名、可修改。密码为 8–128 个字符。注册后会自动登录。

Better Auth 需要 email 字段，但项目为账号生成不可投递的占位地址；不收集邮箱、不支持邮箱登录或邮件找回。账号恢复由管理员生成一次性重置链接。

项目资料与权限分开保存：

| 字段 | 含义 |
| --- | --- |
| `avatar` | 地图人物精灵形象预设 ID，不是个人头像 |
| `appearance` | 当前人物分层造型及各层颜色 |
| `role` | 项目权限：`member` 或 `admin` |
| `suspended` | 账号是否冻结；冻结状态由服务器管理 |

`GET /api/me` 读取当前账号资料；`PATCH /api/me` 更新显示名称、`avatar` 和 `appearance`。资料按 shared schema 校验，更新资料不会改变权限。API 同时返回 `name`/`displayName` 和 `appearance`/`currentAppearance` 兼容字段。PATCH 可接受两组字段；同一资料同时提供两种写法时，`displayName` 和 `currentAppearance` 优先。

每个账号有三个命名造型槽位。`GET /api/me/outfits` 读取全部槽位；`PUT /api/me/outfits/0`、`/1` 或 `/2` 更新单个槽位，传 `null` 可清空。名称为 1–12 个字符，造型按 `appearanceSchema` 校验。槽位按账号跨设备保存；不会自动导入旧浏览器的本地造型。

## 登录 session 与空间连接

Better Auth 的登录 session 有效期为 30 天。一个账号可以在不同设备拥有独立 session，也可同时进入不同 Space；但在同一个 Space 中只允许一个连接。该账号从另一设备再次进入时，新连接接管席位并断开旧连接，不会因此撤销旧设备的账号 session。网络断线重连恢复原 Space 连接与席位；离开或重连过期后席位释放。

| 操作 | 账号 session | 在线 Space 连接 |
| --- | --- | --- |
| 退出登录 | 撤销当前设备的 session | 不撤销其他设备的连接；当前客户端离开登录界面 |
| 修改密码 | 撤销该账号所有 session | 断开该账号所有 Space 连接 |
| 使用密码重置链接 | 设置新密码并撤销所有 session | 断开该账号所有 Space 连接 |
| 管理员冻结 | 撤销现有 session，阻止新 session | 断开该账号所有 Space 连接 |
| 管理员踢下线 | 保持账号 session 有效 | 断开当时在线连接；账号可重新登录和进入 |

修改密码使用 `POST /api/me/password`，需要当前密码。登录、退出和重置密码使用项目允许的 Better Auth 路由；其它 Better Auth 路径不对外开放。

## 管理员

管理员权限以服务端 profile 的 `role` 为准。账号管理界面可查看账号、创建账号、提升或降级权限、冻结或解冻、生成密码重置链接、踢下线及删除账号。管理请求需要有效管理员 session 和显式确认；管理员不能冻结、降级或删除自己。管理员在 Space 中仍受普通地图互动和位置校验约束。

管理员重置链接有效一小时且只能使用一次；重新生成会使旧链接失效。生成链接本身不会撤销登录 session；用户完成重置时会撤销全部 session 并断开在线连接。应私下将链接交给目标用户。

冻结账号会撤销现有 session、拒绝新 session，并断开在线 Space 连接。解冻后，用户可用原密码重新登录。删除账号会删除账号和个人资料；其已发布的留言保留为公开内容，不自动删除。

## 本地维护 CLI

CLI 使用项目根目录 `.env` 和 `DATABASE_PATH`，直接访问 SQLite。只应由可信的主机用户运行。

```sh
npm run identity -- list
npm run identity -- create USERNAME '显示名称' --password-stdin
npm run identity -- role USER_ID admin --yes
npm run identity -- role USER_ID member --yes
npm run identity -- suspend USER_ID --yes
npm run identity -- unsuspend USER_ID --yes
npm run identity -- reset-password USER_ID --yes
npm run identity -- kick USER_ID --yes
npm run identity -- delete USER_ID --yes
```

创建账号的密码必须从标准输入读取，不能放在命令参数中：

```sh
printf '初始密码: '
read -r -s ACCOUNT_PASSWORD
printf '\n'
printf '%s\n' "$ACCOUNT_PASSWORD" | npm run identity -- create USERNAME '显示名称' --password-stdin
unset ACCOUNT_PASSWORD
```

首次部署时可用 CLI 创建首个账号，再授予其管理员权限。`kick` 通过数据库命令队列通知运行中的服务器，通常在一秒内处理；修改权限和其他破坏性操作需要 `--yes`。

## 部署要求

生产环境设置至少 32 字符的随机 `IDENTITY_SECRET`、公开站点 `IDENTITY_BASE_URL` 和实际前端来源列表 `IDENTITY_TRUSTED_ORIGINS`。使用 HTTPS/WSS 和同源反向代理。身份资料、造型、session 及留言保存在 SQLite；部署时持久化并备份数据库。当前仅支持单后端实例。HTTP Basic Auth（如需）由部署者的反向代理提供，项目不实现或配置 Basic Auth。
