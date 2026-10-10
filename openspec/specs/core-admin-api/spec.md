# Core Admin API Specification

## Purpose

向登录管理员提供独立于任何 UI 或 CLI 的稳定管理 API，覆盖用户、状态、运行时、默认配置、Skills 和 Core packages，同时保持 operator 凭证隔离、实际用户身份、有限上传与 Work 内容访问边界。

## Requirements

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

PUT runtime SHALL 接受两种互斥完整输入：引用式 `{agentImage,modelRef}`，或既有 `{agentImage,provider,model,baseUrl?,credential}`。引用式解析完整模型配置，不要求重填 Key或创建 Provider；自定义 Model ID/Thinking 未确认本身不构成无效引用。既有输入继续完整提供 credential，provider 仅保留协议逻辑语义，转为稳定模型配置；省略 baseUrl 不设自定义地址，空 credential 不表示保留。混合输入和真实不可用引用在持久化前拒绝。

有效配置持久化后 SHALL 同步新 Work 默认 runtime 字段并刷新 readiness；依赖或旧执行环境不兼容时仍返回 200、已保存 runtime 和真实非 ready 状态，不掩盖提交事实。未知持久化结果返回安全错误，可 GET runtime 核实，不假装回滚。GET 保留原字段与安全模型引用，不公开 credential、credentialRef 或内部 revision。

已有 Work 捕获模型、镜像及实例 SHALL 不因全局默认改变而更新。模型 Key/准入独立遵守 AIM-002/AIM-004；operator 既有调用形式和公开字段含义保持。新版兼容环境须能初始化自定义模型普通模式，不能因缺少模板拒绝。

#### Scenario: 保存成功但环境不可用
- **WHEN** 配置已持久化后检查 Docker、镜像或兼容性失败
- **THEN** 返回 200、已保存配置及真实非 ready 原因，GET 返回新值，已有 Work 不重启

#### Scenario: 无效配置原子拒绝
- **WHEN** 引用停用/无凭据/不存在，或旧完整输入的协议、地址、Key 等不满足结构规则
- **THEN** 返回 400 与公开 field，旧配置及默认不变；仅 SDK 未收录不能当作这种字段错误

#### Scenario: 引用自定义模型
- **WHEN** 管理员引用已启用、有凭据但 SDK 未收录的模型及兼容 Agent image
- **THEN** 保存/准备完整运行配置，无 Key 重填或 Provider/模板步骤，普通消息初始化可完成

### Requirement: 原子合并默认 Work 管理字段

**Identifier:** CADM-005

PATCH default-work SHALL 仅接受 baseImage、skills 名称数组、packages 名称数组、agentsMd 及 modelRef，至少一项。modelRef 是有效模型选择引用，不允许空值或借其读取 Key；自定义 ID/Thinking 未确认不作为拒绝原因。数组重复、真实不可用引用、无效镜像或超限文本整体拒绝。空数组/AGENTS 显式清空，省略保留最新值；baseImage 注册与完整合并/提交处于同一原子边界，失败无半成品引用。没有默认时返回 409 DEFAULT_WORK_NOT_CONFIGURED，首次完整配置通过 runtime 完成。

提交 SHALL 基于最新完整配置合并，保留未指定的 modelRef/MCP/tools/resources 等字段，并发不相交编辑同时保留，同字段按提交顺序取值，不暴露 revision。返回完整公开配置和 baseImage，所有默认变化仅影响后续 Work。

#### Scenario: 并发修改不相交字段
- **WHEN** 镜像、packages、runtime/modelRef 编辑交错
- **THEN** 以提交时最新配置合并，无关字段不丢失，同字段按后提交取值

#### Scenario: 整体拒绝无效默认
- **WHEN** 同一 patch 有有效 AGENTS 和真实不可用 Skill/模型引用
- **THEN** 所有字段不提交，已有 Work 不改变

#### Scenario: 上传文件不产生路径依赖
- **WHEN** agentsMd 由客户端文件内容产生
- **THEN** 只保存 256 KiB 内 UTF-8 文本，客户端路径不属于输入

#### Scenario: 只更换默认模型
- **WHEN** 仅提交启用且有凭据的自定义模型 modelRef
- **THEN** 原子更新默认模型，其他字段保留最新值，不要求 Provider、模板或 Test 成功

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

### Requirement: 直接管理模型配置与消息 Test

**Identifier:** CADM-MODEL-001

Core SHALL 以 CADM-001 的登录管理员身份提供模型直接管理与 Test API，保持既有 JSON、Content-Type、方法、大小和公开错误规则；新客户端 SHALL 不需要调用 Provider 管理接口。

