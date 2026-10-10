# Spec Delta

## MODIFIED Requirements

### Requirement: Persist a complete reproducible service definition

**Identifier:** WSRV-002

接受的服务定义 SHALL 持久保存 Work 内唯一身份/名称、版本、镜像引用、启动参数、配置引用、挂载、内部端口、CPU 限制、enabled 和恢复/readiness 策略。定义及 Operation SHALL 在对外承诺接受和创建运行实例前持久化；镜像首次解析成功后 SHALL 在创建实例前持久绑定固定制品身份，同 revision 后续使用该身份。停止后定义 SHALL 仍能查询。

部署 SHALL 接受已有本地/registry 镜像、显式 executable/args、environment、workspace 内工作目录、显式只读/可写 workspace grant、内部端口、CPU、enabled/required、restart 和可选 readiness。应用 Service SHALL 不设置平台内存上限，实际创建的 Docker 容器 SHALL 无 Service memory limit；不能由其他默认值、Work 内存预算或镜像名条件重新施加。旧 `memoryBytes` 数值字段仅为兼容和历史数据保留，不再授权或要求内存限制；当前 Service 投影 SHALL 明确说明内存无限制，不能将历史数值展示为有效上限。Agent/helper 的资源策略保持各自契约。

本版部署 SHALL 在接受前拒绝 build context、Dockerfile、image commit/build、特权、host port/network、任意宿主挂载及非空不支持 secret 引用。新解析的不可变镜像身份 SHALL 在创建容器前持久化；同 revision 重试不得追随变更的 tag。定义不可变性覆盖镜像和启动配置，不覆盖可写 workspace 文件及业务数据。

#### Scenario: Definition survives agent loss

- **WHEN** Core 接受定义后 agent 崩溃
- **THEN** 定义和 Operation 仍存在，Core 可以完成或报告失败，无需 agent 重复声明

#### Scenario: Image resolution fails

- **WHEN** 定义已接受但镜像无法拉取或解析
- **THEN** 服务保留 failed 状态及原因，不能报告 ready，修复后可显式 retry

#### Scenario: Deploy existing Python image
- **WHEN** Agent 选择可用 Python 镜像与 workspace 内的 server.py
- **THEN** Core 按声明命令和 workspace 启动镜像，不执行 build 或 commit

#### Scenario: Retag after deployment
- **WHEN** Service revision 捕获镜像身份后原 tag 改变
- **THEN** 重启使用原固定身份或报告 IMAGE_UNAVAILABLE，不替换成 tag 的新内容

#### Scenario: Reject a build request
- **WHEN** 请求包含 Dockerfile 或 build context 字段
- **THEN** Core 在写入状态、预留配额和创建资源前拒绝请求

#### Scenario: 默认应用没有内存上限
- **WHEN** Service 没有提交 memoryBytes 并开始运行
- **THEN** 容器 inspect 显示 Memory=0，当前投影明确无限制，CPU/网络/身份及挂载仍按有效定义

#### Scenario: 旧定义的内存值不能恢复限制
- **WHEN** 含正数 memoryBytes 的已保留 Service 经过受管恢复或重建
- **THEN** 旧数值作为历史保留，新容器仍为 Memory=0，不要求用户逐个重写定义


### Requirement: Idempotent mutations and crash adoption

**Identifier:** WSRV-003

服务 mutation SHALL 使用幂等键，更新 SHALL 检查预期定义版本。相同键相同内容返回原结果，异内容或过期版本返回冲突；Core 恢复后 SHALL 识别已创建的匹配实例，不能因结果未保存而重复创建。

Agent 幂等 scope SHALL 在 daemon 替换后保持稳定并与用户 mutation scope 分离。每个 Operation SHALL 保留受理时定义 revision 与 Work 生命周期 fence；worker MUST NOT 静默替换为后续 desired revision，过期完成 MUST NOT 覆盖较新的 Service 结果。同 key 不同内容 SHALL 返回 IDEMPOTENCY_CONFLICT。失败后的显式 retry 使用新 key；tombstone 服务不得 retry。

内存政策升级 SHALL 保留已接受请求的原幂等 scope、指纹和结果。升级前省略内存而捕获旧默认值的相同原请求 SHALL 仍返回原 Operation，不因默认值改为零而重新创建或冲突。新请求省略内存与显式零 SHALL 使用同一默认语义；历史显式数值的不同请求不能借政策升级伪装成相同原请求。兼容读取不得放宽其他字段或跨 principal/Work 命中。

