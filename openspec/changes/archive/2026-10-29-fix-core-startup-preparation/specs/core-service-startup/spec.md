## MODIFIED Requirements

### Requirement: 自动准备运行依赖并允许失败后恢复

**Identifier:** CORE-DOCKER-PREP-001

Core SHALL 自行检查 Engine、拉取缺失的配置镜像、校验平台及各原生协议、准备 package helper/默认上下文并完成启动恢复。已有 Work 恢复 SHALL 与默认准备分别推进，仅依赖该 Work 的实际捕获配置、镜像及必要恢复资源；默认环境未配置、准备缓慢或失败不得阻断依赖已满足的已有 Work。镜像拉取和依赖准备 SHALL 在后台执行，不占用健康/状态请求直至长时间拉取结束；`/healthz`、`/readyz`、`/control/status` 不因拉取锁排队，状态为当前快照。配置持久化后 SHALL 调度相应准备并使 readiness 反映实际状态；既有管理响应与状态 DTO 保持。

在线管理配置在有效配置确认持久化后 SHALL 返回既有保存结果；尚待后台准备时不得把成功保存报告为保存失败，运行可用性由后续 status/readiness 核实。输入无效、secret 不可用或持久化未确认仍使用原安全错误契约；既有管理员 API 的已保存 runtime 加实际 readiness 返回体保持。

单次镜像/上下文准备 SHALL 有十分钟上限且可在关闭或配置换代时取消；可重试的 Engine/网络/拉取失败 SHALL 以 1、5、15、30、60 秒并以 60 秒封顶的退避再次准备，同一组件不得重复并发准备。非法引用/平台/协议错误 SHALL 标为失败，等待纠正配置后再准备。缺少 file/snapshot helper 配置 SHALL 报告 `unconfigured`，package helper 省略时沿用 Agent 镜像的既有回退；失败的首次 file/snapshot helper 拉取不能永久缓存为已经准备完成。成功后 SHALL 捕获不可变镜像身份，既有 Work 不因 tag 变化或新默认值自动替换运行身份。

默认 Agent/默认上下文或必要启动恢复未完成时不得报告全局基础就绪或完整交付就绪；单个 Work 通过本次启动的完整核验后 SHALL 独立表达其就绪，不等待无关默认准备。file/snapshot helper 不可用 SHALL 单独报告该功能不可用，不能阻断本来可用的 Work/Service。关闭 SHALL 停止新尝试并取消后台任务，遵守既有有界关闭规则，不删除 Work 数据。旧配置代次的完成结果 SHALL 不覆盖新配置状态。

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
- **WHEN** 管理员在线提交有效配置，持久化成功但新镜像尚未取得
- **THEN** 保存请求成功返回保存的非敏感 runtime，status/profile 仍报告真实非 ready，后续准备失败不能伪装成未保存

#### Scenario: 默认镜像准备阻塞
- **WHEN** 默认镜像拉取或验收被阻塞，而已有 Work 的镜像记录和必要依赖均有效
- **THEN** 已有 Work 恢复与验证可以完成，获准用户可使用其已核验 Agent 和 Service；默认创建仍受准备条件限制，全局就绪保持非 ready

#### Scenario: 默认配置换代不取消已有 Work
- **WHEN** 已有 Work 正在按捕获 context 恢复，管理员保存新的默认配置
- **THEN** 只有默认准备切换配置代次，已有 Work 不被无关取消、重启、改镜像或隐式 Apply，最新控制目标仍有优先权

### Requirement: 默认 Work 共享准备在 Core 就绪前完成

**Identifier:** CORE-WORK-PREWARM-001

Core SHALL 将当前实际默认 Work 配置所选 Agent 镜像的能力检查与默认启用包所需的运行环境探测纳入既有后台准备，不得只准备全局 runtime 镜像而遗漏管理员单独选择的默认 Work 镜像。对应默认准备完成并允许新建 Work 前，结果 SHALL 在按 RUNTIME-PREP-REUSE-001 复核或重新准备后，可被本进程的第一个默认 Work 复用，不依赖脑包需要首次 seed、升级或已经安装。默认镜像 / 包选择变更成功持久化后 SHALL 重新调度必要准备；默认没有启用包时 SHALL 不为无包创建强制增加包环境探测依赖。

