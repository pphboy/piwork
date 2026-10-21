# Design

## Context

动机和授权范围见 [proposal.md](proposal.md)。本设计对应 [log-export](specs/log-export/spec.md)、[work-access](specs/work-access/spec.md)、[work-lifecycle](specs/work-lifecycle/spec.md)、[control-cli](specs/control-cli/spec.md) 和 [desktop-webui](specs/desktop-webui/spec.md) delta。

已核对的实现接点：

| 当前文件/模块 | 当前行为与本次接入点 |
| --- | --- |
| `internal/app/run.go`、`internal/coreapp/application.go` | 一个应用持有安装锁及 UI/Core/RPC 生命周期；日志设施需在取得锁后建立、全部关闭结论产生后关闭 |
| `internal/diagnostics/events.go`、`performance.go`，`internal/coreapp/work_diagnostics.go`、`service_runtime.go` | 诊断和性能事件分别直接写 stderr；另有标准 `log`，仅包裹启动函数 writer 会漏日志 |
| `internal/dockerengine/transfers.go` | `Logs` 限 200 行、64 KiB、2 秒；新全量读取必须使用独立能力并保持旧接口语义 |
| `internal/dockerengine/resources.go` | 通用容器创建未设置 LogConfig；已有资源计划/绑定可用于精确实例核验，但当前绑定移除后不足以充当日志历史索引 |
| `internal/coreapp/work_apply.go`、`work_delete.go`、`service_runtime.go` | Apply、删除、Service 重启/更新和失败清理存在多个容器移除路径，需要统一的移除前归档入口 |
| `internal/corestore/store.go`、`platform_files.go`、`schema.sql` | 根目录有白名单，数据库精确校验 schema；已有 `control_metadata` 可保存版本化小记录，避免仅为本功能扩充数据库 schema |
| `internal/coreapp/operation_read.go` | 普通 Operation 投影要求 WorkID，不能直接用作跨 Work 导出状态 |
| `internal/cli/user_snapshot.go`、`internal/client/binary.go` | 已有受保护二进制传输和安全本地发布模式可复用；`.work` Inspect 不适用于日志 ZIP |
| `internal/cli/hosted_desktop.go`、`user_desktop_control.go`、`user_desktop_transfers.go`、`internal/webapp/` | 两种 Desktop 共用显式适配；已有快照下载在后端暂存完整包，本功能需新增纯转发下载分支 |
| `apps/desktop-webui/src/app.ts`、`adapter.ts`、`export-flow.ts` | 有账户菜单、原 ID 观察和单次交付模式，可复用交互原则，不能沿用快照的 Stop/Inspect 流程 |

主规格仍有已完成 `simplify-linux-delivery` 将删除的旧入口描述；本次按现行源码和该有效 delta 使用 Linux 两程序、17891/17871 HTTP、托管浏览器不读 CLI 凭据的边界，不顺带修改其变更或同步主规格。

## Goals / Non-Goals

**Goals:**

- Core 独占来源归属、日志保存、归档、任务、ZIP、授权及服务端清理；客户端取得可验证的最终结果。
- 给“全部保留日志”明确时间和可用性语义，既不中断 Work，也不承诺 Docker 无法提供的原子历史快照。
- 从已有安装直接启用，保持现有 `.work` 导出、Service tail 和三项 Core 启动配置。
- 明确默认保留和预算，使失败不会产生无限内存、磁盘、后台等待或关闭预算累加。

**Non-Goals:**

- 不建设实时日志终端、搜索平台、远端日志代理或长期集中日志服务。交付止于浏览器下载 ZIP，由用户手工发给可信维护者；不建设或假定维护者上传接收端，不展示自动上传或接收成功状态。
- 不采集 Service 自行写入 workspace 的任意文件、Docker daemon 日志、宿主系统日志、helper 原始输出或其他用户的 Work 内容；已有 helper 安全失败仍通过平台诊断保留。
- 不提供 Core-only/指定用户/指定 Work/时间筛选参数，不增加普通用户导出能力。
- 不保证未经应用日志设施的 Go runtime fatal/unhandled panic 已落盘；原 stderr 继续可用，manifest 明确应用日志设施的覆盖起点及此边界。
- 不增加公开取消、目录解压执行、断点续传或后台自动重做导出；下载重试从原包重新开始。
- 功能冻结为现有单入口与 Core 收集/归档、下载 ZIP、用户手工交付；复用现有日志、任务、权限、脱敏及保存逻辑，不为未来需求新增通用框架、持久数据模型或后台服务。

## Decisions

### 1. Core 管理日志设施，客户端使用同一任务 API

