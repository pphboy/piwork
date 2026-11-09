# Proposal

## Why

现有 `.work` V1 将固定镜像层和其他 blob 以原始字节保存，最小应用的搬迁文件也很大。已授权测量的 FastAPI 样本为 797,636,325 字节，其中镜像层占 99.76%；逐 blob Zstd 实验约为 223,295,367 字节且原始哈希全部一致，说明保持完整离线恢复即可显著减少传输体积。

## What Changes

- **BREAKING**：新增 `.work` V2 封装，新导出默认写 V2；新版严格读取现有合法 V1 和 V2，旧版无法读取 V2。扩展名及 MIME 保持现行约定，不增加用户选择格式的入口。
- 保留现有 manifest 内容模型，仅将 `formatVersion` 设为 2，并为每个 blob 增加必需的 `encoding` 和 `storedSize`。`digest`、`size` 继续描述原始内容；自动选择 `raw` 或 `zstd`，采用一个兼顾体积与速度的内置策略。
- 同步离线 inspect、Core 上传/导出/导入/恢复和 snapshot helper 的流式读取与完整性校验，分别约束存储字节、解码字节和恢复逻辑量。
- 保留镜像身份、依赖、缓存、用户文件、配置和全部保留历史；导入后的内容与运行功能遵循现有契约。既有停止条件、身份映射、幂等、快照下载和清理机制继续适用。
- 为 Work Spec 本身提供模块级 README 和对应官网规范入口，讲清组成、manifest、字节封装、校验和兼容规则，使第三方能据此实现格式读写。此处不是要求每个用户 Work 自带 README。
- 用纯 Go 实现记录代表性样本的体积、耗时、内存与暂存磁盘峰值，再评价默认策略；目前不设置固定 MB 或压缩比例验收线，也不承诺所有 Work 都获得同样收益。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `portable-work`：定义 V1/V2 版本边界、V2 blob 描述和压缩格式、内容身份不变量，以及公开 Work Spec README 与规范入口。
- `work-snapshots`：对两种包格式执行完整有界校验，统一物理大小/摘要语义，并将压缩暂存纳入现有导出及恢复流程。

## Impact

- 格式和静态读取：`internal/workpackage/`、`internal/imagestatic/`；schema/DTO 来源为 `internal/contracts/schemas.json` 的相关定义及 `scripts/generate-http-contracts.mjs` 的现有生成链。
- 运行消费者：`internal/coreapp/snapshot_*.go`、`internal/snapshothelper/`、`internal/cli/user_snapshot.go` 和 `user_desktop_transfers.go` 的本地包读取入口；Core、CLI、snapshot helper 需同步构建。托管浏览器继续传输 `.work` 字节，由 Core 校验，无新增压缩设置界面。
- 依赖：引入兼容项目 Go 版本的纯 Go Zstd 库，保持 `CGO_ENABLED=0` 与宿主无外部压缩程序依赖；具体版本和默认参数在实现时固定并验证。
- 文档：在既有 `openspec/specs/portable-work/` 下提供公开 README，沿现有项目导航及官网规范导航接入；只维护所属规范内容，不扩大为首页重写或架构重组。
- 验证：V1 冻结夹具、V2 合成正反例、流式资源检查、隔离双安装完整搬迁和恢复测试、生成链及文档链接检查。真实 `.work`、凭证和私有内容不进入 Git 或公开样例。
- 本次仅创建规划；实现、主规格同步、官网部署及任何正式发行不在本次执行阶段。
