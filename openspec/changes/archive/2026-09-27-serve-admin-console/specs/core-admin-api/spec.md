# Core Admin API Spec Delta

## Purpose

向登录管理员提供独立于任何 UI 或 CLI 的稳定管理 API，覆盖用户、状态、运行时、默认配置、Skills 和 Core packages，同时保持 operator 凭证隔离、实际用户身份、有限上传与 Work 内容访问边界。

## ADDED Requirements

### Requirement: 以登录管理员身份授权管理 API

**Identifier:** CADM-001

Core SHALL 在 `/api/v1/admin/*` 提供 bearer 管理 API。所有路由 SHALL 先验证当前启用用户的有效登录会话，再检查 role=admin；未认证或失效返回 401，已认证普通 user 返回 403 `PERMISSION_DENIED`。operator credential SHALL 不替代该 bearer；`/control/*` 继续使用 operator credential，不接受 admin bearer。管理 API SHALL 不接收浏览器 Cookie 或实现页面、Origin、CSRF、面板会话存储；这些属于调用客户端。

授权 SHALL 在读取上传内容前完成；对于接收长上传、密码哈希或异步环境检查后才提交的操作，Core SHALL 在持久提交前重新验证同一会话。Core 已接受的持久 Operation 在会话随后失效时 SHALL 继续遵守其既有生命周期。admin 管理权限 SHALL 不扩展用户 Work 的内容访问，首管理员 bootstrap 不在该 API 中提供。

#### Scenario: 有效管理员访问
- **WHEN** 启用管理员使用有效 bearer 查询或提交管理动作
- **THEN** Core 以该用户身份处理并返回公开结果，不能把其 actor 改写为 operator

#### Scenario: 保持两种凭证隔离
- **WHEN** 普通 user 或 operator credential 请求 admin API，或者 admin bearer 请求受保护 control API
- **THEN** user 得到 403，错误类型凭证得到 401，不产生状态变更

#### Scenario: 上传期间撤销会话
- **WHEN** 上传开始后管理员会话被撤销，完整内容到达但尚未发布
- **THEN** Core 在提交前拒绝并清理暂存，不发布 Skill 或可安装的 package upload

#### Scenario: 接受后账号禁用
- **WHEN** package Operation 已持久接受，之后请求者被禁用
- **THEN** 原任务继续，失效会话不能再查询，其他启用管理员仍可凭 ID 查询该 Core 任务

### Requirement: 暴露完整且受限的管理资源契约

**Identifier:** CADM-002

Core SHALL 提供下表中的 API；name 和 userId/operationId 均为经过单次 URI 编码的一个路径段，含 slash 的 scoped package name SHALL 正确解码而不扩展路由。JSON 请求 SHALL 拒绝未知字段和非法类型，正文上限 2 MiB；任何文本 secret SHALL 不在返回值或日志回显。成功的删除 SHALL 返回 204，其余使用表中状态。JSON 错误 SHALL 使用 `{code,message,correlationId,field?,retryAfterMs?}`，message 为公开安全提示，field 为公开字段名。客户端无需导入 Core 内部实现。

| 方法与路径（均在 /api/v1/admin 下） | 输入 | 成功响应 |
| --- | --- | --- |
| GET /status | 无 | 200 `{adminApiVersion:1,state,ready,checks}`，checks 含 administrator/runtimeConfigured/runtimeAvailable/filesystemMigrationReady |
| GET /users | 无 | 200 `{users:User[]}` |
| POST /users | `{account,password,role?}` | 201 `User`；省略 role 为 user |
| POST /users/:id/enable 或 disable | 空正文或 `{}` | 200 `{userId,enabled}` |
| POST /users/:id/reset-credential | `{password}` | 200 `{userId,credentialReset:true}` |
| GET /runtime | 无 | 200 `RuntimeView` |
| PUT /runtime | `{agentImage,provider,model,baseUrl?,credential}` | 200 `{runtime:RuntimeView,status:AdminStatus}` |
| GET /default-work | 无 | 200 `{configuration:PublicWorkConfig|null,baseImage:string|null}` |
| PATCH /default-work | `{baseImage?,skills?,packages?,agentsMd?}` | 200 与 GET 相同 |
| GET /skills | 无 | 200 `{skills:ManagedSkill[]}` |
| POST /skills | SKM-004 目录 multipart | 201 `ManagedSkill` |
| GET /skills/:name | 无 | 200 `ManagedSkill` |
| PUT /skills/:name | SKM-004 目录 multipart | 200 `ManagedSkill` |
| POST /skills/:name/enable 或 disable | 空正文或 `{}` | 200 `ManagedSkill` |
| DELETE /skills/:name | 无 | 204 |
| GET /packages | 无 | 200 `{packages:PiPackageCatalogEntry[]}` |
| GET /packages/:name | 无 | 200 catalog entry 加安全 `resolvedSource` |
| POST /package-uploads | PKG-003 ZIP 二进制和现有长度、摘要、来源头 | 201 `{uploadId,expiresAt}` |
| POST /packages | `{source,idempotencyKey,addToDefaults?}` | 202 `PiPackageOperationAcceptance` |
| POST /packages/:name/update | `{source,idempotencyKey}` | 202 `PiPackageOperationAcceptance` |
| POST /packages/:name/enable 或 disable | 空正文或 `{}` | 200 catalog entry |
| DELETE /packages/:name | 无 | 204 |
| GET /operations/:id | 无 | 200 仅 Core package Operation 的公开详情 |

