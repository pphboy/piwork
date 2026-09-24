# Design

## Context

动机与范围见 `proposal.md`。本次跨 CLI、客户端 SDK 和验证入口，因此需要设计文档。

已核实的实现基础：

- `apps/cli/src/main.ts` 使用手写参数解析、前置全局选项、`FileCredentialStore`、`PiworkClient`，已有 Work 变更的 acceptance/Operation 轮询模式。通用文本输出是缩进 JSON；`operation show` 查询成功即退出 0。
- `packages/client-sdk/src/index.ts` 已集中处理 bearer、URL 编码、JSON 大小限制、错误类型和安全错误输出，尚无服务方法。该包不依赖 Core 或 contracts，保持这种依赖边界。
- 正式入口是 `apps/core/src/application/core-application.ts` 的服务路由：读取、enable/disable/restart/retry/remove、logs 均已存在。`apps/core/src/work-management/http-api.ts` 是另一套较窄的路由实现，不能用它缺失的功能推断正式入口缺失。
- `WorkServiceManagementService` 已负责持久化、幂等、配额、恢复预算、Work fence 和删除。`start/stop` 必须映射 enable/disable；不另建进程管理器。
- 服务 show/list 响应带完整 `definition`，其中有环境值；CLI 只需要生命周期元数据，不能直接输出原对象。
- `publicOperation` 已能读取服务操作，但其顶层没有 serviceId。CLI 等待期间从 acceptance 补充 serviceId；独立 `operation show` 保持原投影，不修改公共 Operation schema。
- 正式日志接口使用 `tailLines` 查询参数，限制 1..200、默认 100；服务管理器限制 64 KiB 并做脱敏。非所有者管理员可以读元数据和控制，但不能读日志。

## Goals / Non-Goals

**Goals:**

- 通过现有 HTTP 面实现 CLI-SERVICE-001..006，明确解析、请求、输出和错误边界。
- 所有服务变更仍由 Core 决定是否接受；在观察超时后保留持久操作身份。
- 为 CLI 提供可模拟的服务命令执行入口，在不启动 Docker 或模型的情况下测试失败和等待边界。

**Non-Goals:**

- 不修改服务状态机、授权策略、数据库、HTTP/gRPC schema 或 operator 命令。
- 不把 pi-agentd 的定义管理迁入 SDK 的本次新增命令面，不修复其他 CLI 的历史解析或退出码行为。
- 不将名称解析作为本次隐含功能；沿用现有 `<workId> <serviceId>` 位置参数。此项是范围收敛选择，后续可独立提案。

## Decisions

### 1. 独立服务命令模块，保留现有命令行为

在 `apps/cli/src/work-service.ts` 实现服务命令解析、执行和输出；`main.ts` 只添加帮助和分发入口。这样比继续把全部分支写入 `workCommand` 更容易验证局部语法，也无需重写通用解析器。

- `parseWorkServiceCommand(args)` 返回 discriminated union：list、show、logs、以及 action 为 start/stop/restart/retry/remove 的 mutation；携带 workId、适用的 serviceId、tail、wait、idempotencyKey。
- `executeWorkServiceCommand(context, parsed)` 使用结构化 context：`client`、`json` 和 stdout/stderr 写入函数；测试传入缓冲写入函数和 SDK fake，生产传入现有进程流。
- `runCli` 完成全局选项解析后，先识别 `work service` 的帮助和语法，再加载凭证。合法命令在凭证加载后执行原有 `requireCredential`，之后分发；其他 Work 分支不改变校验顺序。
- `work service --help/-h` 和已支持 action 的帮助在通用 `COMMAND_HELP.work` 处理前返回专门的服务帮助。未知 action 即使附带 help 也按 usage 错误处理。顶层/Work 帮助加入 service；帮助明确持久 stop、停止 Work 上 start 的语义、remove 保留数据、创建更新交给 agent。
- 校验完整位置参数后再处理尾部选项；ID 为非空且非全空白字符串，不以 `-` 开头、不含 NUL，不猜测 ID 前缀或正则。已给出的 ID 不 trim、不按名称查找。
- 用集合拒绝重复选项，包含重复 boolean `--wait`。key 必须非空且非全空白，按原字节发送。tail 使用 `/^[0-9]+$/` 加 safe-integer 和 1..200 检查。`--flag=value`、`--` 分隔符不新增支持。
- 语法错误抛出 `{exitCode: 2}`，沿用主入口 safeErrorMessage；错误文本包含相应服务 usage。help 和语法错误不读取凭证、不发网络请求。

