# Design

## Context

动机见 [proposal.md](proposal.md)。本设计以当前 Go Core 源码为依据，解决两个连续等待：提交后尚无 Work / Operation，以及出现 Work 后的 Starting。

现行创建路径：

| 边界 | 当前工作 | 源码 |
| --- | --- | --- |
| 受理前 | 参数、权限、幂等、重名、默认配置、目录选择检查 | `internal/coreapp/work_create.go` |
| 受理前 | 解析 Agent catalog → 固定 image ID → 全镜像导出 / 静态扫描 | `work_binding.go`、`internal/dockerengine/image_capabilities.go` |
| 受理前 | 全局 Skill 锁内捕获包、创建临时环境探测容器、校验 / 复制 Work context | `package_context.go`、`package_install.go`、`internal/workcontext/` |
| 受理点 | 持久写入 Work、配置、context、配额、卷意图和 Operation，调度 worker | `work_create.go` |
| Starting | 再次全镜像导出 / 扫描，确保网络和卷 | `internal/workruntime/runtime.go` |
| Starting | TLS、配置、Docker 容器创建和启动 | `internal/workruntime/runtime.go` |
| Starting | 等待真实 Agent readiness，拉取并转存初始化诊断 | `internal/agentclient/client.go`、`internal/workruntime/runtime.go` |
| Ready | 恢复所需 Service、核对控制版本、激活 context、发布路由并完成 Operation | `work_start.go`、`work_coordinator.go` |

```text
CURRENT
HTTP --> validate --> export/scan #1 --> probe/copy --> accept
                                                          |
                                                          v
Ready <-- activate <-- diagnostics <-- readiness <-- container <-- export/scan #2
```

前期只读调查的三个本机历史样本中，第二次镜像检查连同网络 / 卷准备约 5.8 秒，容器创建 / 启动约 0.6 秒，后续到 Core readiness 终点约 2.7–2.9 秒。另一次约 578 MiB 镜像的纯导出样本耗时约 11.7 秒，来自不同时间与负载条件，不能与历史样本相加或当作修复后的验收证据。

一个已有样本的 Agent `agent.ready` 比 Core readiness 终点早约 1.6 秒；该差值包含连接确认和日志转存，不足以把全部差值归于 gRPC。当前转存诊断使用 Core 接收时间，不能替代 Agent 原始时间。创建记录时间在第一轮镜像检查后生成，也不能代表请求进入时间。

现有后台准备已经检查全局 runtime Agent / package helper 镜像，但只对 pull 结果作了按 runtime revision 的合并，没有保留静态能力结果。已安装脑包会跳过 seed，环境探测因而也可能没有预热。实际默认 Work 镜像还可以由管理员独立选择，不一定等于全局 runtime 镜像。

## Goals / Non-Goals

**Goals:**

- 在 Core 对应准备完成后的默认创建路径中，完整镜像扫描和环境探测调用数均为零；同键冷准备只执行一次。
- 让内存成功结果可以被创建、Start、Apply、恢复和包环境调用共同复用，同时保留每 Work 的副本、权限和真实 readiness。
- 明确共享任务的所有权、取消、容量和关闭边界，避免把慢请求迁移成无法收尾的后台任务。
- 按同一参考环境独立验证受理、后端就绪和浏览器全过程预算。

**Non-Goals:**

- 本轮不调整 Desktop 两秒观察频率，不引入 SSE / 容器池，不重构容器内 SDK / MCP 初始化。
- 不持久化缓存，不新增存储 schema、公共 DTO、运行参数或宿主依赖；不以镜像 label 单独代替完整首次静态校验。
- 不将 Work context 捕获移到受理后，不共享可变 Work 包目录，不改变大包或外部 MCP 的必要工作量。

## Decisions

### D1. 在检查器入口复用不可变镜像能力

在 `ImageInspector` 的所有能力检查入口共用成功缓存和同键任务表。键为 `(imageID, kind, validatorVersion)`，Engine / 安装隔离由持有检查器的实例保证；`agent`、`file`、`snapshot` 分别匹配自身能力。引用先按现有规则解析为当前不可变 image ID，不能以 tag 或 catalog 名称作缓存键。

初版为最多 64 个成功条目的内存 LRU；当前默认 Agent 和受管 package helper 的必要能力条目在对应准备有效期间保留，换代后取消保留并按普通 LRU 回收。缓存返回 `Capabilities` 的独立副本，尤其复制 Environment 指针及其中 JSON 字节，避免调用者改变共享结果。

