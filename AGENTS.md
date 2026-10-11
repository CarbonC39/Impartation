# 项目协作与实现约定

- 先阅读相关源码、workspace 脚本和对应文档，再编辑。仓库采用 TypeScript strict；保持 strict 类型检查通过，不以 `any` 绕开类型问题。
- Colyseus 使用 0.18 系列。写 Room 或 Schema 前检查 package-lock 与实际安装版本，并读取当前环境安装的官方 Colyseus skill。没有 skill 时用 `npx skills add colyseus/skill` 安装，或查阅 https://docs.colyseus.io 。不要沿用过时的 `colyseus.js`、`client.id`、`Room<MyState>` 或旧断线回调写法。
- 服务端拥有权威状态。客户端只提交经过校验的输入并订阅状态；不能信任客户端提供的 session id，也不能只靠客户端执行权限或碰撞规则。
- 不要手搓登录认证、密码存储、CRDT 或协作同步协议。按需求评估现成、维护中的库及其许可、体积和运维成本。
- 范围决策：当前实现持久匿名身份，桌面、手机、网页可用一次性绑定码共享同一 Better Auth session；正式注册/登录与账号恢复以后再做。用户自行配置共用 HTTP Basic Auth 代理，项目不实现 Basic Auth 认证或代理配置。访客身份由服务端验证的 session 证明；不能仅凭客户端提交的 user id、昵称或平台授权操作。
- `avatar` 表示地图角色形象（精灵图）的预设 ID，从已有形象列表中选择，不是个人头像图片。形象选择与 `member`/`admin` 权限角色分开；当前彩色圆形仅为占位渲染。留言板、番茄钟均归属 integrations，业务规则不放进身份模块文档。
- 主体项目保持最小，优先引用宿主机 Docker 服务；工具编辑器、画笔、正文协作和播放同步交给第三方，不默认维护工具分叉。范围为白板、面向绘师的共同作画、YouTube/Bilibili 同步观看和协作文档；白板不能代替共同作画，视频通话与屏幕共享不在范围内。Drawpile 是能力参考，可选择合适替代服务。
- Tiled JSON 是地图几何和语义的源数据；地图 registry 选择初始地图与默认命名 spawn。地图使用有限正交 16×16 tile。服务端以 `/api/world` 发布地图目录、规范化地图和其显式资源；客户端按 map id 渲染。项目仅约束命名 spawn、碰撞矩形、交互矩形和 Portal 等语义对象，不承诺完整 Tiled renderer 支持。
- 通过泛型 `InteractionRegistry<T>` 注册交互定义。服务器拥有权威位置、身份、权限与 Portal 转换；前端 presentation handlers 与后端 integration handlers 分离。Presentation modes 为 `native`、`embed`、`external`。`native` 按 integration kind 查找显式注册的 handler，通过 `PresentationRegistry.registerNative(kind, handler)` 注册；现有 board/pomodoro 面板属于 native。`embed` 使用沙盒 iframe。native 缺少 handler 时可配置 `fallback: 'external'`，并必须有 URL；embed/external 需要 URL。外置服务保留自身账号与权限；不映射项目匿名身份或管理员，不签发工具凭据、不管理容器。既有 `EXTERNAL_TOOLS` `{ kind, url }` 默认 `external`。配置契约见 `docs/integration-plan.md`，接入边界见 `docs/integrations.md`。统一身份和跨服务授权留待后续需求。
- 前端只依赖 `packages/shared` 导出的 Colyseus 协议结构类型，不依赖 backend 源码类型。
- 用低影响、可独立完成的文档或探索工作时，可委派给 luna；主 agent 负责验收和整合。不要因委派而扩大任务范围。
- 完成代码变更后及时 git commit，便于分阶段回看；不要自行远程 push，远程操作由用户进行。
- README 的启动、构建、测试和部署说明必须与实际脚本及代码相符。未执行的检查标为待验收；不得声称未运行的测试通过，也不要虚构验收结果。
- CI 目前仅可作为后续计划描述，除非仓库中实际加入并验证了 CI 配置。
- 文档只保存使用说明、接口契约、架构边界和待办，不记录对话、agent 分工或逐轮工作日志。测试执行结果写在提交说明中；文档保留运行方法、覆盖范围和未覆盖项，避免多处维护测试数量。