对应 CLI-SERVICE-001、006。未引入 commander 等依赖，避免改变现有命令的解析兼容性。

### 2. SDK 封装现有接口并提供白名单元数据

在 `packages/client-sdk/src/index.ts` 增加以下导出类型与方法。使用包内 TypeScript 类型，不引用 Core 的运行时代码。

| SDK 方法 | HTTP 请求 | 返回 |
| --- | --- | --- |
| `workServices(workId)` | GET `/api/v1/works/{workId}/services` | `{services: WorkServiceSummary[]}` |
| `workService(workId, serviceId)` | GET `/api/v1/works/{workId}/services/{serviceId}` | `WorkServiceSummary` |
| `workServiceAction(workId, serviceId, action, idempotencyKey)` | POST 服务路径下的 action | `AcceptedServiceOperation` |
| `workServiceLogs(workId, serviceId, tailLines = 100)` | GET 服务路径下 `/logs?tailLines=N` | `WorkServiceLogs` |

`action` 类型严格为 `enable | disable | restart | retry | remove`。CLI 映射 start->enable、stop->disable，其余同名；请求 body 严格为 `{idempotencyKey}`。SDK 不新增 service create/update/revisions 方法。每个 URL 路径段独立 `encodeURIComponent`，不得拼接未经编码的 ID。使用 `request` 的现有 bearer、错误和响应大小约束。

类型定义：

- `AcceptedServiceOperation`：workId/serviceId/operationId/correlationId 均为 string，reused 为 boolean。
- `WorkServiceSummary`：规范中十个固定字段；desiredRevision 为 number，appliedRevision 为 number|null，enabled 为 boolean，observedState 为 string，createdAt 为 string。
- `lastError` 为 null 或只含可用且类型正确的 code:string、message:string、retryable:boolean 的对象；code/message 使用 `safeErrorMessage(new Error(value))`。不转发任意错误对象字段。
- endpoint 只投影 name/protocol/host/port 和可用的 url，遵循既有 Core 字段类型。
- `WorkServiceLogs` 为 Core 的 `{serviceId, status, text, truncated, collectedAt, reason?}`；CLI 添加请求的 workId。不对日志做第二次与错误文本相同的 redaction，以免破坏 Core 已限定的日志内容。

`workServices` 和 `workService` 在返回前构造白名单对象，绝不返回原始响应对象或 `definition`。list 使用 name 再 serviceId 的逐字符串比较排序，保证稳定、不依赖本地语言排序。其他 SDK 方法的返回行为不改变。

选择在 SDK 投影而非通用 output 中递归黑名单过滤，能防止服务定义的任意环境变量成为新 CLI 的输出，同时不改变现有 Core HTTP 客户端看到的协议。不是服务端权限调整，也不声称修复既有 API 的全部内容暴露风险。

对应 CLI-SERVICE-002、003、005、006。

### 3. 复用 Operation API，服务观察器保留 acceptance 身份

`work-service.ts` 中实现 `observeServiceOperation`，沿用 Work 的观察语义，但服务等待使用独立函数；不重写已有 `waitOperation`，避免非本次 Work 命令输出变化。

数据流：

```text
parse --> credential --> one POST --> acceptance
                                      |
                       +--------------+--------------+
                       |                             |
                   no --wait                      --wait
                       |                             |
                print acceptance             GET operation by ID
                                                     |
                                        terminal / unavailable / deadline
                                                     |
                                      print one result with serviceId
```