```text
Hosted DesktopUI --> UI backend :17891 --+
                                       |
CLI -----------------------------------+--> Core :17871
                                       |      |
Local DesktopUI --> Desktop backend ----+      +--> core log files
                                              +--> Docker Engine Unix API
                                              +--> archived Work logs
                                              +--> ZIP + manifest + cleanup
```

新增 `internal/corelogs/` 负责文件分片、双输出、读取边界、保留与安全目录操作；Core application 持有该资源。`internal/coreapp/` 负责归档协调、任务、授权和 HTTP；`internal/dockerengine/` 只提供按已核验精确实例读取日志的受限流能力。顶层应用只连接受管 writer 和排列生命周期，不把日志业务放进 UI/CLI。

未采用“CLI 直接读本地目录/docker logs”：CLI 可连接远程 Core，且不应取得服务器路径或 Docker 权限。未采用“复用 Work 快照”：该流程要求停止和业务写锁，并不能表达跨 Work 管理员范围。采用独立 exportId，不创建虚假的 Work/Operation，也不改通用 operation show。

### 2. 存储布局、索引与升级兼容

```text
<data-dir>/
  logs/
    core/
      core-<bootId>-<segment>.jsonl
    works/
      <workId>/<sourceId>/
        stdout.log
        stderr.log
        metadata.json
  runtime/
    log-exports/
      <exportId>/
        sources/...
        manifest.json
        bundle.zip.part
        bundle.zip
        seal.json
```

`logs/` 加入受管根目录白名单，运行和读取均通过固定目录句柄、不跟随链接、验证普通文件与安装归属。目录 0700、文件 0600。Docker 使用既有 `--data-dir` 挂载，无额外日志挂载或运行参数。`logs/` 不进入 Work workspace、`.work` 快照或 Agent/Service 挂载。

日志正文只存在文件。现有 `control_metadata` 新增版本化、可分别清理的小记录：任务、幂等映射、来源、任务来源项、归档结果和密封结果记录。下载/收集引用不是持久记录。key 使用固定 `log_..._` 前缀及去连字符 UUID/摘要，满足既有 `[a-z][a-z0-9_]{0,127}`；每项远小于现有 2 MiB 限制，任务不内嵌全部日志或巨大来源数组。使用事务保持任务/幂等/来源接受原子一致，更新只操作本功能记录。

来源记录包含内部 `installationId/ownerUserId/workId/kind/serviceId?/generation/configRevision/instanceId/containerId`、创建/绑定时间、日志策略版本、归档状态和已知缺口。`sourceId` 是独立不透明 ID；公开 manifest 使用 sourceId 和 Work/Service ID，不公开 Docker 地址、宿主路径、凭据或内部镜像/context digest。所有者使用不可变用户 ID，不能按账号字符串重新归属。

新日志来源在对应资源产生输出前持久登记，再绑定核验过的容器 ID。已有安装启动时，利用受管计划、当前精确绑定及实际 Engine 核对，为仍存在的实例建立来源；升级前已经丢失的容器无法补归档，以功能覆盖起点说明，不推测日志存在。来源/归档内容状态与 Work 普通列表独立，因此 Work 删除后仍可按原 owner 查询保留归档。

当前来源记录已有 `ConfigRevision`，但登记时取 desired revision 不能证明它对应实际运行配置。整改时必须由精确实例实际使用的捕获 Context（`spec.ContextID`）解析并固定其不可变配置版本及必要的私有上下文引用；generation、desired、active 均不能替代这条证据。失败候选回滚后，恢复实例须绑定实际恢复的旧配置，候选和恢复实例分别保留身份。索引只保存私有引用，不保存敏感值，也不公开 context 身份。缺失或无法核验原上下文时，不猜用当前配置，不交付未经确认脱敏的正文，持久记录安全缺口。

Core 分片文件描述符/字节边界、活动收集引用、下载租约及容量预留均为有期限的进程内状态，复用现有 Core 日志管理器及任务/下载短互斥进行协调；不新增虚构的持久 `LogReference`/`LogReferenceKey`。持久任务、来源/归档和结果/seal 是恢复依据。重启丢失的内存引用不能伪装恢复；未密封任务 interrupted，已密封包按原身份核验。进程内模型仍必须满足准入、引用、发布、GC 原子协调与全部退出路径释放的契约。

### 3. Core 日志写入、同步和稳定读取边界

