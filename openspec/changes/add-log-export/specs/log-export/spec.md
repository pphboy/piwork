## Purpose

为管理员提供由 Core 统一负责的日志保存、归档、收集和压缩包下载能力，使 Linux 二进制及 Docker 部署均可通过 CLI 或 DesktopUI 排查问题；导出无需停止 Work，并如实说明保留范围、缺失来源和交付状态。

## ADDED Requirements

### Requirement: Core 日志同时输出并持久保留

**Identifier:** LOGEXP-001

Core SHALL 保留既有 stdout/stderr 输出，同时将受管平台日志追加保存到当前安装数据目录内的 `logs/core/`。业务诊断、性能事件、标准应用日志及日志设施建立后的启动/退出事件 SHALL 纳入统一保存；记录包含 UTC 时间、启动标识、进程内序号、输出流、级别、组件、事件和安全消息，以及适用的 Work/Service/Operation/correlation 标识。正文 SHALL 使用 JSONL 文件，不复制到业务数据库；全局日志不得混入 Work 原始输出、文件正文、会话或平台秘密。

日志目录/文件 SHALL 具有仅安装运行用户可访问的权限，遵守既有安全目录与安装锁边界。帮助、版本、语法失败及未取得安装目录锁的进程 SHALL 不创建或修改日志。二进制与 Docker 部署 SHALL 使用同一数据目录规则，容器重建后可继续保留已持久日志。

Core SHALL 按 16 MiB 分片、256 MiB 总容量及 7 天期限保留日志，清理最旧的已关闭分片，轮转和重启不得覆盖旧分片。写入 SHALL 及时提交文件，按 1 秒周期同步磁盘，并在轮转、建立导出边界和正常关闭时同步；不承诺强杀或断电后保留尚未持久的尾部。文件保存失败 SHALL 保持控制台输出并暴露安全故障；恢复后记录已知失败区间。取得锁前的错误和未经应用日志设施的原生运行时崩溃输出 SHALL 明确列为文件覆盖边界，不能宣称全部 stderr 已落盘。

#### Scenario: 二进制和 Docker 保存同样的日志
- **WHEN** 分别以 Linux 二进制和具有持久数据挂载的 Core 容器运行并产生平台事件
- **THEN** 控制台及数据目录内均可取得对应安全事件，同目录重启或容器重建保留已持久分片

#### Scenario: 轮转与正在导出竞争
- **WHEN** 日志达到分片、容量或期限边界且原分片正被有效导出任务引用
- **THEN** 新日志进入新分片，旧读取对象不被覆盖或清理；引用在任务有界结束后释放

#### Scenario: 日志磁盘写入失败
- **WHEN** 日志目录不可写或磁盘写入失败，而 Core 控制台仍可写
- **THEN** 继续输出控制台，故障可观察，恢复后补记已知保存缺口，导出不虚构对应文件内容

#### Scenario: 帮助及第二实例不改变日志
- **WHEN** 调用 help/version、输入非法启动参数或第二个进程争用同一安装锁
- **THEN** 不建立新的日志写入者、不轮转或清理原安装日志

### Requirement: 收集 Docker 当前保留的全部应用输出

**Identifier:** LOGEXP-002

Core SHALL 通过本机 Docker Engine API 收集精确绑定的 Agent、Service 实例的 stdout/stderr，保留 Docker 时间戳和流来源；请求 SHALL 不 follow、不设置起始时间，并读取截止时间 T 以内的全部当前可取得记录。不得复用 200 行/64 KiB 的有界查看限制，不调用宿主 Docker CLI、不读取 Docker 宿主日志文件或任意应用文件。

新建受管 Agent/Service SHALL 采用支持上述读取的 `json-file` 日志驱动，设置 `max-size=16m`、`max-file=4`；日志驱动策略不要求为已有实例强制替换。已有实例按其实际能力读取，驱动不可读、容器被外部移除、超时、损坏流或资源限额 SHALL 返回相应来源状态，不使用同名或同标签的新实例替代。完整收集 SHALL 继续遵守应用日志已知凭据脱敏规则；归档时使用该精确实例对应的敏感值上下文。

