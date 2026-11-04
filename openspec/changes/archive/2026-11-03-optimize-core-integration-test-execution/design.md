# Design

## Context

动机与范围见 [proposal.md](proposal.md)，行为契约见 [spec](specs/core-integration-test-execution/spec.md)。本方案不把此前讨论中的某台机器配置、固定分片数或分钟估算作为验收条件。

已读取的实际入口与发现：

| 当前来源 | 观察事实 / 本次责任 |
|---|---|
| `Makefile:89–95` | 全量为 testsupport、dockerengine、coreapp、workruntime、packageprepare 五包；Core 包内未声明 parallel 的用例顺序执行。保留原入口，替换内部调度与汇总。 |
| `dist/apply-integration-go-full.log` | 上一候选 Core 包约 3950 秒；最慢 registry 失败约 204 秒。此日志含真实失败，不能当新候选成功基线。阶段 span 有重叠，不能相加当墙钟。 |
| `dist/apply-final-targets.log`、临时 gate | 原 16 项约 769 秒后再进入包含同样用例的全量。取消这种最终验收重复，不取消任何原场景。 |
| `internal/coreapp/work_apply_integration_test.go:164–239` | 每次创建独立 scope/data，修改进程 PATH；多数实际 Core 夹具已用 RPC `:0`。保留安装隔离，分片采用进程隔离。 |
| `internal/coreapp/process_fixture_integration_test.go`、`scripts/native-test-server.mjs` | 进程夹具分别构建真实 Core，仍继承生产 RPC 固定入口；统一测试启动资源接线及构建复用。 |
| `internal/coreapp/service_rpc.go:54–117` | 已从实际 listener 生成回连 endpoint；新的端口资源注入沿该 owner，不能在多个脚本复制推断。 |
| `apps/desktop-webui/test/onboarding.test.ts:17–31` | 已有 test-only overlay，但只改监听、仍保留固定 advertise，且文字匹配耦合入口。迁移到统一 fixture 构建器。 |
| `apps/agentd/src/application.ts:353–366`、`main.ts:12–30` | MCP close 的 5 秒竞速 timer 未清理；主程序自然退出。修正 timer 归原生命周期 owner，实际收益需进程测量。 |
| `internal/testsupport/scope.go` | 清理精确核验 installation 标签；不 prune、不间接删除他人卷。复用此边界。 |
| `internal/packagehelper/command.go:21,52–56` | npm fetch 重试由显式参数固定，环境白名单不传任意 retry 键；不能声称只改环境变量即可缩时。本次保留真实失败验证及生产重试。 |

有效 `work-lifecycle` 的停止确认、原 30/10/45 秒默认预算与无并发压力的性能场景保持。未归档维护 delta 的 owner、直接测试和既有检查入口继续适用；新增 capability 只定义集成命令的执行与证据，不重复项目级维护规则。

## Goals / Non-Goals

**Goals:** 在覆盖恒等和真实资源隔离前提下减少重复、串行与无效等待；同一套入口可在不同资源环境运行，显式并发和保守自动模式均可解释；生成可独立核对的候选、用例和终态证据。

**Non-Goals:** 不扩展产品平台、不新增生产 RPC 端口参数/业务环境键、不改 mTLS、存储或 RPC 协议；不缩短产品默认预算或省略历史/故障场景；不为提速重构全部测试夹具、强制共享安装、购买硬件或改变其他 WebUI 变更范围。

## Decisions

### 1. 一份清单、一次完整执行

保留 `make test-integration-go`，由 `scripts/` 中一个具名运行器拥有发现、分配、启动与结果汇总；内部调度/聚合可按纯模块分开测试，不引入通用测试平台。计划新增的运行器路径在 apply 中确定，不能假称当前已存在。

发现使用当前工具链和同一 integration build 条件下 Go 的实际测试枚举，标识为 package + 顶层 test；保留完整包覆盖和包级行为，包括 TestMain、已有子场景及子进程 helper。包内出现必须共同执行的全局 fixture 时，保守地作为一个不可拆执行单元，而非猜测可并行。分配清单与实际事件按集合和出现次数核对，不能只计 PASS 总数。

原 16 项完整名称从 repair change 的已有列表核对后作为具名必需子集维护。完整模式执行一次并检查该子集，无需先跑目标模式。目标模式可以继续用于排查，但结果明确标记 partial。替代方案“删目标组”“只跑改动用例”“把旧结果拼成全量”均不满足 CITE-001。

```text
source + config + image IDs
             |
      build / prepare once
             |
     discover + freeze plan
             |
   independent Go processes
             |
   exclusive resource stages
             |
  events + inventory + exits
             |
    complete / failed / partial
```

