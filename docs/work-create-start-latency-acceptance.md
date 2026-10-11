# Work 创建与启动延迟验收

日期：2026-10-11。对应变更：`reduce-work-create-and-start-latency`。本记录描述本机未发行构建的实际结果；已发布 Docker 制品和发行身份没有修改，不能将这些性能结果视为旧公开镜像的结果。

## 构建与参考条件

- Git HEAD：`5818e1de7bb5af9bd6305777fc88b40505a708b3`；实现工作区为 modified。基线 Core 在实现前保存，当时 Git 只报告未跟踪的 OpenSpec 规划；基线及当前二进制的实际摘要、本机 Git 事实和具名源码快照分别保存在本机 provenance 记录，不将事后源码 hash 冒充原编译输入。
- Go 1.25.5，Node 24.21.0；测量 Core / CLI 为 Linux amd64、`CGO_ENABLED=0`。
- Linux / WSL2，AMD Ryzen 9 7945HX，32 逻辑 CPU，16,330,420,224 字节内存，Docker `overlay2`。
- 使用既有 production Agent：镜像大小 575,027,216 字节，history schema 5。基线和当前构建均使用该既有镜像，没有重建 Agent。
- 默认脑包、本地内置 MCP、Agent 1 CPU / 768 MiB；合成模型配置，仅初始化，不提交模型 Run。热路径顺序采样时没有并行启动本轮压力任务；宿主其他安装保持原状。
- API 各 20 样本，当前 Desktop 20 样本；包含 Core 预热后的第一个 Work。每个创建成功后停止并删除测试 Work，最终逐一核对 installation 标签并清理本轮资源。

## 默认路径结果

| 指标 | 基线 P95 | 修改后 P95 | 参考目标 |
| --- | --- | --- | --- |
| HTTP 创建请求到接受响应完成 | 7,133.83 ms | 19.39 ms | ≤ 1,000 ms |
| 接受响应完成到查询确认真实 Ready | 9,890.80 ms | 2,664.00 ms | ≤ 3,000 ms |
| HTTP 创建请求到查询确认真实 Ready | 16,943.03 ms | 2,681.12 ms | 单列实际全过程 |
| Desktop 点击创建到列表及面板确认可用 | 未单独采样 | 5,067.70 ms | ≤ 6,000 ms |

基线和当前 API 各 20 次成功，当前 Desktop 20 次成功，无失败样本。当前浏览器最大值 5,106.27 ms；API 接受后 Ready 最大值 2,856.91 ms。没有舍弃慢样本或用重提交替代失败。

API 使用同进程单调计时，Ready 通过至多 100ms 周期的独立只读查询确认。接受响应完成和持久提交不是完全相同的时刻，因此另按同一 Operation 的服务器 `acceptance` 与 `activation` 事件核对全部 40 次创建的差值；该交叉核对也满足三秒目标。阶段耗时本身由 Core 单调时钟计算，服务器 UTC 标记用于关联，不把 Agent 日志转存时间当作原始初始化时间。

当前完整热路径的完整镜像检查增量为 **0**，环境探测增量为 **0**。旧 Core 没有新计时事件，基线准备次数记为 `null`，没有把缺少记录写成零。socket 测试另直接验证 ImageSave 次数及命中不等待无关扫描。

单次 Core 初始准备观察值为基线 27,688.75 ms、当前 10,385.67 ms；保留数据后单次 Start 为基线 9,510.30 ms、当前 2,151.29 ms。这些是单次补充事实，初始准备期间负载条件可能不同，不当作独立 P95 或严格冷启动性能对照。

## 默认预算之外的边界场景

真实 integration 夹具另验证了八个并发调用者使用同一未准备的本地镜像：完整镜像检查和实际环境探测各一份，没有重复执行。20 MiB 合成包与强制 1,500ms 初始化延迟的 stdio MCP 分别创建成功，仍未额外执行镜像级准备；这些场景只记录自身阶段时间，不混入默认 P95，也不宣称缺失镜像的联网拉取已经测量。

同一慢 MCP 配置还用于 Starting 期间受理 Stop：旧创建 Operation 最终 `superseded`，Work 为 `stopped`。缓存命中没有使迟到的 readiness 越过控制版本栅栏。

重启回归分别验证默认脑包已安装且保持启用、默认包显式为空两种情况。前者在 seed 已跳过时仍于 Core Ready 前完成环境探测，重启后的第一个 Work 不新增准备；后者保持空选择且不要求环境探测。实际默认 Work 镜像与全局 runtime 镜像不同的路径也已验证，已有 Work 的 active context 保持。

## 规格场景与证据对应

