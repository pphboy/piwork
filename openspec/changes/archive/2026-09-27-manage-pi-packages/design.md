# Design

## Context

动机见 [proposal.md](proposal.md)。当前实现已有可复用的三条边界：`CoreStore` 的持久 Operation 与 Work 写入栅栏；`WorkContextStore` 的不可变 desired/active context；snapshot worker 对完整 `.work` 的停机捕获、校验和原子恢复。

当前 `packages/pi-adapter/src/isolated-resources.ts` 只加载配置中的独立 Skills，extensions/prompts/themes 为空。`PiSdkRunExecutor` 每次 Run 创建并释放真实 SDK session；不能把一个含可变 extension runtime 的 ResourceLoader 在多个 Run 间复用。`apps/agentd` readiness 当前只有 loadedSkills/resolvedTools，Core 还假设自定义工具均来自 MCP。

仓库锁定 Pi SDK `0.86.0`。该版本支持 package manifest、显式本地资源路径、`SettingsManager.inMemory`、`DefaultResourceLoader`、`AgentSession.bindExtensions` 和公开的 `extensionRunner`；原生来源为 npm/Git/local，ZIP 由 Piwork 接入层提供。官方行为依据：[Pi packages 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)；实现以仓库锁定版本为准，不升级 SDK。

## Goals / Non-Goals

**Goals:** 用一个 package 服务负责来源准备与制品身份，Core 包库和 Work context 分别拥有状态；所有 CLI 和 HTTP 路径复用该服务；运行时只消费已冻结的本地制品；完整搬迁不依赖来源可用性。需求索引以 `PKG-*`、`PKGA-*` 及现有 capability ID 为准。

**Non-Goals:** 不调用交互式 `pi install` 修改宿主配置，不给 package 引入另一套 apply，不实现动态 TUI，不把 JS extension 描述为工具权限沙箱，不迁移旧 Work 或旧 `.work`。本次只产出规划；实现阶段的边界由 tasks.md 定义。

## Decisions

### 1. 所有来源归一为不可变制品

`package.json.name` 是生命周期身份，支持 scoped npm name，长度 1–214，匹配 `^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`；禁止 `.`、`..`。缺失/非法 name 拒绝，不用目录名猜测。version 可缺失，公开为 null，不作为内容身份。同 scope 同 name 只能有一个 desired/catalog 记录。

新增 `packages/pi-package`，提供纯数据类型、manifest/资源清单校验、来源语法、树摘要、ZIP 流及不执行代码的制品验证。Core 编排放在 `apps/core/src/packages/`，准备程序为 `apps/package-helper`。不把包的完整 `node_modules` 交给现有 SkillTree 验证器：其大小限制和禁止链接规则不适合 npm。

Source 输入明确区分：

| CLI 输入 | HTTP source | 解析与冻结 |
|---|---|---|
| `npm:@example/pi-tools@1.0.0` | `{kind:"npm",spec:"@example/pi-tools@1.0.0"}` | 记录解析后的确切版本；tag/range 只在本次准备时解析 |
| `git:github.com/example/pi-tools@v1` | `{kind:"git",spec:"github.com/example/pi-tools@v1"}` | 按锁定 Pi 的 Git source 语法解析，冻结完整 commit；公共 HTTPS Git，不接受内嵌口令或新增交互凭证 |
| `./local-package` | `{kind:"upload",uploadId}` | CLI 把本机目录编码为 ZIP 上传，记录 sourceKind=local |
| `./pi-tools.zip` | `{kind:"upload",uploadId}` | CLI 原样流式上传，记录 sourceKind=zip |
| Work `--from-core <name>` | `{kind:"core",name}` | 首次接受事务内读取当前 enabled Core head、租用并记录制品；独立复制，不重新安装 |

API 不接受 Core 宿主目录路径。local/ZIP 安装后删除源目录、上传或 ZIP 不影响制品。ZIP 只接受根目录 package.json 或唯一外层目录下的 package.json；混合多个根包拒绝。local 是当次快照，修改源文件不会热更新；通过显式 update 再捕获。