`User` SHALL 含 id/account/role/enabled/createdAt/updatedAt；`ManagedSkill` SHALL 含 name/enabled/fileCount/totalBytes/createdAt/updatedAt。`RuntimeView` 未配置为 `{configured:false}`，已配置包含 `configured:true,agentImage,model:{provider,id,baseUrl?,credentialAvailable},updatedAt`，不含 credentialRef、credential 或内部 revision。`PublicWorkConfig` 使用当前公开 WorkConfig 字段且不含 revision；baseImage 为当前 image catalog 的公开引用，未配置或无法解析为 null。packages patch SHALL 为唯一 name 字符串数组，提交后选择项 enabled=true；省略 packages 不修改原选择。

Core package source SHALL 为 `{kind:"npm",spec}`、`{kind:"git",spec}` 或 `{kind:"upload",uploadId}`，拒绝 Work 专用 kind=core；idempotencyKey 为 1–256 字符。acceptance SHALL 使用现有公开字段 operationId/workId=null/correlationId/reused/scope=core/kind/name，Operation 详情含 operationId/workId=null/kind/state/packagePhase/name/result/error/createdAt/updatedAt。name 在接受时尚未解析可以为 null。状态读取 SHALL 不以运行时 ready 作为授权或查询前提；未配置/不可用时仍可管理用户和查询 catalog。依赖默认 agent 环境的 package install/update SHALL 使用既有运行依赖错误，不使 Core 退出。API 本身 SHALL 不提供 Work 路由、上传内容下载、任意服务器路径读取或任务取消。

#### Scenario: 未 ready 时管理用户
- **WHEN** Core 的运行时未配置或 Docker 不可用，管理员查询状态和创建用户
- **THEN** 状态如实反映原因，用户操作可成功，安装 package 则返回依赖错误

#### Scenario: Scoped 包名与非法 JSON
- **WHEN** 查询 URI 编码的 @team/tools，或发送未知字段/超限 JSON
- **THEN** 前者正确查询该包，后者分别返回 400 INVALID_REQUEST 或 413 REQUEST_TOO_LARGE，不接受部分变更

#### Scenario: 公共错误和数据投影
- **WHEN** 查询管理资源或某动作失败
- **THEN** 返回规定 DTO 或稳定错误、可选字段及 correlationId，不返回 SQL、堆栈、宿主路径、secret 或未经处理的脚本输出

### Requirement: 管理用户时沿用身份与撤销规则

**Identifier:** CADM-003

管理员 API SHALL 复用账号唯一性、密码校验、默认 user 角色、最后启用管理员保护及禁用/重置撤销全部登录会话的行为。重复账号 SHALL 返回 409 `CONFLICT`，最后管理员保护为 409 `LAST_ADMINISTRATOR`，无效输入为 400，未知用户为 404 `NOT_FOUND`。用户列表 SHALL 使用账号、再 userId 的稳定升序；不包含密码摘要。enable/disable 相同目标状态 SHALL 成功返回当前状态。重置自身密码或禁用自身的成功响应 SHALL 可返回，但之后该 bearer 必须失效。该 API 不提供改名、角色修改或删除用户。

#### Scenario: 两名管理员并发禁用
- **WHEN** 并发操作可能使启用管理员数降到零
- **THEN** Core 在提交时保证至少保留一名启用管理员，其中违反规则的操作返回 LAST_ADMINISTRATOR

#### Scenario: 管理员创建普通用户
- **WHEN** POST users 省略 role 并提供有效数据
- **THEN** 创建启用 user，该用户的 bearer 可使用授权的用户 API，但不能使用 admin API

#### Scenario: 密码重置后撤销
- **WHEN** 管理员成功重置某账号密码
- **THEN** 该账号全部旧会话不可再认证，新密码可用于新登录，已接受的工作不因重置而取消

### Requirement: 区分全局运行时持久化和可用性

**Identifier:** CADM-004

