# Tiled 地图契约

本页面向地图制作者。托管者配置 Space、部署地图与封面、挂载 Docker 目录和更新回滚时，请参阅[托管指南](hosting.md)。

Tiled JSON (`.tmj`) 是地图几何、出生点、碰撞和交互的唯一源数据。`assets/maps/registry.json` 定义可复用地图和有序 Space 列表；每个 Space 选择初始地图和成员地图：

```json
{
  "maps": [
    { "id": "lobby", "file": "lobby.tmj", "defaultSpawn": "default" }
  ],
  "spaces": [
    {
      "id": "main",
      "name": "Main",
      "description": "Optional description",
      "cover": "/covers/main.png",
      "initialMap": "lobby",
      "maps": ["lobby"]
    }
  ]
}
```

`file` 相对于 registry 文件。`maps` 保存地图定义，每个条目包含 `id`、`file`、`defaultSpawn`；`spaces` 数组顺序就是开始页显示顺序。默认产品 Space 的稳定 ID 为 `main`。Space 的 `id` 必须匹配 `/^[a-z0-9][a-z0-9_-]*$/`，创建后应保持稳定；`name` 是展示名，`description` 可选，`cover` 是普通静态图片路径。每个 Space 的 `initialMap` 和 `maps` 都必须引用已登记地图，初始地图必须属于该 Space。地图可以被多个 Space 复用。Portal 的目标地图必须属于当前 Space，目标出生点也必须存在。

registry 顶层可选 `project`，路径相对于 registry 文件，指向 Tiled `.tiled-project` JSON 文件。配置后，服务端读取项目 `propertyTypes` 中的自定义 class 成员默认值，并在解析地图前补齐地图、layer、tileset、tile、对象和嵌套 class 的属性；不配置时只保留文件显式保存的值，不推断未知 class 成员或 object references。明确声明类型的属性会校验值结构；没有 `type` 的旧属性保留兼容。枚举和编辑器颜色不影响服务端语义。Tiled class 属性在地图 JSON 中保留其 `type`、`propertytype` 与 `value`；嵌套 class 的 `value` 保持 Tiled 原生对象结构。覆盖 class 属性时会按项目 class 成员递归合并其值。共享 world 的 `typedProperties` 按属性名提供顶层类型元数据，既有 `properties` 仍提供直接值，供交互 handler 校验和使用。

JSON Object Template 可使用 `.tj` 或 `.json` 文件，模板路径相对于引用它的地图或上级模板文件。对象实例从模板继承形状、class、尺寸与 properties；实例中同名 property 覆盖模板值，实例的位置和 Tiled object ID 始终作为地图实例自身的值，实例写出的 `class` 或旧版 `type` 会覆盖模板的 class。模板 tile object 必须引用外置 tileset；模板的 tileset source 需要与地图中的一个 tileset source 指向同一文件，服务端据此把模板 GID 映射到地图 GID，地图实例显式设置的 GID 已处于地图 GID 空间，不会再次映射。模板循环引用、缺失文件或无法匹配 tileset 会在启动时明确报错；非循环的模板链正常展开。XML `.tx` 模板不支持。

Tiled 的 `object` property 保存地图内对象的数值 ID。解析器允许 `0` 表示未设置，其余 ID 必须指向地图中存在的对象；引用检查也覆盖 class 与 list property 内的 object 值。模板展开后以地图实例的 ID 作为引用目标，不接受模板文件内部对象 ID 作为替代。

上例的 `/covers/main.png` 需要另外发布到前端静态目录，例如构建前放入 `assets/covers/main.png`。地图 API 不会自动托管 `cover`；只改 `MAP_REGISTRY_PATH` 不会更新前端静态资源。共享地图里的 Portal 也必须对每个引用它的 Space 都有效，不能仅检查初始 Space。