ZIP 读写采用 lazy/streaming 的 `yauzl` 与 `yazl`，锁定依赖并复用 `work-package` 的流控和树校验模式；读侧开启 strictFileNames、validateEntrySizes，并逐条计数/计字节。参考：[yauzl](https://github.com/thejoshwolfe/yauzl)、[yazl](https://github.com/thejoshwolfe/yazl)。拒绝加密、重复路径、绝对路径、反斜线、NUL、`..` 越界、设备/FIFO/socket 和循环链接。允许制品内部相对 symlink（含 npm `.bin`）；校验完整链，不跟随越界链接。输入硬链接拒绝，准备结果硬链接展开成普通文件。保留文件执行位，去掉 setuid/setgid/任意 uid/gid；根和目录权限规范化。

首版限额固定：上传压缩体 256 MiB、单个来源树及最终制品各自展开 1 GiB、单文件 64 MiB、100,000 个条目、目录深度 64、UTF-8 路径 4096 字节、manifest 1 MiB；每个 Work/default selection 最多 64 个 package，重复 name 拒绝。准备期临时工作卷另设每个 helper 4 GiB 的监测终止阈值，包含 npm 缓存、Git checkout、依赖目录与 staging 副本，不把临时副本计入单制品 1 GiB 限额。与 `.work` 既有总量限制同时生效，任何超限都不得部分发布。

制品摘要覆盖规范化路径、类型、执行位、文件内容和链接目标；不包含时间戳、源机器路径和安装时间。记录 `name/version/sourceKind/resolvedSource/preparedEnvironment/resourceInventory/contentDigest`。provenance 中不存 URL 凭证、本机绝对路径或 `.npmrc` 凭证；resolvedSource 只含安全 npm spec/Git URL+commit/本地显示名。package 原本包含的文件属于用户提供的 payload，不承诺替用户清洗其中的业务秘密。

### 2. 安装脚本只在临时隔离 helper 中执行

Core 安装使用接受时 default-work 所选 agent image；Work 安装使用接受时 desired image。`Dockerfile.agentd` 及 acceptance 变体加入 package-helper 入口、Git 和 CA，保持 Node 24 与 Pi 0.86.0。记录 preparedEnvironment 的 Linux architecture/variant、Node module ABI、Pi SDK version；运行时或 `--from-core` 的目标不匹配则返回 `PI_PACKAGE_ENVIRONMENT_MISMATCH`，不暗中 rebuild。

沿用 `runtime-docker` snapshot helper 的容器归属标签、创建/检查/清理机制，增加三步：受信 init helper 仅初始化专用临时 volume 权限；非 root prepare helper 通过只读 source-input mount 接收受信校验后的请求/ZIP，运行下载和 lifecycle scripts；退出后使用平台固定受信 helper 镜像的 capture helper 只读挂载结果，执行静态树校验并导出到 Core staging。prepare helper UID 10001、drop ALL、readonly root、独立临时 volume/tmpfs、独立出站 bridge，不挂载 Docker socket、Core 数据根、其他 Work、operator/model 凭证或宿主 HOME。capture helper network=none，不执行 package 代码。Core 主进程、CLI、导入 helper 均不运行第三方代码。

prepare 使用 argv 调用 npm/Git，禁止 shell 拼接；禁用交互提示。npm source 先下载确切 tarball 并有界解包；Git 固定 commit 后移除 `.git` 管理目录；local/ZIP 以校验后的根为源。远端来源的已落盘树在依赖安装和复制到结果目录前验证单来源限额，不能只依赖结束后的制品检查；最终制品仍由受信 capture 独立验证。存在有效 package-lock 时运行 `npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund`，否则 `npm install` 同样参数；安装生命周期脚本允许在 helper 内运行。不额外推断 `npm run build`：作者必须交付可加载产物或在安装 lifecycle 准备产物。已有依赖与本机 native addon 不能直接冒充目标产物，helper 重新准备声明的运行依赖。Pi/AI/TypeBox 宿主 API 沿用 SDK 的共享模块绑定；不允许包通过自身 dependencies 覆盖这些宿主 API，要求使用官方推荐 peerDependencies。

helper 按自己正在执行的步骤分类非零退出：npm pack 与 Git clone/fetch/checkout → `PI_PACKAGE_SOURCE_FETCH_FAILED`，npm ci/install（含 lifecycle）→ `PI_PACKAGE_DEPENDENCY_INSTALL_FAILED`。只传稳定枚举和固定消息，经 Docker runtime 的错误码白名单与 Core worker 写入 `stage=prepare` 的 Operation；不解析或转发 npm/Git stdout、stderr、argv、来源路径或凭据。空间超限、截止时间和已有的明确输入错误优先，不能被中止子进程的普通退出码覆盖；非命令步骤的未知故障保留 `PI_PACKAGE_PREPARATION_FAILED`。Core 与 Work 共用此映射，原制品和 desired/active 指针在失败时不变。

错误分类仅帮助定位，不代替成功安装。先在实际 Core 路径重现固定 `pi-web-access@0.31.0` 的 prepare helper exit 1，找出与隔离 helper 单独运行成功之间的环境/编排差异并修复根因；用同一镜像和暂存 Core 跑通 `packages install npm:pi-web-access@0.31.0 --default --wait`，确认 Operation succeeded、catalog head/version 与默认集合。外部 registry 暂不可用时保留证据并重试验证，不能将安全失败码记作成功或在未成功时勾选验收。

单 helper 2 CPU/2 GiB/256 PID，准备总时限 30 分钟；全 Core 最多两个 prepare helper，其余 accepted 作业 durable queued。输入与结果均执行字节/条目限额；prepare 容器运行期间由 Core 对其 owned 临时 volume 周期性计量，超过 4 GiB 即停止该 helper、等待确认退出，再以 `PI_PACKAGE_LIMIT_EXCEEDED` 完成失败和资源清理。计量必须覆盖 npm/Git 中间数据和 lifecycle script 写入；监测采样存在超额窗口，不得宣称为底层磁盘配额或精确的硬上限。只有受信 capture 通过后才形成 immutable artifact。Core 重启先检查归属和退出状态，再继续 capture/publish；helper 丢失或状态不可信则作业明确 failed，不自动重复执行安装脚本。终态后清理容器和临时 volume；未确认退出不得回收输入 lease。

### 3. 状态、存储和默认继承

复用现有 Operation 表的 nullable work_id：Core 包任务 `work_id=null`，Work 包任务绑定真实 Work。新增 `pi_package_catalog`（name、enabled、head artifact、generation）、`pi_package_artifacts`（scope、metadata、immutable path、digest）、`pi_package_uploads`（actor/scope/expiry/digest/lease）、`pi_package_jobs`（operation/source/request digest/captured epoch/phase/result）。所有 owner、scope 和对象 ID 在服务端赋值。

Core 制品目录为 `<data>/pi-packages/artifacts/<digest>/`；Work 制品直接物化到每个不可变 context 的 `packages/<nameKey>/`，其中 nameKey 为 name 的完整 SHA-256，避免 scoped name 成为路径。运行时通过已有只读 `/run/piwork` mount 读取。context `metadata.json` 增加必需 `packageContractVersion:1` 和 `packageBindings`，每个配置项对应 name、digest、preparedEnvironment、inventory、safe provenance；disabled 同样拥有 bytes。context identity 覆盖这些字段和完整树。物理复制可用 reflink，不能把可变外部目录或 Core catalog 路径作为 runtime 引用。

`WorkConfig.packages` 是必需的 `{name:string,enabled:boolean}[]`，按 name 的 UTF-8 字节顺序规范化；空集合为 `[]`。Core default-work 同字段但选中项必须 enabled=true 且 Core catalog enabled。普通 install 发布 enabled=true、默认不选中；`--default` 在同一事务发布并追加到现有集合。Core update 保留 enabled/default 状态；disable/remove 被默认引用时拒绝 `PI_PACKAGE_IN_DEFAULTS`。Core enable/disable/remove 同值重复请求是幂等 no-op（不存在 remove 仍返回 not found）。

创建优先级沿用现有配置合并：显式 CLI package flags > 配置文件 packages > default-work.packages。`--package` 完整替换默认集合，`--no-packages` 明确空集合，不能同用。配置文件允许 enabled=false，仍从 enabled Core catalog 复制完整制品。一次 create 捕获原子的一组 catalog heads，并在复制期间持有 lease；任何缺失/禁用/复制失败整体创建失败。完成后 Work 自己拥有制品，Core 变化不能修改它。

既有 Work 的普通 config set 只能重选已在该 Work desired 中的包并修改 enabled/移除；不能借 config set 隐式 fetch、从 Core 更新或恢复只存在历史 context 的包。新增 name 必须先 install；专用 update 才更换 bytes。无关配置编辑必须保留已有 packageBindings，不能因构造新 context 回到 Core 再取同名包。

### 4. Work 提交、并发和回收

install 成功＝完整制品准备好且原子写入 desired；update 成功保留原 enabled；enable/disable/remove 只改 desired；均不触发 apply。未 active 的 removed 包可从 desired 消失，但 active 和历史 context 继续引用旧 bytes。新 package 不存在于旧 active，状态显示 pendingApply；禁用包存储保留但不加载。

每个 Work 同时最多一个非终态 package install/update，Core catalog 同时最多一个。此锁覆盖未知 name 的来源解析；并发 package 状态写入返回 `PI_PACKAGE_BUSY`，无关配置修改仍可进行。publish 复用 WorkConfigurationService 的 CAS merge（最多 8 次），基于最新 desired 合并本次包变更，保留其他字段。Core catalog 用 generation 条件提交，default set 采用服务端字段合并；不能用 CLI GET→整对象 PUT 实现 flag 修改。

`--from-core` 的线性化点是首次 Operation 接受事务。异步镜像准备与目标环境检查可先做，但事务必须重新读取 catalog 的当前 enabled head，用已检查的目标环境验证该 head 的 preparedEnvironment 兼容性，并在同一事务内增加该 artifact 的 lease、写入捕获的 sourceJson 和 Operation；不能先读 head、跨 `await` 后只租用旧 artifact。Core 在该事务前更新时复制兼容的新 head，禁用、移除或新 head 不兼容时拒绝；事务后 Core 再变化不影响 Work 已捕获副本。幂等 replay 直接返回原 Operation，不重新选择来源。

接受 install/update 时禁止 Work 处于 snapshot/export lock、deleting 或正在 start/stop/apply 的过渡态；running 和 stopped 都可准备。package job 非终态期间 apply/start 拒绝 WORK_BUSY，export 沿用冷快照忙检查；stop/delete 可前进并推进 epoch，使旧 job 成为 superseded、停止 helper，禁止延迟 publish。Core 重启重建 durable 锁和 lease。apply 已接受后，capture 的 candidate 固定；apply 期间新的 desired 修改允许遵循既有语义，但不能启动新 package preparation；更新后的 desired 在旧 candidate 成功后继续 pendingApply。

幂等范围是 actor + core/work scope + verb + key。请求 JSON 的 `idempotencyKey` 仍必需；package CLI 在每次提交时自动生成 UUID，不暴露 --idempotency-key 参数，直接调用 HTTP/client-sdk 的程序仍须显式提供该字段。request digest 含目标 name、来源描述、upload 内容摘要、--default，不包含随机 uploadId。相同 key/相同语义重放原 Operation（包括失败），不同请求返回既有幂等冲突；API 调用者显式重试失败须使用新 key。source 不确定版本也只在首次任务解析。上传资源不是幂等 Operation 身份。

publish 顺序为 staging 完整落盘/验证 → 原子 rename → DB catalog/context+Operation 成功事务；DB 未提交的制品仅为可回收孤儿，不能出现在成功列表。GC 标记 catalog heads、所有保留 context（含 active/desired/history）、非终态 operation/upload lease、export/import staging；只有无引用对象可删除。引用建立/回收使用同一事务栅栏，旧 active 和 `.work` 导出不能碰到悬空内容。

### 5. HTTP、视图和错误契约

新增 JSON schema 放在 `packages/contracts/src/control/pi-packages.ts`，SDK 放在 `packages/client-sdk`，路由继续使用现有 authentication/error envelope。`N` 在路径中是 encodeURIComponent 后的完整 name，只解码一次；禁止直接把 URL name 拼到磁盘。

| Scope | Endpoint | 语义 |
|---|---|---|
| operator | `GET /control/packages`、`GET /control/packages/:N` | 全包库及 default 选择 |
| operator | `POST /control/package-uploads` | binary ZIP；headers 包含 content length、SHA-256、source kind、显示名 |
| operator | `POST /control/packages` | `{source,addToDefaults:false,idempotencyKey}`；202 Operation |
| operator | `POST /control/packages/:N/update` | `{source,idempotencyKey}`；202 Operation |
| operator | `POST /control/packages/:N/enable`、`.../disable`、`DELETE .../:N` | 200 最新视图/删除结果 |
| operator | `GET /control/operations/:id` | 只允许 Core package Operation，不能借此读取用户 Work |
| user | `GET /api/v1/packages`、`.../:N` | 只公开 enabled Core catalog，无内部路径和 digest |
| user Work | `GET /api/v1/works/:W/packages`、`.../:N` | desired/active union 的独立 Work 视图 |
| user Work | `POST /api/v1/works/:W/package-uploads` | 绑定授权 Work 的 binary ZIP |
| user Work | `POST /api/v1/works/:W/packages`、`.../:N/update` | `{source,idempotencyKey}`，source 可额外为 core；202 Work Operation |
| user Work | `POST .../packages/:N/enable`、`.../disable`、`DELETE .../:N` | 同步 desired mutation |

Core default-work GET/PUT 与 Work configuration GET/SET/APPLY 保留路径。default-work PUT 新增严格互斥的 `{patch:{packages,...existingFields}}` 分支，字段省略保留、显式 [] 清空；原完整 `{configuration}` 分支使用最终 V1 schema。flag CLI 用 patch；完整配置文件替换仍按完整 schema 校验。Work flags 复用已有服务端 updateMerged，不能客户端读改写覆盖其他字段。

upload 请求使用 Content-Type:application/zip、Content-Length、X-Piwork-SHA256（64 位小写 hex）、X-Piwork-Package-Source（local|zip）及 X-Piwork-Package-Name（encodeURIComponent 编码的文件/目录 basename，解码后最多 255 UTF-8 字节且无分隔符/NUL）。错误 Content-Type 返回 415，缺失/非法 header 返回 400。upload 返回 `{uploadId,expiresAt}`（201），24 小时过期；服务端校验实际长度和摘要。单次上传总时限 30 分钟、无字节活动 60 秒超时；中断只保留不可见 staging 并清理。接收前鉴权且检查 Work 状态，提交时再次检查；跨 actor/scope 使用 upload 返回不可见对象错误。accepted job 对 upload 加 lease，过期不能清除使用中的内容。不与 whole-Work `/api/v1/work-packages` 复用资源或鉴权。

公开 PackageSummary：name、version|null、sourceKind、enabled、resourceCounts（extensions/skills/prompts/themes）、Core isDefault。Work 视图每行 `{name,desired:null|{version,enabled},active:null|{version,enabled},pendingApply,runtime:{availability:"available"|"unavailable",loaded:null|boolean,diagnostics}}`；show 加 safe resolvedSource 和当前 Operation ID。runtime unavailable 时 loaded=null，不能把历史 loaded=true 当成当前成功。同 declared version 的内容更新仍 pendingApply；内部用 digest 比较，但不暴露 digest/revision/host path。列表按 name 排序。

接受响应为 `{operationId,workId:null|string,correlationId,reused,scope:"core"|"work",kind,name:null|string}`，复用 Operation acceptance 标识，kind=`pi-package-install|pi-package-update` 和 scope；name 解析前允许 null。操作内部 phase 为 queued/source/prepare/validate/publish，外部沿用 pending/running/succeeded/failed/superseded。终态 result 含 name、version、resourceCounts，Work result 说明 pendingApply，不暗示 loaded。失败只公开安全 stage、code、包名及可操作消息，不直接返回可能含凭证的 child stdout/stderr。

在既有 Operation GET 响应上为 package job 增加 `packagePhase`：Core `PiPackageService.operation()` 读取持久 job.phase 后投影；Work `WorkLifecycleService.operation()` 先执行现有 owner 授权，再按 Operation ID 读取所属 package job 并投影。`PublicOperationSchema` 将该字段定义为可选枚举，非 package 操作保持原响应；Core 路径继续按 operator 授权。只公开 `queued/source/prepare/validate/publish/cleanup-pending/succeeded/failed/superseded`，不公开 helperId、sourceJson、命令 argv 或原始日志。阶段来自持久状态，Core 重启后查询结果仍一致；`state` 仍是兼容的对外终态依据。

新错误统一 `PI_PACKAGE_*`，避免 whole `.work` 既有 PACKAGE_*：INVALID_SOURCE/MANIFEST_INVALID/UNSAFE_ARCHIVE/LIMIT_EXCEEDED（400；body 超限 413）、NOT_FOUND（404）、ALREADY_INSTALLED/IN_DEFAULTS/BUSY/NAME_MISMATCH/ENVIRONMENT_MISMATCH（409）。来源失联、脚本失败、制品缺失分别 SOURCE_UNAVAILABLE/PREPARE_FAILED/ARTIFACT_MISSING，异步接受后的失败写 Operation（不把后续失败伪装 HTTP 202 成功完成）。鉴权延续 401/403，未授权 Work 的 404 防枚举；snapshot 锁继续 WORK_SNAPSHOT_BUSY。SDK 加载为 PI_PACKAGE_LOAD_FAILED/RESOURCE_CONFLICT，写入 readiness/apply 的持久诊断。

### 6. 两个 CLI 的确定命令面

全局 `--core`、`--json` 放在子命令之前，沿用现有 endpoint/auth precedence。

```text
piwork-serve packages list
piwork-serve packages show <name>
piwork-serve packages install <source> [--default] [--wait] [--verbose]
piwork-serve packages update <name> --source <source> [--wait] [--verbose]
piwork-serve packages enable|disable|remove <name>
piwork-serve config default-work show
piwork-serve config default-work set [--package <name>]... [--no-packages]
piwork-serve operation show <operation-id>

piwork-cli packages list
piwork-cli packages show <name>
piwork-cli work create --name <name> [--package <name>]... [--no-packages]
piwork-cli work packages list <work-id>
piwork-cli work packages show <work-id> <name>
piwork-cli work packages install <work-id> <source> [--wait] [--verbose]
piwork-cli work packages install <work-id> --from-core <name> [--wait] [--verbose]
piwork-cli work packages update <work-id> <name> --source <source> [--wait] [--verbose]
piwork-cli work packages update <work-id> <name> --from-core [--wait] [--verbose]
piwork-cli work packages enable|disable|remove <work-id> <name>
piwork-cli work config show|set|apply <work-id> [...existing options]
piwork-cli operation show <operation-id>
```

`--from-core` 与位置 source/`--source` 互斥；update 必须显式二选一，不默认重新找已失效本地路径。package flags 空字符串、重复、组合矛盾在 auth/file/network 前拒绝，help 不鉴权。Core install --default 原子追加；default-work set --package 是替换列表；其他 flags 省略不清空字段。Work config set 同样支持 --package/--no-packages，选择该 Work 已安装包并设置选中项 enabled=true，若需保留 disabled 使用完整配置文件或专用 disable。

两个 CLI 的 package install/update 若收到 --idempotency-key，作为未知参数在鉴权、来源文件或网络 I/O 前 exit 2；有效请求仍由 CLI 产生内部 UUID。CLI 等待阶段仅按 Operation ID 观察，不会因重试观察生成第二个请求。该改动不移除 package HTTP/client-sdk 的幂等字段，也不影响其他非 package CLI 命令的既有参数。

未 --wait 时只返回 acceptance，exit 0；--wait 不设置本地总时限，只串行观察原 Operation，每次请求单独限时 30 秒。正常结果每 250 ms 轮询；单次超时、网络暂断及 502/503/504 用从 250 ms 起至 5 秒封顶的退避继续 GET 同一 ID，恢复后回到 250 ms，进度只写 stderr。401/403/404 等确定性无法观察错误 exit 5；Ctrl+C exit 130，输出 waiting 与原 ID/恢复命令，只停止本地等待，不取消后台 Operation。服务端真实终态 succeeded exit 0、failed/superseded exit 6，包括保留的 30 分钟准备安全时限；不可用网络不能触发重新提交安装。operation show 查询成功即 exit 0，即使结果是 failed。JSON stdout 恰好一个 acceptance、最终 observation，或确定性观察失败/用户中断时含原 Operation ID 的 waiting 结果；接受前 syntax=2、auth=3、missing=4、network=5、conflict=6、其他=1。新 Core operation 命令和既有用户 operation 命令分别查询对应端点。

package install/update 的 `--verbose` 只与 `--wait` 同用；两个 CLI 在任何 credential、source file 或网络 I/O 前拒绝单独 --verbose。等待器接受可选的安全进度回调，报告首次 ID/phase、phase 变化、等待时长每 30 秒心跳、暂时观察错误的重试/恢复和终态安全 stage/code；普通重复 poll 不写日志。两个 CLI 将这些进度写 stderr，JSON stdout 继续仅输出最终单个对象。日志字段从 allowlist 构造，不打印第三方输出、helper ID、来源地址/绝对路径、命令参数、credential 或 digest；verbose 也不改变轮询、重试、Operation 或退出码。它用于定位停留阶段，不冒充 npm/Git 原始失败原因；具体 exit 1 仍由 3.8 根因排查。

`work packages` 为 Pi 包管理，既有 `work package inspect <file.work>` 仍为完整 Work 文件检查。用户指南必须给出 npm/Git/local/ZIP → install --wait → config show → apply --wait → package show → tool Run → export/import 的复制可运行示例，并说明更新 Core 不修改旧 Work。

### 7. Apply、SDK 加载和 readiness

沿用现有 configuration apply worker：捕获 desired → 检查 active Run → 停旧 runtime → 以 candidate 初始化 → 验证 readiness → 提交 active；失败保留旧 active、清理 candidate 并按原运行意图恢复旧 runtime。原 stopped Work 也必须初始化验证后恢复 stopped；不能仅把配置指针改成 active。运行中 Run 时拒绝 WORK_BUSY。停止/重启只加载 active；active=null 时沿用首次启动的既有 desired 激活规则，不把已有 active 的 pending desired 顺带应用。

把 isolated resource loader 改成 factory。每次 readiness 预检及每个 Run 的 SDK session 各有独立 loader/extension runtime；初始化使用 in-memory 空 SettingsManager，关闭 cwd/home/project 自动发现，显式指定 context standalone Skills 与 enabled package roots。不调用可能下载远程源的 PackageManager.resolve；使用已冻结本地 manifest 的 SDK discovery。保留 AGENTS override 和现有 system prompt。package manifest 声明资源及约定目录按锁定 SDK 解析，错误 diagnostics 必须提升成 required-context failure；disabled 不执行 extension 工厂。

独立 Skill 的公共 name 继续来自 Core Skill 标识；包内 Skill、prompt、theme 使用 SDK 资源名。加载前检查显式路径/链接都位于当前 context 所有 enabled package roots 内；发现动态 resources_discover 路径同样检查，拒绝 home/project 注入。包间、包与独立 Skill 的同名 Skill，以及同名 prompt/theme/extension command、SDK tool native name 与 builtin/MCP/其他 package 的冲突均失败，不采用 first/last wins。disabled 不参与冲突。资源 inventory 静态完成，extension 注册的 tools/commands 只能在 agentd 执行后确定；安装成功不等于加载成功。

工具策略 canonical key 为 `package:<package-name>:<native-tool-name>`，例如 `package:@example/pi-tools:hello`。新增专用 ToolPolicy key schema，保留 builtin/MCP 旧 key；package tool name 限制 `[A-Za-z0-9_-]{1,64}`，总 key 上限 512。SDK 使用原生 tool name，adapter 建立 canonical↔native 唯一映射，把授权结果转为 SDK tools allowlist；readiness 的 resolvedTools 使用 canonical key。没有冲突前不得覆盖原 registry；disallowed tool 不进入模型工具集合。SDK extension 是 Work 内可信执行代码，可自行访问 Work 文件/网络；此策略管模型可调用工具，不把 extension 代码当受限插件沙箱。

在每个 SDK session 创建后 `bindExtensions({mode:"json",...})`，执行 session_start/resources_discover，再 prompt 以获得 before_agent_start/agent_start/tool_call/tool_result/agent_end 事件。通过公开 extensionRunner 发送 session_shutdown（reason=quit），随后 dispose；dispose 本身不发送 shutdown。当前每 Run 新建 SDK session 的结构保留，因此 session_start/shutdown 以 SDK 实例为边界，不承诺跨 Run 常驻 JS 状态。中止/异常路径 finally 也清理；强杀容器不承诺运行 hook。readiness 只预检 extension 加载/注册与资源冲突，不创建持久用户 Session 或调用模型。每 Run 的 ExtensionBindings.onError/runner error listener 在 bindExtensions 前注册：收集 SDK 吞掉的 handler 异常，session_start/resources_discover 错误在 prompt 前拒绝该 Run，运行期错误即使模型生成了文本也使 Run 以安全诊断失败，禁止只写控制台导致调用者看见伪成功。finally 发送 shutdown 并释放 listener/session；shutdown 错误仅记录 cleanup 诊断，不改写已持久终态。

完整支持 headless extensions、注册工具和事件、Skill、prompt template；themes 验证/保留/discover，不添加 TUI。TUI 专用交互沿用 SDK headless 语义，不额外模拟窗口。已有 Session 与 contextIdentity 绑定保持：apply 后使用新 context 的新 Session；不得让旧 context Session 静默执行新包。

扩展 proto ReadinessResponse（保留字段 1–12）追加 packageContractVersion=1、loadedPackages、packageResources、packageDiagnostics。loadedPackages 含 name、内部 digest 和计数；Core 检查与 candidate enabled bindings 完全相等、无额外包，并校验独立 Skills 与 package Skills 的来源集合、最终工具映射。协议 CONTRACT_VERSION 仍 v2，context version 仍 1；packageContractVersion 必须显式匹配，旧 agentd 缺省 0 拒绝。Core route 只在验证通过后发布；内网 digest 不进入公网视图。

### 8. `.work` 捕获完整闭包并恢复独立所有权

直接扩展最终 `formatVersion:1`（magic `PIWORK1\n` 不变），新字段全部必需，即使没有包也写空集合：顶层 `piPackageArtifacts:[]`；compatibility 增加 `piPackageContract:1`；每个 portable context 的 config.packages 和 `packageBindings:[{name,artifactKey}]`。artifact 表项含 key、name、version|null、treeDigest、contentDigest、preparedEnvironment、safe provenance、resourceInventory。key 为包制品内容摘要；treeDigest 引用现有 tree blob，不引入新 blob 编码。同名不同版本/内容可并存，相同 bytes 去重；每个 context 的 bindings 与 config 项一一对应，包括 disabled。

`packages/contracts/src/control/portable-work.ts`、`packages/work-package/src/codec.ts`、capture/metadata、snapshot helper 的 restore-context 一起修改：遍历全部保留 contexts，收集绑定的完整 package trees 与运行依赖；结合已有 workspace/private volumes、AGENTS、Skills、history、images 形成闭包。保留 package 文件模式、制品内相对 symlink；绝不导出指向 Work/Core 外的链接。物理内容可去重，但解码限额按展开后的逻辑引用量计算，防止小包通过大量引用绕限额。

export 不隐式 apply，允许 desired≠active；只在 stopped、运行实例全部确认停止、无非终态控制 Operation 时接受，并持有现有冷快照栅栏。任一 package 引用缺失、树摘要不符或捕获失败则整个 export failed，不提供部分文件；不能临时 npm install 修复。非终态 package job 是控制 Operation。包管理 API、已接受 job 的 publish 和 GC 均尊重同一栅栏。

import 首先静态验证最终 V1 schema、闭包、digest、链接、资源声明、name/bindings、兼容环境及 existing total limits，再由受信 network-none helper 恢复 owned contexts。不调用 npm/Git，不执行 lifecycle/extension/SDK loader，不查 source URL、目标 Core catalog/defaults；目标 Core 同名包完全无关。沿用现有 image/model/MCP binding 规则，不能把无需 package source 错写成无需模型或外部服务配置。只有 contexts、树、volumes、images、history 和 metadata 全部成功才原子发布新身份 stopped Work；失败清理 staged 资源。

所有 desired/active/history 指针重映射到导入 Work 的内部 context ID，保持图关系和 pendingApply；active=null 保留 null。disabled retained、removed-but-active retained、旧历史版本 retained。导入后 runtime unavailable；启动只使用导入 active（首次 active=null 用既有首次激活规则），显式 apply 才采用 pending desired。恢复后源 `.work`、upload 和 source catalog 都可删除；再次 export 仍完整。`--from-core` 若之后显式使用，含义是当前接收 Core 的 head。

inspect 保持纯本地无执行，增加 summary.piPackages：uniqueArtifacts、contextBindings、enabledDesired、enabledActive 和安全 name/version 列表；`integrityVerified` 仍不表示 runtime 已加载，不能展示 imported loaded=true。

### 9. 验证与实施边界

新增 fixture package 两个版本，包含一个带事件计数的真实 extension/tool、一个 Skill、prompt、theme 和一个 npm 运行依赖；扩展读取结果能区分版本。无业务外部服务，模型使用现有 deterministic integration fixture，但 SDK 工具执行走真实 0.86.0。用本地测试 npm registry、临时 Git HTTP 仓库、目录和 ZIP 生成同一 manifest name/语义的来源矩阵，不要求公共 registry/tag 可变状态。测试 registry/Git 服务须从各 prepare helper 的独立 Docker 网络可达；准备 helper 的网络和脚本测试与 runtime extension 测试分开证明隔离。

单元测试覆盖 parser/schema/ZIP/links/limits/CAS/idempotency/claims；服务集成覆盖鉴权、scope、原子默认追加、在镜像准备异步窗口内 Core head 更新/禁用/移除的 capture 竞争、hook 错误及 Core 重启。Docker acceptance 对四种来源分别完成 Core 与 Work 的真实 worker 安装，共八次来源准入；可复用固定 image、fixture 和 Work，不要求八次各自重复全部生命周期。每种来源验证实际 version/sourceKind、独立制品和来源消失后仍可用；共用的运行链验证真实 SDK 工具与事件、权限/冲突、apply 失败回退、stopped 验证、同版本异内容、旧 Session 绑定。远端来源树超限及脚本写满临时卷的测试须观察及时终止、安全失败码、无状态变更和退出后的资源清理。迁移测试是明确拒绝旧数据，不是 backfill。

本轮补救只新增能证明具体根因及等待恢复行为的定向回归，并以固定版本的真实线上 Core 安装成功为交付门槛；运行 typecheck、build、相关测试和 strict OpenSpec 校验。既有全量门禁已由 10.6 完成，只有修复触及共享行为或定向测试暴露回归时才扩大测试范围；不要为一个线上包重新跑全部 Docker 搬迁矩阵。

verbose 的增量验证限于一个 Core/Work 授权后 phase 投影测试及两个 CLI 的定向输出测试：覆盖阶段变化、30 秒心跳、观察重试、JSON stdout 单值、敏感信息缺席和未带 --wait 的早期 usage 拒绝；不为每个来源重复完整安装矩阵。

跨 Core 搬迁测试先确保待导出 Work 的 retained contexts 实际引用四种来源制品（同名来源可通过不同历史 context 保留，不能在同一 selection 中重复 name），并让至少一个保留的 SDK Session 产生真实 package tool call/history；export 后关闭 npm/Git fixture、移除源 local/ZIP、清除来源 Core catalog，在目标放同名不同内容默认包。导入后启动旧 active，验证 pending desired/disabled/history，并用预期的映射后 context identity 继续执行同一个历史 Session，Run 必须成功；再 apply/re-export/import 到第三 Core，再次继续该历史 Session，Run 仍必须成功。整个链验证四种制品、包依赖和运行持久文件存在，active/desired/history 映射保持、target catalog 不变。历史 Session continuation 失败时，PiSdkRunExecutor/agentd 只增加脱敏阶段诊断，用于区分 resource loader 创建、Session 加载、AgentSession 构造、extension bind、prompt 和 shutdown；诊断不得记录 prompt、tool result、package 内容或敏感路径。不得通过改写/删除 SDK JSONL、替换历史 Session、跳过旧 Session continuation 或接受 MODEL_EXECUTION_FAILED 来宣称迁移成功。坏摘要、缺失 blob、外链、旧 schema、超限、并发 export/package publish、stop/delete fence 都有失败测试。

## Risks / Trade-offs

- [第三方安装代码] → 仅临时 prepare helper 执行；无 Core 凭证/宿主目录，时限/资源限制和退出后受信 capture。出站网络允许来源下载，不承诺安装代码离线运行。
- [包体积大、多个历史版本] → 内容去重和引用 GC，保留所有实际 context 引用，不能靠删除历史依赖降低大小。
- [SDK 自动发现与静默冲突] → 显式路径、隔离 SettingsManager、前置 inventory、required diagnostics、真实 SDK 测试；不做自制 extension ABI。
- [原生依赖跨平台] → frozen image/ABI 记录及兼容验证，不在导入时重编译；不宣称跨 architecture 可运行。
- [异步 job 迟到覆盖配置] → durable lock、epoch、CAS 合并、原子指针发布和 lease；失败/superseded 可查询。
- [readiness 不等于所有事件永不失败] → 预检保证加载/注册，运行 hook 失败仍通过 Run 诊断呈现；不把安装完成冒充 agent 可用。

## Migration Plan

这是用户明确要求的最终 MVP V1 硬修改。新代码 fresh store 使用新增 schema 版本（当前 7 → 8）；启动时在旧非空存储迁移前识别旧版本并返回 `CORE_STORAGE_FORMAT_UNSUPPORTED`，不执行旧 Work backfill，不删除用户数据。空库走现有建表链后建立新增表。旧 context 缺少 packages/packageContractVersion、旧 `.work` 缺少必需字段均明确拒绝；不能给解码器加默认 `[]` 伪装兼容。

部署时同步发布 contracts、Core、两 CLI、agent image 和 snapshot/package helper；更新默认 agent image，使用新 V1 数据目录。无 package 的新环境仍显式写 packages:[]。回滚按整套 binary/image 和对应独立数据目录恢复，不让旧代码读取新数据；不存在双读、自动迁移或旧 `.work` 转换。本 change 不执行部署或清空已有环境。