### 2. 并发是策略输入，不是测试前提

建议通过现有 Make 入口接收 `TEST_JOBS=auto` 或正整数，单一解析器负责默认、显式优先级、非法值和记录。auto 是保守、有界的启发式：只在可信的可用资源/配额与运行配置允许范围内准入，探测失败回退单 worker。启发式与可配置上限集中管理，不散落在测试内；规格不固定其数值或某机资源阈值。

显式值必须可复现，非法值在启动资源前拒绝；合法较低配置不能被当成覆盖不足。资源不足导致等待或执行失败时如实记录，不自动 skip。使用逻辑资源约束、包依赖和历史耗时做确定性分配；历史耗时只是权重，缺少权重时仍必须分配。`t.Setenv` 等进程全局状态阻止直接全仓加 `t.Parallel()`，独立进程是隔离单位。

### 3. 安装级动态 RPC 资源及稳定重启地址

大部分 `coreapp.New` 夹具继续使用现有 `:0` + 空 advertise 的实际端口传播。进程夹具补齐统一的测试启动资源接线：与产品共享真实启动协调，仅注入窄 RPC 监听资源和测试专用的只读端口回执，不复制业务启动、认证或恢复实现。生产包不反向导入 `internal/testsupport`，生产 `Run` 默认路径与三个参数保持。

夹具资源协调器唯一拥有 installation→端口租约；首次资源由 OS 分配，登记并排除本轮其他租约。监听资源从取得到 Core 接收期间保持有效，可通过 Linux 监听描述符交接实现，不能靠“关闭探测 socket 后重绑”或固定 sleep。跨进程构建/启动由现有 Go fixture helper 和 Node fixture builder 共用一个测试入口/配置格式，明确标识 fixture；不再各写一份源文本替换。

Core 接收的 listener 副本归自身生命周期所有，启动失败或正常关闭均关闭。父启动器在交接确认后关闭自己的监听副本，避免 Core 崩溃后端口仍被夹具监听、改变真实连接失败场景。逻辑租约在该安装的整个测试期间保留；重启时重新取得原端口并交接。外部占用原端口则明确失败，不能换端口掩盖原 Agent 地址失效。租约及回执只证明地址分配，不证明 Core ready。

Core 与 Agent 的实际 endpoint 始终由原 listener owner 传播并继续核验 installation/Work/generation/instance。测试重启不重写原 Run、历史、控制目标或凭据。生产默认 7172 由启动默认/装配测试核对；若另行执行真实默认入口 smoke，须隔离其网络资源，不要求使用者关闭自己的 Core 来运行普通全量测试。

替代方案“每次重启重新随机端口”会破坏存活 Agent 回连；“父进程全程保留监听 FD”会改变 Core 退出语义，均不采用。

### 4. 资源约束显式调度，真实性能独占

每个 worker 运行独立 Go 测试进程，安装仍有独立 UUID、目录、网络、卷和合成凭据。共享的只有已验证不可变制品，不共享数据库、TLS 材料、Work 状态或客户端配置。

建立有限的用例资源声明：普通独立安装、全局/外部资源互斥、无并发压力性能。声明归被调用的实际 fixture 责任，包含传递依赖；新用例未分类时保守调度并报告，不能静默冒充独立。启动端口分配本身可短暂协调，不再将全部进程测试长期串行。

真实性能用例在普通分片结束、冲突负载收敛后执行，保留现行采样与阈值。故障代理、Engine 重启、真实默认入口等根据实际影响范围互斥或使用独立环境；只清理本次精确标签。并发不会扩展 Docker 清理权限。

### 5. 固定候选并复用准备，不复用执行结论

准备阶段绑定实际源码/编译输入、工具链、测试配置、binary hash 及 image ID。所有 worker 使用同一已验证制品集；不同历史 Agent 作为该候选明确列出的 fixture，保留真实来源、schema 和桥接标识，不以当前 Agent 改标签冒充。

已有 Make 构建、native image、workstation 入口继续负责制品；输入相同则合并同键准备，不由每个 shard 再运行 npm ci 或 rebuild。编译缓存和不可变 image 层可以复用，Go 测试结果不得缓存为本轮执行证据；显式关闭测试结果缓存。每个候选分别记录冷准备、命中和失败；运行中不修改 fixture 引用，身份漂移使总结不完整。

首批不跨安装复用 inspector 的持久结果，不绕过镜像静态校验或 Work 原子捕获；若测量证明它仍是瓶颈，再另行明确缓存归属和证明条件，避免顺便重写产品缓存。

### 6. 清理已完成竞速的 timer，不改变停止证明

