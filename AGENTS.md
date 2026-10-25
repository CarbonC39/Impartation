# 项目协作约定

- 修改前阅读相关源码、workspace 脚本和文档。项目使用 TypeScript strict；保持类型检查通过，不用 `any` 避开类型问题。
- Colyseus 使用 0.18。修改 Room 或 Schema 前核对 lockfile 和安装版本，并阅读当前环境提供的官方 Colyseus skill；没有 skill 时查阅官方文档。不要使用旧版客户端、状态泛型或断线回调写法。
- 服务端拥有权威身份、位置、权限和共享状态。客户端输入须校验；授权不能依赖客户端提交的 user ID、session ID、昵称或角色。
- 账号认证使用 Better Auth 和服务端验证的 session。不要自行实现认证、密码存储、CRDT 或协作协议；账号、角色、造型和恢复规则见 [账号说明](docs/account-system.md)。HTTP Basic Auth 由部署者的代理提供。
- `avatar` 是地图角色精灵预设，`appearance` 是人物造型，`member`/`admin` 是权限角色；三者不可混用。账号造型槽位及身份隔离规则见账号说明。
- Tiled JSON 是地图几何和互动语义的源数据。地图使用有限正交 16×16 tile；地图 registry 定义 Space、初始地图和命名出生点。只依赖项目明确支持的对象和渲染能力，详见 [地图制作](docs/tiled.md)。
- 使用泛型 `InteractionRegistry<T>` 注册互动定义；前后端分别组装自己的 handler。服务端校验身份、位置和权限；handler 离开区域、断线或销毁时清理订阅与资源。内置与外部功能边界见 [互动说明](docs/integrations.md)。
- 外部网页入口统一使用 Tiled 类型 `web`，以 `resourceId` 对应 `EXTERNAL_TOOLS`。外部服务自行管理账号、权限和内容；项目不传递身份凭据、不代理工具流量、不管理工具容器。配置规则见 [外部工具配置](docs/external-tools.md)。
- 前端仅依赖 `packages/shared` 导出的 Colyseus 协议类型，不依赖 backend 源码类型。主体项目保持精简，优先接入宿主机服务；完整编辑器、绘画、文档协作和媒体同步交给外部服务。视频通话和屏幕共享不在范围内。
- README 中的启动、构建、测试和部署说明须与脚本及代码相符。只写已配置的 CI 能力；未运行的检查标为未验收，不声称通过。文档只维护使用说明、接口契约、架构边界和待办，不记录对话或逐轮工作记录。
- 完成代码变更后及时提交，便于分阶段回看；不要远程 push，除非用户明确要求。