PUT runtime SHALL 使用与现有运行时配置相同的输入限制，每次要求完整 agentImage/provider/model/credential，可选 baseUrl 省略即不设置自定义地址；不得通过空 credential 表达保留旧 secret。无效输入 SHALL 在持久化前拒绝。有效配置持久化后 SHALL 同步新 Work 的默认 runtime 字段并刷新 readiness；运行时依赖不可用 SHALL 仍返回 200 和已保存 runtime、实际非 ready status，不能用纯保存失败响应掩盖已提交结果。不可确认持久化完成的内部错误 SHALL 返回安全错误，客户端可通过 GET runtime 核实，不能假装回滚。

已有 Work 的模型、镜像、secret 引用及运行实例 SHALL 不因全局设置变更而改变。新 API SHALL 不改变现有 operator 路由的外部响应契约。

#### Scenario: 保存成功但环境不可用
- **WHEN** 输入有效且配置持久化成功，随后运行时验证失败
- **THEN** 返回 200、已保存配置及 RUNTIME_UNAVAILABLE；GET runtime 返回新值，已有 Work 不重启

#### Scenario: 无效配置原子拒绝
- **WHEN** model、provider、endpoint 或 credential 不满足当前校验规则
- **THEN** 返回 400 与公开 field，原配置及默认 runtime 字段保持不变

### Requirement: 原子合并默认 Work 管理字段

**Identifier:** CADM-005

PATCH default-work SHALL 仅接受 baseImage 字符串、skills 名称数组、packages 名称数组及 agentsMd 字符串，至少提供一项。数组重复、不可用引用、无效镜像或超限文本 SHALL 整体拒绝。空 Skill/package 数组及空 AGENTS 文本 SHALL 表示显式清空，省略字段 SHALL 保留最新已提交值。baseImage SHALL 由 Core 解析/注册为正常 image selection，注册与完整配置校验/默认提交 SHALL 在同一原子边界内，失败不得留下可见的错误默认或半成品引用。没有默认配置时 SHALL 返回 409 `DEFAULT_WORK_NOT_CONFIGURED`。

Core SHALL 在提交时基于最新完整配置合并公开 patch，保留 modelRef、MCP、tools、resources 等未指定字段；并发不相交编辑 SHALL 同时保留，同字段按提交顺序以后者为准，不暴露或要求 revision。成功 SHALL 返回当前公开完整配置和 baseImage。任何默认变更 SHALL 只作用于后续 Work 创建。

#### Scenario: 并发修改不相交字段
- **WHEN** 一个管理员修改 baseImage，另一个修改 packages，同时全局 runtime 更新 modelRef
- **THEN** 按各自提交时的最新配置合并，无关字段不因旧客户端快照丢失；对同一 image 字段按提交顺序取值

#### Scenario: 整体拒绝无效默认
- **WHEN** patch 同时包含有效 AGENTS 内容和不可用 Skill
- **THEN** 返回字段错误，两项都不提交，不改变已有 Work

#### Scenario: 上传文件不产生路径依赖
- **WHEN** agentsMd 由任意客户端文件内容得到
- **THEN** Core 只保存 UTF-8 文本，256 KiB 内可接受，任何客户端路径不属于该 API 输入

### Requirement: 保持 Core package 的管理员身份和 scope 边界

**Identifier:** CADM-006

Core package 上传和 install/update 的 actor SHALL 使用当前管理员 userId；operator 路由继续使用原 operator actor。上传引用 SHALL 同时匹配 actor 和 core scope，不允许管理员消费其他管理员、operator 或 Work 的 uploadId；同一账号重新登录可继续使用未过期的完成上传。幂等键 SHALL 在 actor/core scope/verb 下隔离，同一 actor 的相同语义重复请求重用原 Operation，不同 actor 的同键不相互重用。目录重复上传的语义比较 SHALL 使用最终上传摘要，沿用已有内容比较规则。

Core catalog 并发门禁 SHALL 跨 operator 和所有管理员共同生效。任一启用管理员与 operator SHALL 可以按已知 ID 读取任意 Core package Operation 的安全详情；不存在或非 Core package Operation SHALL 返回相同 404 `PI_PACKAGE_NOT_FOUND`。这种可观察性不得授予其他 actor 上传的使用权限或 Work 内容访问权。

#### Scenario: 上传不能跨管理员使用
- **WHEN** 管理员 B 提交管理员 A 或 operator 的 uploadId
- **THEN** 返回与不存在上传相同的不可用错误，不能安装或获知上传内容

#### Scenario: 幂等键隔离与共同门禁
- **WHEN** 两个管理员使用相同 key 安装包，A 的任务仍非终态
- **THEN** B 不会取得 A 的幂等结果而是受到 Core catalog busy 门禁；同 actor 重放仍取得原 Operation

#### Scenario: 按已知 ID 观察其他管理员任务
- **WHEN** 启用管理员查询另一个管理员创建的 Core package Operation
- **THEN** 返回同一安全状态和 packagePhase；把 ID 换成 Work Operation 则得到统一不可用结果