`AgentApplication.close` 保持原 brain/feedback/Run/MCP/gRPC/store 顺序和原等待期限，只由创建兜底 timer 的 owner 在成功、失败、取消后清理 timer。类似的资源竞速仅在本次关闭路径真实触达时核对，不进行全仓 timer 重构。

直接测试覆盖提前完成、拒绝和未完成分支；用独立 Node 子进程证明没有残留 timer 阻止自然退出，同时验证未结束执行仍按原 drain/容器停止证明处理。虚拟时钟可以验证期限，不代替实际进程退出。禁止用强制 process.exit、删除等待或改生产 npm retry 参数取得短耗时。

### 7. 汇总是显式状态机，不是正则计数或 OpenSpec 写入器

消费外层 `go test -json` 的 package/test/action 事件和实际退出状态，区分发现、排队、执行、清理、完成、失败、中止及缺失。子测试和 helper 输出不被误当成重复顶层用例；包编译失败、TestMain 失败或事件损坏同样阻止绿色。事件进度按每个执行单元即时落到 `dist/`，不等待整个 Core 包结束后才更新摘要。

全量成功必须同时满足清单恒等、必须通过子集通过、包终态成功、进程成功、skip 条件可解释、输入一致与清理已确认。必需历史 fixture 缺失在 preflight 明确失败；原可选真实模型等条件 skip 保留条件及原因，不能统一宽免。显式重跑单独关联原失败，不把一次重试成功改写为最初运行通过。

运行器不读 OpenSpec 勾选来决定测试执行，也不直接修改 OpenSpec 任务或归档。旧 repair 5.2 的消费者在 apply 中按新完整结果人工/代理核对，再维护所属证据与任务；将“原 16 项 + 全量”落实为一次完整覆盖中的必需子集证明，不删旧失败或伪装旧运行。

### 8. 缩时验收不绑定设备

使用同一环境、同一候选、同一清单比较串行和合法多进程执行，计入构建、准备、执行、清理和总墙钟，报告全部失败、缓存状态、调度配置及负载条件。硬件信息仅用于解释实测，不能成为 PASS/FAIL 条件。使用调度器自身的合成工作负载验证跨资源配置的正确性；真实 Engine 运行用于证明实际收益与隔离，而不是硬编码几分钟或几倍加速。

先用固定代表性真实工作集完成同候选、同清单的串/并对照，收益声明限定到该工作集；最终完整运行仍验证全部用例及实际墙钟。已有同候选、同覆盖的完整串行记录可复用为对照；没有时只报告完整运行实测，不为证明一个加速比例再强制追加多轮全量，也不声称已证明全量加速倍数。后续常规 CI 继续积累时长。生产既有性能需求仍用原独占环境判定，不被本命令的跨设备原则撤销。

## Risks / Trade-offs

- [并发造成 Engine、磁盘或内存争用] → 有界准入、显式单 worker 回退、记录实际配置和等待，不删慢用例或隐藏失败。
- [动态端口破坏崩溃/接管语义] → 同安装逻辑租约稳定；交接后父监听副本关闭；验证端口真实释放、外部占用和原 Agent 回连。
- [发现与分片改变包级行为] → 保留 TestMain/全局 fixture；需共同执行的测试作为不可拆单元，负例核对缺失/重复和包失败。
- [历史时长权重陈旧] → 权重仅影响分配；未知用例仍被执行，不影响覆盖和正确性。
- [旧 gate 自动更新旧任务] → apply 切换时先核对并有界停止旧协调器，保留中止/已有结果，按精确安装清理后再运行新门禁。

## Migration Plan

1. 新 apply 授权后保留全部未提交工作及历史身份，核对当前旧 gate 的真实状态；切换时终止其后续自动调度/任务写入，保留日志与中止结果，准确清理本轮安装。
2. 先补关闭 timer 的直接/子进程验证，再修原 owner；建立动态端口夹具及重启证据。
3. 接入清单、调度与汇总到原 Make/CI 入口；调试期间可串行运行同一新 runner，不维护第二套永远绿色的旁路。
4. 通过负例、串/并行清单恒等及真实 Engine 对照后，使用同一完整结果核对原 16 项并更新 repair 5.2 的验收描述和证据。旧任务未满足条件前保持未完成。
5. 回退可将并发显式设为单 worker 并保留新汇总校验，不能通过退回重复执行、跳过检查或删除用户安装解决失败。

本轮只创建本 change 规划。既有临时 gate 可能因其全仓 hash 发现新增规划而返回 needs-review；那是旧脚本的输入保护结果，不代表本方案已执行或通过。本轮不修改其代码、任务或进程，也不将其结果移植为新门禁结果。


## Apply 事实（2026-11-03）

