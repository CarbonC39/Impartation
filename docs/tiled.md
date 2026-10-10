# Tiled 地图约定

当前地图为 `assets/maps/lobby.tmj`，图块为同目录的 `tiles.png`。Phaser 客户端读取可视地图，服务端在启动时读取同一张 JSON 并用共享解析器校验碰撞、出生点和交互区。

## 支持范围

- Tiled JSON 地图，`orientation: orthogonal`、`infinite: false`。
- 渲染单一 `ground` 瓦片层，使用一个内嵌在 `.tmj` 中的图片 atlas tileset。图块名称和图片相对路径从地图读取；瓦片数据必须为数字数组，其尺寸和 GID 会在启动时校验。
- `spawns`、`collisions` 和 `interactions` 三个对象层，层名不可重复。
- 当前几何约定是地图内、无旋转、轴对齐的矩形，以及出生点对象。无限地图、group 层和偏移层不受支持；解析器会拒绝 ellipse、多边形、折线、tile object 和模板对象。外部 tileset、缺失 ground、压缩或 base64 瓦片数据会在启动时拒绝。图块图片是否存在仍由浏览器加载阶段检查。

## 对象层

- `spawns`：至少要有一个名为 `default` 的 Tiled point object，作为加入房间的位置。
- `collisions`：每个矩形对象都是服务器端障碍。矩形必须为正尺寸并完全位于地图范围内；玩家视觉为半径 10px 的圆，当前碰撞使用其 20×20px 轴对齐包围盒，因此墙角处略保守。瓦片图案本身不产生碰撞，需要在此层画出障碍矩形。
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

客户端当前固定从 `/maps/lobby.tmj` 读取地图。若配置后端 `MAP_PATH`，应同步替换前端托管的这份地图，保持几何与资源一致；当前不支持运行中热换地图。交互区重叠时，以对象顺序中的第一个命中区为准。
