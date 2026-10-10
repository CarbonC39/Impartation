# Tiled 地图约定

当前地图为 `assets/maps/lobby.tmj`，图块为同目录的 `tiles.png`。Phaser 客户端读取可视地图，服务端在启动时读取同一张 JSON 并用共享解析器校验碰撞、出生点和交互区。

## 支持范围

- Tiled JSON 地图，`orientation: orthogonal`、`infinite: false`。
- 单一 `ground` 瓦片层；tileset 内嵌在 `.tmj` 中。
- `spawns`、`collisions` 和 `interactions` 三个对象层，层名不可重复。
- 当前几何约定是地图内、无旋转、轴对齐的矩形，以及出生点对象。无限地图和偏移层不受支持；解析器会拒绝 ellipse、多边形、折线、tile object 和模板对象。当前客户端按内嵌 tileset 和 `ground` 层加载地图，使用外部 tileset 或移除 `ground` 会导致客户端无法按现有逻辑渲染。

## 对象层

- `spawns`：至少要有一个名为 `default` 的 Tiled point object，作为加入房间的位置。
- `collisions`：每个矩形对象都是服务器端障碍。矩形必须为正尺寸并完全位于地图范围内；碰撞按访客圆形半径计算。
- `interactions`：矩形区域的类型从 Tiled `class` 或旧式 `type` 读取，当前允许 `media`、`whiteboard`、`board`、`pomodoro`。每个对象需有唯一非空 `name`，以及非空字符串自定义属性 `resourceId`。客户端目前只显示区域和资源 id 提示，不会打开对应功能。

推荐在 Tiled 中使用自定义属性 `resourceId`（string），并保留以上对象层名和类型字面值。例如：

```json
{
  "name": "lounge-screen",
  "class": "media",
  "x": 64,
  "y": 64,
  "width": 160,
  "height": 96,
  "rotation": 0,
  "properties": [{ "name": "resourceId", "type": "string", "value": "lounge-screen" }]
}
```

编辑地图后重启后端以重新载入。无效地图会导致服务启动失败；检查尺寸、对象层名称、出生点和资源 id 后再启动。