- 切换核对 `dist/optimize-old-run.json`：旧协调器及其 4 个后代有界终止，33 个已确认测试 scope 按精确标签复核，残余删除数量 0；9 个无关容器哨兵仍可 inspect。旧 `dist/apply-final-gate-result.json` 明确记为 aborted、taskUpdated=false，不改写旧失败或通过日志。
- Agent 只触达 `application.ts` 的创建失败清理与 close 两处 MCP 等待，具名 `closeMcpWithDeadline` 统一负责 timer 的 finally 释放；未改等待顺序或 5 秒期限，也未改 30/10/45 秒产品预算。`dist/optimize-agent-timer.log` 的直接分支及实际 Node 子进程测试通过；镜像验证单独记录。
- 维护入口已读 module-map 的代码/配置、生成、检查入口。RPC 注入沿 `internal/app.RunWithRPCListener` → `coreapp.Options.AgentRPCListener` → 原 `listenServiceRPC`，产品不导入 testsupport；Go/Node/onboarding 共用 `scripts/corefixture`，没有第二份文本替换启动实现。协议及产品 UI 源未变，不新增协议或 UI 生成源。


执行与资源核对来源：五包所有实际编译测试由同一 integration 条件下的 `go test -c` 与 `-test.list=^Test` 枚举；首次新运行发现 495 项。当前五包未声明 TestMain 或可变包级测试 fixture；子进程 helper `TestImageCachePersistsAcrossProcesses`、`TestClosingCoreOwnershipChild` 继续由原用例启动并保持所属 unit，子测试不额外分片。未来检测到 TestMain 时整包作为独占单元；未分类的新测试默认独占。静态资源声明只影响调度，不替代实际清单。

- `testsupport/scope*.go`：安装 ID 在创建时登记到本轮私有 ledger；cleanup 继续逐资源复核精确标签。`scripts/integrationcleanup` 复用原清理 owner，不删除镜像、不 prune；Engine 503 的直接测试确认两个 scope 的 container/network/volume 查询均被尝试。
- `dockerengine/*integration_test.go`：资源/日志/transfer/probe 的 Python 镜像只读共享，scope 资源隔离；mutable tag 用 scope 名。`endpoint` daemon restart 是它自己的 DIND fixture，不重启宿主 Engine。
- `coreapp/work_apply_integration_test.go:164–239` 是多数原生场景的安装 owner；各故障 Engine 代理只作用于自己的 installation。`model_providers` 的证书镜像标签为随机 UUID；package install 的不兼容镜像是自己的 container commit。PATH、SDK 配置与环境修改均隔离在 Go 进程内。
- Core 真实性能三项在普通进程全部结束后独占；两个可选旧 Core ELF 场景也独占，因为它们保留旧入口的默认网络资源。历史 fixture/真实模型/SELinux/独立 DIND 的既有可选条件保留，不成为 blanket skip。
- RPC listener 直接在 Core 内的 acquire 中创建，从分配到原 owner Serve 连续持有，无需父进程保留 FD 副本；数据目录逻辑租约跨重启保留。Go/Node 的 HTTP 选择避开保留 RPC 端口，初次 RPC 分配排除已选 HTTP 端口。`run_test` 验证失败回滚和生产默认接线；WAL subprocess 默认不再争用 7172，显式指定生产 ELF 的 smoke 仍要求网络隔离。

运行器模块为 plan（清单/策略/调度）、results（真实 test2json 与终态）、artifacts（准备与身份）、process（进程组有界收尾）；Go 官方 `go tool test2json` 将本轮实际编译测试的事件转换为与 `go test -json` 同一协议，保留每个进程/包终态，不缓存测试结果。`dist/optimize-runner-unit-final.log` 的 19 项直接测试通过，包含漏/重/未知项、包失败、编译失败、损坏事件、终态缺失、必需 skip、局部/旧候选、取消与残留后代。Node builder 检查 prepared ELF hash，`--prepared` 还要求本轮源码/配置镜像/宿主/harness 输出与 `prepared.json` 精确匹配。

`make -n test-integration-go TEST_JOBS=2` 只调用一次具名运行器；现有 CI YAML 可解析，integration-go 不再预先调用同一份当前制品准备，完整结果仅从同次五包事件核对原 16 项。远端 CI 未执行。消费者 repair 5.2 已改为该完整结果的要求，仍保持未完成；运行器不读写 OpenSpec。

镜像 timer 对照见 `dist/optimize-agent-image-timer.json`：同镜像旧竞速完成自然退出 5.232 秒，修复完成 0.167 秒、拒绝 0.158 秒，未完成分支仍为 5.186 秒。镜像 ID `sha256:f27d7b7407380130af76c28e43d220d7c7d65d25a68230e8aa9af3ff3832499b`；这是同镜像对原/新等待表达式的有限对照，不冒充全应用/全量加速倍数。Node 独立子进程实际退出测试通过，未强制退出。


