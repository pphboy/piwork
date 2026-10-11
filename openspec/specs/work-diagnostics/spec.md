# Work Diagnostics Specification

## Purpose

Make Work Skill setup, runtime initialization, activation, and restoration observable through correlated safe logs and durable diagnostics, so users can identify and revisit failure causes without direct access to Docker or protected host files.

## Requirements

### Requirement: Log context and runtime stage outcomes

**Identifier:** WDIAG-001

Core SHALL emit structured JSON-line diagnostics to its process stderr for context copy/validation, runtime prepare/start, Skill validation/load, readiness verification, activation, and rollback. Each attempted stage SHALL emit a start and terminal success/failure event, except process termination which SHALL be recovered as an interrupted stage. Events SHALL contain UTC timestamp, level, component, stage, outcome, correlationId, safe code, and safe message; workId and operationId SHALL be present once assigned, and skillName SHALL be present for a Skill-specific event. Agentd SHALL emit safe structured initialization events to container stderr before exiting on initialization failure; Core SHALL relay their validated outcomes into its correlated diagnostics. A successful path SHALL include explicit selected-directory validation, SDK load success, and readiness verification; config persistence alone MUST NOT generate load success. Failures before Work/Operation acceptance SHALL return the same correlationId in the HTTP error and CLI error display and MUST NOT invent a durable Work or Operation.

#### Scenario: Observe successful creation
- **WHEN** a Work with s-a completes initialization
- **THEN** Core stderr contains correlated successful copy, Skill-load, readiness, and activation events with its Work/Operation IDs, and Skill-load identifies s-a without revealing file contents

#### Scenario: Observe failed copy before acceptance
- **WHEN** a create or set request fails while copying a selected Skill before an Operation is accepted
- **THEN** the request fails atomically with a safe copy diagnostic and correlationId, and Core emits the corresponding failure using that correlationId

#### Scenario: Observe a missing required manifest
- **WHEN** agentd detects a missing required manifest during initialization
- **THEN** it emits a structured failure before exit and Core records that Skill/context error instead of reporting only a later network timeout

### Requirement: Preserve actionable Operation diagnostics

**Identifier:** WDIAG-002

Accepted Work initialization/apply Operations SHALL durably retain ordered stage outcomes and terminal root-cause diagnostics. Each failure SHALL contain `code`, `stage`, `message`, `retryable`, `remediation`, and optional public field/Skill identity; the Operation SHALL supply Work/Operation identifiers and correlationId. Store the primary failure independently of `rollback` and `diagnosticCollection` outcomes. Terminal errors and retained stage outcomes SHALL survive same-version Core restart and removal of the failed container. Retention SHALL last for the retained Operation's lifetime. Keep at most the latest 64 terminal stage outcomes and 64 KiB of diagnostic data per Operation; record `truncated: true` if stage outcomes were discarded, without discarding the primary error or rollback outcome. Messages SHALL be at most 1,024 UTF-8 bytes and remediation at most 1,024 bytes. Public Operation reads SHALL use a structured safe projection, not raw persisted request/result/error strings or internal revisions.

#### Scenario: Preserve the initial failure after rollback
- **WHEN** a candidate fails SDK loading and restoration of the previous active runtime also fails
- **THEN** the Operation retains the candidate Skill failure as primary plus a separate failed rollback diagnostic, and Work reports failed

#### Scenario: Query after container removal and Core restart
- **WHEN** a failed initialization's container has been removed and Core restarted
- **THEN** an authorized Operation query returns the retained primary error and stage results without requiring Docker access

#### Scenario: Bound accumulated diagnostic data
- **WHEN** recovery produces more stage outcomes than the retained count or byte limit
- **THEN** oldest stage outcomes are discarded with truncated true while terminal primary/rollback diagnostics remain readable

#### Scenario: Persistence fails
- **WHEN** Core cannot commit a stage or terminal diagnostic to Operation storage
- **THEN** Core emits `DIAGNOSTIC_PERSIST_FAILED` with correlation identifiers to stderr, does not falsely report a successfully persisted terminal Operation, and same-version recovery resolves the incomplete Operation from actual runtime state

### Requirement: Diagnose runtime exit before readiness timeout

**Identifier:** WDIAG-003