| 方法与路径（均在 /api/v1/admin 下） | 行为 | 成功响应 |
| --- | --- | --- |
| GET /models | 列出完整模型安全配置 | 200 `{models:Model[]}` |
| POST /models | 一次创建连接与模型，credential 必需 | 201 `Model` |
| GET /models/:id | 查询模型 | 200 `Model` |
| PATCH /models/:id | 编辑名称、协议、地址、Model ID 或可选 Key | 200 `Model` |
| POST /models/:id/enable 或 disable | 独立修改模型状态 | 200 `Model` |
| DELETE /models/:id | 依赖检查后删除 | 204 |
| POST /model-tests | 检查完整模型草稿或保存项加编辑覆盖 | 200 安全 `ModelTestResult` |

创建输入 SHALL 为 `{model,api,baseUrl,credential,name?}`；name 省略/空值采用 Model ID。编辑至少一项，name 空字符串恢复默认名称，credential 省略保留、显式空值拒绝。Model ID/名称最多 256 字符、Base URL 最多 4096 字符、Key 最多 65536 字符；api 仅 Responses/Messages。公开 Model SHALL 包含 id/name/api/baseUrl/model/modelRef/enabled/credentialAvailable/createdAt/updatedAt，不含 Provider 管理身份、secret 引用、Key 或能力模板。独立模型条目最多 256，历史执行版本不占当前选项数量。

名称限制 SHALL 同时覆盖输入校验、默认名称生成和 Model/ModelConfigList 的输出。129/256 字符的合法名称或省略名称的长 Model ID 不得产生不符合读取契约的对象。旧 Provider/ManagedModel 兼容输入保留其既有 128 字符限制，兼容输出可使用有界且有效 UTF-8 的显示别名；不得因此缩短新模型原始名称、Model ID 或改写执行引用。

Test SHALL 接受完整草稿，或 `{modelId,api?,baseUrl?,model?,credential?}` 检查保存项与明确编辑覆盖，省略覆盖取当前保存值。名称不必填，无 providerId 或能力 JSON 前置条件。保存与 Test 使用同一协议 URL 规范化，Messages 根地址与 /v1 写法兼容；网络/远端错误不参与保存校验。

ModelTestResult SHALL 保留 success/category/httpStatus（可选）/durationMs/checkedAt/api/model/testMessage，成功含非空 replyText/replyTruncated，失败含固定安全 reason/message/recovery，不附带回复正文。固定短消息、20 秒/64 KiB/8 KiB UTF-8 上限、Key 屏蔽和安全错误分类保留；不能仅凭 2xx、空数组、推理/工具内容伪造成功。

本地校验/授权失败继续用正常 API 错误，保留可确认 field/code/correlationId，不猜测未知字段。写入提交前、Test 外发前及返回前 SHALL 重验管理员身份；目录与 Test 不要求 Docker、ready Work 或 SDK 收录。供应商认证失败只作为目标请求失败，不注销管理员。

旧 Provider 路由仅可用于既有客户端的受控兼容/迁移，不得作为新模型 API/UI 的创建、Key、启停或删除前置步骤。迁移不得使其他模型受某条模型编辑影响，不读取他人 Work 内容；删除冲突仅返回安全依赖类别或数量。

#### Scenario: 单请求创建可选模型
- **WHEN** 管理员 POST /models 提交完整自定义 ID 配置且未填写 name/模板/Provider
- **THEN** 原子返回完整模型，名称采用 Model ID，启用且有凭据的项可进入 Choose model，不依赖 Test 成功或 SDK 目录

#### Scenario: 新增与编辑草稿 Test
- **WHEN** 管理员提交完整模型草稿，或 modelId 加未保存的连接字段
- **THEN** 请求使用该目标及明确覆盖，省略 Key 可使用保存值，实际回复/失败安全返回，不发布草稿或更改默认

#### Scenario: 无效字段与权限
- **WHEN** 普通用户访问模型管理，或管理员提交混合旧 Provider 字段、非法协议、空 Key
- **THEN** 普通用户得到 403，结构错误原子拒绝并保留可确认字段；Key、内部路径和原始外部错误不进入公开响应

#### Scenario: Provider 兼容不阻碍直接模型管理
- **WHEN** 旧目录映射完成后新客户端编辑、轮换或删除一个模型
- **THEN** 只操作该模型及其依赖，不需要用户管理 Provider，不改变兄弟模型或丢失旧引用

#### Scenario: 新模型长度边界与兼容投影
- **WHEN** 新模型创建/编辑使用 129 或 256 字符名称，或使用同长度 Model ID 并省略/清空名称，再通过新旧管理读取接口查询
- **THEN** 新模型原始名称完整保留，新旧响应各自符合 DTO；超过 256 字符的新输入原子拒绝，兼容别名不改身份、引用、Key 或其他模型