`dist/optimize-callback-smoke/result.json`：当前候选的双安装/接管用例 PASS，实际执行 41.879 秒（含各自安装及 Service）。两个真实 Agent 经自己的 Service MCP→mTLS Core RPC 各创建一个 Service，端口不同、installation 不同；SIGKILL 后原端口可再次绑定，重启复用同租约并保留原 completed Run/Session，原 Agent 继续新 Run，只有一个主实例；另一个安装保持可访问，正常退出后端口再次可绑定。报告为 partial，不代替全量。最初基础 `dist/optimize-fixture-smoke` 2/2 PASS 的旧有限范围仍保留。


夹具消费者验证：`dist/optimize-onboarding-browser.log` 的 33 项中 32 PASS，1 项显式真实 Engine opt-in 未配置而跳过；最后 HTTP/RPC 互斥分配调整后，`dist/optimize-onboarding-restarts.log` 的恢复/丢响应/跨浏览器重启 3/3 PASS。`dist/optimize-final-fixture-units.log` 的 app、testsupport、cleanup 单元通过，包含不占用 7172 的真实 WAL 子进程；`dist/optimize-rpc-race-final.log` 两包 race 通过。生产三参数/未知 fixture 参数拒绝与默认 `0.0.0.0:7172`/`piwork-core:7172` 接线由直接单元验证，未另跑共享宿主上的生产固定端口 smoke。

旧临时 `dist/apply-final-gate.py` 已增加无条件 retired 入口保护，保留其原正文供历史查证；即使被手动误启动也不能再次调度或写旧任务。源码中的唯一完整入口为原 Make 目标调用的新运行器。


相关检查：Agent 当前 `npm run test:unit` 205/205 PASS（含两个新 timer 测试）；运行器/Node fixture 19/19 PASS。Go Core 单元包 PASS（81.764 秒），app/testsupport/cleanup 最后相关单元 PASS，RPC 两包 race PASS。实际宿主 build、当前 production/acceptance Agent、兼容 SDK/registry、file/snapshot helper 与 workstation/历史桥接镜像均经新准备入口构建；当前身份见各结果的 `identity`，没有推送或发行。native、WebUI dependency、docs、incremental style、Docker quickstart 及 image boundary 检查通过。三参数、重复/未知/fixture 参数拒绝、默认 RPC 接线及生命周期回滚均有直接测试。

本批无 proto、HTTP DTO 或 history schema 修改，故不新增/反向手改生成协议，也无需额外重生成这些无关链；WebUI 生产源未改，原资源链已在准备阶段重建，并以准备前后源码 hash 恒等核对。浏览器夹具变更由 TS 测试编译与上述实际浏览器回归覆盖。未运行远端 CI、真实模型、SELinux 专属主机、独立 DIND 重启或显式旧 Core ELF opt-in；完整入口的实际 skip 仍需据同次结果核对。


代表性串/并对照：`dist/optimize-benchmark-comparison.json`，固定四项各 4/4 PASS；两轮源码 `259ef32455885e5376f3b231efb5245d812c32d1995885048007fe7babec95ee`、工具链、配置、compiled harness、镜像 ID、二进制 hash 与用例清单均恒等，均验证并复用同一份准备、不复用测试结论。串行执行 66.103 秒，总计 69.731 秒；四 worker 执行 53.268 秒，总计 56.917 秒，总墙钟减少 18.4%。两轮 compile 分别 3.010/2.981 秒，cleanup 0.010/0.011 秒，prepare 均为 0（已核验的缓存制品）。该收益只适用于该工作集，不声明全量加速倍数；原旧失败候选不能作可比全量成功基线。对照期间没有并行运行本任务的其他验证，不控制或停止用户既有安装。


第一轮新完整入口 dist/core-integration/2026-11-03T04-21-01.374Z-1479950/result.json 明确保留为 aborted：完成 174 个 unit，157 PASS，原 16 项仅 3 项已通过，不能消费为完整证据；执行 157.492 秒后中止，精确 cleanup 1.199 秒、ledger 30 个 scope 均报告 clean，9 个原无关容器哨兵仍存在。发现 test2json 分片误用仓库 cwd，导致相对 testdata/ 和 ../identity、../workpackage、../../fixtures 读取失败；修正后的 workerInvocation 保留 Go 原有 package 源码目录执行语义，并新增真实子进程正/负读数测试。dist/optimize-cwd-regressions 六项全部 PASS，保留旧失败而非覆盖或自动重试改写。