- 提交前生成一个 UUID 或使用原样 key，不 preflight show/list；仅调用一次 mutation。POST 响应丢失则走现有错误路径，不重试、不编造 acceptance。
- acceptance 收到后启动 120000 ms 观察 deadline。文本先输出五字段 acceptance；JSON 不提前输出。
- `PiworkClient.request` 添加可选第四参数 `{signal?: AbortSignal}`，传给 fetch；`operation(operationId, options?)` 可选转发这个参数。所有原调用保持不变。signal 要覆盖响应 body 读取，确保 headers 已到但 body 卡住时仍可终止。
- 观察器用 deadline 的 AbortController 和 timer 限制整个观察周期；将其 signal 传入每次 operation 查询。finally 清理 timer。超时引起的 SDK 错误可能包装成 NETWORK_ERROR，因此依据本地 deadline/signal 判定 timeout，不能只检查异常名称。
- 第一轮立即查询；pending/running 后等待 `min(250, remainingMs)` 再查询，不并发 poll。未知 state 或缺失/错误类型的必需 Operation 字段视为观察失败，不无限轮询。校验 operationId/workId 与 acceptance 相符。
- 有效 terminal 到达且 deadline 未过：输出 `{...operation, serviceId: accepted.serviceId}`；保留现有公开 terminal 字段，严格输出一次。succeeded 返回 0，failed/superseded 返回 6。
- 任何非 deadline 的观察异常（包括 401/403）输出 waiting envelope：五字段 acceptance（可保留 reused）、state waiting、result null、diagnostics null、error `{code,message}`。error code 为 OPERATION_OBSERVATION_UNAVAILABLE；deadline 用 OPERATION_WAIT_TIMEOUT。固定安全 message 指向 `operation show`，返回 5。
- 文本终端结果含 Work/Service/Operation/State；失败包含现有诊断可用字段及安全 remediation。若字段缺失，显示 unknown 和 Inspect the Operation，不能生成新的故障原因。失败与等待中断都打印恢复命令。
- 独立 `operation show` 原样复用，查询不用 show service，删除服务后仍能查 Operation；本次不修改 `PublicOperationSchema` 或添加服务字段到服务端响应。

观察器接收内部 timing 依赖（now、sleep、deadline timer factory），默认使用 Date.now/setTimeout；单元测试提供受控时钟，模拟 120 秒、挂起 fetch、清理 timer，无需真实等待。不是新增用户配置。

另一方案是扩展共享 Work waiter，但这会让兼容性验证覆盖全部 Work 启停/配置命令；本次采用独立服务观察函数，复用同一 SDK Operation endpoint 与错误规范。

对应 CLI-SERVICE-004。120 秒限制是客户端观察时限，服务 readiness 最长可达 300 秒，所以等待超时只报告 waiting、不取消服务。

### 4. 输出和退出码遵循现有约定

- list/show 与 non-wait acceptance 使用现有紧凑 JSON/缩进 JSON 约定，追加一个换行；不额外访问 Work 或补查服务状态。
- waited JSON 在终态和观察失败时始终一个对象，stdout 不出现 progress；text 显示身份与诊断。已打印 waiting/terminal 后返回指定 code，避免主入口 catch 再输出重复对象。
- logs JSON 保留结构和状态；text 输出日志正文，只有非空且无末尾换行时才补换行。truncated/unavailable 用 stderr 显示安全提示。available/truncated 返回 0，unavailable 返回 5。
- HTTP/网络错误在 acceptance 前沿用 `exitCodeFor` 和主入口错误渲染；包括 quota HTTP 429 仍为现有 fallback 1，本次不统一重映射 SDK 错误。JSON 模式的这些请求错误保持 stdout 空、stderr 安全文本。
- 不新增交互确认：remove 明确指定 Work/service ID，沿用现有 Work delete 风格，而且不带 purge 请求。文档说明删除后不能用 start 恢复定义。

对应 CLI-SERVICE-002、004、005、006。

### 5. 保持 Core 对并发、重试和访问的裁决

CLI 不缓存服务、修改定义或检查本地 observedState 来阻止 action。所有者/admin 权限、Work fence、enabled 前置条件、配额和幂等由现有 Core manager 处理。HTTP POST action 只传 key，没有 revision、purgeData、definition。先接受的请求可能被并发 Work stop supersede；观察结果按原状态输出。