每次读取先检查调用者取消、执行轻量 ImageInspect 并核对 ID / 平台 / 类别。镜像缺失或身份冲突使对应成功结果失效；Docker 不可达时本次失败，不绕过依赖检查。命中在全量扫描许可之前返回。未命中才进入同键合并；原有全量归档 gate 继续限制不同镜像的磁盘 / 临时空间占用，昂贵扫描完成且现有 inspection 归属收尾成功后才发布结果。

选择这一层而非在 `createWork` 中传一个“已检查”布尔值，是为了覆盖 Start、Apply、恢复和并发调用；选择内存而非持久缓存，是为了让二进制 / 校验器升级自然失效，避免引入制品证明与数据升级协议。相同 image ID 依赖现有可信 Engine 的内容寻址不可变语义。

### D2. 缓存真实包环境探测，完成清理后发布

在 `Application` 的 `probePackageEnvironment` 入口增加独立的环境成功缓存，键为 `(imageID, environmentProbeVersion)`，同样最多 64 个成功条目并返回独立值。创建、包安装、脑包 seed 和候选准备都调用这个入口，不建立平行的第二套探测路径。

冷路径保留当前唯一 probe identity、隔离容器内 Node / SDK 实测和环境结构校验。将原始探测及其 defer 清理封装为一次完整工作：`RemovePackageHelper` 与 `ReleaseResourceIntent` 全部成功后才能提交成功缓存，任一失败不发布结果。缓存仅保存镜像环境，不保存包 head、包内容、Work 配置或兼容性结论；每次 `AssertEnvironment` 及接受事务内的来源 / 权限 / 配额核对照常执行。

环境探测独立限制为最多两个实际容器同时执行，不复用已有 package prepare slot：脑包准备等调用者可能已经持有该 slot，重复获取会产生死锁。默认无启用包时不强制执行环境预热。保留当前隔离实测而非改读 Node header / SDK manifest，减少本轮环境判断语义变化。

### D3. 共享任务归 Core 生命周期管理，调用者拥有等待

在新增内部包 `internal/preparationcache/` 复用容量、成功条目、同键 flight、等待者取消和有界关闭机制；镜像 / 环境各创建独立实例，业务校验与 Docker 清理仍属于各自原模块。两类缓存分别维护同键 flight，成功值和进行中任务分离。最多登记 64 个不同未完成键；新键在创建任务前可取消地等待容量，不无限创建后台工作。每个实际任务从明确的 `Application` 生命周期 context 派生，执行预算不超过现有十分钟；不能保存 `initializeDocker` 的一次准备 attempt context 作为长期根，也不能以首个 HTTP 请求的 context 作为共享任务所有者。

每个加入的调用者登记等待者。一个调用者取消只解除自身等待；最后一个解除时取消实际工作，将 flight 标为 closing，后来的同键调用者等待其受管收尾后再重试，不加入取消中的 flight。工作只有在完整函数返回、清理确认且未取消后才发布成功并通知等待者。等待者取消与任务完成通过同一状态锁排序，防止双重结束或把部分结果写入缓存；锁内不执行 Docker / 文件 I/O。

Core 关闭先停止新任务并取消生命周期，再在关闭总预算内等待两个缓存管理器收尾；等待发生在 Engine、inspection root、Store 等依赖关闭前。清理沿现有精确资源身份与有界清理逻辑，不能每任务另加一份总关闭预算。未确认时返回未完成关闭，不报告干净退出，持久意图供下次恢复。配置换代取消旧准备的等待和状态贡献；仍有其他有效使用者的同键工作可继续。

### D4. 预热当前实际默认配置，使用现有准备组件

保持全局 runtime Agent / package helper 检查。`prepareDefaultContext` 在既有 seed / 同步默认引用后，读取实际 `DefaultWorkConfiguration`，用与创建一致的 catalog 解析规则准备其镜像；在 `work_binding.go` 提取可复用的镜像解析部分，不为预热解析模型秘密或构造 Work。

若默认配置启用包，再通过 D2 探测并保留对应环境结果；若不启用包，跳过该依赖。这个分支位于脑包是否需要 seed 的判断之外。全部结果提交到共享缓存后，`defaultContext` 才能完成；无需新增 readiness 组件或修改状态 DTO。必要的当前默认条目保持到默认配置换代，普通其他镜像条目可以回收。