该轮还真实复现 TestNativeBrainAcceptedActionGapRecovery 的只读 SQLite 验收查询遇到临时 writer lock，原无 busy handler 导致立即报 ERR_SQLITE_ERROR。仅为该用例两处直接观测查询设置 SQLite 5 秒 busy_timeout，等待锁释放；原 Action/Job 各出现一次、Run 次数、恢复与 needs_attention 断言均不变，不重放业务动作、不缩短产品预算。四进程复验和新完整运行单独记录。当前 runner 直接测试增为 20/20，另拒绝五包中某包清单为空；结果 JSON 改为同目录原子替换，读取实时进度不会见到截断 JSON。

工作目录与只读观测修正改变执行候选，前一组串/并对照只属于原源码身份，不能充当最终候选的同条件证据；最终需重新固定候选和对照，旧文件及原 SHA/dirty/镜像身份不改写。


第二轮完整入口 dist/core-integration/2026-11-03T04-32-21.740Z-1580321/result.json 已完整执行 495 个 unit：488 个顶层 Test PASS、6 条已解释条件 SKIP、1 个 Test FAIL（WebDAV）；另一个 Go Test PASS 的 startup sampler 被进程清理判定标为失败，不能当作全量通过。总墙钟 1011.275 秒，执行 997.248 秒；原 16 项 15 PASS。此身份的串/并四项对照总计 80.353/46.794 秒，仅作为该旧候选的记录，后续代码修正后不转用为最终候选证明。

取消 I/O 触发 401 的根因、owner 修复与真实重复结果同步归属 repair change。新 afterFileCancellation 只用于文件 deadline/body 资源，stop 幂等且等待已启动回调，连接级取消后主动退役旧连接；不新增产品配置、改变认证和默认预算。直接测试用 Go synctest 的可控调度证明回调在连接复用前完成，真实 net.Pipe 验证下一次读；旧 stop 不等待的诊断 overlay 被该回归拒绝，源码保持修复版本。

运行器进程清理现在区分已退出的 zombie 与仍活动的子进程；成功包的遗留自有子进程须在有界清理后确认为无活动成员，原进程非零、超时、取消或清理未确认仍失败。每个进程的真实 exit/aborted/timedOut/orphaned/cleanupConfirmed 写入 processes.jsonl，CI 同步保留该文件。自动调度上限集中为 8，继续按可用并行度收缩、探测失败回退 1；显式 N 及单 worker 的覆盖/判定相同，不设置 CPU/内存/主机或分钟门槛。合成调度覆盖 1/2/5/8，当前运行器直接测试 22/22 PASS。


并行门禁随后实际复现 Package queue 的 ListContainers 在 list→inspect 间目标 helper 被回收，原封装把一次确认 404 当作整次 Engine 观察失败。Runtime.ListContainers 只忽略该已确认消失的 ID，继续 inspect/核对存活资源；503/其他错误与存活项跨 installation 标签仍失败。direct fake Engine 三种分支与 race 通过，真实队列/容量/新上下文合并场景单独复验；不改队列容量、慢脚本或生产重试预算。


上轮最终候选 b323d2fa69688b56ef298076f65a844084a4f479b1db0db23159aab18ec97734 的采样已修正过程清理后实际 PASS，processes.jsonl 确认为 exit=0、orphaned=true、cleanupConfirmed=true；不把已清理的自有子进程误判为原包非零退出。该候选四项串/并 4/4 PASS 的实测总计 70.317/56.903 秒，仅对应该身份，后续 list 竞态修正不会转用其结果作同候选证明。其完整运行在发现 Package 竞态后有界中止，状态为 aborted，旧日志继续保留；WebDAV 在该真实全量中已 PASS。后续新完整候选需再次独立通过，绝不拼接旧执行。

最终固定代表性工作集在执行前选为真实 Core 进程启动、SDK Chat 模型、Service 修订/移除和原生镜像静态边界四项，分别是 TestNativeCoreProcessHealthIdentityRestartWithoutHostTools、TestNativeChatModelSelectionRunsThroughGoAndRealSDK、TestNativeServiceRevisionsCounterAndRemoval、TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence。两轮使用同一候选、同一清单和已验证准备，只改变单/多 worker，收益声明只覆盖该集合。此前不同候选的 crash/drain 四项对照作为历史记录保留，不拼接或比较为最终候选加速倍数。

