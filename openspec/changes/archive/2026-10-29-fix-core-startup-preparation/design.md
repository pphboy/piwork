# Design

## Context

动机见 [proposal.md](proposal.md)。当前 `ImageInspector` 用进程内 `preparationcache` 保存成功结果，未命中后通过单槽 gate 执行 `SaveImage`、匿名 scratch 和 `imagestatic` 全量检查。`corestore/image_inspections.go` 的持久记录仅证明在途 scratch 归属，完成后删除，不是成功验收记录。`environment_cache.go` 同样只在进程内复用真实 package-helper 环境探测。

`runtime_preparation.go` 的两个准备槽依次推进六个组件；`defaultContext` 等待 agent/packageHelper，然后执行默认脑包、默认 Work 预热和 `recoverCapturedWorks`。定时恢复也在默认准备成功后才启动。`service_gateway.go` 以全局 `Status().Ready` 门控，因此只并行恢复任务不能使已核验 Service 可访问。

现行 RUNTIME-PREP-REUSE-001 明确限定同进程复用，CST-NATIVE-001 要求全局 recovery 后开网关；本变更显式修改这些约束。CST-IMAGE-001 的首次全量内容核验、RUNTIME-CONTEXT-001、WLIFE 文件/快照/凭证栅栏保持。`simplify-linux-delivery` 已实现但未归档，采用其 Linux 三参数入口，不重新引入旧 operator 命令。

已读运行记录显示一次热启动约 5 秒监听、约 70 秒完整就绪；另一次升级启动约 16 秒监听、约 83 秒完整就绪，期间按序检查三份约 550 MiB 的 Agent 镜像。检查开始时间可证明顺序，不能将所有相邻时间间隔都计为纯扫描耗时；Windows 相对 Linux 的额外 I/O 成本尚未测定。这些是调查基线，不是本变更验收通过的证据。

## Goals / Non-Goals

**Goals:**

- 将不可变镜像事实的有效期绑定到安装、Engine、内容与规则，而非 Core 进程寿命；以零重复全量导出/扫描证明修复。
- 将镜像静态事实、默认创建准备、当前 Work 恢复验证分离；每个入口使用自身实际依赖。
- 保留完整校验、取消、收尾、身份和关闭语义，并用真实 Windows 制品验证体验目标。

**Non-Goals:**

- 不自动统一三个镜像版本，不更改已有 Work 固定镜像/context，不持久化 Work Ready 作为跨启动授权。
- 不通过放宽完整性检查、增加超时、提高 VM 配额或禁用宿主安全软件达标。
- 不重写镜像扫描器、不引入发行签名证明替代静态检查、不优化 MicroVM 解包/镜像导入实现；首次安装或新镜像本次仍执行现有完整检查并单独计量。
- 根据所有者追加授权，可在 MicroVM 项目内准备包含本次 Core 的本地验收候选；不改变其性能机制或执行对外发布。Windows 集成验证仍是完成验收的必要依赖。

## Decisions

### 1. 安装内持久的成功证明，与在途清理记录分离

在现有 `control_metadata` 下增加版本化私有命名空间，保持 `piwork-go-core/schema 1`、业务表及根目录布局。通过 `corestore` 的持锁事务读写，记录不进入 Work 内容、`.work` 快照或公共 API。与 `internal_image_inspection/` 在途记录分开，启动清理在途记录不能清空成功证明。

键由 installation ID、Engine scope、immutable image ID、OS/architecture/variant、结果类别及该类别规则版本构成。静态 Agent/file/snapshot 与 package environment 使用独立类别/版本；Core 发行版本本身不作为失效条件。修改任何影响结论的检查语义必须提升对应规则版本，环境版本覆盖探测协议及固定执行条件。

记录仅包含已验证能力/程序摘要或 Node ABI/Pi SDK 等镜像固有事实、键、记录格式版本及有界元数据。严格解析并校验键与 payload 一致性，拒绝未知格式及无效值。每类最多 64 条、单条最多 64 KiB；按持久访问顺序有界回收非固定条目，当前默认集合优先保留。命中更新在内存按键合并，最多保留四类共 256 个访问时间，在下一次写事务中先于淘汰批量更新，正常关闭时在原预算内刷新；不新增后台任务，不让命中等待数据库写锁。未刷新即异常退出只允许丢失淘汰提示，不影响成功证明有效性。容量已满且无法回收时本次可以安全返回已完成检查，但不得声称已持久保存，后续允许重新准备。

选择已有元数据存储，避免新增数据库/根文件和数据格式迁移。只加磁盘上的“已检查”布尔值不能表达身份、规则、能力和清理证明，因此不采用。

### 2. Engine 身份来自实际 daemon，不能只用 socket 路径

