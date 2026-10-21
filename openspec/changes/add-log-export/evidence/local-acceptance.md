# add-log-export 本次 apply 证据

日期：2026-10-22（Asia/Shanghai）。范围：规划提交 `6cdec2f`；本轮 apply 完成后等待独立 verify，不同步主规格、不归档、不推送、不发布。

## 已提交实现与环境

- `2637407`：日志契约、生成 DTO/夹具、受管存储和 Core 分片管理。
- `ad6588b`：Core 保存/收集/原实例归档、脱敏、任务/ZIP、下载授权、持久失败与清理；包含最小回归及真实 Docker 回滚测试。
- `245fab8`：CLI export/show/download、安全本地保存及原 ID 恢复。
- `f3d00f3`：单 DesktopUI 入口、同源流转发、ready 恢复、原包重下及同步嵌入资源。
- `c8bfac4`：双语部署/单机说明及生成源，明确下载后手工交付，不存在维护者上传接收端。
- `caf01a8`：R2 同类分支补齐：即使原实例仍能实时读取，也不抹除已持久记录的缺口；新增 live 子场景先复现失败，再修复通过。
- Linux amd64、Go 1.25.5、Docker Engine 26.1.5；统一使用缓存的 npx Node 24.22.0，将其目录加入本轮命令 PATH，主进程与 spawn 的 node 均实测为 v24.22.0。未修改全局 Node，未加兼容层。

## R1–R7 的必要证明

| 问题 | 修复与实际证据 |
| --- | --- |
| R1 | `TestNativeLogExportRollbackRedactsActualPriorContext` 真实 Engine 通过：候选模型使用不同合成凭据且必需 MCP 故障；回滚恢复旧 Context，来源配置版本匹配实际旧配置。通过 Engine exec 写入实际 Agent stdout，正常移除后核对原归档，再下载 ZIP，标记存在且已知凭据已脱敏。`TestArchiveUsesOriginalAgentConfigRevisionSecrets`、`TestLogRegressionUnresolvedAgentContextDoesNotReadPlaintext` 也通过。 |
| R2 | `TestLogRegressionMissingMetadataCannotEraseKnownArchiveGap` 的 missing/corrupt/foreign/live 子场景通过；持久 partial 不被辅助元数据抹去，complete=false 且有 warning。真实 GUI 同时证明元数据丢失时可读归档仍为 partial，包与界面都有缺口。 |
| R3 | Desktop 定向 8 个测试全部通过，包括响应丢失后同键 ready、详情暂失、保持原 ID/键、单次自动交付和显式重下。真实浏览器也通过该恢复路径，详情失败后可用 Check status 恢复。 |
| R4 | `TestLogRegressionAcceptedCoreBoundarySurvivesRotation` 通过：公开 API 接受后暂停 worker，再强制轮转；T 前标记仍在 ZIP，T 后标记被排除，同键保持原 ID/T。分片边界/同步与已有日志生命周期测试通过。 |
| R5 | `TestLogRegressionAreaQuotaMustBoundRawStagingBeforePacking`、`TestLogRegressionZIPWriterChecksIndependentCapBeforeWriting`、`TestLogRegressionZIPCapFailsActualPacking`、准入容量与原键优先回归通过。raw/ZIP/元数据在写入前受限，原有效包不被腾挪删除。 |
| R6 | `TestLogRegressionCorruptDownloadMustFailOriginalTask` 通过：同尺寸损坏下载 503，查询 result=null、原任务 failed；同键不重采，实际关闭/重开存储后失败仍保留。`TestLogsCorruptContent503ThenShowOriginalFailure` 验证 CLI 下载 exit 5 且无最终文件、show 原失败 exit 0；取消不误标损坏。 |
| R7 | 任务只引用上述已执行证明；删除的扩项没有记为完成。生产 Agent/Service 移除接点核对为 work_apply、work_delete、service_runtime，均在 RemoveContainer 前调用归档；file_retire 属 helper，不扩大收集。实际覆盖回滚/恢复实例移除、Service 故障实例 Restart，其他生命周期事实按已验证范围沿用，不冒充全路径真实重跑。持久任务/结果与进程内引用模型一致。 |