| 规格场景 | 实际证据 |
| --- | --- |
| 创建和启动共享已验证镜像 | `TestNativeWarmDefaultCreationRetainedStartAndRestart`、默认路径完整采样 |
| 多调用者使用同一新镜像 | `TestConcurrentCallersShareOnePreparation`、真实八调用者冷准备 |
| 已准备镜像不等待无关扫描 | `TestImageCacheHitDoesNotWaitForOtherArchiveAndSameKeyMerges` |
| tag 改变或镜像删除 | `TestImageCacheRechecksAvailabilityIdentityAndTag` |
| 环境输出有效但清理失败 | `TestEnvironmentProbeFailuresRequireConfirmedCleanup`、`TestEnvironmentCacheDoesNotPublishBeforeCleanupOrCacheFailure` |
| 首个调用者取消、另一个继续 | `TestFirstCallerCancellationDoesNotCancelOtherWaiter` |
| 全部取消后再次请求 | `TestAllCancelledWaitForCleanupBeforeNewFlight` |
| 共享准备期间关闭 | `TestCloseWaitsForCleanupAndRejectsAdmission`、`TestCoreCloseRetainsDependenciesUntilSharedCleanupReturns` |
| Agent 延迟开放监听 | `TestStartupConfirmsDelayedMutualTLSListenerWithoutSecondBackoff`，合法监听后 500ms 内确认 |
| 无法就绪或身份不符 | `TestReadinessRequiresCurrentIdentityAndContracts`、`TestNativeRunningAgentReportsReadinessTimeoutWithoutExit`、原有提前退出诊断测试 |
| 已安装脑包的安装重启 | `TestNativeWarmDefaultCreationRetainedStartAndRestart` 中启用脑包的重启及首个默认 Work |
| 显式空包默认配置 | 同一真实回归的空选择、无环境探测及第二次重启 |
| 默认镜像不同于 runtime | 同一真实回归的独立 production 默认镜像路径；`TestDefaultImageReferenceResolutionDoesNotRequireModelSecrets` |
| 预热失败或配置换代 | `TestDefaultChangesSaveWithoutWaitingAndInvalidateOldPreparation`、原有 preparation retry / generation 回归 |
| 非必需 helper 未完成 | `TestPreparationRetriesHelpersAndSeparatesBaseReadiness` 及原生 helper 静态归档夹具的 capture 重试回归 |
| 预热后的 20 次默认创建 | 当前 API 20 次、Desktop 20 次，独立统计与零重复准备断言 |
| 首个 Work 和再次 Start | 真实重启回归、默认采样首项及 retained Start 补充记录 |
| 冷镜像和大包条件 | `TestNativeLatencyColdConcurrentLargePackageAndSlowMCP`，与默认预算分开 |
| 捕获失败 | `TestNativePreacceptCopyFailureSharesCorrelationWithoutRecords` |
| 接受响应丢失 / 幂等重放 | `TestCreateRequestPerformanceIncludesFailureAndReplayWithoutNewWork`、原默认创建 integration 的重放校验 |
| Starting 时接受 Stop | 新增真实冷 / 大包场景中的初始创建 Stop，以及 `TestNativeWorkStopFencesInitializingApply` |
| 受理前的慢镜像检查 | 创建入口性能事件、冷准备事件、HTTP preaccept 失败回归 |
| Agent 已 ready 而仍在收集诊断 | `TestReadinessTimingExcludesDelayedDiagnosticTransportAndPersistence`，真实日志传输与持久化延迟独立计时 |
| 多请求共享准备且一个取消的计时 | 共享 flight 取消测试及独立实际执行 / 调用者等待事件投影 |
| 性能事件不扩张公共诊断 | `TestPerformanceSafeProjectionAndAcceptedIdentity`、`TestPerformanceRejectsUnknownFieldsAndPreservesPhaseBoundary`、原 schema / HTTP 回归 |

## 检查结果与范围

- `go test -mod=readonly ./...` 通过；受影响缓存、诊断、客户端、运行时和默认配置并发路径的 race 检查通过。
- 原默认创建、Apply、MCP 失败回退、Stop 竞争、preaccept 失败、readiness 超时、配置 scope / 恢复、Core package 冻结与重放回归已逐项通过；直接真实 Agent 运行时集成通过。
- 首轮旧脑包测试将 history schema 固定为 4，与当前固定镜像 5 不符。测试已改为严格对照 Work 捕获镜像的完整受检能力，定向重跑通过，没有改生产协议、放宽必需契约或更换镜像。
- 文档默认入口的冒烟执行通过，Core 二进制与完整性能采样所用二进制逐字节一致。公共 HTTP / RPC DTO、生成契约、Go / npm 锁文件、存储格式和发布记录没有差异。
- `check-native-boundary`、Docker Quick Start 的 28 项合成测试及 `git diff --check` 通过。
- 仓库 Quick Start 发行身份检查报告当前源码不匹配历史 `sourceInputHash`；该检查没有记为通过。双语命令、模板和部署语义已核对，已发布 `release.json`、固定镜像引用、commit / dirty / hash / digest 保持原记录，没有自动生成替代发行或推送。

## 复现与本机产物

入口和参数见 [测试手册](testing.md#work-创建与启动性能验收)。本机 `dist/work-latency/` 保存 `before-api.json`、`after.json`、`cases.json`、`provenance.json`、`validation.json`、文档入口冒烟及实际测试日志；该目录被 Git 忽略，重新执行入口可取得本机证据。

验收只覆盖上述真实执行的条件。未测量基线 Desktop 的独立分布，未测量缺失镜像的联网拉取、所有第三方 MCP 或任意大包，也没有对外发行本次构建。

## 合入 NiceGUI 主分支后的回归

2026-10-11，合并提交 `4681b4a` 将 `fix-create-slow` 的四个提交合入保留 NiceGUI 默认环境的 `main`；以下检查基于合并后的源码，构建时工作区含待提交文档修改。

- 完整 `make test` 通过，覆盖宿主程序与浏览器资源构建、Go / TS 单元测试、脚本测试及类型检查。
- 真实 Docker / SDK 定向回归三项全部通过：默认脑包及显式空包覆盖、八调用者冷准备与大包 / 慢 MCP / Stop 竞争、热默认创建与保留数据 Start / Core 重启。集成套件耗时 171.742 s，默认脑包保持 `piwork-brain@1.2.1`。
- 41 份主规格严格校验、29 项 Docker Quick Start 合成测试、部署材料一致性、原生平台边界与 `git diff --check` 通过。当前已发布材料校验允许源码后续演进，原分支验收中旧检查器报告的 hash 差异仍保留为当时事实。
- 本轮日志保存在被忽略的 `dist/merge-fix-create-slow/`。本轮未重采 API / Desktop 各 20 次性能分布，前述 P95 继续仅代表原分支验收；也未重新发布镜像，公开 0.0.4 固定制品不包含此次提速优化。