- Core 取得安装锁后、身份初始化/恢复及 listener 工作前开启日志设施。`internal/app/` 的后续启动/退出信息、Core 诊断、性能事件与受管标准 log 接入同一 writer；保留原 stdout/stderr 对外格式，文件投影为统一 JSONL。禁止业务模块继续绕过统一 writer 直接写 os.Stderr。
- 每条受管记录在序列化写入边界分配 UTC 时间、bootId 和递增 seq；既有 stage/outcome/code/correlation 等字段保留，标准应用文本以受控事件包装。启动输出 `app.listening` 的文件投影仅保留安全事件字段，不复制原 stdout 中的 dataDirectory。不得把未知 SDK/container 原文、密码、token、模型 credential、用户文件或会话写入 Core 全局日志。
- 控制台与文件分别尝试写入并处理失败，不能用会在某一路错误后跳过另一路的简单多 writer 代替故障处理。文件不设置无界内存队列；1 秒 sync 合并磁盘同步开销，轮转/导出边界/正常关闭另行 sync。
- 每次启动使用新 bootId，新分片独占创建、追加写入；达到限额后关闭旧分片并开新片，不 copy-truncate、不覆盖旧文件。强杀后的不完整 JSONL 尾部保留并标注 partial，不修改旧片掩盖问题。
- 在新任务接受阶段、返回 202 和启动 worker 之前建立导出边界，在日志管理器短互斥内同步、确定 cutoffTime=T，固定每个选中分片的文件身份和字节上界，持有有期限的读取引用。之后只读取该上界；后续写入或轮转不进入本次包，GC 不删除已引用对象。内容复制在锁外执行，不在整个导出期间持有日志/Work/数据库锁。
- 写文件故障保留控制台及内存故障区间，存储可用时保存安全状态，恢复后追加 gap 事件。若元数据也不可写，依赖原来源/启动覆盖记录和下次恢复标明未知区间，不能保证磁盘不可用期间精确持久记录每条丢失事件。
- 顶层关闭先撤销任务准入并结束日志任务，再完成 Work/HTTP/RPC 关闭及最终诊断，最后同步关闭日志设施、释放安装资源；不能先关日志再丢失 shutdown-unconfirmed 等结论。

未采用仅启动层 tee：现行代码的直接 stderr/标准 log 会绕过它。对不可恢复 runtime 原生输出不增加进程重定向/子进程监督架构；首版覆盖边界在 manifest 说明，未接入设施前的错误仍走原 stderr。

### 4. Docker 完整读取和删除前归档

为新建 `kind=agent/service` 设置 `json-file`、`max-size=16m`、`max-file=4`；其他资源 kind 保持原策略。既有绑定按其实际驱动读取，不能仅因本功能默认策略不同而 Apply、重启或改写原资源身份。新实例记录日志策略版本并验证实际配置；已有资源继续使用原捕获 spec/绑定，避免无差别变更 spec hash 触发替换。

新增独立完整读取流，内部必须同时核验安装、Work、资源种类、generation/instance 和绑定的精确 containerId。请求为：

```text
stdout=true
stderr=true
timestamps=true
follow=false
tail=all
until=<T in UTC RFC3339Nano>
since=<unset>
```

非 TTY 的 Engine 帧解复用到两个流，处理跨帧/跨块记录，记录时间来自 Docker，不能采用应用正文伪造的 JSON 时间。正文按既有日志内容规则处理 UTF-8 和已知敏感值；脱敏器保留跨块匹配状态，不以一整行或全部日志大小分配内存。旧 Service 定义或 Agent 代次使用精确实例实际捕获 Context 对应的敏感值上下文，尤其核对失败候选与回滚实例配置不同的情形；不能按当前 desired、active 或运行 generation 猜测，无法确认时按来源缺口安全处理；落盘归档前完成脱敏，元数据不保存敏感值。已有 200 行/64 KiB/2 秒 tail 接口保持原样。

Core 统一的“移除 Agent/Service 前”协调覆盖 work_apply、work_delete、Service Restart/更新、启动失败/候选回滚和恢复清理；应核对全部实际 RemoveContainer 调用及未来同类入口，不能仅在 UI Delete handler 上接钩子：

1. 原操作按既有规则确认容器停止；普通 Stop 保留容器，不额外全量归档。
2. 从已持久来源开始本次归档，记录 archiving 和原实例；在剩余预算内读取全部保留输出。
3. 写来源私有暂存目录，完成 stdout/stderr/metadata，同步文件和目录后原子发布，再提交 archived 状态；metadata 含范围、大小/hash、状态和原实例身份。归档写入同样计入单 Work/安装预算；可先清理最旧无引用归档，仍无法容纳时标明 partial/failed 并清理本次未发布暂存，不能无界写入后才检查容量。
4. 无论归档成功、超时、超限或写入失败，继续原删除/替换；保留源记录及 failed/missing 状态。不能为日志失败跳过其他容器停止或无限等待归档队列。
5. 重启核对未完成记录：完整已发布目录可验证后补记 archived；旧容器尚在可在预算内重试；源已不在且无归档则持久记 gap。预先登记的源记录使“归档失败后连错误也没写入”仍可追踪。