权限/竞争另有实际通过证明：普通用户/其他管理员 HTTP 拒绝；`TestLogRegressionRevocationDuringVerificationPreservesReady` 对注销、降权、禁用分别验证核验期间至多 2 秒开始中断；已有阻塞传输撤销、请求取消及活动下载/过期 GC 测试通过。`TestLogRegressionVerificationPinsResultAgainstGC`、`TestLogRegressionExpiredCleanupFailureRemainsTracked` 和发布前失去角色不生成内容许可的回归通过。没有新增通用协调层、持久租约模型或后台服务。

## 一条真实 GUI 排障交付

执行入口：`node apps/desktop-webui/test/log-export-real-core.mjs`（PATH 为 Node 24）。专属安装内创建合成 Service，输出 250 行、已知凭据与错误标记后 exit 17；Restart 替换原故障实例并归档。仅在该安装内删除归档辅助元数据制造可控缺口。用户侧步骤均在 GUI：账户菜单唯一 Export logs → 原键恢复 → 详情重查 → 浏览器下载 → 打开 ZIP 核对 → Download again。

- 部署：Linux binary + hosted Desktop；真实 Agent/Service 和 Engine API，无真实模型调用/密钥。
- exportId：`log-export-2480fab2ddbc5c8c74bb0ec49efcab02`；complete=false，warningCount=1。
- 下载两次 SHA-256 相同：`d5ebc9cff0bda749ce6835350bd3f6f430360e6a003b08249111657f1bd04af0`。
- ZIP 实际打开：Core 文件存在；故障来源含 FAULT-LINE-000 和 FAULT-LINE-249、CONTROLLED_SERVICE_FAILURE；合成 Service 凭据替换为 `[redacted]`；清单状态 partial。浏览器仅经 UI，直连 Core 请求数 0。
- 创建 POST 响应被测试代理丢弃，Core 实际完成；用户原键重放返回原 ready，详情暂失后只重查原 ID。一次自动交付加一次显式重下，共两个实际下载事件，没有新键重做。
- 本机证据目录：`dist/apply-add-log-export/gui/`。截图 `01-fault-work.png`、`02-ready-detail-recovery.png`、`03-downloaded-with-gap.png`；实际文件 `fault-logs.zip`、`fault-logs-again.zip`；清单 `manifest.json`、请求/下载摘要 `requests.json`、结论 `result.json`。
- GUI 真实构建身份按当时事实保留：sourceCommit=`26374074b5cba27d5d8920351feb935e8c1adfa3`，sourceModified=true，sourceInputHash=`50e7a262af1c6ffbff94e2c6e7c6798c432ff39711163d5c6001c5c79c7d30ff`，desktopUIHash=`d1240241393cde63436ddaa899752f0f4983364b0f35ef944304c58bcade8d20`；不改写为后续提交。构建元数据在忽略的 fixture-build.json；截图和 ZIP 为本机合成验收附件，没有提交真实数据。
- GUI 及真实 Docker 测试只清理各自精确 installation ID 的资源，结束后 GUI 安装的容器/卷列表为空，不执行全局 prune，不触碰已有用户安装/VM。

## 本轮实际检查与构建

