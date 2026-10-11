# Tiled 地图约定

当前地图为 `assets/maps/lobby.tmj`，图块为同目录的 `tiles.png`。Phaser 客户端读取可视地图，服务端在启动时读取同一张 JSON 并用共享解析器校验碰撞、出生点和交互区。

## 制作地图

可以直接用 Tiled 打开 `assets/maps/lobby.tmj` 修改现有地图。若从空白地图开始，在“文件 → 新建 → 新建地图”中使用以下设置，保存为 Tiled JSON（`.tmj`）：

| 设置 | 要求或示例 |
| --- | --- |
| Orientation | Orthogonal（正交） |
| Infinite | 关闭，使用固定尺寸 |
| 地图尺寸 | 示例为 24 × 16 个图块，可调整 |
| 图块尺寸 | 示例为 32 × 32 像素，可调整 |
| Tile layer format | CSV；保存后 `ground.data` 必须是数字数组 |
| Tile render order | 示例使用 Right Down |

新建地图与图块集的编辑器操作见 [Tiled 入门](https://doc.mapeditor.org/en/stable/manual/introduction/)。项目使用范围比编辑器支持范围更小，按下述契约制作。

1. **创建图块集**：选择“文件 → 新建 → 新建图块集”，使用单张 atlas 图片并勾选 **Embed in map**。现有 `tiles.png` 为 96 × 32 像素，包含三个 32 × 32 图块，margin/spacing 均为 0；也可换成自己的 atlas。只保留一个内嵌图块集，图片放在地图旁或其子目录，使用相对路径。
2. **绘制地面**：将初始瓦片层命名为 `ground`，使用图章或填充工具绘制。该层尺寸与地图一致，不使用压缩/base64 数据。当前只渲染这一层，额外装饰瓦片层不会显示；需要的装饰合并在 `ground` 图块中。
3. **添加对象层**：创建 `spawns`、`collisions`、`interactions` 三个对象层，即使没有障碍或工具，也保留空层。层名不能重复，层位置和偏移保持为 0，不放进 group。
4. **放置出生点**：选中 `spawns`，使用 **Insert Point** 工具，在可通行处放一个点并命名为 `default`。坐标以像素计；出生点需距地图边缘和障碍至少 10px，给当前玩家碰撞体留出空间。
5. **画障碍**：选中 `collisions`，用 **Insert Rectangle** 画轴对齐矩形，旋转为 0，尺寸为正且完全位于地图内。墙面图案不会自动产生碰撞，必须在此层单独定义。
6. **放置工具区域**：选中 `interactions`，用矩形画功能区。为每个交互区域填写唯一的非空 Name，在 Class 中填写下表的类型（旧版字段为 Type）；在 Properties 面板点击 `+`，添加名为 `resourceId` 的 **string** 属性并填写资源 ID。直接把属性保存在对象上，不依赖项目类的继承默认值。
7. **保存并接入**：使用 `.tmj` JSON 地图保存到 `assets/maps/lobby.tmj`，或通过“文件 → 导出为”导出该 JSON。保留图块图片相对路径。外置类型还需在 `.env` 配置匹配的资源与地址，然后按下方步骤验证。

点与矩形工具见 [Tiled 对象操作](https://doc.mapeditor.org/en/stable/manual/objects/)，属性编辑见 [自定义属性](https://doc.mapeditor.org/en/stable/manual/custom-properties/)，文件格式见 [JSON 地图格式](https://doc.mapeditor.org/en/stable/reference/json-map-format/)。

| Class / Type | 接入类型 | 默认 resourceId |
| --- | --- | --- |
| `board` | 内置留言板 | `message-wall` |
| `pomodoro` | 内置番茄钟 | `focus-corner` |
| `whiteboard` | 外置白板 | `shared-canvas` |
| `drawing` | 外置共同作画 | `shared-drawing` |
| `media` | 外置同步观看 | `lounge-screen` |
| `document` | 外置协作文档 | `shared-document` |

对象 Name 是区域标识，`resourceId` 是工具资源标识。多个区域可以引用同一资源，但区域 Name 必须不同；外置配置的 kind 必须与引用该资源的所有区域一致。区域重叠时按 JSON 对象顺序选择第一个命中区域，制作时避免重叠。

## 支持范围

- Tiled JSON 地图，`orientation: orthogonal`、`infinite: false`。
- 渲染单一 `ground` 瓦片层，使用一个内嵌在 `.tmj` 中的图片 atlas tileset。图块名称和图片相对路径从地图读取；瓦片数据必须为数字数组，其尺寸和 GID 会在启动时校验。
- `spawns`、`collisions` 和 `interactions` 三个对象层，层名不可重复。
- 当前几何约定是地图内、无旋转、轴对齐的矩形，以及出生点对象。无限地图、group 层和偏移层不受支持；解析器会拒绝 ellipse、多边形、折线、tile object 和模板对象。外部 tileset、缺失 ground、压缩或 base64 瓦片数据会在启动时拒绝。图块图片是否存在仍由浏览器加载阶段检查。

## 对象层

- `spawns`：至少要有一个名为 `default` 的 Tiled point object，作为加入房间的位置。
- `collisions`：每个矩形对象都是服务器端障碍。矩形必须为正尺寸并完全位于地图范围内；玩家视觉为半径 10px 的圆，当前碰撞使用其 20×20px 轴对齐包围盒，因此墙角处略保守。瓦片图案本身不产生碰撞，需要在此层画出障碍矩形。
- `interactions`：矩形区域的类型从 Tiled `class` 或旧式 `type` 读取，允许 `media`、`whiteboard`、`drawing`、`document`、`board`、`pomodoro`。每个对象需有唯一非空 `name`，以及非空字符串自定义属性 `resourceId`。`board` 与 `pomodoro` 对应内置 integrations；影音、白板、共同作画、协作文档提供外部工具链接。

玩家必须实际位于对应类型和资源的区域内，且连接状态有效，服务端才接受留言板或番茄钟操作。区域外的客户端提示不构成权限；业务规则与存储范围见[内置与外置接入](integrations.md)。

外部工具入口根据服务端同步的 `zoneId` 显示，地址来自后端 `EXTERNAL_TOOLS` 配置。默认白板在右上（`shared-canvas`），共同作画在左中（`shared-drawing`），同步观看在左上（`lounge-screen`），文档在右中（`shared-document`）。未配置时仍显示区域并提示缺少地址。配置 `kind` 必须与使用该 `resourceId` 的所有区域一致；同一资源可以对应多个同类型入口，所有入口打开同一个 URL。自定义地图和配置修改后需重启后端。

入口是否显示不构成工具访问权限，离开区域不撤销工具会话；工具保留自己的账号和权限，项目管理员不会自动成为工具管理员。配置和部署步骤见 [integration-plan.md](integration-plan.md)。

推荐在 Tiled 中使用自定义属性 `resourceId`（string），并保留以上对象层名和类型字面值。例如：

```json
{
  "id": 3,
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

## 验证与发布

在项目根目录运行下面的命令检查当前地图；它使用与后端相同的解析器，不启动房间或修改数据库：

```sh
npm run build -w @virtual-workspace/shared
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { parseWorldMap } from '@virtual-workspace/shared';
const map = parseWorldMap(JSON.parse(readFileSync('assets/maps/lobby.tmj', 'utf8')));
console.log({ width: map.width, height: map.height, spawn: map.spawn, zones: map.zones });
JS
```

解析成功只验证地图数据，图片文件和实际渲染仍需在浏览器确认。重启后端并刷新页面，检查出生位置、障碍、各区域进入/退出和工具资源；无效地图会导致服务启动失败。

客户端固定读取 `/maps/lobby.tmj`。若配置后端 `MAP_PATH`，需同时替换前端托管的 `assets/maps/lobby.tmj`，保持前后端几何与资源一致。开发时 `assets` 由 Vite 托管；生产时重新构建前端并发布输出中的地图和图片。运行中热换地图和地图事件脚本尚不受支持，`interactions` 只识别上表的六种类型。