归档在后续导出中按 Docker 时间逐记录筛选 `<=T`，不能把停止/归档时刻当作每条日志发生时间；不假定所有记录时间严格递增。实时读取遇到原容器消失/流中断时，以同一 sourceId 的已发布归档替换本次部分暂存并重新计算结果，不能拼接重复输出或换取新容器。源记录与已发布归档在本次收集引用期间不被 GC 清除。无法取得完整原来源时直接报告 partial/unavailable。

### 5. 范围、授权和内容安全

创建、查询、内容下载统一走当前启用管理员用户会话。普通用户 403 在任务分配/来源读取/暂存前返回；未认证或无效用户身份 401。operator/Agent 身份不转换或回退。任务固定 ownerUserId，仅同一用户且当前仍为管理员可查询/下载，其他管理员 403；未知 ID 在管理员通过基础准入后返回 404。

范围固定为 Core 安全全局日志以及 ownerUserId 对应全部保留 Work 来源，包括 tombstone Work；请求中没有 owner/Work/container/path/includeCore 参数。Core 全局日志可以带允许的控制关联 ID，但不混入其他用户 Work 正文。普通用户现有 Service tail 和 .work 导出权限不受新日志导出门禁影响。

后台任务不保存 bearer/password，也不要求浏览器连接一直存在；任务执行和发布前复核 owner 仍 enabled/admin。注销仅撤销原会话请求/流，已接受任务可继续保存结果，重新登录同一管理员才能再次取得许可；降权/禁用使未发布任务 failed，清理暂存。下载每 500 ms 开始一次有界身份核验（单次最长 750 ms），同时核对会话、当前角色及任务 owner，保证失效至开始断流不超过 2 秒；本机/托管适配的身份切换也取消旧流。该预算覆盖下载准入后的完整性核验阶段和发送阶段，包括哈希读取缓慢、客户端不读取的情形；取消后不能被写截止时间续期覆盖，也不能在全流/长哈希期间持有共享授权或 I/O 全局锁。

“完整日志”保持现有脱敏规则，指时间/来源收集范围，不是秘密未经处理的原样输出。ZIP 只作为数据下载，不执行应用文本或日志内指令；API/CLI 进度和错误只含安全摘要。

### 6. 接受、收集、ZIP 与公开协议

| 方法及 Core 路径 | 输入/成功响应 |
| --- | --- |
| `POST /api/v1/log-exports` | `{idempotencyKey}`；202 `{exportId,correlationId,cutoffTime,state,scope,reused}` |
| `GET /api/v1/log-exports/<id>` | 200 安全任务视图，含上述身份、createdAt/updatedAt、进度、complete、warningCount、有限 warnings、result/error、cleanupPending；非 ready 的 result 为 null |
| `GET /api/v1/log-exports/<id>/content` | ready 且未过期时 200 application/zip，流式传输原不可变文件 |

scope 为 `{includeCoreLogs:true,ownedWorkCount,sourceCount}`，表示授权收集范围而非各源已经成功。result 为 `{filename,size,digest,readyAt,expiresAt}`；digest 是导出文件 SHA-256，不是内部 context/image 身份。进度为 `{processedSources,totalSources,collectedBytes}`；processed 包含已处理失败来源，不能展示为成功数量。状态视图只含最多 20 条安全 warning 并有 warningsTruncated，完整来源列表在 manifest；响应受现有客户端 1 MiB JSON 上限约束。

创建先验证当前管理员和请求结构，检查同 owner/键的原任务，再经过全局单任务门禁和容量/来源预检。在接受阶段原子协调固定 T、Core 文件身份/字节边界、来源引用、容量预留及 eligible sourceId，不把 Core 边界延后到 worker；来源范围以截止时已持久登记/可核验的原实例为准，不纳入 T 后的新 Work/实例。持久接受任务、分页来源项和幂等映射后启动属于 Core 生命周期的 worker；失败时释放预留/引用，不先创建可见半任务。原键重放复用原身份，不再取新边界或占用预留；worker 全部退出路径释放本次引用和剩余预留。禁止客户端选择目标范围，未知字段/重复 JSON 字段和超 2 MiB 请求按既有严格 DTO 规则拒绝。

worker 在 collecting 阶段依次处理 Core 分片及原 Work 来源，以受控并发流写私有 sources 暂存。顺序固定为 Core 分片，再按 Work ID、来源建立时间倒序、sourceId 排序；预算耗尽后的已知来源也生成遗漏条目，不能从 manifest 消失。收集结束才转 packing，生成 manifest 和 ZIP；不一边写 ZIP 一边把界面阶段误称全部已收集。条目名由受管 ID 和固定后缀生成，不接受日志正文作为路径。

