# Tiled 地图契约

Tiled JSON (`.tmj`) 是地图几何、出生点、碰撞和交互的唯一源数据。`assets/maps/registry.json` 选择地图集合的初始地图和每张地图的默认出生点：

```json
{
  "initialMap": "lobby",
  "maps": [
    { "id": "lobby", "file": "lobby.tmj", "defaultSpawn": "default" }
  ]
}
```

`file` 相对于 registry 文件。地图 registry 是服务端加载配置；新增地图要在此登记，并确保所有 Portal 目标均能解析。客户端从 `GET /api/world` 读取地图目录，再取对应地图和资源，不硬编码 `lobby.tmj`。服务端以相同 `.tmj` 提取权威语义，并发布规范化后的渲染 JSON 和该地图显式引用的资源。

## 地图设置

使用有限、正交地图，图块宽高均为 **16 × 16 像素**。地图宽高可按需设置。Tiled 中把几何语义对象放入名为 `spawns`、`collisions`、`interactions` 的对象层；这些图层可位于 group 内，也可使用 layer 的偏移。解析器将 group/layer 偏移计入语义对象位置。其他图层、对象和 tileset 元数据不用于碰撞、出生点或交互校验。

渲染加载器可解析多个内嵌 atlas 和外置 JSON `.tsj` tileset，Phaser 按 Tiled 顺序创建全部瓦片层，包括 group 中的瓦片层；不依赖 `ground` 名称。XML `.tsx` 尚无加载器，image layer、tile object 和 image-collection tileset 尚无专门渲染路径。它们不被共享语义解析器禁止；使用时需补充渲染加载/展示实现。

项目只约束语义层的数据，不承诺 Phaser 渲染器支持 Tiled 的全部图层、对象或 tileset 表达。地图保存后应在实际浏览器检查所用渲染特性。无限地图和非正交地图不受支持，因为当前权威移动和 AABB 边界按有限矩形世界计算。语义对象使用无旋转点或轴对齐矩形；碰撞和交互必须为正尺寸且完全在地图范围内。

### 出生点与碰撞

- `spawns` 中放置一个或多个唯一命名的 Tiled point object。名称是出生点 ID；无需名为 `default` 的固定对象。registry 的 `defaultSpawn` 必须匹配该地图存在的名称。
- 出生点应位于可通行区域。服务端使用玩家半径 10px 的碰撞体校验边界和障碍。
- `collisions` 中每个矩形对象都是服务器端障碍。地面瓦片图案不会自动产生碰撞。

### 交互区与 Portal

`interactions` 中每个矩形对象需要唯一非空 Name。交互类型从 Tiled `class`（旧版 `type`）读取。共享的泛型 `InteractionRegistry<T>` 保存按 kind 关联的定义；当前解析定义只负责校验 properties，前后端 handlers 在各自模块组装。交互区域的坐标、类型和 properties 是地图定义的一部分，`resourceId` 用于需要共享资源归属的交互。

Portal 使用类型 `Portal`，并在对象 properties 中设置两个 string：

```json
{
  "name": "to-lounge",
  "class": "Portal",
  "x": 16,
  "y": 16,
  "width": 32,
  "height": 32,
  "properties": [
    { "name": "targetMap", "type": "string", "value": "lounge" },
    { "name": "targetSpawn", "type": "string", "value": "arrival" }
  ]
}
```

服务端校验 Portal 指向 registry 中存在的地图和出生点。客户端仅提交当前 Portal 的 `zoneId`；服务端还会检查身份、玩家所在地图和实际位置，再在同一房间内切换玩家 `mapId` 并放置到目标出生点。交互显示和客户端碰撞都不能授权地图切换。

## Integration 接入

内置留言板与番茄钟分别注册为 `board`、`pomodoro`，按 `resourceId` 归属数据。所有地图外置页面入口统一使用类型 `web`，并按 `resourceId` 关联配置；多个区域可引用相同资源。`name` 标识区域本身。

`EXTERNAL_TOOLS` 以 resourceId 为键配置 `{ url, mode?, fallback? }`，其中 URL 必填，mode 可为 `embed` 或 `external`，默认 `external`。embed 在沙盒 iframe 容器内呈现配置页面；external 打开配置的原生页面。`fallback: "external"` 仅在 embed 旁增加手动打开链接，不检测 iframe 加载失败，也不自动切换。展示模式不改变服务器端身份、位置或权限校验，也不映射项目身份。

公共 WebTool 配置会通过 `GET /api/tools` 暴露给浏览器，不得含凭据。见[内置与外置接入](integrations.md)和[入口配置](integration-plan.md)。

## 校验与发布

服务启动时会解析 registry 中所有地图，检查 16px tile 尺寸、命名出生点、语义几何和 Portal 目标。验证地图契约后，还需在浏览器检查地图渲染、资源路径、出生点、碰撞、区域进入/退出及跨地图到达行为。更换 registry 或地图文件后重启后端。