预热 SHALL 保持健康 / 状态查询可响应、单次准备十分钟预算、重试与配置代次规则、既有组件划分及 file / snapshot helper 降级语义，不创建默认 Work，不重置管理员的默认选择或脑包管理决定。Core 重启后的首次预热、未预热的新镜像、拉取和恢复时间 SHALL 分别报告，不能伪装成已经准备好的创建路径。

#### Scenario: 已安装脑包的安装重启
- **WHEN** 脑包已安装且默认选择有效，Core 重启完成后台准备并报告基础 ready
- **THEN** 第一个默认 Work 直接复用镜像检查和所需包环境结果，不在受理前重新导出镜像或创建环境探测容器

#### Scenario: 管理员显式选择空包列表
- **WHEN** 管理员默认配置不启用任何包且镜像运行能力有效
- **THEN** Core 保留空选择，不为预热重新启用脑包，无包 Work 创建不依赖包环境探测

#### Scenario: 默认 Work 镜像不同于全局 runtime 镜像
- **WHEN** 管理员持久化单独选择的默认 Work 镜像或默认包列表
- **THEN** 保存不等待完整准备，后台准备实际所选镜像及必要环境，准备期间状态反映当前默认选择，旧完成结果不能覆盖新选择

#### Scenario: 预热失败或配置换代
- **WHEN** 当前默认准备失败，或准备进行时管理员持久化新配置
- **THEN** 健康和状态仍可读，readiness 反映当前代次实际准备状态，旧代次结果不把新配置标记为 ready

#### Scenario: 非必需 helper 尚未完成
- **WHEN** 默认 Agent、所需环境和恢复已完成，而 file 或 snapshot helper 仍未准备好
- **THEN** 沿既有基础 / 交付 readiness 区分报告，已可用的 Work 能力不被非必需 helper 阻断

#### Scenario: 重启命中持久默认准备
- **WHEN** 当前实际默认 Work 镜像和启用包所需环境已有有效持久成功记录
- **THEN** Core 轻量复核后完成该项预热，不重新完整扫描或运行环境探测；保存新的默认选择仍重新核对其实际依赖

### Requirement: 初始化并核验 Go Core 持久存储

**Identifier:** CST-NATIVE-001

Go Core SHALL 为全新安装建立明确标识为 `piwork-go-core`、schemaVersion=1 的存储，并原子初始化所需业务表、安装身份和约束。该版本标识与 TS Core schema 8/9/10 及独立的 Agent history 版本分离。已支持的 Go 存储 SHALL 保留安装、用户、登录、Work、Operation、网络身份、文件任务及快照/包状态并按现有规则恢复。

不支持的格式、未知版本、损坏 marker 或无法识别的非空目录 SHALL 在执行数据库迁移、创建 Docker 资源和开放业务路由前明确失败，不静默重建、清空、降级或猜测转换。首次初始化中断只允许从可证明属于本次 Go 初始化的未完成记录恢复，不能据此接受任意非空目录。存储锁 SHALL 保证单一 Core 所有者，未持锁进程不得修改存储。

Work 与 service 的稳定网络身份 SHALL 在对应创建/导入事务发布时分配并持久化；网关 SHALL 按目标 Work 开放：该 Work 及目标 Service 完成本次 Core/Engine 代次的恢复、资源栅栏与实际容器核验前不得路由。已完成核验的目标不因无关默认准备或其他 Work 等待而被全局 Ready 门槛阻断；全局关闭、Engine 不可用、身份撤销及目标状态变化仍须阻止新准入并撤销原有内容连接。业务重启恢复与 `.work` V1 导入仍为必要能力，不因取消历史安装升级而省略。

#### Scenario: 空目录首次启动
- **WHEN** Core 指向新的空数据目录
- **THEN** 初始化合法 Go 存储并启动健康接口，未初始化管理员/runtime 时显示相应状态，不创建默认用户或 Work

