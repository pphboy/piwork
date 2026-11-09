# Design

## Context

动机与范围见 [proposal.md](proposal.md)。当前 `portable-work` 的 PWORK-001 和 PWORK-WIRE-001 只定义 V1；`work-snapshots` 的 WSNAP-002 同时限制传输与恢复量。设计必须修改这些现行契约，而不是把压缩字节冒充合法 V1。

已核对的实现事实：

| 来源 | 当前职责与约束 |
| --- | --- |
| `internal/workpackage/codec.go:86–199`、`manifest.go:54–79` | 只读 `PIWORK1\n` 与 `formatVersion=1`；按原始 `size` 计算偏移、包大小并验证每个 blob |
| `internal/coreapp/snapshot_capture.go:32–43,198–235,282–324` | 按原始摘要去重，收集未压缩镜像层，在 job 暂存目录生成并重验包 |
| `internal/workpackage/inspect.go:49–108` | blob 与镜像层消费者直接依赖文件的原始字节偏移 |
| `internal/imagestatic/portable.go:14–54`、`layers.go:209–311` | 入口使用 ReaderAt，实际 tar/镜像身份校验已经按流执行 |
| `internal/coreapp/snapshot_import_worker.go:293–314` | OnBlob 将原始内容写入既有内容寻址暂存，再校验环境并恢复 |
| `internal/snapshothelper/history.go:388–403`、`internal/dockerengine/snapshot_helpers.go:125` | helper 重验包与历史，运行内存限额为 512 MiB；不能把大镜像完整放进内存 |
| `internal/cli/user_snapshot.go`、`user_desktop_transfers.go` | CLI 和独立 Desktop 复用 `workpackage.Inspect`；托管浏览器传输字节，Core 承担格式校验 |
| `internal/contracts/schemas.json`、`scripts/generate-http-contracts.mjs:21–48` | schema 是冻结基座与当前覆盖定义的混合生成链；V1/V2 变更须从实际来源同步 DTO 和验证夹具 |

2026-11-09 的只读内容分析与获授权导出测量已完成；源 Work 在测量后恢复 ready。记录仅保留不含内容的统计：

| 同一真实样本 | 字节 |
| --- | ---: |
| V1 原包 | 797,636,325 |
| 原始镜像层（33 个） | 795,727,872 |
| 整包 Zstd CLI 1.5.7 等级 3 | 223,440,843 |
| 整包 Zstd CLI 1.5.7 等级 7 | 205,417,351 |
| 逐 blob 等级 3，含原 manifest、未含 V2 新字段 | 223,295,367 |

111 个 blob 的解压哈希全部一致，其中 10 个采用 raw 更合适。这是压缩封装实验，不是 V2 Core 导入、纯 Go 性能或通用压缩率验收；真实包、身份和凭证不作为提交夹具。原始临时统计位于本机忽略的 `dist/work-size-study.*/`，规划不依赖该目录永久存在。

## Goals / Non-Goals

**Goals:**

- 用同一套原始内容校验与恢复逻辑消费 V1/V2，格式差异集中在包读写边界。
- 通过逐 blob 压缩减少传输文件体积，保持原始内容身份、完整闭包和离线恢复。
- 为 Work Spec 提供可独立阅读的公开入口；必要的 schema、字节约定和合成夹具能从入口定位。

**Non-Goals:**

- 不改变安装后持久数据布局、Work 运行行为，不精简镜像构建、缓存、依赖或历史；不引入联网补内容、增量包或跨包共享存储。
- 不新增用户压缩选项、格式选择、通用 codec 插件、字典管理、后台重压缩或旧包转换命令。
- 不重组 manifest 的业务字段，不重命名整套实现模块；不把 Work README 变成每个用户 Work 的必需文件。
- 本变更实现可准备官网规范修改及本地预览；对外部署和正式发行由后续明确发布指令驱动。

## Decisions

### 1. V2 只扩展存储描述

顶层使用 `formatVersion=2`；除 `blobs` 外，manifest 的内容关系与现有语义保持。V2 blob 的精确字段集合为 `digest`、`size`、`kinds`、`encoding`、`storedSize`，五项均必需。`encoding` 仅为 `raw` 或 `zstd`；`size` 和 `digest` 始终描述解码后的原始字节，`storedSize` 描述物理包内区间。

```text
PIWORK2\n | uint64_be(manifest_length) | UTF-8 JSON | blob[0] | blob[1] | ...
                                      digest-sorted stored payloads

blob[i] -- raw / zstd decode --> original bytes -- SHA-256 --> digest
```

