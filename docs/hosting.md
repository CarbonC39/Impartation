# 托管指南：Space 与地图

本文面向部署和维护站点的托管者。基础启动、生产身份配置与镜像地址见 [README](../README.zh-CN.md#配置与部署)；Tiled 对象、碰撞和交互制作见[地图契约](tiled.md)。下面的 Docker 示例需要在目标主机按本文的验收步骤确认。

## 部署方式与持久数据

当前使用单后端进程和本地 SQLite。每个 Space 最多运行一个 Colyseus room；所有 Space 共用 `SPACE_MAX_CLIENTS`，默认 32。满员时拒绝新连接，重连保留中的席位也占用容量。增加后端副本不会让它们共享同一个 Space。

| 内容 | Docker 镜像中的默认位置 | 维护方式 |
| --- | --- | --- |
| 身份、资料与留言数据库 | `/app/data/world.sqlite` | 持久化 `/app/data` 并备份 |
| Space registry 与地图源文件 | `/app/assets/maps/registry.json` 及其引用文件 | 使用镜像内置文件，或挂载完整地图目录并设置 `MAP_REGISTRY_PATH` |
| 前端静态站点 | `/app/apps/frontend/dist` | 镜像内置构建产物；独立托管时发布同一份前端产物 |
| Space 封面 | 前端静态站点中由 `cover` 指向的文件 | 随前端构建发布，或挂载到前端静态目录的专用子目录 |
| 外置工具内容 | 各工具服务自己的存储 | 按对应服务维护；项目只保存入口配置 |

玩家、聊天、语音配对、番茄钟、私密区域成员/锁和选择器状态归各 Space room；空房销毁或后端重启后不恢复这些运行时状态。身份资料在 Space 间共用；留言按 `(space_id, resourceId)` 持久化。

## 配置 Space 与地图

`MAP_REGISTRY_PATH` 指向服务器读取的 registry JSON。建议使用绝对路径；Docker 中必须填写容器内路径。配置顶层包含 `maps`、`spaces` 和可选 `project`：

| 配置 | 托管时的含义 |
| --- | --- |
| `maps[].id` | 地图标识；Space 的地图列表和 Portal 用它引用地图，无需与文件名相同 |
| `project`（可选） | 相对 registry 的 `.tiled-project` JSON 路径，用于展开 Custom Classes 默认属性 |
| `maps[].file` | 相对 registry 所在目录的 Tiled JSON 路径 |
| `maps[].defaultSpawn` | 进入该地图作为初始地图时使用的命名出生点 |
| `spaces[].id` | 稳定机器标识，1–128 字符，匹配 `/^[a-z0-9][a-z0-9_-]*$/` |
| `spaces[].name` / `description` | 展示名与可选说明；更换名称不会更换 Space 身份 |
| `spaces[].cover` | 浏览器直接请求的普通静态图片路径，例如 `/space-covers/main.png` |
| `spaces[].initialMap` | 该 Space 的初始地图，必须属于它的 `maps` |
| `spaces[].maps` | 该 Space 可用的地图 ID 列表，不可为空或重复 |

`spaces` 数组顺序就是开始页顺序。地图 ID 在整个 registry 内唯一；Space ID 在 `spaces` 内唯一。两个 Space 可以引用同一地图定义，玩家和内置交互运行状态仍然独立。

不要通过改 Space ID 来改展示名称：留言按这个 ID 保存；改 ID 会进入一个新 Space，旧留言不会自动迁移，删除配置也不会自动清理旧留言。早于 multi-space 的数据库升级时，既有留言归入 `main`；要继续使用它们，应保留这个 Space ID。

### 新增地图或 Space

1. 用 Tiled 制作有限、正交、16×16 tile 地图，保存为 JSON `.tmj`。添加命名出生点、碰撞和交互对象；具体约束见[地图设置](tiled.md#地图设置)。项目支持的渲染特性有限，不能仅以 Tiled 编辑器内显示正常作为验收依据。
2. 把 `.tmj`、外置 JSON `.tsj` tileset、JSON Object Templates（`.tj`/`.json`）、可选 `.tiled-project` 和图片按原相对结构一起部署。在 `maps` 登记文件和 `defaultSpawn`，再把地图 ID 加到对应 Space 的 `maps`，按需设为 `initialMap`。
3. 检查所有 Portal 的 `targetMap` 和 `targetSpawn`。Portal 只能指向当前 Space 内的地图；共享地图中的 Portal 必须对每个引用它的 Space 都有效。例如 A 中有 Portal 指向 B，使用 A 的 Space 也必须包含 B，即使用户暂时不走该入口。
4. 新 Space 填写稳定 ID、展示名、封面、初始地图与地图列表，并放到希望的显示位置。封面文件要另外发布到浏览器可访问的静态路径。
5. 如地图新增或删除 `web` 资源，同步核对 `EXTERNAL_TOOLS`，再重启后端并按下文验收。现有配置项必须仍对应 registry 地图中的 `web` 区域；未配置的入口可以保留。配置方式见[外置入口](integration-plan.md)。

Space 隔离不会自动创建第三方白板、文档或观看房间。`EXTERNAL_TOOLS` 是全后端共用配置；不同 Space 复用相同 `resourceId` 时会打开相同 URL。需要不同外置内容时，使用不同资源 ID 和工具 URL，并由工具自身管理权限。

### 文件路径与浏览器路径

地图源文件按服务器文件系统解析：registry 的 `file` 相对 registry；`.tmj` 中外置 tileset 的 `source` 相对 `.tmj`；模板相对引用它的地图或模板文件；`project` 相对 registry；图片相对声明它的 `.tmj` 或 `.tsj`。保留目录结构，并使用部署平台上实际存在的大小写。XML `.tsx` 不受当前加载器支持。

后端把这些地图图片引用改写为 `/api/maps/:id/assets/:asset`，渲染 JSON 则由 `/api/maps/:id/map.json` 提供。不要手写资源序号，也不要把服务器文件路径填到 `cover`。

封面不会通过地图 API 自动发布。开发时 `assets/covers/main.png` 对应 `/covers/main.png`；前端构建会把它复制到 `apps/frontend/dist/covers/main.png`。运行时替换后端地图目录不会更新这份构建副本。使用现有镜像时，可像下面这样挂载一个专用封面目录；独立托管前端时，要把封面部署到该前端站点。

## Docker：挂载自己的地图与封面

下面复用仓库的大厅和交互试验场作为起点。从仓库根目录准备文件；`tiles.png` 暂作封面占位，可替换成自己的普通图片：

```sh
mkdir -p hosting/world/maps hosting/covers
cp assets/maps/lobby.tmj assets/maps/interaction-lab.tmj assets/maps/tiles.png hosting/world/maps/
cp assets/maps/tiles.png hosting/covers/main.png
```

保存以下内容到 `hosting/world/registry.json`。两个 Space 复用地图，并选择不同的初始地图：

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
      "description": "从大厅进入交互试验场",
      "cover": "/space-covers/main.png",
      "initialMap": "lobby",
      "maps": ["lobby", "interaction-lab"]
    },
    {
      "id": "studio",
      "name": "工作室",
      "cover": "/space-covers/main.png",
      "initialMap": "interaction-lab",
      "maps": ["lobby", "interaction-lab"]
    }
  ]
}
```

按 README 配置 `.env.production` 的私密 `IDENTITY_SECRET`、公开 HTTPS `IDENTITY_BASE_URL` 和 `IDENTITY_TRUSTED_ORIGINS`。在同一目录运行下面的容器示例；若已有同名容器，按下文更新步骤停掉并替换它，保留数据卷：

```sh
docker run -d --name virtual-workspace --restart unless-stopped \
  -p 127.0.0.1:2567:2567 \
  -v virtual-workspace-data:/app/data \
  --mount "type=bind,src=${PWD}/hosting/world,dst=/app/world,readonly" \
  --mount "type=bind,src=${PWD}/hosting/covers,dst=/app/apps/frontend/dist/space-covers,readonly" \
  --env-file .env.production \
  -e MAP_REGISTRY_PATH=/app/world/registry.json \
  -e SPACE_MAX_CLIENTS=32 \
  ghcr.io/carbonc39/virtualworkspace:latest