敏感值上下文 SHALL 绑定该精确实例实际捕获的不可变配置版本；失败候选回滚后的恢复实例不能按 desired、active 或 generation 猜选配置。原上下文无法核验时 SHALL 安全报告来源缺口，不把未经确认脱敏的正文作为完整日志交付。

#### Scenario: 输出超过现有日志查看限制
- **WHEN** 一个已授权实例保留超过 200 行及 64 KiB 输出且未超过导出资源预算
- **THEN** 导出收集全部可读取保留输出，不只取得尾部，并保持 stdout/stderr 和时间信息

#### Scenario: 旧容器的日志驱动不可读
- **WHEN** 已有容器使用不支持日志读取的驱动
- **THEN** 该来源在清单中为不可用并附安全原因，其他可读来源仍可收集，不为导出重建容器

#### Scenario: 容器名称被复用
- **WHEN** 目标实例消失而另一个容器复用名称或部分标签
- **THEN** 不读取替代容器，查找原实例归档或报告原来源缺失

#### Scenario: 脱敏不因分块或配置变化失效
- **WHEN** 已知凭据跨 Docker 数据块输出，或容器使用旧版本环境配置而当前 desired 已修改
- **THEN** 归档及导出仍按原实例上下文脱敏，不能输出因分块或选错配置而遗漏的已知秘密

#### Scenario: 失败候选回滚后的脱敏
- **WHEN** 候选配置与旧配置使用不同的已知凭据，失败后恢复实例实际运行旧配置
- **THEN** 候选与恢复实例分别绑定各自实际上下文，其归档及导出均不泄漏对应已知凭据；上下文不可确认时明确报告缺口

### Requirement: 固定截止范围并保持 Work 正常运行

**Identifier:** LOGEXP-003

接受一次导出时，Core SHALL 固定截止时间、请求主体及授权来源范围：Core 全局日志和该管理员自己全部 Work 的保留 Agent/Service 输出及归档，包括仍保留的已删除 Work 来源。范围 SHALL 由 Core 推导，请求不能指定 owner、任意 Work、容器、宿主路径或是否读取 Core 日志。

导出 SHALL 收集固定范围中时间不晚于 T、收集时仍可取得的全部保留日志；T 不表示 Docker 在 T 瞬间所有历史字节的原子快照。Core 文件读取边界和已选归档 SHALL 在有界任务期间保持稳定；实例在收集期间被替换时 SHALL 按原实例归档衔接并去重。已知归档缺口、收集期间丢失和无法确认的来源 SHALL 如实反馈。

导出 SHALL 不停止/启动 Work、不取消 Run、不 Apply、不获取冷快照业务锁；导出期间正常对话、服务和文件操作保持既有准入。Docker 或默认模型未就绪 SHALL 不妨碍收集可用 Core 文件和历史归档。

Core SHALL 在接受新任务、返回接受响应及开始后台收集前，固定并引用 Core 文件身份与字节上界；不得仅在 worker 开始时取边界。接受失败 SHALL 释放预留和引用，同键重放不得重取边界。

#### Scenario: 运行中导出
- **WHEN** 管理员导出时自己的 Work 正在执行 Run 且 Service 持续输出
- **THEN** Work 无额外停止、重启或取消，包中不含 T 之后的记录，进度使用真实收集阶段

#### Scenario: 管理员没有 Work
- **WHEN** 有效管理员未拥有 Work
- **THEN** 仍可导出 Core 日志，成功的空 Work 范围不会被解释为错误或扩大到其他用户

#### Scenario: Docker 不可用
- **WHEN** Docker 暂时不可达但 Core 文件及历史归档可读取
- **THEN** 任务仍收集这些来源，为依赖 Docker 的来源记录缺口，不要求先修复模型或停止 Work

#### Scenario: 收集时发生替换
- **WHEN** 已纳入范围的 Service 在导出期间更换实例
- **THEN** 读取原实例当前输出或其归档且只纳入一次，T 之后创建的新实例不被误当作原来源

