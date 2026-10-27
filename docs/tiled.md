# Tiled 地图制作

本文面向地图制作者，介绍本项目读取的地图图层和交互对象。Space、地图挂载与封面部署见[托管指南](hosting.md)。需要查阅 Tiled 原生对象字段时，可参考其[对象编辑说明](https://doc.mapeditor.org/en/stable/manual/objects/)和[JSON 地图格式](https://doc.mapeditor.org/en/stable/reference/json-map-format/)；本项目只支持其中列出的地图子集。

## 地图基本要求

地图使用有限、正交网格，tile 尺寸为 16×16 像素，保存为 Tiled JSON（`.tmj`）。地图 registry 为每张地图指定 ID、文件和默认出生点，并为每个 Space 指定初始地图及可用地图。地图 ID 与文件名可以不同。

每张地图需要且只能有以下三个对象图层；可将它们放在 Tiled group 中：

| 图层 | 内容 |
| --- | --- |
| `spawns` | 命名 point object，供进入地图和 Portal 落点使用 |
| `collisions` | 阻挡角色通行的矩形或简单多边形 |
| `interactions` | 动作锚点和互动区域 |

示例 registry：

```json
{
  "maps": [
    { "id": "lobby", "file": "lobby.tmj", "defaultSpawn": "default" }
  ],
  "spaces": [
    {
      "id": "main",
      "name": "大厅",
      "cover": "/covers/main.png",
      "initialMap": "lobby",
      "maps": ["lobby"]
    }
  ]
}
```

出生点名称在地图内唯一，并须与 registry 中的 `defaultSpawn` 相同。出生点需要位于可通行区域。地面图块不会自动产生碰撞，墙和障碍需要在 `collisions` 图层单独绘制。

本项目的语义对象只支持未旋转的 point、矩形和简单多边形。多边形至少有三个点，不可自交；私密区域之间不可重叠。装饰和家具请绘制在瓦片层，不要用语义对象代替地图画面。

## 交互对象

交互对象放在 `interactions` 图层，使用 Tiled `class` 指定类型；旧地图保存的 `type` 也可读取。所有交互对象都需要非空名称。`action`、`attachment`、`board`、`pomodoro`、`Portal` 和 `web` 以名称作为地图内 ID，名称须唯一；`variantSelector`、`privateArea` 和 `wardrobe` 使用 Tiled 分配的数字对象 ID。地图中的 Tiled 对象 ID 必须保持唯一。

| 类型 | 形状 | 必填属性 | 用途 |
| --- | --- | --- | --- |
| `action` | point | string `action`，当前为 `sit` | 角色动作锚点 |
| `variantSelector` | point | string `action`（目前为 `sit`）、数值 `targetObjectId`、逗号分隔的 string `variants` | 角色坐下时选择关联图块 |
| `privateArea` | 矩形或多边形 | 无 | 临时邀请成员并限制进入 |
| `wardrobe` | 矩形或多边形 | 无 | 打开角色衣柜 |
| `Portal` | 矩形或多边形 | string `targetMap`、string `targetSpawn` | 前往同一 Space 中的另一张地图 |
| `web` | 矩形或多边形 | 非空 string `resourceId` | 打开外部网页入口 |
| `attachment` | 矩形或多边形 | string `mode`、string `attachmentIds` | 取用角色附件 |

### 动作锚点与家具选择

动作锚点是 `action` point，当前支持 `sit`。可选 `facing` 设为 `up`、`down`、`left` 或 `right`。朝向不匹配时角色仍会原地坐下，但不会对齐锚点或占用座位。`offsetX`、`offsetY` 可微调坐姿位置，单位为地图像素。

```json
{
  "name": "window-seat",
  "class": "action",
  "x": 176,
  "y": 224,
  "point": true,
  "properties": [
    { "name": "action", "type": "string", "value": "sit" },
    { "name": "facing", "type": "string", "value": "down" }
  ]
}
```

需要选择家具图块时，使用 `variantSelector` point，并以 `targetObjectId` 引用 `interactions` 以外对象图层中的目标矩形或 tile object。目标对象必须有数值 ID、正数宽高和唯一 ID；不要求名称。每个选项用整数属性 `variant.<选项名>` 指定 atlas tileset 中从 0 开始的图块编号；`-1` 表示隐藏目标。`variants` 中的选项名与这些属性后缀对应。多 tileset 地图还需在目标对象上添加 string 属性 `variantTileset`，值为 tileset 名称。

每个选择点必须对应自己的目标对象。家具背景可保留在瓦片层，需要切换的图块不要同时画在静态层。可参考仓库地图中的座位示例。

### 私密区域、衣柜与 Portal

私密区域初始开放；已进入的成员可邀请在线玩家并锁定或解锁入口。成员走出区域会失去成员资格，锁定后重新进入需要再次受邀；未入场的邀请在区域无人后最多保留 60 秒。区域不替代墙体和碰撞。

`wardrobe` 区域打开角色造型界面。家具应另画在普通瓦片层。

Portal 的 `targetMap` 必须是当前 Space 可用地图的 ID，`targetSpawn` 必须是该地图已有的出生点名称。若多个 Space 共用一张地图，该地图上的 Portal 对每个 Space 都必须有效。

### 外部工具

`web` 区域通过 `resourceId` 关联 `EXTERNAL_TOOLS` 中的网页地址。进入区域只显示入口，用户点击后打开。外部服务自行管理登录和权限；地图配置不授予工具访问权。配置方式见[外部工具入口配置](external-tools.md)。

### 角色附件

`attachment` 区域使用名称作为来源 ID。`mode` 和 `attachmentIds` 的组合如下：

| `mode` | 附件 ID 数量 | 行为 |
| --- | --- | --- |
| `single-unlimited` | 一个 | 可重复取用 |
| `single-unique` | 一个 | 同一地图来源同时仅一人持有 |
| `multiple-unlimited-random` | 两个或更多 | 每次随机取用一个 |

附件需使用项目已登记的 ID。需要可取走的地图图块时，推荐使用 Tiled 原生图块对象：

1. 在普通对象层（例如 `attachment-visuals`）选择“插入图块”，选中图块并直接拖动到地图上的目标位置。
2. 在 `attachment` 来源区域上新增 **object 类型**属性 `visualObjectId`，用 Tiled 的对象选择器选中刚放置的图块对象。
3. 图块对象当前只支持未旋转、未翻转的 16×16 atlas 图块；位置可以不对齐网格，支持对象层和 group 的偏移。每个图块对象只归一个来源所有，不可同时作为家具选择目标。

不需要另填 GID、X 或 Y，也不要把同一图块重复绘制到静态瓦片层。Tiled 保存图块对象的位置和全局 GID，项目会处理其左下角原点与渲染坐标的转换。`crown-east`、`crown-west` 使用这种方式；移动对应图块对象即可调整显示位置。

旧地图也可继续手动配置：若唯一来源的附件被取走时还要隐藏地图图块，在来源对象上配置整数属性 `visualGid`、`visualX`、`visualY`，并将对应图块从静态瓦片层移除。X/Y 是地图像素坐标，需对齐 16 像素网格；三个属性须同时填写。坐标指目标图块左上角，从 `(0, 0)` 开始，例：第 6 列、第 4 行是 `(80, 48)`。`visualGid` 是地图中的全局 GID：`tileset.firstgid + Tiled 图块本地 ID`，不是本地 ID；多个 tileset 各自使用自己的 `firstgid`。

## 渲染与验收

瓦片层的可选布尔属性：

| 属性 | 效果 |
| --- | --- |
| 无 | 地面层，在人物后方；普通层之间遵循 Tiled 图层顺序 |
| `ySort = true` | 按每行底边 Y 与人物脚底 Y 排序；相同 Y 的瓦片行按 Tiled 图层顺序叠放 |
| `abovePlayers = true` | 始终在人物前方；此层不要同时设置 `ySort` |

`top`、`y-sort` 等图层名称没有特殊含义。排序按以上用途分组，不保证跨组遵循 Tiled 中的图层堆叠；`spawns` 的图层位置只影响编辑器显示，不定义人物层级。人物的身体、衣服、头发和附件作为同一深度绘制，图块不会插入其部件之间。

本项目支持 atlas tileset、普通瓦片层和分组瓦片层；外置 JSON tileset（`.tsj`）可与地图一起使用。XML tileset（`.tsx`）、image collection tileset、image layer 和通用 tile object 没有对应的地图渲染路径。请使用 atlas tileset，并在目标浏览器验收地图外观和资源路径。

服务端启动时会检查地图大小与方向、必需对象图层、出生点、交互字段和几何、家具目标及 Portal 目标。配置错误会阻止启动。地图文件修改后需重启后端；重启后还应检查出生点、碰撞、互动区与传送落点。