#### Scenario: Repeat a create request

- **WHEN** agent 未收到响应而用相同键重试创建
- **THEN** 系统返回同一服务和 Operation，仅存在一个对应实例和一份配额预留

#### Scenario: Crash between instance creation and result recording

- **WHEN** Core 在容器已创建但未记录完成时崩溃并重启
- **THEN** 系统接管该容器并恢复操作状态，不创建第二个服务实例

#### Scenario: Concurrent definition updates

- **WHEN** 两个更新使用相同旧 revision，而其中一个已成功
- **THEN** 后一个更新返回冲突，不能覆盖已接受的新定义

#### Scenario: A new daemon repeats a lost request
- **WHEN** 替换后的合法 daemon 以原 key 和 payload 重试
- **THEN** Core 返回原 Service/Operation，不重复预留配额

#### Scenario: Update overtakes an old worker
- **WHEN** worker B 等待 Docker 时 revision C 已被接受
- **THEN** B 不能记录 C 已应用或覆盖其失败/状态，仅匹配当前目标才能就绪

#### Scenario: 升级后重试原请求
- **WHEN** 创建请求在旧默认内存政策下已接受但响应丢失，升级后调用者以同 scope/key 和原内容重试
- **THEN** 返回原 Service/Operation 且不新增预留；其他业务字段不同仍返回幂等冲突


### Requirement: Enforce quotas atomically

**Identifier:** WSRV-007

系统 SHALL 在接受服务定义或 CPU 增长前原子核对最大服务数、Work 及宿主 CPU 预算，并拒绝超额请求且不创建资源。CPU 预算 SHALL 包括 Agent 和启用 Service；stopped Work 的启用定义仍保留 CPU 预算。禁用、缩容或删除 SHALL 在实际占用已释放后才能释放对应 CPU/数量预算。

应用 Service SHALL 不申请或占用 Work/宿主内存预留，也不因这些内存预算不足而被拒绝。历史 Service 内存预留及尚未清理的数值 SHALL 不进入有效内存配额计算；它们不得阻断其他 Service、Agent 配置或导入。Agent 及其他仍受内存政策管理的对象 SHALL 保持原预算检查。

CPU 核算 SHALL 对每个 Service 取 desired 预留和未释放实际占用的较大值；宿主核算 SHALL 汇总全部 Work。共享 workspace 卷每 Work 只计一次；未删除定义均计入 maxServices，确认 runtime 移除后才能释放删除对象的 slot。Work CPU 缩减低于保留预留/占用 SHALL 在配置修改前被拒绝。取消内存预算不能被解释为已停止容器或已释放 CPU。

#### Scenario: Concurrent requests exceed remaining budget

- **WHEN** 两个合法创建分别能装入剩余 CPU/数量配额但合计超额
- **THEN** 最多接受可容纳的请求，另一请求返回配额错误，不留下重复或负配额

#### Scenario: Disable has not yet stopped the container

- **WHEN** 禁用服务已接受但其容器仍运行，新请求试图使用其 CPU/数量预算
- **THEN** 系统仍计算未释放占用，直到确认停止后才允许重用预算

#### Scenario: Use default deployment headroom
- **WHEN** 全新默认 Work 创建一个请求 250 CPU milliseconds 且无内存上限的 Service
- **THEN** CPU 和数量满足配额时接受创建，不预留或检查该 Service 的内存额度

#### Scenario: Share an existing workspace
- **WHEN** 两个 Service 挂载已有 Work workspace
- **THEN** 同一个 workspace 只计一个卷 slot，不按 Service 挂载次数重复计数

#### Scenario: Host budget exhausted elsewhere
- **WHEN** 其他 Work 已占用剩余宿主 CPU 预算
- **THEN** 即使 Work 本地额度满足也原子拒绝 Service 请求，返回 QUOTA_EXCEEDED

#### Scenario: 历史 Service 内存预算不阻断部署
- **WHEN** Work 或宿主的旧 Service 内存预留看似耗尽，而 CPU、服务数和卷数仍满足准入
- **THEN** 新 Service 被接受，现有 Agent 内存政策仍有效，历史 Service 记录不被当作当前内存占用


### Requirement: Validate a bounded deployment request

**Identifier:** WSRV-011