#### Scenario: 接受后收集前发生轮转清理
- **WHEN** Core 已接受任务但 worker 尚未读取，日志发生轮转及保留清理
- **THEN** 已接受边界内的对象仍可按原身份和字节上界读取，T 后记录不混入，不能因晚取边界丢失已保留的 T 前日志却报告完整

### Requirement: 提供独立且可恢复识别的导出任务 API

**Identifier:** LOGEXP-004

Core SHALL 提供 `POST /api/v1/log-exports`、`GET /api/v1/log-exports/<exportId>`、`GET /api/v1/log-exports/<exportId>/content`。创建仅接受非空、1..256 字符的 `idempotencyKey`，拒绝未知字段和非法类型；接受返回 202 及 `exportId`、`correlationId`、`cutoffTime`、`state`、`scope`、`reused`。所有入口遵守 WACC-LOG-EXPORT-001。

同一用户、同一幂等键 SHALL 在任务元数据保留期内返回原任务和原截止时间，不重新收集；重放检查先于新任务并发门禁。同一 Core 最多接受一个非终态收集/打包任务，其他新任务返回 409 `LOG_EXPORT_BUSY`，不排队、不替代旧任务。未持久接受前不得返回虚构导出身份。

任务 SHALL 以 `collecting`、`packing`、`ready`、`failed`、`interrupted`、`expired` 表达真实状态，另行提供来源进度、取得时间和安全错误。ready 返回 `complete`、缺口计数、大小、SHA-256、文件名和绝对到期时间；其他状态不发布内容地址或伪造下载成功。未知 ID 返回 404，非 ready 内容返回 409，过期内容返回 410，已生成结果缺失或损坏返回安全的内容不可用错误；查询失败 SHALL 不重建任务。成功查询 failed/interrupted 任务仍返回 200 的任务状态。

#### Scenario: 创建响应丢失后使用原键恢复
- **WHEN** Core 已接受任务但创建响应丢失，管理员显式用相同键再次提交
- **THEN** 返回原 exportId、原 cutoffTime 和 reused=true，不产生第二个任务

#### Scenario: 并发与幂等重放
- **WHEN** 存在进行中任务时发生原键重放及另一个新键提交
- **THEN** 前者返回原任务，后者返回 LOG_EXPORT_BUSY，不以并发限制拒绝合法重放

#### Scenario: 只查询和下载原结果
- **WHEN** 客户端查询 failed 任务，下载 packing 任务，或下载 expired 任务
- **THEN** 分别取得真实失败状态、409 或 410，不触发新收集

### Requirement: 压缩包清单如实表达交付和缺口

**Identifier:** LOGEXP-005

结果 SHALL 为包含 `manifest.json`、`core/` 及适用 `works/` 日志条目的 ZIP。manifest SHALL 含格式版本、exportId、cutoffTime、实际授权范围、保留策略、`complete` 和逐来源结果；来源结果含安全 sourceId、适用 Work/Service 标识、类型、`available/empty/partial/unavailable`、实际时间范围、条目路径、字节数及安全原因，区分正常空输出、保留清理、未知历史边界、归档失败和本次读取失败。内部容器地址、凭据和任意宿主路径不得进入公开元数据。

全部约定来源成功读取且无已知缺口时 SHALL 为 complete=true；存在缺失、部分读取或来源覆盖不能确认时 SHALL 为 false。完整性仅针对约定的保留范围，不证明从 Work 创建起从未丢失日志。单个来源失败 SHALL 尽可能生成 complete=false 的有效包；全部应用来源不可用但仍能打包时可以交付带清单的部分结果，不能伪装为空日志成功。压缩/存储失败则整个任务 failed，不开放半包。

来源筛选、脱敏、压缩与传输 SHALL 流式执行，不按全部日志体积消耗内存。ZIP 完成并确认大小/hash 后才发布 ready，内容发布后保持不可变；下载重试取得同一字节和原 cutoffTime。

持久来源及归档中的已知缺口 SHALL 持续参与完整性判定；辅助归档元数据缺失、损坏或不可核验不得把 partial/missing/failed/unknown 提升为完整。可安全读取的剩余内容最多为 partial，否则 unavailable；任务 warning 与 manifest SHALL 一致反馈 complete=false。