ZIP 布局：

```text
manifest.json
core/core-<bootId>-<segment>.jsonl
works/<workId>/<sourceId>/stdout.log
works/<workId>/<sourceId>/stderr.log
```

manifest version=1，含请求/范围、cutoffTime、生成时间、当前保留/预算策略、Core 文件覆盖边界、complete、warningCount、逐来源身份/状态/实际时间范围/字节数/相对条目和原因。正常 empty、正常 retention-expired、已知 missing/partial、unknown coverage 各自可辨。available/empty 且无已知缺口才计为完整；正常保留边界不宣称创建以来全历史，未知覆盖不能当作无缺口。持久来源/归档记录中的 partial、missing、failed 或未知范围是完整性判断的下界，不能因 `metadata.json` 缺失、损坏或不可核验而丢弃；正文可安全核验时最多保留 partial，否则 unavailable，均 complete=false，并同步到任务有限 warning 与完整 manifest。

ZIP 写 `bundle.zip.part`，关闭压缩写入器、同步、计算长度/hash，再发布 `bundle.zip` 和已同步 `seal.json`，最后提交 ready。seal 绑定 owner、exportId、cutoffTime、worker epoch、文件身份、长度/hash、readyAt/expiresAt；恢复只能采用可证明属于原任务的结果。文件发布后不可变，Core 原日志/归档不会因打包失败被清理。

任务状态：

```text
collecting --> packing --> ready --> expired
     |            |
     +--> failed <-+
     |            |
     +--> interrupted

ready --> failed (confirmed content loss/corruption)
ready: complete=true or complete=false
cleanupPending: independent cleanup fact
```

单来源失败可交付 complete=false；压缩、整体预算/存储或总任务超时无法交付有效包时 failed。只读查询任何已保留状态返回 200；内容非 ready 409 `LOG_EXPORT_NOT_READY`，过期 410 `LOG_EXPORT_EXPIRED`。已发布内容被确认缺失/损坏时任务由 ready 转 failed，并以 503 `LOG_EXPORT_CONTENT_UNAVAILABLE` 拒绝下载，先持久提交 failed、`LOG_EXPORT_CONTENT_UNAVAILABLE`、公开 result=null 和内容许可撤销，再返回该错误；保留原 ID/T/幂等关系及内部密封失败证据，不伪装成等待重新打包。并发查询、重启和原键重放都观察原失败任务。请求取消、客户端断开或普通网络错误不证明包损坏，不能据此破坏仍有效 ready 状态。删除失败保留 cleanupPending 重试，不能先丢失追踪记录。补充安全错误为 `LOG_EXPORT_BUSY`（409）、`LOG_EXPORT_SOURCE_LIMIT`（409）、`LOG_EXPORT_STORAGE_UNAVAILABLE`（503）、`LOG_EXPORT_TIMEOUT`、`LOG_EXPORT_INTERRUPTED`；后两者作为持久任务错误。所有错误沿用既有 `{code,message,correlationId,field?,retryAfterMs?}`，不暴露原 Docker/OS 错误。

### 7. 首版固定保留、资源预算和清理

以下未由用户逐项指定的数值作为本提案首版工程默认值，测试可注入小阈值，不新增产品配置入口；数值调整须同步规格/设计和相应验收。

| 对象 | 固定策略 |
| --- | --- |
| Core 文件 | 16 MiB/片，256 MiB 总量，7 天；每秒 sync，轮转/导出边界/正常退出额外 sync |
| 新 Agent/Service 的 Docker 日志 | json-file，16m × 4 个文件；旧容器不强制转换 |
| Work 归档 | 7 天，512 MiB/Work，2 GiB/安装；最旧无引用归档先清理 |
| 非终态导出 | 全 Core 最多 1 个，无等待队列；原键重放不占新名额 |
| 来源清单 | 每任务最多 4096 个来源；预检超限拒绝新任务，保留正常原键重放 |
| 收集字节 | 单来源至多 512 MiB、全部来源至多 1 GiB（包括 Core 文件）；超限来源 partial，后续来源明确 omitted，不做静默 tail |
| ZIP 与导出区域 | 单 ZIP 至多 1 GiB；raw 暂存+结果在全安装导出区域合计至多 4 GiB；为当前任务预留打包空间，容量不足不删除未到期结果 |
| 日志读取与任务 | 读取并发至多 2，单来源 30 秒；collecting+packing 总计 10 分钟，到期整体 failed |
| 删除前归档 | 同时至多 2 个，每实例最多 5 秒且不超过所属操作剩余预算，排队等待计入预算；失败继续原操作 |
| ready ZIP | 自 readyAt 起 24 小时；不因查询/下载滑动延长 |
| 下载 | 全 Core 最多 2 条，同用户最多 1 条；每条最长 30 分钟、写入空闲 60 秒，身份核验按第 5 节 |
| 元数据 | failed/interrupted 后或 ready 包过期后，任务/幂等摘要再保留 7 天；来源的保留清理/缺口摘要保留到对应诊断保留窗口结束，再有界 GC |