manifest 使用现有 canonical JSON 写入方式，不压缩；原样本头与 manifest 仅 20,067 字节。偏移由 `16 + manifest_length + 前序 storedSize 之和` 推导，不增加 offset 索引。包摘要继续计算实际物理包的全部字节，不增加 compressedDigest；HTTP、下载、幂等比较及 helper 回执使用该物理摘要和物理大小。

选择逐 blob 而非整包压缩：该样本体积几乎相同，逐 blob 保留按摘要定位内容的能力，避免为了校验某个镜像或文件先展开整包。保持原始摘要可直接复用镜像 diff_ids、文件树和 Pi package 内容关系；按压缩字节换内容身份会扩大变更，故不采用。

### 2. 固定可互操作的 Zstd 子集

V2 的每个 `zstd` blob 恰好包含一个普通 Zstd 帧，无外部/预置字典、拼接帧、skippable frame 或尾随字节。允许标准帧可选的 content size 与 checksum；存在时也须验证，缺省时仍以 manifest 原始长度和 SHA-256 完整校验。帧 header 与块边界检查只限定上述封装约定，实际解压复用库，不自行实现压缩算法。格式依据为 [RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html)。

本提案将协议允许的最大解码窗口定为 **8 MiB**，是容纳均衡压缩策略并为既有 512 MiB helper 保留余量的技术默认选择。writer 不产生更大窗口，reader 在分配对应资源之前拒绝超限窗口；single-segment 帧按其实际窗口含义检查。这个上限是协议约束，不等同于进程总内存限制。实现在此范围内调节编码参数，纯 Go 实测不改变此接口；如必须改变协议上限，先同步本变更规格与公开说明。

选用 `github.com/klauspost/compress/zstd` 的兼容 Go 1.25.5 的固定版本，起点为库的均衡默认等级、受限窗口及单路编解码。按实际 Go 结果调整一个内置策略；不把 C CLI 等级或时间直接当作 Go 参数/指标。仍以 `CGO_ENABLED=0` 构建，不调用宿主 zstd/gzip。

当一次成功压缩的结果不小于原始数据时，writer 使用 `raw`；空 blob 使用 `raw,size=storedSize=0`。raw 回退是体积选择，不把压缩失败、I/O 错误或取消掩盖为成功。不要求不同库版本生成字节相同的压缩结果；已经发布的同一快照必须复用原文件，保证下载重试字节稳定。

### 3. 版本校验先于内部归一化

V1 magic 只配 V1 manifest，V2 magic 只配 V2 manifest；已识别版本不匹配返回 PACKAGE_INVALID，未知版本/编码返回 PACKAGE_FORMAT_UNSUPPORTED。V1 继续拒绝缺少既有字段、未知字段和非法引用，不将新的 optional 字段直接加入 V1 schema 来放宽旧格式。

各版本先执行独立严格 wire schema 校验，再生成共用读取描述。V1 内部视为 raw 且 storedSize=size，但源文件、manifest 记录、物理摘要及 formatVersion 不改写。V2 新字段缺失不得补默认。共用的内容、树、包、镜像和历史验证继续消费原始字节，不复制一套 V2 业务恢复逻辑。

保留冻结 V1 golden 文件与字节身份；生产新导出只写 V2。若旧单测依赖 V1 写入器，限定其用于冻结夹具验证，不提供产品旧格式导出开关。history schema、storage layout、agent protocol 与 package contract 均不因封装升级而变更。

### 4. 共享有界读取，适配现有消费者

包 reader 按 storedSize 构造严格的存储区间，raw 直接读取，zstd 经有界解码器读取。先检查长度加法及限制；实际输出超过 size 立即失败，输出不足、帧未结束、区间未精确消费或 SHA-256 不符也失败。OnBlob 接收原始内容流，保持既有原始 blob 暂存与恢复职责。

`Verified.Open` 保留“按 digest 打开原始 blob”的窄接口，但实现必须理解 encoding。镜像校验改为消费可打开的原始层流：将 `imagestatic` 已有 applyLayer 的流式 tar/白化/ELF/环境校验主体复用到压缩包路径，原 Engine archive 入口继续通过原始 section 提供流。必要的重复验证允许重新打开对应 blob，不建立持久解压 cache、不为 ReaderAt 接口把整层缓存在内存。