During initialization Core SHALL check both readiness and container state. A confirmed early container exit SHALL fail initialization without waiting for the full readiness timeout, capture its exit code, and attempt bounded retrieval of the matching container's initialization diagnostics before cleanup or replacement. Under responsive Docker, exit detection SHALL take at most two seconds after exit and collection at most two additional seconds. Readiness timeout remains bounded at the existing default 30 seconds. Collection SHALL inspect at most the last 200 lines and 64 KiB, never follow logs indefinitely, and report `available`, `unavailable`, `unrecognized`, or `truncated`. A recognized structured initialization error SHALL remain the primary error; absent such a cause, use `AGENT_EXITED` for confirmed exit or `AGENT_READINESS_TIMEOUT` for a running non-ready daemon. Recognized incompatible descriptor/handshake errors SHALL use `AGENT_CONTEXT_INCOMPATIBLE`. Collection failure MUST NOT replace the primary cause or disappear silently.

#### Scenario: Old image exits immediately
- **WHEN** agentd exits with the recognized `invalid Work Skill descriptor` initialization error
- **THEN** the Operation reports context incompatibility, exit code, compatible-runtime remediation, and collected status instead of only EHOSTUNREACH or UNAVAILABLE

#### Scenario: Container exits without useful logs
- **WHEN** the container exits and its output contains no recognized safe initialization error
- **THEN** the Operation reports AGENT_EXITED with the exit code and collection outcome unrecognized, without guessing a Skill failure

#### Scenario: Docker log retrieval fails
- **WHEN** a known initialization failure is followed by a timeout or error retrieving container diagnostics
- **THEN** the original failure remains primary and diagnosticCollection reports unavailable with a safe collection code

#### Scenario: Running daemon never becomes ready
- **WHEN** the container remains running but no valid readiness succeeds within 30 seconds
- **THEN** the Operation fails with AGENT_READINESS_TIMEOUT plus bounded collection outcome and does not claim the daemon exited

### Requirement: Authorize and sanitize diagnostic access

**Identifier:** WDIAG-004

Diagnostic and runtime Skill queries SHALL use existing Work ownership/administrative permissions. Ordinary non-owners SHALL receive the same not-found response as for an absent resource. Core, agentd, HTTP and CLI diagnostic outputs MUST NOT contain passwords, credentials, secret paths, host/import/managed-storage paths, raw configuration, internal digests/context identifiers/revisions, Skill bodies, supporting-file contents, prompts, or Session history. Treat container output, SDK errors, filenames and exception messages as untrusted inputs; publish only recognized codes and allowlisted fields with server-authored safe messages. Unknown output SHALL be summarized by collection status rather than forwarded as a log tail. Work ID, Operation ID, correlationId, validated Skill name, stage, field, exit code, and static remediation are permitted.

#### Scenario: Reject a cross-owner diagnostic query
- **WHEN** a user queries another owner's failed Operation
- **THEN** Core returns NOT_FOUND without confirming the Operation, its Skill names, or failure state

#### Scenario: Redact hostile SDK or container errors
- **WHEN** an SDK error or container output contains a token, host path, manifest body, or a forged structured message
- **THEN** logs and public/persisted diagnostics contain only validated safe fields and server-authored messages, and none of those injected values

### Requirement: Retain correlated service lifecycle diagnostics

**Identifier:** WDIAG-SERVICE-001

Service acceptance, image resolution, storage/network preparation, container start, readiness, recovery, stop and removal SHALL emit structured start and terminal outcomes with workId, serviceId, operationId when assigned, and correlationId. Accepted Operations SHALL durably retain safe error code, stage, message, retryability and remediation under the existing 64-outcome/64-KiB bounds. Preacceptance errors SHALL carry correlationId without inventing service/Operation records. Core restarts and container removal SHALL not erase retained errors. Known codes SHALL distinguish image unavailable, invalid definition, denied mount, quota exceeded, process exit, probe timeout, Docker unavailable, lifecycle supersession, and diagnostic collection failure. Arbitrary container output MUST NOT replace server-authored safe root-cause messages.

#### Scenario: Diagnose an invalid executable
- **WHEN** a service exits because its executable is absent
- **THEN** its Operation reports a safe SERVICE_EXITED or SERVICE_START_FAILED diagnostic, stage and identifiers; failure remains queryable after Core restart