部署输入 SHALL 遵守精确 schema 且编码后不超过 1 MiB。缺必填字段、未知字段、重复端口/挂载、路径穿越、NUL、非法资源数值和不支持选项 SHALL 在受理前拒绝。默认值 SHALL 在幂等比较前规范化。不得隐含 shell；脚本需要显式 shell executable 和 args。无 workspace 挂载的 Service SHALL 显式选择 workingDirectory `/`；有 grant 时默认 `/var/data/workspace` 且必须留在获准 workspace 内。本版唯一挂载 SHALL 为 `{source: "workspace", target: "/var/data/workspace", readOnly: boolean}` 且至多一次，拒绝直接 volume ID 和任意挂载别名。

| 输入 | 必需行为 |
| --- | --- |
| name | 必填，遵守 WSRV-010；tombstone 名称保留 |
| image.reference | 必填非空，至多 2048 UTF-8 bytes；无内嵌凭据或 URL scheme |
| command | 必填非空 executable，至多 4096 bytes |
| args | 默认 []，至多 128 项，每项至多 4096 bytes |
| environment | 默认 {}，至多 128 个匹配 `[A-Za-z_][A-Za-z0-9_]*` 的名称，每值至多 16384 bytes |
| secretRefs | 默认 []；非空返回 UNSUPPORTED_SERVICE_OPTION |
| workingDirectory | grant 内规范绝对路径；无 grant 时显式 `/` |
| mounts | 默认 []；零或一个支持的 workspace 挂载 |
| ports | 默认 []；至多 64 项，名称及 protocol/port 对唯一，TCP/UDP，端口 1..65535 |
| cpuMillis | 默认 250，整数 10..128000，须满足配额 |
| memoryBytes | 兼容字段；省略默认 0，非负安全整数；正数仅保留原请求/历史语义，不设置内存上限或参与配额 |
| enabled, required | 分别默认 true、false |
| readiness | 可选 HTTP/TCP/exec；deadlineMs 默认 120000、范围 1000..300000；timeoutMs 默认 2000、范围 1..2000 |
| restartPolicy | 默认 bounded；允许 bounded/never |

HTTP/TCP readiness SHALL 引用已声明的 TCP 端口；HTTP SHALL 提供规范路径并要求 2xx，exec SHALL 提供有界非空 argv 并要求退出码零。探测字段缺失或不兼容 SHALL 拒绝。更新保留原镜像引用时 SHALL 保留固定镜像身份，引用/digest 改变时 SHALL 重新解析。公开选择字段不得授权宿主挂载、特权、控制凭据或 Docker socket。

HTTP/DTO、MCP、gRPC 和快照校验 SHALL 对上述内存兼容语义保持一致。`deployment_context` SHALL 明确返回 Service 内存政策为 unlimited；旧 defaultServiceMemoryBytes 使用 0 并声明无限制含义，旧 total/availableMemoryBytes 若保留仅表示非 Service 预算，不得伪装成 Service 可用内存或实时宿主内存。

#### Scenario: Reject incomplete deployment input
- **WHEN** 请求缺镜像/executable、资源值为负数或未显式 grant 却使用 workspace 工作目录
- **THEN** Core 返回带安全字段标识的 INVALID_SERVICE_DEFINITION，不写定义、Operation 或预留

#### Scenario: Normalize defaults for retry
- **WHEN** 同 key 重试对原请求省略字段填写显式默认值
- **THEN** 与原请求规范化语义一致并返回原受理结果

#### Scenario: Validate readiness reference
- **WHEN** HTTP 探测引用不存在或仅 UDP 的端口
- **THEN** 在创建任何容器前拒绝请求

#### Scenario: Deploy an image-native service
- **WHEN** 合法 Service 无 workspace 挂载且显式使用 `/` 工作目录
- **THEN** 按声明 executable 运行，不获得持久 workspace 或 Agent 私有挂载

#### Scenario: 各入口一致理解无限制
- **WHEN** 调用者从 HTTP 或真实 MCP/gRPC 提交省略或零 memoryBytes 的合法定义
- **THEN** 请求可接受且规范默认一致，部署上下文明确 unlimited，不触发最小 16 MiB 或 64/128 MiB 补值

#### Scenario: 内存兼容字段仍需合法
- **WHEN** 请求提交负数、非整数或超过安全整数范围的 memoryBytes
- **THEN** 接受前安全拒绝，不创建 Service 或资源


### Requirement: Restore service definitions independently from source runtime state

**Identifier:** WSRV-SNAPSHOT-001