导入已经需要原始内容寻址暂存，可直接复用 OnBlob 的写入结果供后续还原；离线 inspect、上传及 helper 校验不提前建立可见 Work 或运行包内代码。独立 Desktop 和 CLI 使用同一包库，托管浏览器仍由 Core 校验。

### 5. 资源与临时文件沿既有边界管理

V1/V2 的物理包大小至多 100 GiB；对 V2 额外检查 `16 + manifest_length + sum(size)` 不超过 100 GiB，保留原先对全部未压缩 blob 的上限。文件恢复逻辑量仍按跨树引用累计、同树硬链接一次及去重镜像层累计，最多 100 GiB。metadata 64 MiB 单份/256 MiB 累计等既有限制按原始字节检查。数字须为安全非负整数，逐项检查累计溢出。

导出在现有 job 目录捕获原始 blob，再逐项生成压缩候选，确定真实 storedSize 后写 manifest 与最终包。raw blob 直接复用原暂存，不复制同一份 raw 候选；候选文件只属于该 job。完成后重读最终物理包并校验原始内容，仍在既有成功发布事务之后提供下载。

原始暂存 U、保留压缩候选 C 和最终包 P 可能同时存在，磁盘峰值至少需按 U+C+P 加现有镜像 save 临时量实测，不能用最终文件大小推断。取消、磁盘失败和崩溃走原 journal/精确 job 清理，不增加后台压缩队列、重试状态机或自动重放。原 30 分钟任务预算和转移限制保持。

### 6. Work Spec README 与官网使用现有入口

实现时在 `openspec/specs/portable-work/README.md` 与 `README.zh-CN.md` 提供对应英文/中文入口，主规格仍按现有 Requirement/Scenario 维护。README 讲清 Work、Spec/manifest、Package、Instance 的关系；逐组解释内容字段、完整闭包、原始摘要与编码、V1/V2 framing、限制、恢复/平台边界，并链接完整 schema、树格式、history schema 和合成样例。README 与官网不是另一套独立规则来源。

以现有 schema 生成 V1/V2 的可公开机器可读定义到 `internal/workpackage/schema/`，由公开 README 链接；生成流程不覆写 OpenSpec 主规格或冻结证据。只为相关定义与引用闭包提供明确输出，不导出整个内部 HTTP catalog，不建立通用文档生成平台。公开样例来自 `internal/workpackage/testdata/` 的合成夹具，包含 raw/zstd 以及相应失败示例说明，避免读者需要研究 Core 数据库才能知道字节格式。

已从官网仓库公开 main 树核对到：`pphboy/pphboy.github.io` 的 `piwork/docs/spec/work.md`、`piwork/docs/zh/spec/work.md` 已有 Work 规范页，两份 `spec/index.md` 与 `.vitepress/config.ts` 已提供并列 Work/Service/Harness 导航。更新现有 Work 页及其规范来源链接即可；不刻意增加“模块地位”文案。网页文案从同版公开 README 适配，只调整站点链接与布局。根 README 仅按需要增加简短有效导航。

官网当前页面还明确写 V1 无压缩，须与支持版本同步；新内容在实现验证前标为提案/未发布，不能把规划当作已支持。当前环境无官网本地 checkout，实现阶段使用该仓库的隔离 checkout 仅修改上述 Work 规范页面及直接链接，执行其 `piwork/package.json` 的 VitePress build 并本地核对。部署为后续独立动作；本变更的代码 apply 不自动发布官网或 Core。

### 7. 责任、同步与验证

| owner | 修改/同步对象 | 必要验证 |
| --- | --- | --- |
| contracts | V1/V2 wire schema、相关生成 DTO/oracle；`make generate` 现有链 | `go test ./internal/contracts`、生成一致性和严格版本反例 |
| workpackage / imagestatic | V2 编解码、原始流、镜像静态校验、V1 兼容 | golden/损坏/边界/单字节流、跨实现压缩夹具、内存有界测试 |
| coreapp / snapshothelper | 导出暂存、上传/受理/导入/恢复各读取点、物理回执 | 对应单测、真实 helper 512 MiB 运行、离线双安装搬迁和原 job 崩溃恢复 |
| cli / Desktop | inspect、上传前验证、下载后验证、原文件命名与摘要 | `internal/cli` 单测及现有 Desktop 上传下载集成 |
| 构建 | Core/CLI/snapshot helper 配套构建、Go 依赖锁定 | `make build`、helper 镜像构建、native boundary；不为压缩重建用户固定 Agent/Service 镜像 |
| 公开说明 | portable-work README、schema/样例、现有官网 Work 页与来源链接 | repository-docs、双语/示例/schema 一致性、官网本地 build 与链接核对 |

