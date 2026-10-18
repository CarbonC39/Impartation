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

需要让树冠、屋顶等瓦片遮住角色时，在对应的 **瓦片层** 添加 Tiled 自定义布尔属性 `abovePlayers = true`。该层会整体绘制在角色、地图对象和角色状态标记之上；多个前景瓦片层仍按 Tiled 中的顺序叠放。未设置或设为 `false` 的瓦片层保持原有背景深度。这个属性只控制显示，不产生碰撞；需要阻挡移动时仍须在 `collisions` 对象层绘制矩形。可将前景瓦片层放入 group，但属性应设置在瓦片层本身。

需要角色走到瓦片上方时被遮挡、走到下方时显示在前面，可在对应瓦片层添加 Tiled 自定义布尔属性 `ySort = true`。客户端按每行瓦片的底边世界 Y 坐标与角色脚点排序，适合树木、柜台等局部遮挡；同一行的瓦片共用排序深度。跨多行绘制的完整物体会按行分别排序，制图时应检查实际效果。`ySort` 与 `abovePlayers` 同时为 `true` 时使用 `ySort`。角色名称等状态标记仍显示在 Y 排序瓦片上方。

项目只约束语义层的数据，不承诺 Phaser 渲染器支持 Tiled 的全部图层、对象或 tileset 表达。地图保存后应在实际浏览器检查所用渲染特性。无限地图和非正交地图不受支持，因为当前权威移动和 AABB 边界按有限矩形世界计算。语义对象使用无旋转点或轴对齐矩形；碰撞和区域交互矩形必须为正尺寸且完全在地图范围内。16×16 只约束地图网格；角色、家具和对象叠加图的视觉尺寸独立。

### 出生点与碰撞

- `spawns` 中放置一个或多个唯一命名的 Tiled point object。名称是出生点 ID；无需名为 `default` 的固定对象。registry 的 `defaultSpawn` 必须匹配该地图存在的名称。
- 出生点应位于可通行区域。服务端使用脚点上方的 12×8 地面碰撞矩形校验边界和障碍，尺寸独立于角色图片。
- `collisions` 中每个矩形对象都是服务器端障碍。地面瓦片图案不会自动产生碰撞。

### 角色动作锚点

在 `interactions` 对象层放置命名 point object，`class` 设为 `action`，并用 string property `action` 指定动作名称。地图可以声明任意合法名称，但只有 shared `CHARACTER_ACTIONS` 目录中的动作（目前为 `sit`）可被玩家触发；新增动作需同时加入目录和角色图集的动作行。对象 `name` 是当前地图内唯一的 authored ID；动作锚点没有 `resourceId`。

可选 string property `facing` 覆盖角色朝向（`up`、`down`、`left` 或 `right`）；省略时保留当前朝向。`offsetX`、`offsetY` 是以世界像素计的有限数值偏移，默认均为 0。可选 `linkedObjectId` 为地图对象保留关联 ID，供后续对象变体扩展使用。

```json
{
  "name": "window-seat",
  "class": "action",
  "x": 176,
  "y": 224,
  "point": true,
  "properties": [
    { "name": "action", "type": "string", "value": "sit" },
    { "name": "facing", "type": "string", "value": "down" },
    { "name": "offsetX", "type": "float", "value": 0 },
    { "name": "offsetY", "type": "float", "value": 2 },
    { "name": "linkedObjectId", "type": "string", "value": "window-desk" }
  ]
}
```

激活动作时，服务端只在角色脚底所在的同一 16×16 网格格子中查找同名动作锚点；不使用距离半径。相同动作名称在每格最多一个锚点，不同动作可共用一格。匹配时服务端将角色吸附到锚点加偏移的位置，并应用可选朝向；没有匹配锚点时仍执行动作，保留位置和朝向。有效锚点必须位于可通行区域。非零移动会取消动作、目标对象和动作动画标记。

客户端通过 `activateAction({ action, animated })` 请求动作；`animated` 可省略且默认为 `false`。请求不携带对象 ID 或客户端坐标。地图对象的 `WorldObjectState` 会保留锚点及其关联对象 ID，当前不执行脚本，也不改变桌面等对象行为。

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

`EXTERNAL_TOOLS` 以 resourceId 为键配置 `{ url, mode?, manualExternalOpen?, allowSameOrigin? }`，其中 URL 必填，mode 可为 `embed` 或 `external`，默认 `external`。进入区域只在区域上方显示入口提示；用户点击后才在居中、可拖动的电视框窗口中挂载 embed iframe，或打开 external 新标签页。`manualExternalOpen: true` 仅在已打开的 embed 旁增加手动外链；旧 `fallback: "external"` 是兼容别名，两者均不检测加载失败或自动切换。`allowSameOrigin` 默认 false，仅对可信自托管的 embed 开放。展示模式不改变服务器端身份、位置或权限校验，也不映射项目身份。

公共 WebTool 配置会通过 `GET /api/tools` 暴露给浏览器，不得含凭据。见[内置与外置接入](integrations.md)和[入口配置](integration-plan.md)。

## 校验与发布

服务启动时会解析 registry 中所有地图，检查 16px tile 尺寸、命名出生点、语义几何、动作锚点和 Portal 目标。验证地图契约后，还需在浏览器检查地图渲染、资源路径、出生点、碰撞、区域进入/退出、动作锚点定位与朝向及跨地图到达行为。更换 registry 或地图文件后重启后端。
