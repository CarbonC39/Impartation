# 托管指南：Space 与地图

本文面向站点托管者，说明运行限制、自定义地图部署和更新检查。基础安装与生产身份配置见 [README](../README.zh-CN.md#配置与部署)，地图制作见[Tiled 地图说明](tiled.md)。

## 运行与持久数据

当前部署使用单个后端进程和本地 SQLite。每个 Space 最多一个 Colyseus room；增加后端副本不会共享房间、排队或互动状态。

| 内容 | Docker 默认位置 | 部署要求 |
| --- | --- | --- |
| SQLite 数据库 | `/app/data/world.sqlite` | 持久化并定期备份 `/app/data` |
| 地图 registry 与引用文件 | `/app/assets/maps/` | 使用镜像资源，或挂载完整地图目录并设置 `MAP_REGISTRY_PATH` |
| 前端文件 | `/app/apps/frontend/dist` | 镜像自带；封面必须由该静态站点提供 |
| 外部工具内容 | 各工具自己的存储 | 按对应服务单独维护 |

留言按 `(Space ID, resourceId)` 保存。保持现有留言数据时不要更改 Space ID；改 ID 会建立新的数据范围，不会自动迁移留言。Space room 内的玩家、计时器、私密区域和家具选择属于运行状态，房间销毁或后端重启后不恢复。

## 配置 Space 与地图

`MAP_REGISTRY_PATH` 指向 registry JSON，Docker 中填写容器内路径。registry 包含 `maps` 和有序的 `spaces` 数组，可选 `project` 指向 Tiled 项目文件。

| 字段 | 说明 |
| --- | --- |
| `maps[].id` | 地图 ID，在整个 registry 中唯一 |
| `maps[].file` | Tiled JSON 文件路径，相对 registry 文件所在目录 |
| `maps[].defaultSpawn` | 该地图中存在的出生点名称 |
| `spaces[].id` | 稳定 Space ID，匹配 `/^[a-z0-9][a-z0-9_-]*$/` |
| `spaces[].name`、`description` | 开始页显示名称和可选说明 |
| `spaces[].cover` | 浏览器可读取的静态图片 URL；不会由地图 API 发布 |
| `spaces[].initialMap` | 该 Space 的初始地图，须包含在 `maps` 中 |
| `spaces[].maps` | 该 Space 可进入的地图 ID 列表 |

`spaces` 数组顺序决定开始页顺序。多个 Space 可以引用同一张地图，但运行状态互相隔离。每个 Space 内的 Portal 目标也必须在其地图列表中。

新增地图时，将 `.tmj`、它引用的 tileset 和图片保持相对目录结构一并部署，然后在 registry 登记地图并加入目标 Space。使用 JSON Object Template 或 `.tiled-project` 时也要部署其引用文件。更改 registry、地图或 tileset 后重启后端。

Space ID 与地图 ID 是稳定标识，避免用改 ID 的方式改显示名称。封面是前端静态资源；例如 `/space-covers/main.png` 对应前端目录中的 `space-covers/main.png`。更新后端地图目录不会自动更新前端封面。

## Compose 示例

复制 Compose 环境文件并校验配置：

```sh
cp compose.env.example compose.env
# 设置 VW_ORIGIN、IDENTITY_SECRET 和注册策略
docker compose --env-file compose.env -f compose.example.yml config --quiet
docker compose --env-file compose.env -f compose.example.yml up -d
```

默认只启动 Impartation，监听宿主机 `127.0.0.1:2567`；远程访问需配置 HTTPS 反向代理，或启用 Compose 中注释的 Caddy。`compose.env` 提供 Compose 变量插值，只有写在 `compose.example.yml` 的 `environment` 项才会传入容器。更新环境变量后需重新创建容器，单独重启不会重新加载环境文件。

Compose 中的 coturn、WBO、Etherpad 和 Neko 均为可选注释服务。启用外部工具还需配置浏览器可访问的 `EXTERNAL_TOOLS` URL 和所需访问控制，见[外部工具配置](external-tools.md)。共享浏览器 Neko 不提供 YouTube/Bilibili 同步播放功能。

## 挂载自定义地图

下面以仓库地图为例建立目录；实际部署请替换地图、registry 和封面：

```sh
mkdir -p hosting/world/maps hosting/covers
cp assets/maps/lobby.tmj assets/maps/interaction-lab.tmj assets/maps/tiles.png hosting/world/maps/
cp assets/maps/tiles.png hosting/covers/main.png
```

在 `hosting/world/registry.json` 登记地图及 Space，例如：

```json
{
  "maps": [
    { "id": "lobby", "file": "maps/lobby.tmj", "defaultSpawn": "default" },
    { "id": "interaction-lab", "file": "maps/interaction-lab.tmj", "defaultSpawn": "arrival" }
  ],
  "spaces": [
    {
      "id": "main",
      "name": "大厅",
      "cover": "/space-covers/main.png",
      "initialMap": "lobby",
      "maps": ["lobby", "interaction-lab"]
    }
  ]
}
```

将地图目录和封面挂载到镜像，并设置 registry 路径：

```sh
docker run -d --name impartation --restart unless-stopped \
  -p 127.0.0.1:2567:2567 \
  -v impartation-data:/app/data \
  --mount "type=bind,src=${PWD}/hosting/world,dst=/app/world,readonly" \
  --mount "type=bind,src=${PWD}/hosting/covers,dst=/app/apps/frontend/dist/space-covers,readonly" \
  --env-file .env.production \
  -e MAP_REGISTRY_PATH=/app/world/registry.json \
  ghcr.io/carbonc39/virtualworkspace:latest
```

`.env.production` 至少配置 `IDENTITY_SECRET`、`IDENTITY_BASE_URL` 和 `IDENTITY_TRUSTED_ORIGINS`。地图和封面挂载须允许镜像的 `node` 用户读取；数据库卷须可写。不要把封面挂载到整个 `dist` 目录，否则会遮住前端文件。

## 更新与验收

- 升级前备份 SQLite 数据和当前 registry/地图文件；回滚到旧程序时，若数据库格式已更新，也要恢复数据库备份。
- 地图文件和 registry 在启动时加载，没有热更新；换图后重启后端并刷新页面。单纯替换地图文件不需要重建前端。
- Compose 更改环境变量或镜像版本后重新运行 `up -d`；保留原数据库卷。

部署后检查服务和示例地图资源：

```sh
docker logs --tail 100 impartation
curl -fsS http://127.0.0.1:2567/health
curl -fsS http://127.0.0.1:2567/api/world
curl -fsS http://127.0.0.1:2567/api/maps/lobby/map.json
```

再用浏览器检查 Space 列表、封面、出生点、碰撞、互动区和 Portal。`/health` 只检查数据库连接；服务启动成功也不能证明图片和封面都能访问。

| 问题 | 检查项 |
| --- | --- |
| `ENOENT` 或 registry 解析失败 | `MAP_REGISTRY_PATH`、挂载路径和文件权限 |
| Portal 目标错误 | 每个 Space 的地图列表、目标地图 ID 和出生点名称 |
| 地图图片 404 | `.tmj`/`.tsj` 相对路径、文件大小写和挂载内容 |
| 封面 404 | 前端静态目录；`cover` 不由地图 API 发布 |
| 改图后仍显示旧内容 | 后端是否重启、浏览器是否刷新、是否修改了后端实际读取的地图目录 |
| Space 没有旧留言 | Space ID 是否改变；不同 Space 不共享留言 |