验收复用现有 `TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations`、`TestNativeCoreSnapshotJobsRecoverAcrossActualProcessCrashes`、`TestNativeCoreExportsCompleteStoppedWorkAndDownloadsSameSnapshot` 与相关历史/上传测试。新增内容只覆盖压缩引入的行为，不把测试基础设施重写成独立项目。真实模型调用、首页 UI 重做、发布验证不属于本轮实现必需项。

## Risks / Trade-offs

- 解压增加 CPU 和重复读取成本 → 使用单一均衡策略，记录真实 Go 导出/inspect/上传验证/导入耗时；保留必需重验，不为一次快测增加永久 cache。
- 解码器缺省可能接受额外帧或申请过大窗口 → 用 V2 明确子集、库资源选项和合成负例约束；解压窗口与输出量分别限制。
- 暂存增加磁盘写入 → 沿现有 job 生命周期收口候选与最终文件，记录磁盘峰值及取消/磁盘失败后的清理结果。
- CLI/Core/helper 版本混用 → 同版构建验证，旧读取器拒绝 V2；不静默回退内容、重新安装依赖或在下载时转码。
- 文档与实际 parser 漂移 → 从真实 schema 提供公开定义，以合成 V1/V2 夹具核对 README 和官网示例；不公开真实 Work。

## Migration Plan

1. 保留 V1 夹具，新增 V2 schema、读写器及全部消费者支持，完成隔离验收后再交付配套 Core/CLI/helper。
2. 新受理 export 默认产生 V2；已经就绪的 V1 upload/export、同键回执与下载继续使用原文件。旧未完成 job 仍依既有恢复规则处理，不在升级时自动重压缩。
3. V1 导入后再次显式导出产生 V2，内容与受管身份映射继续遵循既有契约。
4. 回退旧软件前保留数据与包备份并完成快照/清理 gate。旧软件不能使用 V2 包；本变更不承诺 V2→V1 转换或自动降级，Work 自身的原始存储布局未因压缩改变。
5. 在支持版本明确后同步官网规范内容；官网部署与正式发行按后续授权执行。

## Open Questions

- 在兼容项目 Go 版本、8 MiB 协议窗口与既有 helper 限额内，固定哪一版纯 Go 库及哪一个均衡编码参数组合最合适，由专项实测决定，不改变格式或任务划分。
- 原始/压缩/恢复大小及完整流水线数据收齐后再评价收益；用户明确暂不设硬比例或固定 MB 门槛。任何新门槛须依据实际结果讨论，不能把此前单样本 72% 写成通用承诺。


## 实现选择与当前验证（2026-11-09）

- 固定纯 Go `github.com/klauspost/compress` v1.18.0，SpeedDefault、8 MiB 窗口、单路编解码；wire schema 分为严格 V1/V2，共用内部内容 DTO。
- 同一真实样本原始包 797,636,325 字节，Go V2 为 219,235,146 字节，完整 inspect 通过。准备候选约 3.322 秒、编码并校验约 1.263 秒、inspect 约 3.161 秒；测量进程 VmHWM 57,528 KiB。候选与最终文件同时占 438,445,470 字节；这是编解码测量，不含整次 Core 捕获的额外镜像 save 暂存与导入运行峰值。
- 独立编码策略对比：SpeedDefault payload 219,211,099 字节、2.388 秒；SpeedBetterCompression payload 201,954,715 字节、3.501 秒。选均衡默认，计时包含读取/编码并受宿主状态影响，不是性能 SLA。
- 已执行 make generate、HTTP 生成一致性、workpackage/imagestatic/contracts/snapshothelper 单测、CLI 单测、Core Snapshot 定向单测、native boundary、文档边界；完整 Core 单测存在 `TestCustomOperatorRejectsUnsafeFilesAndParentsWithoutChangingThem/public` 失败，隔离 HEAD 基线同样复现，不因本变更修复该无关行为。
- make build 在本机因上层空 `.git` 目录导致 Go VCS 探测失败；对本次命令显式设置实际 GIT_DIR/GIT_WORK_TREE 后构建通过。helper 使用本机 Go 模块缓存的 loopback proxy 构建测试镜像，宿主运行仍不依赖该代理。
- 官网隔离工作区位于忽略的 `dist/work-spec-website/`，中英文 Work 页与直接来源链接已修改，pnpm frozen install 和 VitePress build 通过，未部署。可审阅修改保留为本变更 evidence/website-work-spec.patch。
- 完整隔离 Core 搬迁、崩溃恢复和 helper 资源验收仍在核对，未以编解码测量代替通过，也未勾选相关任务。


