# Tasks

## 1. 版本化 schema 与 Work Spec 入口

- [x] 1.1 从现有冻结基座及生成覆盖定义增加严格的 V2 manifest/blob schema，保留严格 V1 schema；通过版本化读取描述共用内容模型，同步 Go DTO、oracle 与相关跨语言输出。验证：`make generate`、`go test ./internal/contracts` 和 `node scripts/check-generated.mjs http`，覆盖 V1 不接受新字段、V2 必需字段、版本/magic 不匹配与未知编码。
- [x] 1.2 在 `openspec/specs/portable-work/README.md`、`README.zh-CN.md` 建立 Work Spec 的公开说明入口，按设计解释现有内容分组及 V1/V2 差异，链接现行规范与本变更的未发布状态；从实际 schema 提供相关公开定义和引用闭包。验证：生成定义接受合成合法 manifest 并拒绝缺字段/未知字段，双语含义对应，`node scripts/check-repository-docs.mjs` 通过；不以文档入口重排业务字段。

## 2. 有界 V2 编解码

- [x] 2.1 固定兼容 Go 1.25.5 的纯 Go Zstd 依赖，选取 8 MiB 协议窗口以内的均衡单路编解码起点，落地版本识别与 raw/zstd 窄分支。验证：`CGO_ENABLED=0 go test ./internal/workpackage`，确认无需外部压缩命令、magic 与 manifest 版本严格配对。
- [x] 2.2 实现 V2 存储描述、偏移累计、原始内容摘要与物理包摘要校验；OnBlob 和按 digest 打开的流交付原始字节，V1 只在成功严格解析后归一化。验证：新增合成 raw/zstd 混合包、空 blob、重复内容/多用途和单字节读取往返测试，冻结 V1 golden 文件及摘要保持。
- [x] 2.3 实现单普通帧、无字典、无拼接/可跳过帧/尾随、8 MiB 窗口、精确存储消费与输出长度限制；分别检查物理包、解码总量、恢复逻辑量及原始 metadata 上限。验证：定向损坏/截断/长度与哈希错配/大窗口/超额输出/累计溢出/重复引用负例及大 blob 流式内存测试通过，失败不发布部分成功。
- [x] 2.4 实现一次成功试压后选 raw 或 zstd 的 writer，空 blob 为 raw，编码/I/O/取消失败正常上报。验证：可压缩、不可压缩和零长度合成输入选择正确；用固定的独立标准实现合成帧验证互操作，标准工具解码 Go 输出后与原始哈希相同；将最终字段与帧约束示例补入本组 README，标准工具仅为开发验证依赖。

## 3. 静态校验、helper 与客户端消费者

- [x] 3.1 调整 `Verified.Open` 和 `imagestatic` 的镜像层读取入口，复用已有流式 tar、whiteout、ELF、环境与 diff_ids 校验，不为接口适配整层缓存。验证：`go test ./internal/workpackage ./internal/imagestatic`，同一镜像在 V1、V2 raw/zstd 表示下有相同身份与能力；损坏、越界和大层输入仍按原规则拒绝。
- [x] 3.2 更新 snapshot helper 的 package/history 校验，以及 Core 上传、受理、导入与恢复调用方对原始流/存储大小的使用。验证：`go test ./internal/snapshothelper ./internal/coreapp` 中受影响的快照/历史单测通过，同一个 V1/V2 正反例在各入口得到一致的字节校验结果，OnBlob 暂存的原始内容可直接用于现有恢复。
- [x] 3.3 更新 CLI 与独立 Desktop 的本地 inspect、上传前验证和下载后验证调用点，保持现有文件名和无覆盖落盘行为。验证：`go test ./internal/cli` 的 Snapshot/Transfer/Inspect 相关测试覆盖 V1/V2，安全摘要显示实际 formatVersion 和物理 size/digest；源码注释明确原始流与物理区间的区别，无新增压缩设置界面。

## 4. 导出暂存、物理传输与任务恢复

