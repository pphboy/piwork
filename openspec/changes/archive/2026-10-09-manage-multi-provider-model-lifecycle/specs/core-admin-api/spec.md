## ADDED Requirements

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

## MODIFIED Requirements

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