### 上轮集成阻断与资源收尾（现已解除）

完整快照测试在导出前的默认脑包准备阶段失败：defaultContext 为 CONTEXT_PREPARATION_FAILED，内部原因是 Docker resource state is unconfirmed。将同一诊断置于未修改 HEAD 的隔离源码中，得到相同错误；现阶段不能用该环境完成搬迁/崩溃恢复验收，也不能声称 V2 Core 端到端通过。已停止反复等待同一前置条件的测试，并用既有 integrationcleanup 对本次记录的 4 个精确测试 scope 完成清理，未清理其他安装或镜像。

作为独立已完成验证，同版 snapshot helper 在 network=none、read-only、cap-drop=ALL、memory=512m 下成功执行 verify-package，验证完整真实 V2 包、静态镜像和私有历史。官网隔离预览构建通过；公开修改补丁和不含用户内容的 Go 测量摘要归本变更 evidence。上轮仍有 7 项任务未勾选，保留了完整端到端验收及资源/事务覆盖的实际要求。


### 本轮完整验收（2026-11-09）

- 确认上轮两个失败同源于 shell umask=0077：权限负例请求的 0644 被收紧为 0600，脑包输入也因此不可被容器 UID 10001 读取。本轮仅在验证命令设 umask 0022，生产权限校验未放宽。六个相关 Go 包（含完整 coreapp、cli）单测通过，权限基线失败解除。
- 旧缓存验收 Agent 缺少当前 SessionManagement RPC。使用现有 Dockerfile 从当前源码重建 acceptance 镜像；原 npm 镜像源未推进时改用官方 npm registry 完成构建。用户运行安装及固定镜像未替换。
- 新版完整 Core 导出/原快照重试/恢复字节、真实 TS SDK 历史搬迁、V1 输入与 V2 输入各自离线跨安装搬迁及再次导入、实际 Core 进程崩溃恢复、上传取消/鉴权撤销/容量测试全部通过。主集成批次 441.536 秒，V1/V2 搬迁子用例分别 160.07/161.58 秒；属于定向 partial 验收，不宣称全仓 integration inventory 已运行。
- 按源 manifest 的编码定位原始流，避免目的封装描述（例如测试中的 V1 fixture 转换）影响源 V2 解码；使用既有 digest 排序二分定位，不增加大型索引副本。新增互转回归通过。磁盘写失败保持原 ENOSPC 原因，不被解码错误覆盖；body 写入故障和候选归属清理测试通过。
- CLI/Desktop 的完整本地检查/上传/原快照下载路径已扩展为 V1/V2 两种合成包测试；公开 V2 合成包使用可完整 offline inspect 的 native fixture，包含标准库独立互操作用例。
- 新增独立 FastAPI 测量用例复用集成运行器既有 fastapi-htmx-workstation-fixture，无新可选跳过门槛；在现有资源清单登记并按 Performance 规则独占运行。该测试完整 export/download/inspect/upload/import/显式 Start，并核对随机文件和 FastAPI ready。
- FastAPI 合成流程记录：物理包 219,559,318 字节，恢复逻辑量 827,078,371 字节，导出 13,346 ms、inspect 3,326 ms、上传及双端校验 7,099 ms、导入 11,293 ms，Core 测试进程峰值 RSS 177,856,512 字节，job 暂存采样峰值 1,434,610,056 字节。此工作负载含随机文件、约 26 MiB 重复内容及 Agent/FastAPI 两份镜像，和前述真实样本不是同一个输入；耗时/峰值是本机实测而非 SLA。单独流程测试 54.014 秒通过。
- 全部测量只记录安全统计，详细合成测试日志位于忽略的 dist；源码编译仍关闭 CGo。官网仅准备本地规范修改及其 patch，未发布网站或 Core，未同步/归档主规格。


### 最终一致性与边界

公开 JSON schema 已归属 `internal/workpackage/schema/`，公开 README 与官网均链接到该实现交付目录，现有生成检查继续禁止覆写 OpenSpec 主规格、归档证据和发布身份；生成检查自身的 14 项脚本回归通过。新增性能验收复用既有 FastAPI fixture，未增加默认跳过项。写入器还在输出包头前检查原始解码总量，并保留底层磁盘写失败原因。验证入口均使用 umask 0022；宿主正式构建在必要时显式指定当前 worktree 的 GIT_DIR/GIT_WORK_TREE。

