# Tasks

## 1. 固定范围与契约证据

- [x] 1.1 冻结 design 中 16 项原始失败和当前源码/有效规格映射，区分 1 夹具、7 断言、3 readiness、1 drain、4 未决；用精确测试名、目标 SHA 和初始结果复核，不声明未执行基线已失败。
- [x] 1.2 核对隔离测试安装、真实镜像来源、Go/Node/Engine 版本及现有运行入口；验证清理仅精确 installation 标签，旧镜像身份不冒充，缺依赖明确失败而非新增 skip。

## 2. 已证实契约与夹具修复

- [x] 2.1 修复清单 1 的旧不兼容镜像夹具来源/构建入口，保留生产与 acceptance 能力及拒绝旧协议证明；运行原 TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence。
- [x] 2.2 按 work-services 有效契约修正清单 2 的 Service Memory=0 断言，保留 CPU、身份、挂载、网络及归属校验；运行原资源生命周期真实 Engine 测试及 dockerengine 单元。
- [x] 2.3 修正清单 6/7/12 的当前 schema 断言，保留真实 schema4 升级、历史内容、回滚、降级栅栏和取消后历史检查；运行三个原测试及 work-store/workhistory 契约测试。
- [x] 2.4 按当前 WORK_BUSY 契约修正清单 9，明确拒绝且无队列/额外 Run，保留模型捕获不变；运行原真实 SDK 测试及对应 HTTP 合约测试。
- [x] 2.5 按 CONV-SESSION-001 修正清单 3/14：同 Session 明确新提交使用当前 active，原 Run/context/幂等和历史不改写、不重放，跨 Work 仍拒绝；运行两个原真实链及对应 Session/context 负例。