`dockerengine/endpoint.go` 在连接及重新建立信任时通过 Engine Info 读取 daemon ID 和存储后端信息，构成私有 scope（daemon ID、storage driver、DockerRootDir 的规范化摘要）。同一 Engine 正常重启应稳定；空/不支持/不可确认的身份不允许跨进程复用，保留完整检查路径并报告安全原因。不能用 PID、VM boot ID 或固定 Unix socket 字符串作为身份。

Engine 不可达时禁止用历史成功提供当前依赖成功；断连、重连或检测到 scope 变化时撤销连接代次的内存复用及 Work 准入证明，重新核验实际资源。持久记录只在相同已确认 scope 下可用，已知镜像缺失/不兼容时失效对应记录。受保护的本机 Engine 与安装存储是既有信任边界；该机制不声称检测特权操作者在保留全部身份的情况下篡改 Docker 底层存储。发现内容损坏必须回到实际校验/故障处理。

### 3. 所有调用者共用一条验收路径

```text
Caller --> Engine/image check --> Memory success
                           |
                           +--> Shared job --> Durable success
                                        |
                                        +--> Full verification --> Cleanup
                                                                      |
                                                                      v
                                                              Atomic success
```

每次调用先复核当前镜像存在、精确身份、平台和协议标签。内存或持久命中返回独立副本，不排队等待其他镜像的全量扫描。未命中由原 `preparationcache` 合并同键请求；重型 gate 仅保护真正的 scratch 分配/扫描，继续保持单槽及环境探测最多两槽的内存/磁盘边界。

静态检查继续使用现有 config SHA256、layer/diffID、gzip、whiteout、ELF 全部验证。临时 fd 关闭、在途归属收尾确认后才提交成功证明；环境探测在辅助容器移除和资源归属释放确认后提交。持久提交失败不发布新的可复用成功，沿安全准备失败/重试处理。中断发生在提交前则下次重做；提交后崩溃可复用完整事务结果。失效与旧在途成功发布使用代次/有效性核对，禁止被删除的记录由迟到任务重新发布。

成功记录发布与 Work 激活统一遵循 Store 写事务 → Engine 身份栅栏的顺序；成功记录的身份栅栏覆盖写入及提交，取得数据库写入资格前不得持有 Engine 身份锁。Work 路由仍在原控制事务内核验当前 route epoch 与 Engine 代次后发布，保留撤销与迟到完成拒绝规则。

环境探测继续调用固定镜像的真实 helper，不以静态标签或未验证环境描述替代。仅固定、无 Work 挂载/秘密/可变网络输入的镜像环境事实可以持久复用；包安装结果和 Work 上下文不进入此记录。读取包环境结果仍要求该镜像静态能力有效。

保持 RUNTIME-PREP-CANCEL-001：单个等待者取消不影响其他等待者，全部取消则收尾，关闭等待所有任务并遵守原总预算。配置换代撤销旧默认状态贡献，但不会撤销其他 Work 对相同镜像的合法使用。

### 4. 基础设施、默认准备和 Work 恢复成为独立依赖分支

```text
Store/identity/listeners --> Engine + recovery inventory
                                   |
                  +----------------+----------------+
                  |                                 |
          Default preparation                Work recovery
          + default prewarm                  + per-Work fences
                  |                          + captured image/context
                  |                          + actual Agent/Service check
                  |                                 |
                  |                          Work admission opens
                  +----------------+----------------+
                                   |
                          Global readiness aggregate
```

从 `prepareDefaultContext` 移出已有 Work 恢复及其定时恢复启动。恢复生命周期属于 Core/Engine 代次，不属于默认 runtime 配置代次；已有 Work 可恢复时，不要求当前默认模型配置可用。Engine 初始化也不能因默认配置缺失而完全停止。Core 包库任务的恢复继续先于默认脑包准备；Work 文件/快照/临时服务/包任务收尾按归属先于该 Work 恢复，真正影响全安装的存储/身份故障仍阻断全局业务。

准备协调器最多同时推进三个组件任务，并优先让文件和快照 helper 与默认 Agent 并行，避免同一默认镜像的多个等待者占满所有槽位。镜像全量导出与扫描仍只有一个重型槽，包环境探测仍最多两槽；该调整不提高这两类重型资源的上限。

恢复协调器先完成持久意图与资源归属盘点，再按 Work 调度，使用有界并发（默认最多两个 Work），对同一 Work 保持单一恢复任务及既有控制版本排序。被锁定、等待其 helper 或退避的 Work 保留自身状态并让出执行槽，不能无限占槽阻塞其他 Work。不得重置原恢复计数、引入第二个 Agent 或自动重放历史 Run。默认镜像的慢扫描不占用已命中 Work 镜像的恢复槽。