并行完整运行 dist/core-integration/2026-11-03T05-32-19.993Z-2320698/result.json 完整执行 499 项，原 16 项全部 PASS；全量仍 failed，因为 TestNativeServiceExitDiagnosisAndWorkRecovery 使用固定 400ms/2500ms 猜测实际阶段，在 Docker start/inspect 延迟变化后提前退出并得到 SERVICE_START_FAILED。原全量及诊断不改写为成功。用例调整为：before-ready 的进程仅在收到真正的 readiness HTTP 探测后退出；after-ready 仅在 create Operation 已成功、由 Agent 在共享 workspace 发布且 Service 通过只读挂载观察到明确信号后退出。退出码 0/7、readiness/recovery 阶段、Work degrade/恢复、原成功 Operation 不改写的断言均保留；移除对宿主调度快慢的阶段假设。首次新夹具因挂载时 workingDirectory 不符服务规范被实际 API 拒绝，修正为挂载内目录后，dist/optimize-service-exit-regression-v2 真实用例通过。当前完整清单仍为 499 项；新候选独立执行，不拼接上一轮 16 项证明。


## 最终完整验收（2026-11-03）

具名原入口 make test-integration-go 默认 auto 实际准入 8 个 worker，完整结果 dist/core-integration/2026-11-03T05-53-27.832Z-2653395/result.json 为 full/passed：499 个顶层用例恰好一次，493 PASS、0 FAIL、6 条既有可选条件 SKIP，原 16 项 16/16 PASS。五包逐 unit 的包终态和真实进程退出全部成功；清理确认，9 个原无关容器哨兵仍存在。没有后台 worker 或第二个活动门禁，也没有自动写 OpenSpec 的运行器。此前失败/中止不改写为成功。

源码输入 SHA256 913a29bfe42e2a6e81f24793cd0b9654ab6125f404777e4255472ff7d57a5007；Git 3822c238579e1c4db2ff6090acf5786835d9e451，modified=true；工具链 {'node': 'v24.20.0', 'go': 'go version go1.25.5 linux/amd64'}。测试二进制/配置/compiled harness/镜像的逐项冻结数据归 result.json，compiled 清单按键排序紧凑 JSON 的摘要 2e3ca8804cd3e45c14478c6e86e068411f6f33c4a4196e8465aa9b82be306000。结尾再次从真实工作区和 Docker inspect 核对源码与全部镜像 ID 恒等。

| 完整包 | 实际发现/执行数 | 包与进程 |
|---|---:|---|
| piwork/internal/coreapp | 419 | 全部成功 |
| piwork/internal/dockerengine | 56 | 全部成功 |
| piwork/internal/packageprepare | 7 | 全部成功 |
| piwork/internal/testsupport | 7 | 全部成功 |
| piwork/internal/workruntime | 10 | 全部成功 |

| 阶段 | 墙钟秒 |
|---|---:|
| 共享准备（镜像层缓存命中） | 10.569 |
| 宿主构建 | 0.640 |
| 本轮测试/夹具编译 | 3.070 |
| 执行 | 658.198 |
| 最终精确清理 | 0.076 |
| 总墙钟 | 673.189 |

本轮准备命中 99 个 Docker 缓存步骤，未从旧结果缓存取得 PASS。最终候选未另行清空全部 Docker 层测冷构建；此前其他候选的冷/热准备只保留各自实测身份，不当作本候选收益。

实际固定镜像身份：

- piwork-agentd:go-migration-acceptance：sha256:d1d821164df751f36a32914ec205a9bfecee94f53f5da1b2f0cdf6b68c6ab106
- piwork-agentd:go-migration-production：sha256:e36e317823bb464c0258d5d20bc88f15e121ee444284409182df9678e5a10dec
- piwork-agentd:go-migration-registry-unavailable：sha256:66794559e2308e28cff98fb02b41b955a627c11ddaec39526e57e3742275e7a7
- piwork-agentd:go-migration-sdk-0860：sha256:20bccd86ef89fbe44a09ddbf02331b01f133171ceb5f084af9721e4960d3927e
- piwork-agentd:synthetic-incompatible-helper：sha256:df42ae4f999ba215dde7fa13fe4e057597ff0a8b6e8f6b380bc1968504b2b07f
- piwork-file-helper:go-migration-acceptance：sha256:ecd00a1e887b5a2e907483496413a00e54f23fc04871327aaff48bb209a45475
- piwork-memory-history4-web-base:acceptance：sha256:26000d925aa901691c699858db29172ce6d8d49fd2c56ed42852015d448d0bfa
- piwork-snapshot-helper:go-migration-acceptance：sha256:9a31d4bc50a76572701f389be09e4a0fb6d57f56e34b9c0154d110731553b9f9
- piwork-workstation:acceptance：sha256:6254c3683e3556ca6a62bde764ed693d330281ebb28cc6eb9cecc6bc6235b472
- python:3.13-slim：sha256:bdfc738a8a869292ec1b01f1b8e620db533e09d1fe68fe980a7118b22dae9cec

条件 skip（均非原 16 项）：