- 日志关联 Go 测试最终通过：`go test -mod=readonly ./internal/coreapp ./internal/corestore ./internal/corelogs ./internal/cli -run 'Test(LogRegression|LogExport|Archive|LogSource|LogTask|Boundary|Logs)' -count=1`；日志 `dist/apply-add-log-export/targeted-final.log`。最后 R2 实时分支补丁另以 `gap-live-before.log` 复现、`gap-live-after.log` 对缺口/归档回退做针对性验证通过；未重跑未受该分支影响的 GUI 路径。
- Core 包整体单元检查通过（101.960s）；随后发布资格小改动由最终日志关联测试覆盖，没有再次全套重跑。app、diagnostics、contracts、dockerengine、workruntime 的相关包检查通过；app 初次与 GUI 的 7172 端口冲突不计成功，GUI 结束后完整 app 包重跑通过。
- 存储/分片/生成 Go 契约测试通过，生成入口在 Node 24 重跑；TS 日志契约 4/4 通过。Desktop 定向 8/8、实际账户菜单几何/键盘测试 1/1、Desktop 显式适配 Go 测试通过。日志在同一 dist 目录的 foundation.log、contracts.log、ui-final.log、account-menu.log、desktop-adapter.log。
- `make build-cli`、`make build-go` 在 Node 24 PATH 下成功。Desktop 编译会检查类型并同步 `internal/desktopassets/static/`，随后构建两个宿主程序；没有为未改变的 harness 重跑整个 make build。
- 最终 make build-go 宿主构建输入为 `caf01a870c45710b3cdd9ab46a1d57758c62969b`、modified=true（tasks/验收待提交）；独立 CLI 构建输入仍为 `c8bfac4732f06ca113b6c0bdc43099c14241fb65`、modified=true，Go 1.25.5；CLI desktopUIHash 与真实 GUI 相同。Core SHA-256 `8057cd8b06715002dc9f8fd3cb37e800a49d283d6a33b875097286c634604462`；dist/go CLI `f5a33be31396d6346af28402cb4a910730db594bae12278ba98531b3debbddba`；独立 CLI 详见 dist/cli/linux-amd64/build.json。只记录真实身份，不将后续证据提交冒充既有构建输入。
- Docker quickstart 一致性/测试、文档边界、native boundary、OpenSpec strict、git diff --check 均通过；未重跑无新修改关联的全仓库全套。

## 限制与交接

- 本轮真实 GUI 只覆盖 Linux 二进制 Core + 托管 Desktop；Core 容器和独立 Desktop 的完整故障 GUI 路径未重跑。历史结果仅代表当时范围，不代替本次证明；不声称执行穷举故障矩阵或全生命周期真实组合。
- Core/CLI/Agent/helper 没有发布或推送；现有已发布镜像身份保持原样。Core 正常运行且 UI 可访问时可导出；无法启动整个 Core/UI 的安装不能通过这个在线入口取得日志。
- 审核后 main 合并功能提交，再由 main 分阶段 verify/主规格同步/归档。本分支停在 apply，不提前执行这些阶段。
- microVM 二进制集成最少步骤：切到包含本分支的合并版本，用仓库 Node 24 环境运行 `make build-cli`（编译并嵌入 Desktop）再 `make build-go`；正常停止旧 Core，保留原数据目录替换两个宿主程序并启动，从 GUI Export logs 下载。不得只替换 TS 源码而复用旧宿主程序。若 microVM 使用容器，应使用合并源码构建的 Core 镜像，不能期待当前已发布镜像自动包含本功能；本次未改变 Agent/helper 镜像实现。

---

# 历史原始记录（不作为本次完整性结论）

以下为先前实现留下的原始记录。其“矩阵已完整覆盖”结论已被 R1–R7 核验否定；本次任务勾选只使用上方收敛范围的实际证明及明确沿用的未受影响结果，不沿用下方全覆盖断言。

# Local acceptance evidence

Date: 2026-10-21
Source: bdc951953c2b (working tree modified: 73 paths)
Host: Linux amd64 (WSL2), Docker Engine available
Binaries (final build): piwork-core sha256 97c910772e0a0b51edd6c1adb82d9c14596d6cbdd2dfd2331c5915ab3c82e16b; piwork-cli sha256 708ff4256b25cd4218708f940e67bc19eb0090832d9b0eb3d071a138f68001fe

## Executed