预热捕获 `(runtime preparation generation, defaultWork revision, selected image ID, needsPackageEnvironment)`；发布前核对仍为当前选择。`default_work_patch.go` 在镜像或包选择成功持久化后调度现有后台 refresh，保存响应不等待昂贵检查；`package_worker.go` 将安装结果加入默认包列表后也调度必要 refresh。现有 model 变更调度继续适用。应用默认引用同步只沿用既有语义，不覆写管理员独立保存的 Skills / 包列表 / 其他字段。

后台刷新使状态反映当前选择的准备结果；旧配置工作不能把新配置设为 ready，也不改已有 Work 捕获的 image ID。当前请求显式选择未预热镜像或 tag 已改变时走正常可取消冷路径，单独统计。

```text
AFTER: SHARED PREPARATION
Core start / defaults change
  --> resolve effective default image
  --> inspect once --> capability cache
  --> probe once, if needed --> environment cache
  --> recovery / current-generation checks --> Core Ready

AFTER: DEFAULT CREATE
HTTP --> validate/replay --> resolve image + light inspect/cache
  --> lease/validate/copy owned context --> durable accept --> 202
                                                 |
                                                 v
  Starting --> light inspect/cache --> network/volumes/TLS
    --> create/start Agent --> verified readiness --> diagnostics
    --> service restore + control fence --> activate route --> Ready
```

网络 / 卷 Ensure 的幂等调用保留；它们与约 0.6 秒容器创建路径不是当前主要重复大流量工作，先以计时确认再判断是否另做优化。context 捕获也保留当前原子顺序，避免把进度提前变成受理后才发现配置失败。

### D5. 仅启动确认阶段推动快速连接重试

在 `internal/agentclient` 提供启动确认使用的窄接口。`waitReady` 的实际 RPC 因连接暂时不可用而失败、且当前容器仍在运行时，通过连接的 `ResetConnectBackoff` 推动下一轮重试，继续使用现有约 200ms 的检查节奏；不重建客户端，不做忙循环，不让普通 Session / Run RPC 也不断重置退避。

保留单次 RPC 一秒上限与 readiness 三十秒总预算；身份 / 契约错误直接按原规则失败，确认容器退出继续有界收集诊断。当前 Agent 能返回合法 readiness 后，参考延迟监听测试的确认耗时目标为 500ms 内。正式运行不持续重置连接退避。选择局部启动重试，而非修改整条连接的全局 backoff 参数，是为了避免改变运行期断线行为。

RPC 验证成功后仍按现有规则收集 / 持久化诊断、恢复所需 Service、核对控制版本并激活。镜像缓存命中、端口已开放和 `agent.ready` 日志均不能直接发布路由。

### D6. 独立安全计时，不扩张公共诊断协议

在 `internal/diagnostics` 增加只写进程 stderr 的性能事件投影，与现有受 schema 约束的 `Event` / `OperationDiagnostics` 分开。固定字段为 UTC `timestamp`、`event`、`phase`、`outcome`、非负 `durationMs`、`cacheState`、`correlationId`，以及实际可用的 `workId` / `operationId`；固定枚举由代码 allowlist 产生，禁止外部错误文本或原始配置。共享执行使用独立安全关联 ID，调用者以该关联 ID 关联等待，不输出缓存键或镜像身份。

计时阶段至少包括 `create-request`、`image-resolve`、`image-inspection`、`environment-probe`、`context-capture`、`acceptance`、`runtime-prepare`、`container-start`、`readiness-rpc`、`diagnostic-collection`、`activation`。调用者等待和实际共享执行分开计数。请求起点在创建 HTTP 入口建立；preaccept 失败没有业务 ID；后续 worker 沿已有 correlationId 关联，不修改 Operation.createdAt 的含义。

各阶段以本进程单调时钟计算耗时，UTC 时间用于关联。保持原有公共 Operation 阶段、字段、持久诊断及 64 项 / 64 KiB 限额；性能数据不塞入持久 Operation JSON。原 Agent 日志的发生时间与 Core 转存时间不混用，也不改变现有安全解析白名单。

### D7. 性能目标、样本与验证分离

| 测量边界 | 参考目标 | 方法 |
| --- | --- | --- |
| 创建请求进入 → 202 响应完成 | P95 ≤ 1 秒 | 请求单调计时与安全服务器阶段事件对照 |
| 持久受理 → 后端真实激活 Ready | P95 ≤ 3 秒 | 当前实例 activation 事件与至多 100ms 分辨率的独立只读观察对照 |
| 浏览器点击创建 → 列表及面板确认可用 | 实测 P95 ≤ 6 秒 | 真实 Core / CLI / Desktop 的浏览器测量 |