- TestNativeOptionalRealModelSmoke：PIWORK_TEST_REAL_MODEL_ENV 未配置/未 opt-in。
- TestNativeSchema5UpgradeRollbackAndDowngradeFence：source and current acceptance images required 未配置/未 opt-in。
- TestNativeSELinuxSnapshotRejectsUserAttributesAndRetries：SELinux Enforcing 未配置/未 opt-in。
- TestIsolatedRealEngineIdentitySurvivesDaemonRestart：PIWORK_TEST_ISOLATED_DIND_IMAGE 未配置/未 opt-in。
- TestNativeNewAgentRejectsTemporaryModeAgainstOldCore：PIWORK_TEST_OLD_CORE_BINARY 未配置/未 opt-in。
- TestNativePreparationRecordsPermitOldCoreRollbackAndUpgrade：PIWORK_TEST_PREPARATION_OLD_CORE 未配置/未 opt-in。

最终代表性四项比较为 dist/optimize-benchmark-stable-comparison.json：相同源码、compiled harness、工具链、配置、镜像、二进制 hash 与清单；串行执行 54.380 秒、总 58.077 秒，多进程执行 24.636 秒、总 28.322 秒；总墙钟减少 51.2%，该收益仅对应固定四项，不声明与旧失败全量候选之间的加速倍数。两轮 prepare=0，均先验证同一准备；compile 分别 3.062/3.049 秒，cleanup 分别 0.009/0.008 秒。

最后新增文件取消/连接退役三项和 Docker 快照列表竞态直接/race 测试通过；旧回调实现的 synctest 负例明确失败，新版本通过。正式 CI 配置已核对，远端 CI 未运行；没有同步主规格、归档、提交或发布。

最终三个所属 change 的 strict、文档路径、增量风格、native/UI 依赖、镜像边界、quickstart 检查（含 30 项正反例）和 git diff --check 均通过。最终完整结果已核对后才维护任务；本 change 19/19，repair 5.2 完成。

用户本轮明确单一 Docker Engine，不扩展多 Engine 适配；此前 WARNING 2 不适用于本次范围。授权修复 WARNING 1/3：进程 owner 使用 Linux subreaper 保留 setsid/detached 后代归属，等待内核确认全部子进程回收；prepared 身份加入有效构建配置摘要，排除仅调度参数。只触达 scripts 开发运行器和直接消费者；不改产品入口/协议/UI，不重跑无关浏览器或镜像验收。此前完整 499 项通过保留为原候选历史，不冒充本轮源码验收。

本轮 WARNING 1/3 修正完成。process owner 使用 Go Linux subreaper，原始命令 stdout/stderr 仍由 Node 消费，fd 3 单独返回原进程退出码及清理确认；原命令退出后内核把已脱离进程组/会话的后代交给 supervisor，逐项有界停止并 wait4，只有 ECHILD 才确认全部回收。Node 外层保留取消/超时兜底，缺少回执不计为成功。真实回归覆盖成功、失败、取消三种 detached 后代，PID 已被 reaped（ESRCH），无关进程哨兵保持存活。

prepared 身份新增构建配置摘要，包括环境中的构建键、go env 生效设置和显式 release metadata 内容摘要；不记录原始可能敏感值。TEST_JOBS 等纯调度设置不影响复用；GOFLAGS/CGO 等改变、旧 prepared 格式缺少配置字段时均拒绝。配置参与执行前和结束时的一致性核对。实现中曾发现 go env 的 GOGCCFLAGS 含每次探测随机生成的临时 CGo 路径，会产生假漂移；本项目及 supervisor 均关闭 CGo，故剔除这一派生字段，真实 CGO/GO 配置仍参与摘要，加入稳定性负例。

验证：dist/verify-fix-units.log 25/25 PASS；Go supervisor/cleanup 包检查、native、style、docs 及 diff 检查通过。dist/verify-fix-prepared-positive/result.json 真实入口局部 3/3 PASS（Core 崩溃接管、跨安装清理哨兵、动态端口重启/冲突），从准备时 jobs=1 切换 jobs=2 被正常接受。dist/verify-fix-prepared-negative/result.json 为预期 failed：GOFLAGS 改变被拒绝、results 为空，未启动测试安装。dist/verify-fix-current-preparation-v2 为当前配置正向准备/执行通过；首次临时字段导致的失败记录保留。

用户明确不会测试多个 Docker Engine，第 2 项不属于本次范围，不新增 Engine 适配或测试。此前完整 499 项/11 分 13 秒是原候选历史，本轮只修改开发测试监管和准备校验，执行上述适用回归，不声称已重新运行新源码的完整集成；没有修改产品运行参数、业务代码、主规格或进行归档/提交/发布。