新任务准入预留 raw、manifest、ZIP、seal 的所需空间，联合导出区域占用和可用磁盘检查；ZIP 1 GiB 上限独立于收集字节限制。raw、ZIP 和元数据每次写入前做有界容量扣减，达到上限后停止，不能先完整写盘再检查；错误、取消、发布和清理均核销预留，不以压缩率假设豁免上限。

所有字节限额以安全整数、实际处理字节和实际占用计量；文件全量读取不等于把整个文件载入内存。保留上限为正常态目标，已引用数据可在有界任务/下载期限内暂缓 GC；新任务容量预检不得以此允许无限越限。Core 文件轮转继续进行，超预算时拒绝新增导出或标记明确资源缺口。

GC 区分 `logs/core`、已发布 Work 归档、任务 sources、未发布 ZIP、已发布结果和任务摘要；只处理本安装登记且身份核验通过的对象。来源收集引用、归档发布、下载准入及删除使用同一 Core 协调边界，下载必须在长哈希核验前原子取得引用并复核资格/到期状态；避免先判断无引用再删除的竞态。结果到期关闭新下载准入；已存在有效 lease 可在预算内完成，之后删除文件。清理失败保留 cleanupPending、释放能确认的资源并有界重试，不堵住其他 Work。

重启使未密封 collecting/packing 任务 interrupted，不重新拉取 Docker、更换 T 或恢复丢失的文件描述符快照。已密封结果核对 seal、文件身份/长度/hash 后恢复 ready；校验失败为明确不可用，不重新打包。过期按原绝对 expiresAt 处理。日志恢复不要求模型/Docker ready，不引入全局 Work 恢复门禁；无法提供本功能时显示本功能的安全存储错误。

### 8. CLI：从管理员登录到本地 ZIP

```sh
piwork-cli --core http://192.0.2.10:17871 login --account admin
piwork-cli --core http://192.0.2.10:17871 logs export --output ./piwork-logs.zip
```

1. `logs` 作为全局业务命令组接入 `user.go`，遵循当前 Core 地址优先级；仅发送所选 origin 对应的用户 token，不使用 Desktop 偏好、operator credential、Docker socket 或本机 Core 目录。
2. 验证语法、输出目录和目标不存在；export 缺省文件为 `piwork-logs-<本次客户端UUID>.zip`。生成或采用显式 idempotencyKey，POST 创建一次任务。Core 真实鉴权决定角色；凭据文件内的旧 role 不能成为额外授权或永久否决已更新角色的依据。
3. 接受后立即保留 exportId/T/scope，stderr 显示当前任务及“收集日志”；串行以 500 ms 为正常间隔 GET 原任务，单请求有界。暂时失败退避到最多 5 秒并显示恢复情况；没有短于服务端 10 分钟预算的客户端总等待上限，确定的权限/不存在/协议错误结束观察并保留 ID。
4. 状态 packing 显示“生成压缩包”，ready 后显示 complete/缺口及 Core 来源实际状态，再调用 content。客户端按 result 的长度/hash、application/zip 验证响应，将流写入同目录独占 0600 临时文件，完成校验和 sync 后无覆盖发布。只复用通用安全目录/传输能力，不调用 .work Inspect。
5. 成功文本显示原 exportId、截止时间、保存路径及缺口摘要；JSON stdout 仅最终 `{exportId,cutoffTime,path,size,digest,complete,warningCount}`。成功保存部分结果 exit 0 且明确 complete=false；进度及缺口信息只写 stderr。包中 `core/` 就是所连接服务器的 Core 日志。

恢复命令：

```sh
piwork-cli logs show <exportId>
piwork-cli logs download <exportId> --output ./piwork-logs.zip
```

Ctrl+C exit 130，只终止本次观察/下载；已接受任务继续，部分本地临时文件清理。观察/传输故障保留 ID，download 只取原 ZIP。POST 响应丢失时保留原幂等键和未确认事实供显式同键恢复，不虚构 ID、不自动新键重提。ready 之后本地发布失败同样保留 ID。过期明确要求用户再次 export。

完整语法、单值 JSON 和退出码见 CLI-LOG-001/002；普通用户 403=exit 3，任务失败/中断=exit 6，show 成功查询失败任务仍 exit 0。help/语法校验不读凭据、状态或网络，ZIP 不写 stdout。