```

`/app/world/registry.json` 中的 `maps/lobby.tmj` 解析为 `/app/world/maps/lobby.tmj`；`cover` 的 `/space-covers/main.png` 则对应另一个挂载中的 `main.png`。不要覆盖整个 `/app/apps/frontend/dist` 来放封面，否则会遮住镜像内置前端。

镜像以 `node` 用户运行，挂载文件必须允许它读取，父目录必须允许遍历。地图和封面挂载为只读；数据库卷需要可写。Docker 的 `--env-file` 负责注入运行时环境变量，镜像启动命令不会自行读取宿主机 `.env`。更改环境文件后要重新创建容器；仅 `docker restart` 不会重新导入环境变量。

Docker 环境文件中的 JSON 值直接写为 `EXTERNAL_TOOLS={}` 或 `VOICE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]`，不要在整个 JSON 外添加 shell 引号；JSON 内部的双引号仍需保留。

## 源码或 Release 部署

源码部署执行 README 中的构建命令；Release 包已含后端、shared、前端产物和 `assets`，按 README 安装生产依赖。设置实际的 `MAP_REGISTRY_PATH`，并让前端站点提供 registry 的封面路径。由后端同时托管前端时，把 `FRONTEND_DIST_PATH` 设为前端 `dist` 的绝对路径。

只更新运行时地图集时，无需重新编译前端或后端；修改 `assets` 中的封面并依赖 Vite 复制时，则需要重新构建和发布前端，或更新部署后的对应静态文件。`npm start` 会读取项目根目录 `.env`；直接执行编译后的 Node 入口时，应由进程管理器注入环境变量或显式传入 Node 的 env-file 参数。

## 更新与回滚

1. 保存当前镜像/Release 版本、环境配置，以及 registry、地图、tileset 和图片的完整版本。升级程序前备份数据库；停服后备份整个数据目录，可一并保留 SQLite 的 WAL 文件，避免仅复制正在写入的主数据库文件。
2. 停止后端，替换完整地图文件集和相应封面，确认路径与读取权限。需要调整环境变量或升级镜像时重新创建容器，并继续挂载原数据库卷；仅替换地图文件时可在替换后启动原容器。
3. 启动后检查日志和下文验收项。registry、Tiled JSON 和外置 tileset 在启动时读入，没有配置热更新；已打开页面也需刷新，重新获取 Space 目录。
4. 若只回退地图，恢复整套匹配的 registry、地图和图片并重启。若回退程序且数据库格式已升级，恢复升级前的数据库备份；旧程序会拒绝更新版本的数据库，项目没有降级迁移。

## 部署验收与排查

在部署主机检查后端 API 和封面；下面的地图 ID、封面路径对应上面的示例：

```sh
docker logs --tail 100 virtual-workspace
curl -fsS http://127.0.0.1:2567/health
curl -fsS http://127.0.0.1:2567/api/world
curl -fsS http://127.0.0.1:2567/api/maps/lobby/map.json
curl -fsS -o /dev/null http://127.0.0.1:2567/space-covers/main.png
```

随后从实际公开 HTTPS 站点访问：确认 Space 顺序、名称和封面，逐一进入并核对初始地图；在浏览器网络面板确认地图 JSON 和图片请求成功。遍历 Portal，检查到达位置、碰撞和地图显示。使用两个浏览器分别进入不同 Space，核对玩家和内置交互隔离；满员时确认明确拒绝且不出现第二个实例。外置服务另行验收登录与内容访问。

`/health` 只检查数据库连接，不能代替浏览器地图验收。启动校验会解析 registry、地图语义和外置 JSON tileset，但不会证明所有图片文件存在或封面可访问。

| 现象 | 检查位置 |
| --- | --- |
| 启动报 `ENOENT` 或 JSON 解析错误 | 容器内 registry 路径、文件是否完整挂载、`.tsj` 是否为 JSON，以及文件权限 |
| `Unknown map`、`initialMap must exist` 或 `Invalid Portal destination` | Space 的地图列表、初始地图、所有共享地图的 Portal 目标与命名 spawn |
| 地图可加载但封面 404 | 前端静态目录或封面挂载；`MAP_REGISTRY_PATH` 不提供封面路由 |
| 地图图片 404 | 规范化地图中的资源 URL、后端挂载图片及 `.tmj`/`.tsj` 的相对路径和大小写 |
| 修改地图后仍看到旧内容 | 后端是否已重启、页面是否刷新；是否误改了前端 `dist` 内的地图副本而非后端读取的地图集 |
| 地图显示正常但走路/Portal 不对 | Tiled 语义对象层、碰撞矩形和命名出生点；视觉瓦片不会自动生成碰撞 |
| 新 Space 没有旧留言 | 是否更换 Space ID；历史迁移留言在 `main`，不同 Space 的相同资源 ID 也不会共用留言 |
| `Space is full` | 当前连接与重连保留席位，以及 `SPACE_MAX_CLIENTS`；该设置是每个 Space 的上限，全部 Space 共用同一个配置值 |

地图目录、Space 元数据、地图资源和工具 URL 是浏览器可读取的配置。Space 列表本身不提供私有空间 ACL；站点门禁由托管者的代理提供，第三方服务保留自己的权限边界。