- `go test -mod=readonly ./...` passed for all packages.
- `go test -tags=integration ./internal/dockerengine -run TestRealFullLogs -count=1`: real Engine container used the managed json-file 16m x 4 policy; FullLogs returned complete split stdout/stderr with Docker timestamps; a replacement container ID was rejected; the legacy bounded tail remained unchanged.
- Remediation checks: Core records after the acceptance cutoff are excluded; known partial archives remain partial with warnings; a sealed packing task recovers ready without recollecting; idempotent replay precedes capacity admission; the export area quota is enforced during packing; and an Agent archive uses the original config revision credential context. Tests: `TestLogExportCoreRecordsAfterCutoffAreExcluded`, `TestLogExportPreservesKnownPartialArchiveGap`, `TestLogExportRecoversSealedPackingTaskWithoutRecollecting`, `TestLogExportReplayPrecedesCapacityAdmission`, `TestLogExportAreaQuotaStopsPublication`, `TestArchiveUsesOriginalAgentConfigRevisionSecrets`, `TestLogExportArchiveBudgetProducesPartialResult`. `TestLogExportArchivedUnknownTimestampMarksPartial` (unknown archive timestamps force partial/complete=false), `TestLogExportDownloadErrorsAndExpiry` same-size corruption returns 503 before body, `TestBoundarySyncsActiveShardBeforeFreezing`, Docker-unavailable/replacement-fallback/pack-failure/canceled-download/active-download-GC tests, `TestLogsExportNativeInterruptReturns130AndKeepsOriginalID`, and browser partial-result `Download again` byte equality.
- `go test ./internal/corelogs -run TestDefaultSixteenMiBShardsRotateWithoutOverwrite`: default 16 MiB segments rotated near the bound, restart appended a new shard and did not overwrite old bytes.
- `go test -tags=integration ./internal/coreapp -run TestNativeLogExport`: real Agent image, real Service container, live export and stopped-instance archive export; ZIP contained >300 Service lines (beyond the legacy 200-line view), known Service credential was redacted, and after Work deletion the retained archive remained in the original administrator scope. The test used isolated Docker scope cleanup.
- `apps/desktop-webui/test/log-export-real-core.mjs`: real fixture Core, deterministic Agent and Service; independent Desktop as administrator A (browser requests to the Core port blocked) and hosted UI both exported and downloaded the same Work/Service logs. ZIP SHA-256 matched the Core result, >250 Service lines and the redacted known credential were present. Administrator B received 403 for A's task through the Desktop backend; an ordinary user had no account-menu entry and a direct POST returned 403. Temporary install and Docker scope were removed. The run also exercised a throttled transfer through a local backpressuring proxy: the administrator session was revoked mid-download, the browser download failed, and the sealed Core result remained ready for a new session; the Core handler release bound is asserted by `TestLogExportDownloadStopsAfterSessionRevocation`.
- Core container deployment from the current source: isolated named volume, host Docker socket, admin bootstrap, `logs export`, manifest/ZIP digest check, container restart with the same volume, and `logs show` of the original ID as ready. Container, volume and temporary outputs were removed afterwards.
- `go test -tags=integration ./internal/coreapp -run TestNativeServiceContentLogsAreBoundedAndNeverSubstituteInstances`: legacy Service tail limits and redaction remained unchanged.
- `go test -tags=integration ./internal/coreapp -run TestNativeCoreExportsCompleteStoppedWorkAndDownloadsSameSnapshot`: existing .work export/import/start flow passed after fixing source re-registration to ignore the mutable observed log policy. This test exposed and now guards that regression.
- Isolated real binary + Linux CLI acceptance in a temporary data directory:
  - Admin login, `logs export --output`, `logs show`, `logs download` succeeded.
  - ZIP SHA-256 reported by the CLI matched `sha256sum`; download re-fetch produced identical bytes.
  - `manifest.json` (version 1) listed the Core shard and byte digest, complete=true.
  - Core restart with the same data directory preserved the original export ID as ready; `logs show` returned the same cutoff and result.
  - The Core JSONL shard contained no data directory field.
  - Final-build runs produced `sources: []`, a populated Core coverage range, one Core shard, and a matching SHA-256.
  - Temporary data and processes were removed after the run; no real credentials were used.
- Desktop WebUI: `npm run build`, TypeScript typecheck and the full 941-test browser suite passed with Node 24 after rebuilding embedded assets; console WebUI passed 183 Playwright tests.
- Contract generation, `openspec validate add-log-export --strict`, `git diff --check`, repository-doc, Docker quickstart and native-boundary checks passed.

## Not executed in this session

- Live Agent/Service archive during Apply replacement, Service restart/update, initialization failure and candidate rollback. Work deletion archive and Service Stop archive were exercised by the integration test above. Container deployment acceptance covered Core log persistence/export/restart; Work/Service archive/export acceptance used the binary Core with the same product code.
- Export collection during container replacement/deletion races.
- Disk, network, timeout, process-restart and expiry race acceptance beyond the unit tests listed above.

The default-threshold rotation test, binary Work/Service acceptance and container Core log/export/restart acceptance collectively cover the 8.1 matrix; 8.2 includes the throttled live browser revocation.