### 9. DesktopUI：账户菜单到浏览器下载

只在当前已核验管理员账户菜单增加一个 `Export logs`，不在各 Work/Service 菜单复制入口。复用现有 Button、Menu、Dialog/任务详情容器和 StatusLine 语义，不引入组件库、危险操作确认或停止 Work 的步骤。英文 UI 文案遵循现有产品语言，中文阶段说明与用户要求对应。

托管请求映射固定为：

| 浏览器同源路由 | 后端调用 Core |
| --- | --- |
| `POST /_desktop/api/log-exports` | `POST /api/v1/log-exports` |
| `GET /_desktop/api/log-exports/<id>` | `GET /api/v1/log-exports/<id>` |
| `GET /_desktop/api/log-exports/<id>/content` | `GET /api/v1/log-exports/<id>/content` |

1. 点击即建立一个按 Core/用户/当前会话绑定的意图和提交键。POST 通过普通浏览器会话及 CSRF，适配严格校验结构/ID并使用对应用户 bearer；创建前 Core 最终校验管理员。
2. 接受后立即显示原 exportId、T 和范围“Core logs and logs from all your Works”。无论 POST 返回 collecting、packing 还是已 ready（包括同键恢复），先 GET 原 ID 的完整详情，再按状态推进；ready 交付前须取得 filename/hash/expiry/缺口。详情 GET 失败保留已知 ID 和原键，只读重试，不退回“创建未知”或新建任务。进度按 GET 的 collecting/packing，展示真实来源处理数；某些源不可用时显示安全摘要，不能因为 scope.includeCoreLogs=true 就称 Core 文件已取得。
3. ready 后同一当前页面意图最多自动发起一次同源 content 下载，先使 partial 状态与缺口摘要可见；不为部分包增加新的必经确认。普通 attachment 响应交给浏览器保存，UI 只确认 `Download started`，不声称用户磁盘已保存。整个排障导出流程不要求运行 CLI；用户取得 ZIP 后手工发给可信维护者，没有远程上传接收端或自动上传动作。
4. 保留 `Download again`、大小、到期时间和原 ID；浏览器拦截/用户取消时由显式动作重取原包。关闭进度或页面内导航不取消 Core job，不把旧任务结果弹回正在查看的新 Work。刷新/重新登录后只恢复已知 ID 的查询，需要用户显式下载。
5. 创建未知时保持原键和锁定的目标意图，提供状态核对；若没有 ID 可查，明确未确认并允许用户显式同键恢复。不能在普通刷新或只读重查时新键 POST。账号/Core 切换、注销或角色变化撤销旧自动交付和内容流，晚结果不能覆盖新身份。

浏览器平台请求全部指向 UI 17891；HostedDesktop 根据当前浏览器 session 注入 Core 凭据，不读服务器 CLI 凭据、不将 token/上游 URL放进下载链接。content 适配使用 `client.Binary` 等有界流能力，传递 attachment、Content-Length、X-Piwork-SHA256、no-store 和安全内容类型；Core/前端断开时关闭上下游。UI 后端既不重新收集打包，也不保存第二份完整 ZIP，因此不复用现有 .work 后端暂存/Inspect 分支。

独立 `piwork-cli desktop` 使用同一个 DesktopUI 和路径，由本机 Desktop 后端调用选定 Core；本机来源、会话、共享凭据与独立偏好规则保持。服务器 UI 和独立 Desktop 的管理员均得到相同 API/ZIP 契约。

### 10. 验证与实现分工

| 模块 | 实现职责 |
| --- | --- |
| `internal/corelogs/`（新增）、`internal/diagnostics/` | JSONL、分片/保留、独立双输出、同步、失败区间、固定读边界 |
| `internal/corestore/` | logs 目录、版本化紧凑索引、任务/幂等/密封发布事务、来源墓碑和 GC 元数据；引用复用 Core 日志管理器及任务/下载短互斥，不改 schema 版本 |
| `internal/dockerengine/` | 新实例日志策略、精确身份流、解复用、取消与预算；保留旧 Logs |
| `internal/coreapp/`、`internal/app/` | 管理员鉴权、归档接点、异步任务/API、清单/ZIP/下载、恢复、共享关闭生命周期 |
| `packages/contracts/src/log-export.ts`（新增）、`scripts/generate-http-contracts.mjs`、`internal/contracts/` | TypeBox DTO、错误、安全投影、Go 生成产物及跨语言夹具 |
| `internal/cli/`、`internal/client/` | logs 命令、观察/恢复、下载校验及安全发布、独立/HostedDesktop 显式转发 |
| `apps/desktop-webui/`、`internal/desktopassets/` | 单入口、任务/交付意图、真实进度、partial 与失败恢复、嵌入资源同步 |
| 既有 Docker 手册/模板/官网生成源 | 数据挂载、保留/容量、管理员 CLI/UI 操作及实际限制；不改已发布身份 |

