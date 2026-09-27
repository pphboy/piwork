# Proposal

## Why

部署者目前必须使用 `piwork-serve` 执行日常管理，远程浏览器没有可用的管理员面板。新增独立部署入口，让管理员通过浏览器管理用户、运行配置、Skills 和 Core Pi packages，同时保持 Core 的 daemon 职责和稳定 API 边界。

## What Changes

- 在现有 `apps/console` 工作区实现独立管理面板，以 `piwork-console serve` 启动，与 Core 同机部署，由面板提供 HTTPS，连接本机 Core。面板停机不影响 Core、CLI 或已接受的后台任务。
- 仅允许启用的 `admin` 登录；浏览器使用安全 Cookie 和 CSRF 保护，Core bearer 保存在面板进程内。普通 `user` 继续使用 `piwork-cli`；管理员可创建两种角色，禁用、重置密码和最后一名管理员保护沿用 Core 规则。
- 提供状态、用户、全局运行时、默认 Work 配置、Skills、Core packages 和按 ID 查询 Package Operation 的完整管理流程。每页明确加载、空态、提交、失败、权限失效和刷新行为。
- Skill 添加/更新使用浏览器目录上传，名称来自所选目录 basename；`AGENTS.md` 支持选择本地文件载入编辑器和直接编辑，提交文本内容。
- Core package 支持 npm、Git、本地目录和 ZIP；安装/更新展示持久 Operation 与准备阶段，可复制 ID 并在重新登录或其他设备上按 ID 查询。默认包选择、原子安装并加入默认、并发门禁和已有 Work 副本隔离沿用现有语义。
- Core 增加通用管理员 API、Skill 内容上传和只更新指定默认字段的管理契约；Core package 上传及幂等键使用真实管理员身份。现有 `/control/*` operator 接口保持凭证隔离。
- UI 需求集中在独立的 `serve-ui*` 能力中；通用授权、上传及数据变更记录在 Core 能力规范中，通过公开 DTO、错误码与 HTTP 接口连接。
- 第一版不包含首管理员 bootstrap、Core 进程启停、Work/Session/Run/聊天页面、Work package 管理、`.work` 快照、多 Core 管理、任务历史列表或包任务取消。首管理员仍由 CLI/env 初始化。

## Capabilities

### New Capabilities

- `serve-ui`：独立面板命令、同机连接与 HTTPS、管理员浏览器会话、导航、公共交互和故障行为。
- `serve-ui-users`：用户列表、创建、启用、禁用和密码重置的面板交互。
- `serve-ui-configuration`：Core 状态、全局运行时及默认 Work 配置表单，包含 AGENTS 文件选择和编辑。
- `serve-ui-skills`：通过本地目录上传管理完整 Skill 的浏览器流程。
- `serve-ui-packages`：Core package 四类来源、管理动作、默认关联和按 Operation ID 恢复观察。
- `core-admin-api`：供任意管理客户端使用的管理员授权、管理 API、公共响应、默认字段合并和身份隔离。

### Modified Capabilities

- `serve-control-plane`：默认 Work 配置和 Core 管理能力同时允许 operator 控制面与受保护管理员 API，继续限制 Work 内容访问。
- `skill-management`：增加鉴权后的有界目录内容上传，并允许管理员通过该入口管理与发现完整管理状态。
- `pi-package-management`：Core catalog、Core 上传和 Operation 查询扩展至管理员；明确 actor 隔离及与 Work scope 的边界。

## Impact

- `apps/console`：替换占位页面，新增启动入口、HTTPS 服务、进程内会话、页面与浏览器脚本、上传适配及浏览器验收。
- `apps/core`：新增管理路由和可复用管理应用服务；补齐 Skill 上传，复用用户、运行时、配置和 package 领域实现。Core 不导入 console 代码、不提供页面或浏览器 Cookie 接口。
- `packages/contracts`、`packages/client-sdk`：增加客户端无关的管理 DTO、错误和 SDK 方法；浏览器不直接加载含 Node 依赖的 SDK。
- `packages/core-store`：复用现有用户、配置事务、上传、actor 与幂等记录；必要的存储调整限于本 change 的管理契约。`packages/pi-package` 继续负责目录/ZIP 的校验和打包。
- 新增流式 multipart 解析依赖用于目录输入；浏览器测试作为 console 的独立验收入口。更新 workspace 构建、命令文档和同机部署说明。
- 保持现有 CLI 命令和凭证形式；管理员新增 API 不放宽普通用户权限。上传临时文件有界并清理，secret 不进入页面响应或日志；配置提交与运行时 readiness 分别报告，避免把已保存配置误报为未保存。