- [x] 4.1 在原 snapshot job 目录准备编码候选、确定 storedSize，再写 V2 manifest/最终包并完整重验；raw 复用原 blob，候选沿原任务精确清理。验证：定向单测覆盖 raw 回退、编码失败、磁盘失败与取消；压缩错误不会降级成功，不增加任务状态或持久缓存。
- [x] 4.2 统一 Core/CLI/helper 的 Content-Length、X-Piwork-SHA256、snapshot/package 回执、导入幂等比较为实际物理包字节；已有就绪 V1/V2 下载只读原文件。验证：快照下载和受理单测覆盖压缩包长度、完整摘要、重试及同键回执稳定，已就绪 V1 不被后台转码。
- [x] 4.3 将候选与最终文件纳入既有 journal 中断/成功恢复判断，保留未知清理 gate 与所属用户隔离。验证：扩展现有 snapshot recovery/fault 单测，覆盖封装中断与发布后响应丢失；只清理所属 job；在 Work Spec README 中说明同一快照下载稳定性与旧包兼容行为。

## 5. 完整公开规范与官网材料

- [x] 5.1 完成 README 的字段/引用关系、树编码、镜像与历史校验、资源限制、错误、平台依赖及恢复边界，链接同版公开 schema 和 V1/V2 合成夹具；按需要为根双语 README 添加简短有效导航。验证：按文档手工解析一个合成 V2 样例并核对偏移、原始哈希和物理包摘要，运行 schema 示例检查与 `node scripts/check-repository-docs.mjs`，公开材料无真实 Work 内容或凭证。
- [x] 5.2 在官网 `pphboy/pphboy.github.io` 的隔离 checkout 中，仅更新 `piwork/docs/spec/work.md`、`piwork/docs/zh/spec/work.md` 及两份规范索引的直接来源链接，复用同版 README 规则并明确支持/未发布状态。验证：在 `piwork/` 运行 `pnpm install --frozen-lockfile`、`pnpm build`，本地核对两种语言 Work 页、schema/样例链接与原导航；不部署网站，不顺手重写索引中与 Work 格式无关的历史发布材料。

## 6. 跨组件验收与默认策略收敛

- [x] 6.1 构建同版 Core、CLI 与 snapshot helper，并在独立安装/数据目录中执行既有完整快照离线搬迁场景，增加 V1 导入→V2 导出及 V2 再导入/再导出覆盖。验证：`make build`、`make native-helper-images`，运行 `TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations`、`TestNativeSnapshotHistoryRebuildContinuesRealTSSDKSession` 和 `TestNativeCoreExportsCompleteStoppedWorkAndDownloadsSameSnapshot`；验证镜像身份、原始文件/规定元数据、配置/包/历史闭包、stopped 发布及显式 Start 后使用，来源 registry 不可达仍可恢复。
- [x] 6.2 在同版实际 helper 的 512 MiB 限额下验证大压缩层与受限窗口读取，并执行 `TestNativeCoreSnapshotJobsRecoverAcrossActualProcessCrashes`、相关上传中断/容量场景和所属 Desktop 上传下载路径。验证：内存保持有界、无半包/半 Work、同键结果与原包字节稳定，未知清理保留 gate；集成结果明确标记实际执行与未测项。
- [x] 6.3 在相同内容输入上比较纯 Go 默认与候选均衡参数，记录原始/存储/恢复大小、导出/inspect/上传校验/导入耗时、进程或 cgroup 内存及暂存磁盘峰值；选定一个内置策略并同步设计中的实现选择。验证：包含代表性 Agent+FastAPI 内容、大可压缩 blob 和不可压缩内容，原始哈希及功能往返通过；暂不设置固定比例/MB 门槛，测量输出放 `dist/`，提交的必要摘要只含安全统计。
- [x] 6.4 核对 V1/V2 schema、生成物、公开说明与各读写入口一致，执行 `node scripts/check-native-boundary.mjs`、适用生成检查、文档检查、`git diff --check` 及 OpenSpec 变更验证。验证：没有遗漏消费者、未声明字段/设置或新增运行依赖；记录全部实际检查结果，待用户另行要求再同步主规格、归档或发布。