客户端从 `GET /api/world` 读取 `{ maps, spaces }`：`spaces` 提供列表元数据，`maps` 是规范化地图目录；再按地图 URL 请求对应渲染 JSON 和显式资源。服务端以源 `.tmj` 提取权威语义。单进程中每个 Space 最多有一个 live Colyseus room；`spaceJoinSchema` 要求客户端提交 `spaceId`，服务端按它匹配该 Space。满员时明确拒绝加入，不会再创建第二个 room。`SPACE_MAX_CLIENTS` 对所有 Space 共用，默认 32。

## 交互试验场

默认 registry 已登记 `interaction-lab.tmj`。重启后端后进入大厅，从出生点向下走进传送框即可到达；从中央房间北侧出口绕到左右走廊，再走到最下方的地垫传送区即可返回大厅，落点位于入口下方，不会连续触发传送。

试验场直接复用 `lobby.tmj` 的图层构造与同一张 `tiles.png`：木地板、墙面、蓝色座椅、长桌、书架与小边桌均沿用大厅素材。左上房间在原有墙体基础上补充南侧隔墙，并留出 48px 门口。地图没有另加一套画风或图块。

| 位置 | 可体验内容 |
| --- | --- |
| 下方书架之间的长桌，上排左侧三个蓝色座位 | 三个独立 variantSelector；站到对应座位按 E / 坐下，可选 computer、book、drawing-board，桌上图块同步变化 |
| 同一排最右侧蓝色座位 | 单选项选择器；坐下直接在桌上显示书本 |
| 上方中央房间左侧蓝色座位 | 普通 action 锚点，验证朝向、2px 偏移和移动起身 |
| 上方中央房间墙上的蓝色镜框前 | wardrobe，打开已有衣橱；保存后返回当前地图 |
| 左上房间 | privateArea，有墙体和南侧门口，房内也有镜框入口及座位；房外左侧走廊的门与地垫传送区可尝试到达房内 spawn，仍接受锁定准入检查 |
| 中央各桌椅旁的 web 区域 | 沿用 lobby 的四个资源位置与 resourceId，分别对应 Etherpad、WBO、Drawpile Web、SyncTV；复用现有 `EXTERNAL_TOOLS`，未配置时提示未配置 |
| 最下方走廊的地垫区域 | Portal，传送回大厅 |

多人体验可用两个独立浏览器身份：先由 A 坐在某个长桌座位，B 在同一定位格按 E 验证占用拒绝，再分别操作不同座位；A 起身后 B 可接手。私密房间由 A 先进入并锁定，B 在门外验证被阻挡，A 添加 B 后再检查 B 可进入及平等解锁。成员离开房间后可重入；全部离开物理区域并等待 60 秒后会清空锁定和成员。

## 地图设置

使用有限、正交地图，图块宽高均为 **16 × 16 像素**。地图宽高可按需设置。Tiled 中把几何语义对象放入名为 `spawns`、`collisions`、`interactions` 的对象层；这些图层可位于 group 内，也可使用 layer 的偏移。解析器将 group/layer 偏移计入语义对象位置。其他图层、对象和 tileset 元数据不用于碰撞、出生点或交互校验。

渲染加载器可解析多个内嵌 atlas 和外置 JSON `.tsj` tileset，Phaser 按 Tiled 顺序创建全部瓦片层，包括 group 中的瓦片层；不依赖 `ground` 名称。atlas tileset 的 tile animation 帧由渲染器播放；服务启动时要求动画至少有一帧，帧的 local tile ID 必须位于 tileset 范围内，duration 必须为正整数毫秒。Image-collection tileset 动画没有专门支持。XML `.tsx` 尚无加载器，image layer、通用 tile object 和 image-collection tileset 尚无专门渲染路径；variantSelector 引用的目标矩形或 atlas tile object 有专用渲染路径。它们不被共享语义解析器禁止；使用时需补充渲染加载/展示实现。

