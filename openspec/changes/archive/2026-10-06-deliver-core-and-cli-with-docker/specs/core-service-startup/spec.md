# Spec Delta

## ADDED Requirements

### Requirement: 使用显式容器环境完成首次初始化

**Identifier:** CORE-DOCKER-INIT-001

Core SHALL 接受部署者显式提供的进程环境变量，复用既有 `PIWORK_ADMIN_ACCOUNT`/`PIWORK_ADMIN_PASSWORD`、`PIWORK_AGENT_IMAGE`、`PIWORK_MODEL_PROVIDER`、`PIWORK_MODEL`、`PIWORK_API_KEY` 和可选 `PIWORK_MODEL_BASE_URL` 初始化缺失的管理员/默认 runtime。示例不提供可用的默认账号、密码或 key。已存在的管理员、模型及默认配置 SHALL 不被重启时环境覆盖；首次初始化不得创建默认 Work。格式非法的已提供输入 SHALL 在使用之前安全拒绝，即使已有持久值也不隐式忽略非法输入。合法但缺失的初始化字段 SHALL 保持健康可访问、通过既有状态说明缺项。

Agent 与 package/file/snapshot helper 引用 SHALL 可由发行环境传入；默认上下文仅按既有一次性 seed 语义准备，已提交的管理员禁用/移除/默认选择不被每次启动重置。模型 Base URL 的既有限制 SHALL 保持：HTTPS 地址可用；HTTP 只允许 loopback，且 Agent 中 loopback 指向 Agent 自身。

#### Scenario: 空数据首次启动
- **WHEN** 空数据目录收到完整合法的管理员、运行配置及匹配镜像引用
- **THEN** Core 保存首管理员和默认运行配置，自动准备依赖，准备完成后可创建 Work；不输出秘密、不预建 Work

#### Scenario: 重建容器时 env 与持久值不同
- **WHEN** 已有安装的容器以不同的合法管理员密码/模型 env 重建
- **THEN** 已保存的身份与默认运行配置保持，查询反映持久值；修改使用既有管理入口

#### Scenario: 试图使用宿主 HTTP 模型地址
- **WHEN** 提供 `http://host.docker.internal:8000` 作为模型 Base URL
- **THEN** 按既有非法输入契约拒绝，不将 CLI 宿主别名或容器模式当成放开模型限制的依据

### Requirement: 自动准备运行依赖并允许失败后恢复

**Identifier:** CORE-DOCKER-PREP-001

Core SHALL 自行检查 Engine、拉取缺失的配置镜像、校验平台及各原生协议、准备 package helper/默认上下文并完成启动恢复。镜像拉取和依赖准备 SHALL 在后台执行，不占用健康/状态请求直至长时间拉取结束；`/healthz`、`/readyz`、`/control/status` 不因拉取锁排队，状态为当前快照。配置持久化后 SHALL 调度相应准备并使 readiness 反映实际状态；既有管理响应与状态 DTO 保持。

operator `config set` 在有效配置确认持久化后 SHALL 返回原 RuntimeView 并成功退出；尚待后台准备时不得把成功保存报告为保存失败，运行可用性由后续 status/readiness 核实。输入无效、secret 不可用或持久化未确认仍使用原安全错误契约；既有管理员 API 的已保存 runtime 加实际 readiness 返回体保持。

单次镜像/上下文准备 SHALL 有十分钟上限且可在关闭或配置换代时取消；可重试的 Engine/网络/拉取失败 SHALL 以 1、5、15、30、60 秒并以 60 秒封顶的退避再次准备，同一组件不得重复并发准备。非法引用/平台/协议错误 SHALL 标为失败，等待纠正配置后再准备。缺少 file/snapshot helper 配置 SHALL 报告 `unconfigured`，package helper 省略时沿用 Agent 镜像的既有回退；失败的首次 file/snapshot helper 拉取不能永久缓存为已经准备完成。成功后 SHALL 捕获不可变镜像身份，既有 Work 不因 tag 变化或新默认值自动替换运行身份。

Agent/默认上下文或启动恢复未完成时不得报告 Work 就绪；file/snapshot helper 不可用 SHALL 单独报告该功能不可用，不能阻断本来可用的 Work/Service。关闭 SHALL 停止新尝试并取消后台任务，遵守既有有界关闭规则，不删除 Work 数据。旧配置代次的完成结果 SHALL 不覆盖新配置状态。

#### Scenario: 首次慢速拉取
- **WHEN** 必需镜像未缓存，拉取持续超过现有一分钟刷新窗口
- **THEN** Core 继续后台准备，健康/状态仍可读取且不假报 ready，不要求用户手动 pull；十分钟单次期限后按失败规则处理