同键重放的实际接受仍受 Core 当前前置条件影响；不承诺 CLI 能绕过已删除或新 disabled 状态。remove manager 接受已 tombstone 资源以重放原操作；CLI 不增加会阻断这个路径的 pre-read。

### 6. 自动化验证以真实 CLI 协议和正式 HTTP 入口为边界

- SDK 测试扩展 `packages/client-sdk/src/index.test.ts`：mock fetch 验证 4 类方法、5 个 action、逐段编码、bearer、body 无附加字段、tail、错误传播、元数据白名单及排序；验证 operation 的可选 signal 被转发，原调用形态保持兼容。
- CLI 新增 `apps/cli/src/work-service.test.ts`：纯解析测试覆盖命令矩阵和非法输入；执行测试使用 PiworkClient 的 fake fetch 与注入输出，验证真实请求数和观察流程，而不是只检查函数映射表。使用受控时钟和可中断 fake fetch 测试慢 body、挂起请求及终态、断线、无额外 mutation。
- 扩展 `apps/cli/src/main.test.ts`：启动编译后的 CLI，验证帮助、没有凭证时 usage 优先、禁止 create/update、JSON 一条记录以及主入口退出码。需要同进程 fake HTTP server 的子进程测试使用异步 spawn，避免 spawnSync 阻塞服务端事件循环。为 fixture 使用独立私有临时凭证目录。
- 扩展 `apps/core/src/application/control-plane.test.ts` 的正式路由覆盖：沿用现有 CoreApplication fixture，创建服务只用于测试准备；验证客户端使用的 GET/action/operation 路径、start->enable/stop->disable、重放 acceptance、跨 Work ID、非所有者 404、admin 日志 403、tail 边界，以及 tombstone 后 Operation 可读。不增加生产服务端路由。
- 状态机、Work stop/start 持久性、workspace 保留、重试预算与竞态由已有 `apps/core/src/work-services/service-management.test.ts` 覆盖，复跑并针对缺失断言扩展现有 fixture。运行真实 manager + fake runtime，无需新建 Docker 管理逻辑。
- 文档在 `docs/operations.md` 增加命令示例、--wait/--json、ID 获取、日志权限/限制、恢复命令、持久 stop、stopped Work start 和 remove 数据语义；README 简要链接。

验证顺序：`npm run build`、`npm run typecheck`、`npm run test:unit --workspace @piwork/client-sdk`、`npm run test:unit --workspace @piwork/cli`，再在 `apps/core` 工作目录运行 `node --test dist/application/control-plane.test.js dist/work-services/service-management.test.js`。修改相关测试文件时按实际文件列表补入。此 change 不改 Docker runtime、镜像或模型路径，因此不强制运行昂贵的模型/Docker acceptance。

## Risks / Trade-offs

- [stop 被理解为临时停进程] -> 命令帮助与运维示例明确这是持久 disabled，并验证 Work 重启不会恢复该服务。
- [停止 Work 上 start 成功被误读为 ready] -> 只打印 Operation 状态；不添加 ready 声明，不自动启动 Work。
- [服务元数据含完整定义] -> SDK 白名单投影与 credential sentinel 测试；日志继续由 Core 授权和脱敏。
- [wait 超时与服务 readiness 时限不同] -> 保留 waiting/Operation ID 和查询指引，严格不取消或重新提交。
- [两套 HTTP 实现容易选错] -> 测试依赖正式 CoreApplication 路由；较窄的旧 HTTP helper 不在本次扩展范围。
- [ID 比名称难手输] -> list 输出 ID 和 name，按现有 CLI 风格复制 ID；名称解析延后，不增加查找竞态。

## Migration Plan

无需数据迁移、服务端部署顺序或凭证转换。构建并发布配套的 client-sdk 和 CLI 即可连接当前 Core；既有服务立即可管理。回滚 CLI/SDK 到旧版本仅移除新命令，不改变 Core、服务定义或已接受 Operation。控制命令已经产生的 enabled/tombstone 状态属于用户操作，不随程序回滚撤销。