Core 包库收尾与 Work 归属的包收尾分别执行；Work 收尾按作用域限并发、限时并重试，不能因一个 Work 的未确认 helper 阻塞其他 Work 或默认脑包。已恢复并运行的包 worker 继续持有自己的资源，其他作用域重试时不能重新回收或重新栅栏它。

helper 完成触发对应受阻 Work 重评，不通过重新执行全部默认上下文恢复。全局基础 Ready 仍需当前默认预热有效且启动恢复协调已完成必要盘点/处置；处置可以是已验证、stopped、按原规则明确失败/等待，不等于保证每个 Work 成功。完整交付 Ready 仍需原六个组件全部 ready。内部新增恢复状态不增加公共 preparation 组件。

### 5. 以当前 Work 证明开放路由，保留全局安全门槛

`service_gateway.go` 将“全局 Ready”检查拆成 Core 存活/未关闭、Engine 当前可用，以及已认证目标 Work 的当前恢复证明和 Service 精确绑定。证明绑定本次 Core/Engine 代次、Work control version、Agent generation/instance/context 以及 Service 绑定；不能从旧 `observed_state` 或镜像记录构造。Agent 与 Service 均完成所需验证后，才对该 Service 开放。

HTTP、SSE、WebSocket 的首次授权和持续复核共用该条件；Stop/Delete/Apply、身份撤销、绑定变化、Engine 故障和关闭按原机制撤销。Work 之间的内容权限、Host/Origin、Cookie 分区及动态路径前缀保持。Session/Run 与 Service 请求审计所有全局 Ready 依赖，确保已核验 Work 可实际使用；新建默认 Work、修改默认环境及真正依赖默认准备的操作继续按原准备条件准入，不能全局删除检查。

Work 列表与详情在当前 Agent 路由证明缺失时将持久化的 ready/degraded 投影为 unknown；Service 的可用状态也在检查前后核对同一 Engine 代次。工作台据此允许已验证 Work 在默认准备尚未完成时使用，创建默认 Work 仍独立检查完整 Ready。旧状态不能通过页面缓存重新取得内容准入。

恢复取消与 SQLite 检查点并发时，`modernc.org/sqlite` 1.39.1 可能在查询结果已产生但上下文同时取消时丢弃未关闭的结果句柄，导致正常关闭时读取锁仍在。升级至兼容 Go 1.25.5 的 1.40.1，使用其对该句柄的释放修复；依赖集合不变。关闭预算与 checkpoint 的确认条件保持原样。

### 6. 时间与执行次数共同验收

沿 `diagnostics` 增加固定安全阶段：Core 启动、Engine 核验、持久复用、镜像导出/扫描、环境探测、默认准备、恢复盘点、每 Work/Service 核验和全局 ready。用单调时钟计算耗时，UTC/不透明 boot correlation 用于关联；只记录固定枚举和计数，不输出镜像 digest、路径、配置或凭据。共享执行和调用者等待分别计数，命中区分内存/持久。

基准工具在 `scripts/`，原始输出放忽略的 `dist/`。参考环境冻结 Windows/WHPX/QEMU/Docker/Core 版本、宿主 CPU/磁盘、2 vCPU/4 GiB、三个不同固定 Agent 镜像、一个 desired-running Work（默认脑包）及一个确定性 Service；镜像与成功记录均有效，依赖本地可用，不调用外部模型或外部慢 MCP。

- 整 VM 日常启动：从测试控制器启动 launcher 进程前的单调时点开始，包含已有 bundle 的校验，P95 ≤ 25 秒。所有者在查看 22.197 秒实测 P95 后明确接受 25 秒预算；历史 20 秒判定和原始样本保留，新判定不替换或删减失败。
- VM/Docker 存活时 Core 重启：从创建 Core 进程前开始，P95 ≤ 10 秒；前一次正常退出确认受管容器已停，避免以进程热接管冒充正常恢复。
- 结束点取工作台实际后端请求、当前 Agent 有效响应、浏览器同源 Service 代理返回预期内容、完整 `/readyz?profile=docker-delivery` 均已成立的最晚时点。不能只测 health，不能相加不同阶段 P95。
- 两组分别至少 20 次预先确定的连续尝试；报告全部成功/失败、P50/P95/max，P95 采用 nearest-rank。基准组必须零失败；失败或超时样本保留并使该组失败，不丢弃或用重试覆盖。每次验证全量导出/扫描为零，已有效的必要环境探测也为零。
- 上述完整基线已由前轮冻结候选完成。对后续仅修复核验问题的候选，所有者明确选择避免重复整套基准时，采用原完整基线加匹配当前制品的定向回归。本轮 v9 已完成 Core 20 次、整 VM 7 次，所有者要求按已有结果收尾；当前 VM 正常退出后阻止第 8 次启动。原始 20 次计划、正常完成样本及所有者停止导致的预检退出均保留；公开采样工具仍将不足 20 次的组判为未完成完整基准，单独记录增量回归判定。不能修改样本数量、重贴旧制品身份或宣称 v9 整 VM P95 已重新验收。每个实际样本仍须完整 UI/Agent/Service/ready 结束点及零重复重型操作，实际 Core/镜像/源码输入须匹配新包。
- 按所有者明确要求，验收禁止重启 Windows 宿主整机。通过 Core 进程正常退出与整 VM 正常关闭后的独立启动验证持久复用；不将整机重启作为完成条件，也不宣称已验证宿主断电或宿主页缓存丢失的启动表现。
- 人为阻塞默认镜像准备，证明已有 Work 和 Service 在解除阻塞前独立可用，同时全局 ready 仍为 false。另测停止目标、缺失镜像、失效规则、崩溃、恢复预算和所有安全栅栏。
- 首次空安装、升级引入新镜像、旧安装首次建立记录各单独采集完整阶段时间与执行次数，遵守既有有界准备预算，不混入重启样本。此变更不预设未经测量的冷启动体验秒数，也不宣称这些场景满足 Core 10 秒或整 VM 25 秒的重启预算。