需要让树冠、屋顶等瓦片遮住角色时，在对应的 **瓦片层** 添加 Tiled 自定义布尔属性 `abovePlayers = true`。该层会整体绘制在角色、地图对象和角色状态标记之上；多个前景瓦片层仍按 Tiled 中的顺序叠放。未设置或设为 `false` 的瓦片层保持原有背景深度。这个属性只控制显示，不产生碰撞；需要阻挡移动时仍须在 `collisions` 对象层绘制矩形或多边形。可将前景瓦片层放入 group，但属性应设置在瓦片层本身。

需要角色走到瓦片上方时被遮挡、走到下方时显示在前面，可在对应瓦片层添加 Tiled 自定义布尔属性 `ySort = true`。客户端按每行瓦片的底边世界 Y 坐标与角色脚点排序，适合树木、柜台等局部遮挡；同一行的瓦片共用排序深度。跨多行绘制的完整物体会按行分别排序，制图时应检查实际效果。`ySort` 与 `abovePlayers` 同时为 `true` 时使用 `ySort`。角色名称等状态标记仍显示在 Y 排序瓦片上方。

项目只约束语义层的数据，不承诺 Phaser 渲染器支持 Tiled 的全部图层、对象或 tileset 表达。地图保存后应在实际浏览器检查所用渲染特性。无限地图和非正交地图不受支持，因为当前权威移动和 AABB 边界按有限矩形世界计算。出生点和动作锚点使用无旋转点；碰撞和区域交互可使用无旋转轴对齐矩形或简单多边形，必须有正面积且完全在地图范围内。16×16 只约束地图网格；角色、家具和对象叠加图的视觉尺寸独立。属性默认值、object references 和 Object Templates 的解析遵循 [Tiled Custom Properties](https://doc.mapeditor.org/en/stable/manual/custom-properties/)、[JSON Map Format](https://doc.mapeditor.org/en/stable/reference/json-map-format/) 与 [Using Templates](https://doc.mapeditor.org/en/stable/manual/using-templates/)；模板 tile GID 映射遵循 [Tiled Global Tile IDs](https://doc.mapeditor.org/en/stable/reference/global-tile-ids/)。

### 出生点与碰撞

- `spawns` 中放置一个或多个唯一命名的 Tiled point object。名称是出生点 ID；无需名为 `default` 的固定对象。registry 的 `defaultSpawn` 必须匹配该地图存在的名称。
- 出生点应位于可通行区域。服务端使用脚点上方的 12×8 地面碰撞矩形校验边界和障碍，尺寸独立于角色图片。
- `collisions` 中每个矩形或多边形对象都是服务器端障碍。地面瓦片图案不会自动产生碰撞。

### 角色附件来源

在 `interactions` 对象层放置 `class = attachment` 的矩形或多边形区域。对象名称是该地图内唯一的来源 ID。配置两个自定义字符串属性：`mode` 与 `attachmentIds`。`attachmentIds` 使用英文逗号分隔资源 ID；服务启动时会校验 ID 是否存在、是否重复，以及模式所需的数量。

| `mode` | `attachmentIds` | 取用规则 |
| --- | --- | --- |
| `single-unlimited` | 一个 ID | 始终可取，多人可同时持有 |
| `single-unique` | 一个 ID | 同一 Space 的该来源同时只能由一人持有；清除、替换或离开后重新可取 |
| `multiple-unlimited-random` | 两个或更多 ID | 每次独立随机取一个，来源始终可取 |

角色同时只显示一个附件；新附件直接替换旧附件。附件不会进入账号资料、造型槽或衣橱，普通断线重连会保留房间内的持有状态。素材登记在 `packages/shared/src/attachments.ts`，图片放在 `assets/attachments/`，图集尺寸、方向和动作帧排列与角色图层相同。附件在造型图层之上按相同脚点、帧和透明度绘制，不参与碰撞或角色动作规则。

需要随唯一来源占用消失的图块应从普通静态瓦片层移除，并在来源对象上填写 `visualGid`、`visualX`、`visualY` 三个 int 属性。`visualGid` 是地图 atlas 的 GID，X/Y 是该图块左上角的地图像素坐标，必须对齐 16px 网格并位于地图内。客户端会在运行时为它创建独立的可见图层，根据房间同步状态隐藏和恢复；同一图块不要仍留在静态层。未填写这三个属性的来源继续使用普通静态地图装饰。

大厅有 `drink-west`、`drink-east`（潘趣酒，单件无限），`food-west`、`food-east`（五种食物，随机无限）和 `crown-west`（派对皇冠，单件唯一）作为可走入的示例来源。进入区域后点「取用附件」；地图左上角常驻显示当前名称与「清除」按钮。皇冠图块会在取走时消失，在释放后重新显示。

### 多边形区域与动画

`collisions` 和所有区域交互（包括 Portal、web、privateArea、wardrobe）支持 Tiled polygon object。顶点相对于对象 x/y，group/layer 偏移同样生效；顺时针、逆时针和凹多边形均可使用。顶点数为 3–1024，不允许自交、重复点、重叠边、孔洞或零面积。点类型出生点、action、variantSelector 以及变体目标不使用多边形。规范化 API 保留绝对世界坐标顶点和包围矩形，触发、准入和碰撞按实际多边形计算。

角色仍以 12×8 脚底矩形参与碰撞，只接触障碍边界不会阻挡；普通区域按脚点是否在内部判断，多边形边界计入区域。锁定的 privateArea 校验完整脚底矩形，不能从斜边跨入；锁定时脚底已跨边界的非成员可向外退。privateArea 的实际面积不能彼此重叠，但可以共边或有重叠包围框。

atlas 的动画使用每个 tile 的 `animation: [{ tileid, duration }]`，`tileid` 为所属 tileset 的 local ID，`duration` 为正整数毫秒。普通层、abovePlayers、ySort 和 variantSelector 目标均支持动画，按本地时间循环，不进入服务端状态；动画帧不改变碰撞或交互几何。WebGL 使用 Phaser 4 原生播放，Canvas 使用相同帧时间选择。

### 交互类型

以下是六种地图交互类型；交互类型写在 `interactions` 对象层对象的 Tiled `class`（兼容旧 `type`）中。既有地图保持原有行为，新类型只有显式添加对应对象后才启用。项目语义对象保留其他自定义数据，内置类型会校验自己使用的字段。

| 类型 | Tiled 对象 | 标识与必需字段 | 用途 |
| --- | --- | --- | --- |
| `action` | 命名 point | 地图内唯一 `name`；string `action`，当前支持 `sit` | 角色动作锚点；既有地图继续以名称作为 ID |
| `variantSelector` | 带数值 Tiled ID 和名称的 point | string `action: sit`、数值 `targetObjectId`、CSV string `variants` | 占用动作点后切换关联地图对象变体 |
| `privateArea` | 带数值 Tiled ID 的矩形或多边形 | 无必需 properties | 可临时锁定并管理成员的空间区域 |
| `wardrobe` | 带数值 Tiled ID 的矩形或多边形 | 无必需 properties | 打开现有角色外观编辑和保存界面 |
| `Portal` | 命名矩形或多边形 | string `targetMap`、string `targetSpawn` | 由服务器验证并执行地图转换 |
| `web` | 命名矩形或多边形 | 非空 string `resourceId` | 打开 `EXTERNAL_TOOLS` 外置页面；默认为 external，embed 可选 |

### 角色动作锚点

在 `interactions` 对象层放置命名 point object，`class` 设为 `action`，并用 string property `action` 指定动作名称。地图可以声明任意合法名称，但只有 shared `CHARACTER_ACTIONS` 目录中的动作（目前为 `sit`）可被玩家触发；新增动作需同时加入目录和角色图集的动作行。对象 `name` 是当前地图内唯一的 authored ID；动作锚点没有 `resourceId`。

可选 string property `facing` 声明对齐到锚点所需的朝向（`up`、`down`、`left` 或 `right`）；交互不会自动转身。朝向不符时角色仍可原地执行动作，但不会对齐锚点或认领它；客户端提示所需朝向。省略时不限制朝向。动作已激活时，切换动画保留当前已认领的锚点及偏移后位置。`offsetX`、`offsetY` 是以世界像素计的有限数值偏移，默认均为 0。可选 `linkedObjectId` 保留与地图对象的关联 ID。

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

激活动作时，服务端查找与角色 12×8 脚底矩形有正面积重叠的同名锚点；锚点对应其 16×16 tile。若有多个候选，先选择距离最近者，距离相同时按稳定对象 ID 的字符串顺序决定。最近锚点朝向不符时，角色原地执行动作，保持位置和朝向，`actionTargetId` 为空，并释放已有动作认领；不会对齐、认领或显示变体选择界面，也不会自动应用变体。最近锚点朝向相符但已被占用时请求失败，不会改选更远锚点。有效请求会将角色吸附到锚点加偏移的位置；服务端沿吸附路径按小于脚底矩形尺寸的步长采样，并检查碰撞和私密区域限制。没有重叠候选时，动作也会在原地执行。相同动作名称在每个 16×16 格最多一个锚点，不同动作可共用一格。非零移动会取消动作、目标对象和动作动画标记。

客户端通过 `activateAction({ action, animated })` 请求动作；`animated` 可省略且默认为 `false`。请求不携带对象 ID 或客户端坐标。服务端权威校验重叠、朝向、锚点占用、吸附路径及动作偏移。若希望任意朝向都能对齐，可省略 `facing`；配置后，只有匹配朝向才对齐并使用交互点，其余朝向仍原地执行动作。

### 变体选择点

`variantSelector` 必须放在 `interactions` 对象层中，是 point object，并填写数值 Tiled `id`、非空 `name` 及以下 properties：`action`（目前为 `sit`）、数值 `targetObjectId`（被选择地图对象的 Tiled `id`）、逗号分隔的 `variants`。名称须唯一，符合小写字母开头的 `[a-z][a-z0-9_-]*`，最多 16 个。可选 `facing`、有限数值 `offsetX`/`offsetY` 与 `action` 共用规则。

```json
{
  "id": 204,
  "name": "sofa-seat-1",
  "class": "variantSelector",
  "x": 176,
  "y": 224,
  "point": true,
  "properties": [
    { "name": "action", "type": "string", "value": "sit" },
    { "name": "targetObjectId", "type": "object", "value": 501 },
    { "name": "variants", "type": "string", "value": "computer,book,drawing-board" },
    { "name": "facing", "type": "string", "value": "down" },
    { "name": "offsetY", "type": "float", "value": 2 }
  ]
}
```

目标放在 `interactions` 以外的对象层中，使用数值 Tiled `id` 和正数宽高。推荐直接画一个矩形，省略基础 `gid` 时初始透明。为选择器声明的每个名字添加 `variant.<name>` int property；所有值都是 tileset 内零起始 local tile ID，`0` 表示第一块图块，`-1` 表示透明。单 tileset 地图自动使用该 tileset；多 tileset 地图必须填写 target 上的 string property `variantTileset` 选择 tileset，也可在单 tileset 地图显式填写。系统根据 tileset 的 `firstgid` 将 local ID 转为运行时 map GID；例如 `basic` 的 `firstgid` 为 1 时，local ID `6` 对应 GID `7`。backend 会先展开 external TSJ，再解析地图语义。旧变体配置若填的是 map GID，需要减去所属 tileset 的 `firstgid`；原先表示透明的变体值 `0` 改为 `-1`。普通矩形的 x/y 是左上角；已有 tile object 的基础 `gid` 仍使用 Tiled 原生 map GID，并保留 bottom-left（默认）对齐，其 y 是底边。显式基础 `gid: 0` 也沿用 tile object 底边坐标。两种形式都不能旋转，不支持翻转 GID 或 image collection tileset。目标不需要脚本，服务器按地图 ID 和对象 ID 保存当前变体。

```json
{
  "id": 501,
  "name": "desk-prop",
  "x": 168,
  "y": 192,
  "width": 16,
  "height": 16,
  "properties": [
    { "name": "variantTileset", "type": "string", "value": "basic" },
    { "name": "variant.computer", "type": "int", "value": 6 },
    { "name": "variant.book", "type": "int", "value": 7 },
    { "name": "variant.drawing-board", "type": "int", "value": 8 }
  ]
}
```

透明仅隐藏目标物品，原有 tile layer 仍然可见；桌面、地面等背景可以保留在原层，变化的物品不要同时画进静态前景层。目标物品按底边参与 Y 排序，绘制在同底边的 ySort 图块之上；abovePlayers 前景仍可遮挡它。

占用选择点时，选择界面优先于普通区域入口：已打开的 web 窗口关闭，普通区域面板暂停，释放后恢复当前位置的区域入口。私密区域的成员与准入状态仍独立维护。

只有正确朝向并成功对齐、认领选择点后，单候选变体才自动应用，多候选才显示选择界面。朝向不符会原地坐下，不认领新选择点或应用新变体；释放旧认领时仍复原其目标。占用者可调用现有 `selectVariant` 请求清除物品，无需地图额外声明 `empty` 选项：

```ts
room.request('selectVariant', { selectorId: '204', variant: null });
```

清除会保留动作和认领，并隐藏目标图块，即使 Tiled 目标有基础 `gid`。正常选择名称变体会恢复该变体。移动、取消动作、断线、跨地图或认领失效会释放选择点并重置其目标为 Tiled 原始基础图块；省略基础 `gid` 时恢复透明。动画切换若仍保持同一选择点认领，不会重置目标或再次自动应用单选项。每个 selector 必须独占一个 target。多个沙发位置需分别制作 selector 和 target；不要共用目标对象。选择与变体状态按 Tiled 对象 ID 定位，不依赖名称。服务端原子认领选择点，只有占用者保持所需动作、朝向和锚点位置时可选择。

### 私密区域与衣柜

`privateArea` 与 `wardrobe` 是矩形或多边形交互区，均使用数值 Tiled `id` 作为稳定 ID。私密区域无需 properties；衣柜复用项目现有衣柜界面及保存流程。

```json
[
  { "id": 601, "name": "studio-private", "class": "privateArea", "x": 64, "y": 64, "width": 96, "height": 64 },
  { "id": 602, "name": "wardrobe-corner", "class": "wardrobe", "x": 176, "y": 64, "width": 32, "height": 32 }
]
```

房间墙体仍需在 `collisions` 层制作，并留出门口；静态墙体对所有人保持碰撞。`privateArea` 在锁定后为区域边界补充成员准入检查，不能替代墙体绘制。

私密区域初始开放。进入开放区域的在线玩家成为该会话成员；任一成员可锁定/解锁，也可将任一在线玩家加入成员名单。锁定后，非成员的完整脚点碰撞矩形不能进入区域；服务器也校验角色动作偏移位置和 Portal 目标出生点。离开区域不会清除成员资格，因此仍在线的成员可重新进入。断开连接或切换地图会移除该成员；无实体成员但仍有成员记录时，60 秒后解锁并清空；成员名单立刻为空时立即重置。

私密区域的实际面积不能彼此重叠；普通交互区可以与其嵌套。普通交互区域的选择与私密成员上下文分别维护，嵌套的 board、web 或 Portal 仍按自身区域处理。私密区域会影响聊天与附近语音：区域成员能收到公共频道内容，公共玩家收不到区域内玩家的内容，不同私密区域彼此隔离。位置等玩家状态仍对整个房间可见；语音隔离由官方客户端按收听方向启用或禁用每个 WebRTC peer 的音轨，不是抵御篡改客户端的媒体保密机制。

### 交互区与 Portal

旧的 action/web/Portal/board/pomodoro 使用名称作为交互 ID；新类型使用 Tiled 数字 ID 的字符串形式作为运行时 ID。新增对象需同时填写非空名称和数值 ID；不要在编辑时重建需保留身份的对象。把座位升级为 selector 时保留其位置/朝向/偏移，明确引用目标对象并添加选项。`linkedObjectId` 不会自动变为变体目标。

`interactions` 中每个矩形或多边形对象需要唯一非空 Name。交互类型从 Tiled `class`（旧版 `type`）读取。共享的泛型 `InteractionRegistry<T>` 保存按 kind 关联的定义；当前解析定义只负责校验 properties，前后端 handlers 在各自模块组装。交互区域的坐标、类型和 properties 是地图定义的一部分，`resourceId` 用于需要共享资源归属的交互。

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

服务端校验 Portal 指向当前 Space 中存在的地图和出生点。客户端仅提交当前 Portal 的 `zoneId`；服务端还会检查身份、玩家所在地图和实际位置，再在同一 Space room 内切换玩家 `mapId` 并放置到目标出生点。交互显示和客户端碰撞都不能授权地图切换。

## Integration 接入

内置留言板与番茄钟分别注册为 `board`、`pomodoro`，按 `resourceId` 归属数据。所有地图外置页面入口统一使用类型 `web`，并按 `resourceId` 关联配置；多个区域可引用相同资源。`name` 标识区域本身。`web` 只提供外置服务入口，不把协作文档、绘画或媒体同步状态复制到项目中。

`EXTERNAL_TOOLS` 以 resourceId 为键配置 `{ url, mode?, manualExternalOpen?, allowSameOrigin? }`，其中 URL 必填，mode 可为 `embed` 或 `external`，默认 `external`。进入区域只在区域上方显示入口提示；用户点击后才在居中、可拖动的电视框窗口中挂载 embed iframe，或打开 external 新标签页。`manualExternalOpen: true` 仅在已打开的 embed 旁增加手动外链；旧 `fallback: "external"` 是兼容别名，两者均不检测加载失败或自动切换。`allowSameOrigin` 默认 false，仅对可信自托管的 embed 开放。展示模式不改变服务器端身份、位置或权限校验，也不映射项目身份。

公共 WebTool 配置会通过 `GET /api/tools` 暴露给浏览器，不得含凭据。见[内置与外置接入](integrations.md)和[入口配置](integration-plan.md)。

外置入口的 Tiled 矩形只保存资源键：

```json
{
  "name": "shared-drawing",
  "class": "web",
  "x": 256,
  "y": 64,
  "width": 32,
  "height": 32,
  "properties": [
    { "name": "resourceId", "type": "string", "value": "shared-drawing" }
  ]
}
```

`EXTERNAL_TOOLS` 中以该 `resourceId` 配置服务 URL。`external` 默认打开新标签页；满足服务 CSP、认证和浏览器限制时可选 `embed`。这份地图契约不代表已完成具体外置服务的浏览器端到端验收。

## 校验与发布

服务启动时会解析 registry 中所有地图，检查 16px tile 尺寸、命名出生点、语义几何、动作锚点、变体目标与引用、私密区域重叠和 Portal 目标。验证地图契约后，还需在浏览器检查地图渲染、资源路径、出生点、碰撞、区域进入/退出、动作锚点定位与朝向及跨地图到达行为。外置服务是否可访问还取决于目标浏览器与部署配置，需单独验收。更换 registry 或地图文件后重启后端。