最终完成的是本变更的定向实现验收：既有相关单测、版本化恢复/CLI/Desktop 回归、五项核心集成（含两个迁移子用例）、独立 FastAPI 完整性能流程、512 MiB helper 验证、生成/边界/文档/风格与严格 OpenSpec 验证。未将定向运行描述为全仓所有测试或外部发布。测试资源仅按本次 ledger 精确清理；未部署用户运行实例、官网或新正式版本。


最终 18/18 任务完成。最后一轮 make build、make native-helper-images、六包 Go 单测、公开 V1/V2 夹具/固定独立 Zstd 帧验证、生成一致性、14 项生成/集成调度脚本检查、native boundary、文档/增量风格、git diff --check 与严格 OpenSpec 验证通过；最终 helper 镜像在 512 MiB 限额下再次 verify-package 成功。本次 ledger 的 17 个精确 scope 已确认清理完成。源码和官网隔离修改均未提交、未发布，官网修改保留为所属 evidence patch。


### 两项 verify WARNING 的局部修复

- 源长度回归（DEFECT）：Encode 在成功消费声明存储区间后，再从该源项探测一个字节，要求真实 EOF；多余字节返回 PACKAGE_INVALID，探测读取错误原样传递，所有路径仍关闭源项。新增 V1 raw、V2 raw、V2 zstd 三种超长源回归与 EOF 探测 I/O 错误回归；先确认旧代码失败，再确认修复通过。源区间和原始哈希检查均保留，没有新哈希、重试或状态机制。
- 规范说明缺口（DEFECT）：中英文 Work Spec README 补齐 tree version=1 的公共字段、四种精确变体、mtimeNs 字符串、权限位范围、标准 Base64、解码路径字节排序、父目录与硬链接约束，并提供同一个完整 JSON 示例。直接链接既有控制历史和身份映射 schema 清单，保留组件特有校验。两份文档中的树示例通过真实 ValidateTree 验证，不新增格式、schema 生成平台或用户配置。
- 官网隔离 Work 页面同步上述说明，VitePress 构建通过，evidence/website-work-spec.patch 已更新，未部署。
- 本轮验证：workpackage/imagestatic/contracts/snapshothelper/cli 单测、Core Snapshot 定向单测、make build、native boundary、repository-docs、增量风格与 git diff --check 通过；实际 Core 导出/重复下载/导入恢复的集成用例 49.394 秒通过，本次精确测试 scope 清理确认完成。原始超长源复现程序现在对 V1、V2 raw 都返回失败；定向核对确认两项 WARNING 已处理。其余完整搬迁与崩溃验收沿用前轮记录，本轮未宣称重跑全仓集成。
- KEEP：既有完整性、兼容及公开规范义务。SIMPLIFY：单字节 EOF 探测与文档字段表/小型示例，未扩大产品范围。

### 主规格同步与归档（2026-11-09）

- 按所有者指令将 portable-work 与 work-snapshots 的 5 条修改、3 条新增要求同步到主规格，保留未触及要求和既有场景；逐项比较确认无待应用 delta。spec-driven 规划完整，18/18 任务完成，变更严格验证及本变更归档检查通过。
- 51 份主规格严格验证通过；全量历史归档检查为 90/92 通过，另两份既有归档 `2026-10-13-simplify-docker-release-and-quickstart`（40/41）与 `2026-10-13-support-cross-platform-cli-and-default-desktop`（23/32）仍有未完成任务，两者相对 HEAD 未改动，不属于本变更。
- 双语公开说明改为链接当前主规格与本归档；官网隔离页面同步，VitePress 本地构建再次通过，补丁随本归档保留。文档边界、native boundary、增量风格、HTTP 生成一致性及 14 项生成/集成调度脚本检查通过。归档与提交不包含官网部署或正式发行。
- 提交前以首个实现提交的测试内容进行 overlay 检查，workpackage、imagestatic、contracts、snapshothelper、完整 coreapp 与 cli 六包单测通过（coreapp 81.783 秒）；跨组件 integration 测试编译通过。完整 Docker 流程沿用前述已通过记录，本轮没有重跑或扩大为全仓验收。所有者另行要求的原端口本机预览继续运行，未作为正式发行。