完整包 SHALL 保留 service 名称、全部 retained revision/定义、desired/applied revision、enabled/required、tombstone、已绑定镜像、持久恢复预算、每个 service 的持久 CPU/slots 预留、兼容历史内存字段及当前 workspace 卷引用；导入为每个 service 分配新 ID，映射受管依赖、预留与 workspace grant。定义中的命令、args、environment、端口和固定容器路径保持原样。workspace 当前引用即使因失败的 remove 而仍属于 tombstone service，也 SHALL 映射而不隐式解除；但引用不授权 tombstone service 启动。源 observedState/error 和旧 Operation 可保留为 provenance，但不能作为新容器 ready 的证明。未 tombstone 服务在导入 stopped Work 中 SHALL 报告 stopped 或 disabled；tombstone 仍不可列为可恢复服务且名称保留，budget exhaustion 仍阻止自动恢复，显式 retry 沿用既有语义。

Service 的持久 desired CPU 与 slots SHALL 使用包内预留值，不从 enabled、最新 definition 或源 observedState 重算；disabled 或 tombstone 不意味着其持久 CPU/slots 必为零。历史内存字段 SHALL 校验并保留为来源事实，但 SHALL 不进入导入准入、宿主汇总或后续 Service 内存限制。新 Service 的内存预留为零。导入后的实际运行占用 SHALL 从零开始，保留的字段本身 SHALL NOT 触发服务启动。

后续显式 Work start SHALL 按 enabled、required、固定镜像与恢复策略重建，不需要 agent 重新 create。历史 appliedRevision 不变，实际就绪重新检查；不发布 host port、不添加新挂载形式、不允许镜像 build/commit、不重放历史服务 mutation。服务历史控制幂等记录仅作 provenance，不能使新 owner 请求命中源 principal 的幂等 scope。

包内 active context 选择内置 `work-services` 时，导入并显式启动后 pi-agentd SHALL 经真实 MCP adapter 和目标 Core 的认证 gRPC 列出、检查、启用、禁用、重启及按现有权限创建/更新本 Work 的 service；操作对象 SHALL 是目标新 service ID，不依赖源 Core、源证书或重新部署历史服务。源 active context 未选择该 MCP 或工具策略禁止某工具时，导入 SHALL 保持该限制，不用目标默认配置补授权。

#### Scenario: Enabled and disabled services
- **WHEN** 包有 enabled web 和 disabled worker，导入后显式 start
- **THEN** 只启动 web，使用原镜像/文件/端口，worker 保持 disabled

#### Scenario: Shared storage survives import
- **WHEN** 两个服务共享 workspace，且一个曾被删除
- **THEN** 新服务引用新 Work 的同一个 workspace，已删除服务不复活，数据不被重新初始化

#### Scenario: Preserve failed retry budget
- **WHEN** 一个服务自动恢复预算已耗尽后导出导入
- **THEN** 不因导入而清零预算或自动重试，用户仍可显式 retry

#### Scenario: Disabled service retains its reservation
- **WHEN** 一个已停止 Work 中，disabled worker 的持久 desired CPU/内存预留因失败的 disable 操作仍非零
- **THEN** 导入后的 worker 仍为 disabled 且不启动；目标 Work 保留相同持久 CPU/slots 及兼容历史内存值，后者不参与有效内存配额，实际运行占用为零，再次导出仍能读到来源值

#### Scenario: Manage restored services through target Core MCP
- **WHEN** 含内置 `work-services` 的 Work 从安装 A 导出、只凭包导入安装 B 并显式启动，安装 A 不再可达
- **THEN** 安装 B 的 pi-agentd 通过真实 MCP 及目标 Core gRPC 列出恢复后的 service，并以目标 service ID 完成 stop/start 与 Operation 查询；服务定义和 workspace 数据保持原样

#### Scenario: Preserve imported tool policy
- **WHEN** 源 active context 禁止 `work-services.service_stop` 或已移除内置 MCP
- **THEN** 导入后的 pi-agentd 不得到该工具，目标默认配置不能替它重新授权

#### Scenario: 导入旧正数内存定义
- **WHEN** 含历史正数 Service 内存定义和预留的完整包导入新 Core
- **THEN** 不因这些 Service 内存值触发 QUOTA_EXCEEDED，仍按原 CPU/slots 和 Agent 内存检查；显式 Start 后 Service Memory=0，镜像、代码、数据与历史字段保留