#### Scenario: 一个来源读取失败
- **WHEN** Core 日志和一个 Agent 可读，另一个 Service 读取超时
- **THEN** 生成包含可用日志的有效 ZIP，manifest 与任务结果均为 complete=false 并标明该 Service 来源超时

#### Scenario: 空日志与日志不可用
- **WHEN** 一个容器成功返回零记录，另一个容器无法读取
- **THEN** 前者记 empty，后者记 unavailable，不能把二者都当作正常空输出

#### Scenario: 压缩过程中磁盘耗尽
- **WHEN** 压缩包尚未完整发布时写入失败
- **THEN** 任务 failed，内容入口不可下载，原日志和历史归档不被当作暂存删除

#### Scenario: 归档记录时间无法确认
- **WHEN** 已发布归档中存在无法解析 Docker 时间戳的记录
- **THEN** 该来源在任务与清单中为 partial 并给出安全原因，complete=false

#### Scenario: 归档辅助元数据丢失
- **WHEN** 持久归档记录为 partial，而 metadata.json 缺失或损坏
- **THEN** 后续导出保留已知缺口且 complete=false，任务有安全 warning，不能因仍有正文文件而升级为 available 且无警告

### Requirement: 对日志归档和导出资源执行有界保留

**Identifier:** LOGEXP-006

Work 日志归档 SHALL 默认保留 7 天、每 Work 至多 512 MiB、全安装至多 2 GiB，按最旧的已发布归档清理，并保留与仍可追踪来源对应的清理/缺口摘要。导出 SHALL 有固定的来源数、单来源字节、总收集字节、暂存及结果总容量、来源读取时间、任务总时间和下载预算；超限不能隐式尾部采样或报告 complete=true。数值与首版固定策略依 design 的保留/预算表执行，不增加 Core 启动参数或业务环境变量。

ready 包 SHALL 自完成起保留 24 小时；新的下载在到期后拒绝，已经开始的合法下载可在其有界租约内完成。引用中的日志/归档/包 SHALL 不被 GC 删除；租约、任务及下载均有期限，异常退出不造成永久钉住空间。无可释放容量时 SHALL 安全拒绝新任务或报告明确资源缺口/失败，不清理其他安装或绕过有效引用。

任务接受 SHALL 预留受限的收集、清单、ZIP 和密封空间，按实际占用在每次写入前限制预算；单 ZIP 上限独立执行，不得只在收集或打包全部写完后检查。下载准入取得引用、核验到期和 GC 删除 SHALL 原子协调，在长完整性核验前保护原结果；取消或失败释放本次资源。

#### Scenario: 有效下载与过期清理竞争
- **WHEN** 下载已经合法开始，期间包到期且 GC 运行
- **THEN** 该下载在预算内继续，新下载被拒绝，释放引用后包可清理

#### Scenario: 收集达到字节预算
- **WHEN** 一个旧实例或全部来源超过本次收集限额
- **THEN** 清单明确部分/遗漏来源、实际已取得字节及资源限制原因，不声称已经收集全部日志

#### Scenario: 归档达到保留上限
- **WHEN** 归档年龄、单 Work 或全安装容量超限
- **THEN** 仅清理当前安装最旧且无引用的归档，后续导出可区分保留清理与未知丢失

#### Scenario: 小容量预算下收集与打包
- **WHEN** 注入较小的导出区域或单 ZIP 容量限额并持续产生不可有效压缩的日志
- **THEN** 写入不会越过对应硬限额后才报错，任务明确部分或失败，预留被正确核销，不删除有效 ready 包腾挪空间

#### Scenario: 下载准入与 GC 同时发生
- **WHEN** 内容核验开始前下载准入与到期清理竞争
- **THEN** 要么合法原子取得有界引用且结果在核验和传输期间受保护，要么拒绝新许可；不能先检查后删除或泄漏槽位

### Requirement: Core 重启和退出保留真实任务结论