#### Scenario: 同格式重新启动
- **WHEN** Go Core 重启并读取支持的完整 Go 存储
- **THEN** 使用原安装身份和网络身份恢复，不重新分配 Work 域名、不清空 Operation 或配额

#### Scenario: 拒绝旧开发目录或未知版本
- **WHEN** 目录含旧 TS 数据、未知 Go schemaVersion 或无合法 marker 的非空库
- **THEN** 启动非零退出并说明应使用独立支持的数据目录，原数据及 Docker 资源不被修改

#### Scenario: 初始化中断或第二个所有者
- **WHEN** 初始化事务中断后重试，或另一进程已持有目录锁
- **THEN** 前者仅恢复可证明属于 Go 的未完成初始化，后者拒绝；两种情况均不产生部分可用的业务库或并行写入者

#### Scenario: 部分 Work 已核验但全局未就绪
- **WHEN** Work A 及其 Service 已通过本轮核验，而默认准备或 Work B 仍未完成
- **THEN** 获准用户可经原同源 Service 路径访问 A，B 不因 A 成功而放行，全局探针保持其真实聚合状态

#### Scenario: 旧状态不能授权与持续连接撤销
- **WHEN** 存储保留上次 Ready 但当前核验尚未完成，或已开放目标随后 Stop、Apply、撤销身份或遇到 Engine 故障
- **THEN** 前者不允许 HTTP/SSE/WebSocket 路由，后者按原栅栏撤销相关准入与连接，不能依赖镜像记录或旧 Ready 继续访问

### Requirement: 原生辅助能力检查与保留 Agent 运行环境

**Identifier:** CST-IMAGE-001

Agent production/acceptance SHALL 保留完整 TS Pi SDK harness 与 Node/npm/Git，并交付普通原生 Go package-helper 和 Service MCP；两 target 使用相同程序字节。Agent RPC v2、package-helper contract 2、Service MCP contract 1 与包内容/context contract 1 SHALL 分别核验，不能用 label、Node shebang 或链接启动器冒充静态 Go 能力。Go 构建固定 1.25.5、CGO=0、只读模块锁和真实 commit/dirty，运行宿主不增加解释器或 sqlite3 依赖。

镜像首次验收或成功证明失效时，静态检查 SHALL 先固定 image ID，通过 Engine inspect/save 核验选定 config SHA256、平台、layer/diff ID、gzip、whiteout/opaque 合并树和完整可执行 ELF，不运行 ENTRYPOINT 或包代码，不创建能力检查容器。归档使用 0600 匿名 scratch 与持久安装/image 归属，取消和进程退出回收 fd；仅精确本安装零字节 fallback 占位可清理。归档/恢复各 100 GiB、metadata 单份 64 MiB/累计 256 MiB、一百万条目、路径 4096 字节/深度 128，宣称长度不能驱动无界分配。

Agent 与默认 Web base SHALL 分别提供获准场景所需 sqlite3 CLI；Agent bash 不因 Service 有 Python/pip 就获得这些工具，策略禁用时不能另开 SQL 入口。默认 Web 环境遵循有效 web-development-base 的 NiceGUI 要求，旧 FastAPI/React 描述不作为新默认约束。旧 Work 采用新系统命令仍须兼容镜像选择及显式 Apply。静态镜像能力不替代完整包和目标安装校验。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
make native-agent-images
```

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
  go test -mod=readonly -tags=integration -v ./internal/dockerengine \
  -run 'TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence|TestRealTSAgentNativeMutualTLSWithoutHostTools|TestRealTSMCPClientNativeStdioAndCoreMutualTLS|TestNativePackageHelperRealImageSourcesAndTSArtifactCompatibility'
```

#### Scenario: 有效证明复用与冷检查保持完整
- **WHEN** 调用者请求镜像能力
- **THEN** 按 RUNTIME-PREP-REUSE-001 复核有效成功证明后可复用；缺失或失效时执行上述全部内容核验，不能只检查标签、文件大小或时间戳后宣称完整验收成功，不能用此证明跳过可移植 Work 导入的实际内容检查