#### Scenario: helper 首次失败随后网络恢复
- **WHEN** file 或 snapshot helper 的首轮准备因可恢复网络故障失败，随后网络可达
- **THEN** 同一 Core 进程自动再次准备，成功后相应功能可用，期间其他已可用功能保持

#### Scenario: 镜像协议错误
- **WHEN** 下载的镜像与约定协议或平台不兼容
- **THEN** 对应组件为 failed，完整就绪失败，公开状态给出安全错误码，不启动不兼容运行容器

#### Scenario: 更新配置时旧准备还在执行
- **WHEN** 已持久化新 runtime 版本而旧版本的准备完成
- **THEN** 旧结果不能使新配置 ready；已有 Work 捕获身份与独立配置保持

#### Scenario: operator 保存后依赖尚未准备
- **WHEN** operator 提交有效配置，持久化成功但新镜像尚未取得
- **THEN** config set 成功返回保存的非敏感 runtime，status/profile 仍报告真实非 ready，后续准备失败不能伪装成未保存

### Requirement: 暴露安全的交付准备状态

**Identifier:** CORE-DOCKER-STATUS-001

`GET /control/status` SHALL 保留原 `state/ready/checks`，增加 `preparation={version:1,ready,components}`；components 固定为 `docker`、`agent`、`packageHelper`、`defaultContext`、`fileHelper`、`snapshotHelper`。每项 SHALL 包含 `state`、非负 `attempt`、`retryAfterSeconds` 与 `code`；state 为 `unconfigured|pending|preparing|ready|retrying|failed`，不适用的 delay/code 为 null，重试 delay 为非负秒数。此 `preparation.ready` 表示全部交付组件已准备，不等于基础 Work readiness；完整交付判定还要求基础 ready。Docker 持续不可用 SHALL 最多五秒使基础/交付就绪失效。

`piwork-serve status` SHALL 通过既有入口读取该快照，成功查询的退出语义保持；组件状态不得带镜像地址/ID、宿主路径、账号、key/token、operator credential、证书、registry 原始响应或堆栈。错误码限定为 `DOCKER_UNAVAILABLE`、`IMAGE_UNAVAILABLE`、`IMAGE_INCOMPATIBLE`、`CONTEXT_PREPARATION_FAILED`、`RUNTIME_UNCONFIGURED`、`SHUTTING_DOWN` 或 null。严格管理 API 的 `AdminStatus` 不增加字段，用户业务状态格式也不因 Docker 交付改变。

#### Scenario: 完整就绪与基础就绪不同
- **WHEN** Work 运行环境已 ready，但 file helper 尚在准备
- **THEN** 原 state/ready 可以反映基础可用，preparation.ready 为 false，fileHelper 为 preparing，状态不含拉取源或秘密

#### Scenario: 只查询状态而不修改系统
- **WHEN** 多个客户端在网络故障期间连续调用 status
- **THEN** 每次返回当前安全快照，不因读取发起重复拉取或把长期准备阻塞放到请求中

## MODIFIED Requirements

### Requirement: Recover Core and Work state across restart

Core 重启时 SHALL 恢复用户、会话、Work 和每个 Work 的 desired/active 配置版本。恢复 MUST 使用 Work 保存的配置，不得用新的全局默认配置替换已有 Work。正常关闭已经停止的 Work 运行容器 SHALL 按持久运行意图恢复；原本期望 stopped 的 Work SHALL 保持停止。用户、Work、Operation、Session、Run 标识和持久历史 SHALL 保留，恢复不得重新提交历史 Run 或创建重复 Work。

#### Scenario: Continue after restart with changed defaults
- **WHEN** Work A 使用 model-a，Core 正常关闭后全局默认改为 model-b，再次启动并恢复 Work A
- **THEN** Work A 使用原保存的 model-a，原 Session 和历史可继续查询，不创建重复 Work

#### Scenario: Continue after Core restart
- **WHEN** Core 正常退出前确认停止全部受管 Work，随后使用原数据目录和匹配 Work 卷重新启动
- **THEN** 原有效登录凭证和对象标识保持，期望 running 的 Work 及启用的 Service 恢复，期望 stopped 的 Work 不启动，不要求任何 Work 在 Core 退出期间持续运行

#### Scenario: Recover an incomplete create operation
- **WHEN** Core 在 Docker 已创建 Agent 容器、但 create Operation 尚未终结时异常退出，随后重启
- **THEN** 恢复核对并接管或安全收尾已创建资源，继续或明确失败原 Operation，不创建重复 Work 实例

### Requirement: Shut down Core without destroying running Works