### 7. 受影响模块与验证入口

| 模块 | 职责与验证 |
| --- | --- |
| `internal/corestore` | 有界私有记录、原子成功提交、严格读取、回收；重开 store、损坏、提交中断与 schema 兼容测试 |
| `internal/dockerengine/endpoint.go`、`image_capabilities.go` | Engine scope、每次轻量复核、静态结果复用；假 Engine 计数及真实 Engine 重启测试 |
| `internal/preparationcache`、`internal/imagestatic` | 保留共享/取消与完整扫描规则；现有 adversarial archive、并发和 cleanup 测试回归 |
| `internal/coreapp/environment_cache.go`、`package_install.go` | 环境持久复用、独立规则版本、清理后发布；真实 helper/故障注入测试 |
| `runtime_preparation.go`、`default_work_prewarm.go`、`work_recovery.go` | 分支调度、代次隔离、按 Work 恢复；阻塞默认/多 Work/配置换代集成测试 |
| `service_gateway.go`、Service/Session/Run 入口 | 当前代次准入及持续撤销；HTTP/SSE/WebSocket、权限及生命周期竞态测试 |
| `internal/app`、`internal/diagnostics`、`scripts/` | 启动计量、样本统计和行为计数；安全日志测试、Linux 与 Windows 实测 |

## Risks / Trade-offs

- [持久复用扩大信任寿命] → 严格 Engine/内容/规则作用域、当前存在性检查、仅成功发布、私有存储及失效测试；保留完整冷检查作为权威来源。
- [恢复并发绕过资源栅栏或迟到发布] → 每 Work 单任务、控制版本/Engine 代次核验、持久资源盘点先行，并用 Stop/Apply/文件/快照故障注入验证。
- [全局 Ready 与已可用 Work 不再等价] → 保留探针聚合含义，按 Work 开放，双语说明明确区别，UI 不把全局状态强行投影成所有 Work 不可用。
- [缓存容量或规则升级重新产生冷成本] → 有界淘汰可观测，默认记录优先；首次建立/失效分组报告，不能把重复准备隐藏为普通命中。
- [整 VM 预算包含 launcher 校验与 Guest 网络等待] → 记录全过程并细分阶段；Core 达标不等于 Windows 整体达标。所有者已明确接受 25 秒整 VM 预算，按同一完整组重新判定并保留原 20 秒失败结果；MicroVM 网络等待作为已知跨项目后续项记录，本变更不修改其性能机制。

## Migration Plan

1. 保持原数据格式及持久身份；旧安装没有成功记录时按原完整验证建立。无需清库、升级 Work 镜像或更换 state 磁盘。
2. 在独立安装验证 Core 单元/契约、进程崩溃与真实 Docker 集成，再执行 Linux 重启计量和原默认 Work 创建性能回归。
3. 同步双语 Docker 部署手册、单机示例及官网生成材料的就绪含义；检查 Compose/模板/打包内容一致，保留当前参数、端口和关闭窗口。
4. 生成可核对 commit/dirty/hash 的本地候选，并按所有者追加授权在 MicroVM 中集成；冻结输入并构建后，用独立安装或停机复制的数据副本验证 Windows。未核对匹配集成制品和实测结果时，本变更的对应验收任务保持未完成，不用 mock 代替。
5. 回退使用支持同一数据格式的原 Core，派生私有记录可被忽略；回退后预期重新全量检查。回退/再升级均不得改变业务身份、运行意图或历史。实际兼容性通过旧版本重开测试证明，不能只根据 schemaVersion 相同推断。