### Requirement: Recover Core and Work state across restart

Core 重启时 SHALL 恢复用户、会话、Work 和每个 Work 的 desired/active 配置版本。恢复 MUST 使用 Work 保存的配置，不得用新的全局默认配置替换已有 Work。正常关闭已经停止的 Work 运行容器 SHALL 按持久运行意图恢复；原本期望 stopped 的 Work SHALL 保持停止。用户、Work、Operation、Session、Run 标识和持久历史 SHALL 保留，恢复不得重新提交历史 Run 或创建重复 Work。

Go 安装 SHALL 使用自身支持的持久格式恢复，不接管旧 TS 安装。异常退出后的恢复 SHALL 先核验残留资源及当前代次；Agent、Service 或文件 helper 尚未完成核验时，内容路由与写入准入保持关闭，不创建第二个有效主 daemon。

已有 Work 的恢复 SHALL 在本安装基础设施和资源归属核验后按各自依赖调度，保持有界并发及同一 Work 控制目标排序。单个 Work 的包/文件/快照/临时资源待清理或恢复退避不得阻止无关 Work 推进；本安装存储或身份整体不可核验时仍安全拒绝。定时恢复 SHALL 不依赖默认环境先进入 ready，也不得因默认配置更新或 Core 重启重置原持久恢复预算。

#### Scenario: Continue after restart with changed defaults
- **WHEN** Work A 使用 model-a，Core 正常关闭后全局默认改为 model-b，再次启动并恢复 Work A
- **THEN** Work A 使用原保存的 model-a，原 Session 和历史可继续查询，不创建重复 Work

#### Scenario: Continue after Core restart
- **WHEN** Core 正常退出前确认停止全部受管 Work，随后使用原数据目录和匹配 Work 卷重新启动
- **THEN** 原有效登录凭证和对象标识保持，期望 running 的 Work 及启用的 Service 恢复，期望 stopped 的 Work 不启动，不要求任何 Work 在 Core 退出期间持续运行

#### Scenario: Recover an incomplete create operation
- **WHEN** Core 在 Docker 已创建 Agent 容器、但 create Operation 尚未终结时异常退出，随后重启
- **THEN** 恢复核对并接管或安全收尾已创建资源，继续或明确失败原 Operation，不创建重复 Work 实例

#### Scenario: Recover before reopening access
- **WHEN** 新进程正在核对 Agent 代次、Service 容器或残留文件 helper
- **THEN** 未完成核验的路由与写入入口保持关闭，安全查询可显示恢复中或具体故障

#### Scenario: 受阻 Work 不阻塞无关 Work
- **WHEN** Work A 等待自身文件或快照收尾，而 Work B 的捕获镜像和恢复依赖有效
- **THEN** A 保持未确认及原栅栏，B 可以完成自身核验并开放；未知资源不被删除，两者都不会产生第二个有效主 Agent

#### Scenario: 恢复遇到较新控制目标
- **WHEN** Work 正在恢复时 Stop、Delete 或 Apply 被接受
- **THEN** 旧恢复不能迟到发布 ready 或覆盖新目标，资源继续按原控制版本、清理与恢复预算规则处理

## ADDED Requirements

### Requirement: Core 重启准备具有可重复的端到端验收

**Identifier:** CORE-STARTUP-LATENCY-001

系统 SHALL 在冻结参考环境下分别验收已初始化安装的整 VM 日常启动和 VM/Docker 存活时的 Core 正常重启。参考环境为 Windows WHPX、2 vCPU / 4 GiB、三个不同且已验收的固定 Agent 镜像版本、一个期望运行的默认脑包 Work 和一个确定性 Service；镜像、成功记录及本地依赖均有效，无外部慢 MCP/模型调用和额外压力。报告 SHALL 包含宿主硬件/磁盘、Windows/QEMU/Docker/Core 及制品版本，不以增配或自动更换已有镜像满足目标。