固定默认脑包、内置本地 MCP、默认 Agent 1 CPU / 768 MiB、无用户 Service、无慢外部依赖；每组至少 20 个顺序创建成功样本，保留全部失败与超预算样本。结构正确性测试和墙钟性能测试分离：普通 CI 以 ImageSave / probe 次数及取消行为作稳定门禁，专门性能入口在同一参考机做前后对照，不能仅靠机器更快宣称重复工作已经消除。

参考测试记录 OS / CPU / 内存 / Docker 存储驱动、镜像版本与大小、构建 commit / dirty 状态、资源限制、样本数、并发条件和 P50 / P95。使用独立 installation ID、合成模型配置，不发付费模型请求；真实 production Agent 验证普通初始化路径，acceptance Agent 用于确定性功能回归。实际默认创建在 Core 已 ready 后立即开始，保留首个 Work 样本；冷启动 / 新镜像 / 大包 / 外部 MCP 和并发压力另列。

浏览器两秒周期不是“显示一定最多两秒”的证明；终态、Work 和列表同步可能分多次完成，因此 6 秒目标必须实际测量，不能由多个 P95 相加得出。未达标时按阶段报告原因，不自动降低目标、缩短必要预算或扩张为 UI 改造。

### D8. 模块改动与实现顺序

| 顺序 | 模块 | 本次职责 |
| --- | --- | --- |
| 1 | `internal/diagnostics/`、`coreapp/work_create_http.go`、`work_diagnostics.go`、`work_create.go`、`work_start.go`、`workruntime/runtime.go` | 请求起点、共享执行 / 等待及激活阶段安全计时 |
| 2 | 新增 `internal/preparationcache/`、`dockerengine/image_capabilities.go` 及缓存支持文件 | 有界成功缓存、同键合并、轻量复核、全量 gate 保留 |
| 3 | `coreapp/package_install.go`、`package_context.go` 及新环境缓存支持文件 | 所有环境调用共享结果，清理完成后发布 |
| 4 | `coreapp/application.go` | 注入明确生命周期，管理任务容量、取消及依赖关闭顺序 |
| 5 | `coreapp/work_binding.go`、`runtime_preparation.go`、`default_work_patch.go`、`package_worker.go` | 实际默认选择解析、启动 / 配置变更预热与代次核对 |
| 6 | `agentclient/client.go`、`workruntime/runtime.go` | 启动阶段快速重连及 RPC / 日志收集分段 |
| 7 | 对应单元 / integration 测试、`apps/desktop-webui/test/`、`scripts/`、`docs/testing.md` | 功能门禁、真实 Core / 浏览器性能入口和安全结果说明 |

## Risks / Trade-offs

- [Core 重启仍需首次完整检查] → 在现有后台准备中执行并单独计时，健康 / 状态接口保持响应；不承诺冷启动满足热路径预算。
- [缓存键不足或共享值被修改] → 固定镜像身份 / 类别 / 校验版本、Engine 实例隔离、轻量复核与独立副本；覆盖 tag 变化、删除、容量回收测试。
- [一个请求取消影响其他请求、配置换代漏取消或关闭提前释放资源] → 等待者与 flight 分离，closing 状态及关闭等待有界，测试首个 / 全部调用者取消与资源关闭顺序。
- [临时 helper 退出但清理不完整] → 保留归属意图和现有恢复，清理未确认不发布成功缓存，不以缓存掩盖失败。
- [默认 Work 与 runtime 镜像不同，或默认配置在预热时变化] → 用实际默认选择、现有默认 revision 与准备代次核对；成功持久化后只调度后台准备，旧 Work 保持原捕获值。
- [大包校验 / 复制、Node 模块加载、外部 MCP 成为剩余耗时] → 保留必要工作并独立计量，默认预算明确测试条件；后续优化依据测量单独规划。
- [单阶段 P95 或两秒轮询误导总预算] → 独立端到端样本和浏览器测量，不丢弃失败 / 慢样本，不把历史数据当本次通过证据。

## Migration Plan

仅替换新构建的 Core；内存缓存随进程启动重建，预热沿既有状态和重试流程执行。已有 Work、context、历史、模型引用及已捕获镜像不迁移。使用既有镜像完成兼容功能 / 性能验收，不因本变更重新发布 Agent 制品。

回退为原 Core 构建，缓存自然消失，持久数据格式未改；恢复后按原生命周期继续，不清理用户卷。默认环境变量、网络、目录、CLI 状态存储、readiness 默认超时及关闭总预算保持；若实现实际需要改变这些部署边界，必须先更新本规划并按仓库约定同步全部双语部署材料及 quickstart 检查。