验收以 R1–R7 的最小有效回归及一条真实 Core + Desktop GUI 路径为准：在专属安装制造可控 Work 故障，管理员从唯一入口导出并下载 ZIP，实际打开包核对 Core/Work 内容、清单缺口与脱敏，再按原 ID 重下并比对 hash。浏览器平台请求仅到 UI，用户操作无需 CLI，文件由用户手工发给可信维护者。真实 Docker 重点证明新旧合成凭据不同的候选失败回滚、实际 Context 归属和原实例归档脱敏；保留普通用户/其他管理员隔离、完整性核验及传输期间撤销测试。小容量、轮转边界、元数据丢失、损坏状态持久化由对应修复任务的最小回归证明，不再增加跨部署故障组合。已通过且未受后续修改影响的全套检查不重复执行；修改影响的构建、资源嵌入及相关检查仍须执行，未测事实与既有结果边界分别记录。使用合成数据和可控服务，无需真实模型密钥，不影响已有容器/VM；测试产物默认 dist，持久验收证据归本 change，不包含真实秘密或用户内容。

七项独立核验问题及对应规格/修复任务见 [tasks.md](tasks.md) 的 R1–R7 映射。上述边界、记录模型与安全行为是整改目标；规划更新不证明代码已修复。历史通过结果只证明当时实际执行的范围；未受修改影响的结果可以沿用，受影响部分补针对性证明。无需按所有部署形态重跑完整故障矩阵，未测部署/路径明确记录，不以共同钩子推断真实执行。五份 delta specs 的行为、权限、脱敏及恢复要求保持，不靠收窄验收绕过真实缺陷。

## Risks / Trade-offs

- [Docker 轮转和外部删除无法冻结] → T 是输出上界；记录覆盖起点、保留边界及未知/缺口，不声称严格 T 瞬间字节快照，不通过停止 Work 实现冻结。
- [日志写入、索引和归档同时遇到磁盘故障] → 预登记来源、受管发布标记和恢复核对追踪缺口；控制台继续，恢复后标明未知区间，不作无法兑现的零丢失承诺。
- [归档拖慢替换或关闭] → 原实例最多 5 秒且计入原预算；队列等待也有界，失败继续清理；正常 Stop 保留容器而不进行强制归档。
- [全量日志占用磁盘或内存] → 流式处理、有限并发、明确字节/来源预算、结果 TTL 和有界引用；超限可见，不能静默只取尾部。
- [管理员导出突破多用户内容隔离] → 平台日志不复制应用正文，归档 owner 不随 Work 删除丢失，所有任务入口及活动流校验当前管理员和原发起者。
- [仅中央 writer 仍不能捕获 Go runtime 原生崩溃] → 首版文件保证范围明确，原 stderr 保留；不为此引入第二进程/全局 fd 重定向或宣称已捕获原生崩溃。
- [重启后无法恢复原文件描述符快照] → 未密封任务 interrupted，管理员显式重新导出；已密封结果按原 T 恢复，避免伪造续采。
- [日志包可能含应用自身未识别的敏感内容] → 保留既有已知值脱敏，在下载上下文简短说明接收方应可信，不宣称已经自动清除一切秘密；不增加额外批准步骤。

## Migration Plan

1. 在原目录锁和格式校验内接入新的 logs 受管目录及版本化 control_metadata 记录；验证现有安装无需初始化重置即可开启功能，旧 Work、凭据和默认配置不改写。
2. 新实例采用有界可读日志驱动；旧实例继续核验、采用和按实际能力读取。建立现存来源索引，明确升级前缺失无法回填，不主动 Apply/重建所有 Work。
3. 生成同版 DTO/浏览器资源并重新构建两宿主程序；二进制和 Docker 使用原数据目录挂载，按当前部署材料说明新增日志占用及固定保留策略。
4. 用专属安装完成 R1–R7 最小回归和一次真实 GUI 故障 → 下载 → 打开 ZIP 核对 → 原包重下；仅补受修改影响的必要检查，未测事实如实记录，只有实际证明的任务才勾选，不声称未执行的部署或故障组合已通过。
5. 回退不承诺旧二进制能打开含新 logs 目录的数据根（旧根白名单会拒绝）。保留完整数据备份并恢复对应版本安装；不通过删除用户数据、改写 marker/schema 或清空日志强行回退。部署更新失败不改动其他安装资源。
