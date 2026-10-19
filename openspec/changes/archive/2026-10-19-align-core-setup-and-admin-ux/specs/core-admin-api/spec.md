# Spec Delta

## MODIFIED Requirements

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
| PUT /runtime | `{modelRef}` 或 `{provider,model,baseUrl?,credential}`；旧 agentImage 字段仅按 CADM-004 验证同版固定值 | 200 `{runtime:RuntimeView,status:AdminStatus}` |
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

### Requirement: 区分全局运行时持久化和可用性

**Identifier:** CADM-004

PUT runtime SHALL 接受两种互斥完整模型输入：引用式 `{modelRef}`，或既有 `{provider,model,baseUrl?,credential}`，均不要求镜像参数。引用式解析完整模型配置，不要求重填 Key 或创建 Provider；自定义 Model ID/Thinking 未确认本身不构成无效引用。既有模型输入继续完整提供 credential，provider 仅保留协议逻辑语义，转为稳定模型配置；省略 baseUrl 不设自定义地址，空 credential 不表示保留。混合输入和真实不可用引用在持久化前拒绝。

全局 Runtime 的 Agent 引用 SHALL 在 Core 写入边界由该服务端同版内嵌发行配置取得，管理员 API、operator 在线/离线和 Console 适配遵守同一规则。兼容旧输入中的 agentImage 字段时，省略或等于内嵌值均采用内嵌引用；不同值 SHALL 返回 400 INVALID_REQUEST、field=agentImage，原子保留 Runtime、模型及默认配置。发行引用缺失/无效 SHALL 返回安全的 RELEASE_DEFAULTS_UNAVAILABLE 错误且不修改配置，不回退客户端、旧 Runtime、业务 env 或手填值。新网页客户端只发送模型引用。

有效配置持久化后 SHALL 同步新 Work 默认 runtime 字段并刷新 readiness；依赖或旧执行环境不兼容时仍返回 200、已保存 runtime 和真实非 ready 状态，不掩盖提交事实。未知持久化结果返回安全错误，可 GET runtime 核实，不假装回滚。GET 保留原字段与安全模型引用，如实返回已保存镜像，不公开 credential、credentialRef 或内部 revision；服务端升级或读取不自动改写 Runtime，显式保存才采用当前发行引用。

已有 Work 捕获模型、镜像及实例 SHALL 不因全局默认改变而更新。模型 Key/准入独立遵守 AIM-002/AIM-004，operator 凭证与公开结果含义保持；其镜像参数收紧遵守 SERVE-RUNTIME-RELEASE-001。新版兼容环境须能初始化自定义模型普通模式，不能因缺少模板拒绝。

#### Scenario: 保存成功但环境不可用
- **WHEN** 配置已持久化后检查 Docker、镜像或兼容性失败
- **THEN** 返回 200、已保存配置及真实非 ready 原因，GET 返回新值，已有 Work 不重启

#### Scenario: 无效配置原子拒绝
- **WHEN** 引用停用/无凭据/不存在，或旧完整输入的协议、地址、Key 等不满足结构规则
- **THEN** 返回 400 与公开 field，旧配置及默认不变；仅 SDK 未收录不能当作这种字段错误

#### Scenario: 引用自定义模型
- **WHEN** 管理员引用已启用、有凭据但 SDK 未收录的模型
- **THEN** Core 使用自身发行 Agent 引用保存/准备完整配置，无镜像填写、Key 重填或 Provider/模板步骤，普通消息初始化可完成

#### Scenario: 省略或携带旧同值字段
- **WHEN** 管理员以无镜像参数输入保存，或旧客户端携带与服务端内嵌引用相同的 agentImage
- **THEN** 两者均使用服务端固定引用，不以客户端提交字段作为镜像选择来源

#### Scenario: 自定义镜像或发行损坏
- **WHEN** 管理员携带不同 agentImage，或 Core 无法解析内嵌发行引用
- **THEN** 分别返回字段错误或发行错误，任何 Runtime/default/新模型写入均不发生，不能只在 Console 拒绝而让直接 API 绕过

#### Scenario: 升级后的读取与显式保存
- **WHEN** 已保存旧 Runtime 的安装换用新发行程序，先读取再显式保存相同模型
- **THEN** 读取保留旧镜像及现有 Work；显式保存才使用新发行引用，只影响后续新 Work