#### Scenario: Separate failure from log collection
- **WHEN** readiness fails and Docker log retrieval also times out
- **THEN** the readiness error remains primary and a separate collection outcome reports unavailable

### Requirement: Read bounded application output as authorized Work content

**Identifier:** WDIAG-SERVICE-002

Service log content SHALL be a separate explicitly requested content response, not a raw tail copied into Core process logs or durable diagnostic messages. Reads SHALL select only the bound application instance for that Work/service, accept tailLines 1..200 (default 100), cap output at 64 KiB and collection at 2 seconds, never follow indefinitely, and report available/unavailable/truncated plus a safe reason. Stop preserves access while the instance exists; removed instances SHALL return unavailable rather than another instance output. Known injected credential values and control credentials SHALL be redacted; application output remains untrusted user content and MUST NOT be interpreted as Core instructions or trusted structured diagnostics. Work ownership/content authorization SHALL govern access. General safe-diagnostic restrictions continue to apply to all lifecycle errors and process logs.

#### Scenario: Inspect application traceback
- **WHEN** the Work owner or current Work agent explicitly asks for its failed service logs
- **THEN** the bounded application output is returned as content with collection status and is not copied into global Core logs

#### Scenario: Cap noisy output
- **WHEN** the service prints more than the requested lines or byte limit
- **THEN** the response is bounded and reports truncation without blocking on a live follow stream

#### Scenario: Do not substitute a sibling log source
- **WHEN** a saved service binding refers to a removed container
- **THEN** the result is unavailable, never logs from agentd, another service or another Work

### Requirement: 安全计量创建请求及启动关键阶段

**Identifier:** WDIAG-LATENCY-001

Core SHALL 从创建 HTTP 请求进入开始建立性能计时和关联信息，覆盖受理前的镜像解析 / 检查、共享等待、环境探测、上下文捕获和持久受理；启动阶段 SHALL 分别计量资源准备、容器启动、有效 readiness 响应确认、诊断收集和激活。结构化性能事件 SHALL 包含 UTC 时间、固定事件 / 阶段名、结果、非负耗时和 correlationId，Work / Operation 标识只在真实分配并可用后加入；缓存状态 SHALL 区分命中、实际准备和共享等待。

单阶段耗时 SHALL 使用单调时钟计算。RPC 核验成功、诊断收集完成及最终激活 SHALL 有可区分的时间边界；不得把转存 Agent 日志的时间当作 Agent 原始初始化发生时间，也不得把 Operation.createdAt 解释为 HTTP 请求起点。计时 SHALL 作为独立的安全进程日志，不新增公共 Operation / HTTP / RPC 字段，不改变既有持久诊断阶段、错误投影及容量上限。

事件 SHALL 仅包含允许的标识、固定安全枚举和计量值，不记录镜像引用 / digest、内部 context 身份、宿主路径、配置、凭据、包内容或会话。共享准备的实际耗时与各调用者等待耗时 SHALL 分别关联，不能把一次共享工作计成多次执行。

#### Scenario: 受理前发生慢镜像检查
- **WHEN** 创建请求需要首次完整镜像准备，尚未生成 Work / Operation
- **THEN** 同一 correlationId 下可以观察请求开始、准备等待及结果耗时，未分配的业务 ID 缺省，受理前等待不会从端到端记录中消失

#### Scenario: Agent 已就绪但 Core 尚在收集诊断
- **WHEN** Core 已取得有效 readiness 响应，之后继续拉取并持久化安全初始化诊断
- **THEN** RPC 确认耗时、诊断收集耗时及最终激活时间能够分别识别，Agent 原始事件和转存时间不混用

#### Scenario: 多请求共享准备且一个取消
- **WHEN** 多个创建请求共享一次镜像准备，其中一个取消
- **THEN** 性能记录包含一次实际共享执行、各自等待 / 取消结果及各自请求关联，不输出跨 Work 内容或内部镜像身份

#### Scenario: 性能事件不扩张公共诊断
- **WHEN** 创建或启动成功、失败、被取消或被 superseded
- **THEN** 公共 Operation 和错误响应继续符合既有 schema，新增性能日志只含安全枚举、计量值和已允许的关联标识