**Identifier:** LOGEXP-007

Core SHALL 持久保存任务身份、截止范围、阶段及结果元数据。重启时，尚未发布结果的 collecting/packing 任务 SHALL 终结为 interrupted，清理其确切归属暂存并释放引用；不重新枚举来源或更换截止时间冒充原任务。已完整密封的结果 SHALL 核对文件和发布凭据后恢复 ready 或保持其真实过期状态；缺失/损坏结果 SHALL 明确不可用。清理失败保留 cleanupPending 并有界重试。

正常关闭 SHALL 关闭新导出准入、结束活动读取/打包/下载，保留日志设施直到 Work 关闭诊断写完，最后同步关闭日志。日志任务 SHALL 不使现有 Core 45 秒默认关闭总预算失效；客户端断开、关闭面板或中断 CLI 等待不取消已接受 Core 任务。

任务和幂等摘要 SHALL 在 failed/interrupted 终结后，或 ready 包过期后保留 7 天以供查询和原键恢复，随后一起有界清理。该期限外的新尝试由客户端显式发起，不宣称可无限恢复旧 ID。

已发布结果经核验确实缺失或损坏时，Core SHALL 持久将 ready 转为 failed，错误为 `LOG_EXPORT_CONTENT_UNAVAILABLE`，公开 result 为 null，并撤销后续内容许可；保留原 ID、cutoffTime、幂等关系和可追踪的清理状态，不重新收集。普通请求取消或网络中断不得被当作文件损坏证据。

#### Scenario: 打包时 Core 重启
- **WHEN** 一个 packing 任务未发布包而 Core 重启
- **THEN** 原任务可查询为 interrupted，其暂存被收尾，原键重放不会启动新收集

#### Scenario: 包已密封而 ready 提交前中断
- **WHEN** 完整结果已持久密封但 Core 在提交 ready 元数据前退出
- **THEN** 重启核验该同一结果后恢复发布，或返回明确不可用，不把残缺 ZIP 发布为 ready

#### Scenario: 关闭发生在慢读取中
- **WHEN** Core 关闭时 Docker 日志请求或下载客户端停滞
- **THEN** 活动 I/O 有界取消，Work 仍按原预算停止，关闭日志在日志设施关闭前被保存

#### Scenario: 内容损坏后查询和重启
- **WHEN** 下载核验确认原 ready 文件同尺寸损坏，随后查询、重启或显式同键恢复
- **THEN** 下载以 503 拒绝且不发包体，原任务持续为 failed、公开 result=null，保留原身份和错误；清理失败可追踪重试，不产生新任务

### Requirement: 下载结果具有稳定身份和完整性元数据

**Identifier:** LOGEXP-008

Core 内容响应 SHALL 提供 `application/zip`、安全 attachment 文件名、Content-Length、`X-Piwork-SHA256` 和禁止缓存头；新响应须确认任务 ready、内容未过期且通过当前授权。Core SHALL 在发送响应头及包体前核对任务结果记录、seal、文件长度与 SHA-256；文件缺失或类型、大小、身份、hash 不符 SHALL 按 LOGEXP-007 先持久提交真实失败状态，再返回 503 安全错误，不重建压缩包、不发送包体。

下载 SHALL 使用有界流和授权复核，连接中断只释放本次下载资源，不删除仍有效的 ready 包。浏览器适配 SHALL 仅转发同一用户已授权的内容流，不重定向到 Core 或另行收集/打包；CLI 校验后的本地发布遵守 CLI-LOG-002。

#### Scenario: 同一结果重复下载
- **WHEN** 发起管理员在有效期内通过 CLI 和 DesktopUI 下载同一 exportId
- **THEN** 得到相同长度/hash 的 ZIP、同一 cutoffTime 与来源清单

#### Scenario: ready 文件被损坏或替换
- **WHEN** 实际结果与密封时记录的身份、类型、大小或 hash 不符
- **THEN** 下载前持久记录原任务 failed、result=null 和 LOG_EXPORT_CONTENT_UNAVAILABLE，返回 503 且无包体，不返回另一包、不偷偷重新收集