核验基准 `3822c238579e1c4db2ff6090acf5786835d9e451`：显式 synthetic-incompatible-helper 夹具由 `scripts/build-native-agent-images.sh` 构建，测试检查其合成身份与被拒绝的 contract；Service 测试仅将 Memory 断言更新为 0，保留其他资源断言。同一 SHA 的 [backend-engine](https://github.com/pphboy/piwork/actions/runs/41413657439/job/125172214839) 两个原测试及 dockerengine 通过；unit-static 通过。完整 integration-go 的其他失败不由此结论覆盖。

同一 SHA 的 [backend-history](https://github.com/pphboy/piwork/actions/runs/41413657439/job/125172214964) 六个原真实链通过，涵盖两条 schema4 升级、取消后的历史、模型选择、同 Session 跨 Apply 和导入后继续；unit-static 与 agent-unit 通过。源码断言固定当前镜像 schema、409/WORK_BUSY 且无额外 Run，并检查原 Session/Run、历史和幂等重放。该定向结果不替代 5.2 的完整套件。

## 3. 恢复观察与 drain 真正确认

- [x] 3.1 修复清单 4/10/11 对异步启动的过早观察，使用既有有界 readiness 和目标 Work/Service 状态，保留文件撤销、数据、计数和服务内容；运行三个原重启测试，不以固定 sleep 或延长预算替代完成证明。
- [x] 3.2 在 Agent Run/daemon owner 修复 drain 超时后仍未 settled 却成功返回的问题；直接测试空闲、自然结束、取消成功、取消未结束、重复 drain、晚回调和准入关闭，确保旧执行不能重开准入。
- [x] 3.3 修复 Core 提前 Revoke/Close 导致 drain 原连接丢失的独立链路，将实际 drain RPC 及 Go 消费者按 Work/代次传递已确认/未确认事实，保留其他 Work/Service 停止尝试、30/10/45 秒原预算和诊断；运行清单 13 原真实关闭测试及针对未确认 receipt 的 Go/TS 负例，若协议变化同步原生成链。

核验基准 `3822c238579e1c4db2ff6090acf5786835d9e451`：`node --test apps/agentd/dist/runs.test.js` 18/18 通过；`go test -mod=readonly -run 'Test(DetachedShutdownRouteDrainsRealClientAfterAdmissionCancellation|ShutdownDetachesOriginalRoutesWithoutLosingDrainAuthority|CapturedShutdownDrainRequiresOriginalConfirmedReceipt)' ./internal/workruntime ./internal/coreapp` 通过。PR #4 的 [backend-drain](https://github.com/pphboy/piwork/actions/runs/41413657439/job/125172214973) 在同一 SHA 实际通过 `TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain`；这不代表完整 integration-go 已通过。原 DrainResponse 布尔字段及生成协议未变。

同一 backend-drain 运行还通过 WebDAV 重启、SDK Service 部署重启和 Service revisions 三个原测试；它们使用 `waitRecoveredWorkReady` 检查具体 Work/Service 的有界恢复，原文件、数据和计数断言保留。

## 4. 四项未决失败的有限修复

- [x] 4.1 对清单 5 取得迁移 stop 子场景原 Operation/runtime-start 阶段证据，修复原控制版本和停止 supersession 的实际缺陷；验证 crash/stop/delete/apply 全部原子场景及无重复主写入者，不将历史某次错误当本轮根因。
- [x] 4.2 对清单 8 输出安全 event/phase/outcome 分类，核对有效诊断契约后修复源或准确 allowlist；运行原进程健康/身份/重启测试，保留秘密字段拒绝和真实失败诊断，不接受任意 stderr。
- [x] 4.3 对清单 15 用确定性 Engine 故障 barrier 区分 requested/request.succeeded 与实际 pending 清理，修复未推进或错误确认；运行原临时清理重试测试，验证 Engine 恢复后原任务收尾、无自动重新部署、无跨安装清理。
- [x] 4.4 对清单 16 在五分钟 context 到期前记录原 Apply 的安全阶段/状态，修复真正阻塞而非误修 reopen；运行原 Skill 故障/回滚/重启完整测试，保留具体失败及耐久诊断，不吞 storage error 或机械增时。
- [x] 4.5 对已知 Service iframe Stop→Start 偶发做受控 entry/DOM 代次诊断并记录复现或未复现范围；仅在当前契约及根因证明后做所属最小修复和回归，不新增盲目 retry、固定 sleep 或 UI 重设计。

同一 SHA 的 backend-drain 通过迁移恢复原测试的 crash/stop/delete/apply 四个子场景及进程健康/身份/重启原测试。迁移控制与原上下文竞争另有 `work_start_migration_restore_test.go` 负例；进程诊断只在已确认 Engine 不可用时接纳该阶段失败，并对不安全 token 和其他失败保留拒绝测试。

同一 backend-drain 的 `TestNativeTemporaryCleanupRetriesAfterEngineReturns` 和 `TestNativeSkillFailuresRemainSpecificAfterRollbackAndCoreRestart` 通过。前者用受控 Engine 代理确认 `pending/DOCKER_UNAVAILABLE`、容量保留及恢复后的原清理；后者在原候选 SDK 失败进入 rollback 后注入故障，记录原 Operation 的安全状态与阶段。`temporary_offline_test.go` 保留 Engine 代次和目标归属负例。

## 5. 集成验收与交付

- [x] 5.1 按每组改动运行 Go 单元/必要 race、Agent 和相关 workspace 测试，执行 make build、make test、native-boundary、gofmt/source-style；协议/资源触达则执行 make generate 与相应生成漂移检查，记录实际通过/失败。
- [x] 5.2 在同一候选真实 Engine 上完成一次新完整 make test-integration-go，并从同次清单/事件中核对原 16 项全部通过，核对全部原测试和条件 skip，保留失败记录；不得删除测试、只选通过项或沿用旧 SHA 结果宣称完成。
- [x] 5.3 执行 Desktop/Administration 正式浏览器、真实 Core/导入导出/日志导出回归及必要 Service iframe 复查；逐项记录代码 SHA、镜像身份、结果和未执行边界，局部绿色不替代全量门禁。
- [x] 5.4 运行本 change strict validation、文档路径及 diff 检查；提交前给出功能分组与验收摘要，明确未决项，保持主规格/归档/发布不动，不把审批或规划状态当实现完成。