Core 收到 SIGINT、SIGTERM，或因 Docker Compose stop/down/重建进入正常关闭时 SHALL 停止接受新任务、撤销 readiness、停止生命周期调度，并在既有有界关闭流程内排空执行、收尾文件/快照/package 任务及停止本安装全部受管 Work 的 Agent 和附属 Service。正常关闭成功前 MUST 确认所有受管 Work 运行容器已经停止；不得要求或承诺这些 Work 在 Core 退出后继续运行。某 Work 的 drain 或停止失败 SHALL 不阻止尝试关闭其他受管 Work。

关闭 SHALL 保留 Work 记录、desiredState、Service 启用意图、配置、历史及匹配数据卷，不把 Core 退出隐式转换为用户的 Work stop/delete。默认 drain 30 秒、终止确认 10 秒和 Core 进程总预算 45 秒保持，Docker Compose 提供 60 秒关闭窗口。未确认关闭或超出预算 SHALL 非零退出并提供安全的未完成诊断及恢复记录，不报告正常关闭成功；关闭 SHALL 释放 listener 和 store 锁。SIGKILL、进程崩溃或断电不执行完整正常关闭流程，不得据此记录所有 Work 已停，重启沿用持久意图和资源归属恢复；本变更不新增进程外监护机制。CLI 退出 SHALL 不停止 Work。

#### Scenario: Stop Core and reopen its store
- **WHEN** 具有运行中 Work 和附属 Service 的 Core 收到 SIGTERM 并正常关闭成功
- **THEN** 全部受管 Agent/Service 运行容器已确认停止，数据及运行意图保留，进程在预算内退出，新 Core 能打开同一 store 并按意图恢复

#### Scenario: Bound a stalled shutdown
- **WHEN** 接受中的请求、任务或受管容器无法在关闭期限内完成或确认停止
- **THEN** Core 仍尝试关闭其他 Work，并以非零退出和安全未完成诊断结束，不无限等待、不谎报所有 Work 已停

#### Scenario: Stop Core through Docker Compose
- **WHEN** 用户执行发行手册的 Core stop/down 或 force-recreate
- **THEN** Core 经正常关闭流程停止全部受管 Work，保留目录和卷；重建启动后仅恢复期望 running 的 Work 及启用的 Service

#### Scenario: Abrupt Core loss is not confirmed shutdown
- **WHEN** Core 被 SIGKILL、崩溃或失去电源
- **THEN** 不宣称已确认关闭全部 Work，后续 Core 核对原资源并恢复持久意图，不重提历史 Run 或操作未知归属资源

### Requirement: Expose distinct health and readiness probes

Core SHALL 在能够响应时提供无认证 `GET /healthz`，并在存储初始化及启动恢复完成后通过无认证 `GET /readyz` 报告基础 Work 就绪；关闭时 readiness MUST 失效，runtime/Docker 阻断 Work 操作时 MUST 给出安全原因。未提供 profile 时 SHALL 保持既有 JSON 和基础 readiness 语义，包括 file/snapshot helper 缺失的原有功能降级。

`GET /readyz?profile=docker-delivery` SHALL 复用此入口，仅在基础 ready 且 CORE-DOCKER-STATUS-001 的全部交付组件 ready 时返回 200；其他情况返回 503。此 profile SHALL 保留原 status/reason/state/ready/checks 字段，并附加 preparation；ready/status 是完整交付的布尔值/名称，state/checks 仍反映基础状态，基础 ready 但准备未完成时 reason 为 `DEPENDENCIES_PREPARING` 或 `DEPENDENCY_FAILED`。未知/重复 profile SHALL 返回 400 `INVALID_REQUEST` 和安全 field=`profile`，不原样回显输入。探针不执行模型真实调用，也不保证某用户网络、凭证或具体 Work 已 ready。

#### Scenario: Report a ready installation
- **WHEN** Core 已初始化，Docker 可达且启动恢复已完成
- **THEN** 默认 health/readiness 成功，默认 readiness 报告 Work runtime 可用

#### Scenario: Report a runtime dependency failure
- **WHEN** Core 存活但 Docker 不可达
- **THEN** health 成功，默认 readiness 失败并返回安全依赖状态，不返回内部堆栈或凭据

#### Scenario: Docker 交付全组件准备完成
- **WHEN** 基础 ready 且所有交付组件准备成功
- **THEN** docker-delivery profile 返回 200 和 ready=true，Compose 可以据此完成等待

#### Scenario: helper 降级保持旧探针兼容
- **WHEN** 基础 ready 而 snapshot helper 失败或未配置
- **THEN** 默认探针保持基础可用语义，交付 profile 返回 503 并指出安全组件状态

#### Scenario: 停机与非法 profile
- **WHEN** Core 正在关闭，或请求携带未知/重复 profile
- **THEN** 分别返回非 ready 的 503 或安全的 400，不暴露秘密、不等待镜像准备