整 VM 计时 SHALL 从启动器进程启动前开始，包含已有 bundle 校验、VM、Docker 与 Core 恢复；P95 MUST 不超过 25 秒，该预算按所有者明确决定由原 20 秒调整。Core 重启 SHALL 从 Core 进程启动前计时，前一次正常关闭已确认停止受管 Work 容器，P95 MUST 不超过 10 秒。结束点 SHALL 为工作台实际后端请求、当前 Agent 有效响应、浏览器同源 Service 代理预期内容和完整交付就绪均成立的最晚时点；不能用仅 HTTP 监听或 health 成功代替。完整就绪探针仍不保证任意用户 Work 就绪，验收须独立检查参考 Work。

每组 SHALL 至少记录 20 次预先确定的连续尝试，保留所有失败/超时和慢样本，报告逐次耗时、P50/P95/max，使用 nearest-rank 计算分位数；任何失败/超时使该组不通过，不能以追加重试替换。每次有效记录的镜像完整导出与完整扫描 SHALL 均为零，已有效的必要环境探测也 SHALL 为零。验收 MUST NOT 重启 Windows 宿主整机，也不以整机重启作为完成条件；报告 SHALL 区分已验证的 Core/VM 进程重建与未执行的宿主断电或宿主页缓存丢失场景。

首次空安装、升级引入新镜像和旧安装首次建立成功记录 SHALL 各自单独测量准备阶段及完整时间，保持原有有界准备/重试行为；上述 Core 10 秒与整 VM 25 秒预算不适用于这些冷路径，不能用重启结果宣称它们已经达标。Linux/Core 局部验证不能替代修复制品集成到 Windows MicroVM 后的实际验收；未完成实测 MUST 明确标记未验收，不宣称整体优化完成。

已完成上述完整基线后，若后续候选仅修复核验发现的问题，所有者明确选择按已有样本完成定向回归时，系统 SHALL 保留原完整基线、原始新候选采样计划及实际停止原因，以匹配当前制品的真实 Windows 启动结果完成该轮增量复验。每个实际样本仍须核对当前 Core/镜像身份、共同可用结束点及零重复完整导出/扫描和有效环境探测；报告 SHALL 分开完整基准与增量回归，列明实际样本数，不足 20 次的组 MUST NOT 宣称该候选已重新通过 P95 完整基准。采样工具的原完整基准判定不因增量复验而放宽，不能以纯 Linux 测试替代当前 Windows 制品的实际运行。

#### Scenario: 重启参考安装
- **WHEN** 用固定配置分别执行两组至少 20 次正常重启
- **THEN** 全部成功且分别满足整 VM 25 秒、Core 10 秒 P95，逐次零重复全量验收，并从实际 UI、Agent、Service 和探针共同验证结束点

#### Scenario: 整 VM 已正常退出
- **WHEN** 独立测试 VM 正常关闭并确认进程退出后，再次启动同一测试安装
- **THEN** 有效记录仍复用，不重新全量导出扫描；各次耗时、失败和当前恢复验证单独可查，测试不重启宿主整机

#### Scenario: 首次建立或失效后准备
- **WHEN** 空安装首次准备、首次升级建立记录或新镜像首次出现
- **THEN** 分组记录完整检查/加载及恢复耗时和次数，必要检查只按实际唯一键执行，不隐去首次成本或将其计为有效记录命中

#### Scenario: Core 达标而 Windows 尚未通过
- **WHEN** Core 单测或 Linux 基准通过，但匹配的 Windows 集成制品缺失、未测或超出目标
- **THEN** Windows 验收保持未完成或失败，给出实际阶段归属，不能以局部结果宣布整体优化完成或擅自放宽预算

#### Scenario: 所有者选择修复候选定向复验
- **WHEN** 前轮完整性能基线有效，修复候选已集成到 Windows MicroVM 并完成真实启动，所有者明确要求按已有结果收尾
- **THEN** 保留当前已完成样本，正常关闭当前测试 VM 后停止追加启动，按实际数量与制品身份单独记录增量回归判定；原完整基线和失败保留，不以小样本或旧包结果伪称新候选完整 P95 验收
