# Piwork Brain 的 Go 验收

本次实施基于 master `a980c189be074c2a6d87cc88d7f942fbab7998c4`，工作树为 `rebase-piwork-brain-onto-go-core`。平台程序、业务资源控制、凭据与实例身份、候选准备、历史校验和环境分享均通过 Go Core；保留的 TypeScript 只用于 Agent、Pi SDK、extension、契约和浏览器。测试使用确定性模型，无线上 provider 凭据。

## 八条闭环

| 回路 | 当前验收入口 | 必须观测的结果 |
| --- | --- | --- |
| 默认创建 | 原生 Work 创建与实际 SDK 资源加载测试 | 普通 piwork-brain 默认包、可编辑源、captured active，无热加载 |
| 观测 | `brain_workstation_integration_test.go` | 真实 NiceGUI 页面/WebSocket 完成 Todo、页面访问与业务动作入库，普通事实不启动模型 |
| 自动处理与异步 | 同上 | 明确请求启动自动 Run、原 Job 等待释放 Run、手动 Chat 可用、原 Job 与制品被验证 |
| Service 改进与经验 | 同上 | SDK 修改业务代码、权威查询证实结果、有效经验在下一 Run 采用，已受理 Run 快照不变 |
| 脑包采用 | 同上与 `brain_candidates_integration_test.go` | 固定来源捕获、独立 Apply、真实 loaded、匹配工具/input/全部 checks 的实际 SDK 证明 |
| 恢复 | `TestNativeBrainAcceptedActionGapRecovery` 与候选生命周期测试 | 原 Action 已完成/仍执行/无法证明三种中断恢复，不重复副作用；候选原 ID 与第一次 Apply 期限保持 |
| 独立分享 | 工作站验收的 `shareCopies` | schema 4 全闭包 .work，两个新 Work 身份，旧反馈 historical，各副本新反馈和新候选各自获得实际 SDK 证明 |
| 模型选择 | `run_models_integration_test.go` | 两个实际 SDK 模型、Session 偏好确认、不可变 actualModel、原键重放与显式 selector |

`scripts/native-host-acceptance.mjs` 将这些回路接到三个 release 程序运行的 scratch 宿主与独立 Engine。开发机器只驱动浏览器与 fixture；产品宿主没有 Node、npm、Python、shell、Go 或 Docker CLI。业务服务没有宿主发布端口，浏览器通过 Go CLI Service 代理访问 HTTP/WebSocket。fixture 镜像在验收准备阶段构建，服务部署只使用现成镜像。

## 执行入口

```sh
make generate build test
make test-integration
make test-native-host
node scripts/check-native-boundary.mjs
node scripts/check-native-image-boundary.mjs
node scripts/check-go-acceptance.mjs
openspec validate rebase-piwork-brain-onto-go-core --strict --no-interactive
```

`make workstation-fixture` 单独准备 Python/NiceGUI 的离线 wheel 镜像；这只是例子，不限制后续 Service 的技术栈。完整测试包含原生 helper、实际 mTLS Agent、真实 SDK/MCP、Go HTTP、CLI/本地 Desktop API，以及 master 产品 UI 回归。

故障验收区分包加载失败与已加载行为失败：前者以 Go Apply 的原 Operation 和 prior active 恢复为依据；后者保留已加载环境并将请求置为 needs_attention。历史请求只能读取，不能自动续接或 Retry。验收只清理本 fixture 的安装、容器、volume 与临时文件，不清理其他工作树资源。

加载失败场景会在候选发布后保存无关 AGENTS，确认新 context 对同一候选的失败 Apply 仍关联原请求、保留新编辑并恢复 prior active。已加载行为失败场景必须锁定新候选的 live requestId、对应实际 Run/失败 SDK checks、当前 active/loaded 和未改变的有效经验；此前加载失败记录不能满足此断言。

当前协议为 package-helper contract 2、Work history schema 4、runModel contract 1、workFeedback contract 1。不存在旧平台兼容、旧历史升级或双协议入口。

## 本次实际执行

最终发布包 `dist/release/piwork-linux-amd64-a980c189be07.tar.gz` 使用当前未提交工作树构建；revision 标记对应上述 master 基线，不能将它误认为已提交的实现版本。生产 Agent 为 `sha256:8259a6e73fbeb48fdaca92237a15a7dff763c2e52bef78f7f331fd1d00255389`，验收 Agent 为 `sha256:4a3e745a8fc8cbe836e6187905f621f3da72af2b9ba2f8089969dfa4f3719f3b`，File helper 为 `sha256:fc88bd025502d13cb1984296f4c3e6118fe7909f7b79540e0e9d532971a4cc07`，Snapshot helper 为 `sha256:5bef4e8bffc2b071ad48ff892d229d49fefc04e198999850c5eb08a13e2d6495`。

2026-10-04 前次 scratch fixture `piwork-native-host-da5f22b9-7c3a-4db7-bff2-f310b1ec077b` 的八条回路均 PASS，包含 W1～W4 修复及丢失 Apply context 不得隐藏候选的异常处理，结果见 `/tmp/piwork-brain-fixes-scratch-final.log`。前次 `piwork-native-host-7f72537d-d340-4d3f-a250-1ecf4785f331` 结果保留为历史证据。执行命令为：

```sh
PIWORK_TEST_RELEASE_BIN=dist/release/piwork-linux-amd64-a980c189be07/bin \
  node scripts/native-host-acceptance.mjs
```

实际部署由 SDK 调用 Go MCP；浏览器经 CLI 代理操作 NiceGUI；两个导入副本都在新身份下取得自己的新反馈和候选 SDK 证明。前一轮同样通过的 fixture `piwork-native-host-30cd0556-96c4-4bbf-88b4-38d31bd0d521` 还实际覆盖 CLI `--wait` 的观测窗口结束后按原 Operation 只读等待终态，没有重新提交导入，见 `/tmp/piwork-brain-scratch-original-id-final.log`。该次进程清单只有 `piwork-serve`、`piwork-cli`、`piwork-console`，所有 fixture 资源已清理。

其余当前测试结果、规范映射和集成批次记录见 `openspec/changes/archive/2026-10-04-rebase-piwork-brain-onto-go-core/verification.md`；master 的 970 条历史验收记录只作索引回归，不代替本次实际测试。

最终五个 Go 集成包的 215 项必需顶层测试均有实际 PASS 证据（Core 169 项，其他四包 46 项）。初批次有失败并在 90 分钟上限终止；全部失败和超时后的遗漏已按原测试名称修复、补跑并核对完整集合，原失败命令未改记为 PASS。后续完整批次上限为 120 分钟。本次不启用需要额外凭据的可选线上模型 smoke。构建/单元/类型检查、两套浏览器、真实 Desktop 大包往返、最终 scratch 八回路和源/镜像/发布边界检查均完成。

## 上一轮 W1～W4 修复后的执行记录（2026-10-04，历史）

W1～W4 对应回归全部通过：Apply 按同 Work、发布后受理及相同启用内容关联，缺失 authority 明确不可用；Retry 四类查询返回后重读 live/期限/生命周期；Details 提供安全基线、固定 checks 和原 Apply；坏行为验收锁定新 requestId/实际 Run、失败 SDK checks、仍 active/loaded 和有效经验不变。

- `make generate build` PASS；首次 `test-go` 的 CLI 临时控制文件名碰撞如实保留，夹具修复后 `make -o build test` 全部 PASS。保留 TS 单元 142 PASS，最终 Core/contracts/CLI 三包非缓存回归 PASS。
- Desktop 浏览器 166 PASS，五分钟票据过期专项 1 PASS；Serve UI 49 PASS；真实 Go Core/CLI Desktop 全流程 PASS，`mainReloads=0`。
- 五个真实专项 PASS：工作站 489.16 秒、Chat 双模型 42.92 秒、Service 身份/重放 79.21 秒、候选 RPC/显式 Apply 73.15 秒、三类中断恢复 112.28 秒。工作站实际失败 SDK checks：新请求 `request-c76ba018-1179-440d-8018-386f29a162c9` 对应 Run `run-04d335df-51a2-4d14-9b43-42b68543f51a`，`review_format: failed`，候选保持 active/loaded，经验未变。
- 当前生产/验收/两个 helper 镜像、release 重建及源码/镜像/发布边界、OpenSpec strict 校验通过。最终 scratch 使用的 Core SHA256 为 `9550bee09f8ed55e6f8437b0173a288a92257c628c51350a747ec4907d385710`，与 `dist/go/piwork-serve` 相同；宿主只有 Go 平台进程，所有 fixture 资源按所有权清理。

证据见 change 的 `verification.md` 及 `/tmp/piwork-brain-fixes-*.log`。该轮未重跑整个 120 分钟集成集合；原 215 项必需测试的历史执行仍保留，该轮新执行和两次 scratch 不替代这些记录。

## W5 修复后的当前执行（2026-10-04）

显式 Retry、完成事务及 Go 静态历史校验都核对原 Job 与 Action 的归属。原 Job 不能被替换，Action 暂未返回 Job 时保留原引用；错误回执不启动验证 Run、不记录为目标的有效 Job evidence、不完成请求或提交经验。普通无目标关联的只读 Job 观察仍可用。

- WorkStore 39 + Agent 74 项完整单元 PASS，Go workhistory/workpackage/snapshothelper/coreapp 四包非缓存 PASS。直接 finish 和导入历史的错误关联、缺 Action 等负向用例均拒绝，正确关联仍完成并提交有效经验。
- 修复前同一真实本地 HTTP 反例在当前生产模块返回 `needs_attention/INVALID_WAIT`、自动 Run 0、原请求 cancelled、mutation 1，退出码 0。该异常组合使用受控模型夹具，不宣称为 Docker 内的异常注入。
- 新镜像及 release 下的 scratch fixture `piwork-native-host-2808c4db-ddbc-4708-9178-19c4975bcc32` 八条回路 PASS；两个独立导入副本均保留历史，并各自产生新反馈和实际 SDK 候选证明。产品宿主仅运行 Go 程序，自有资源已清理。
- 构建、发布、source/image boundary、release checksums、OpenSpec strict 与任务状态校验 PASS；当前 Core SHA256 仍为 `9550bee09f8ed55e6f8437b0173a288a92257c628c51350a747ec4907d385710`，快照 helper 包含新的历史关联校验。

证据为 `/tmp/piwork-brain-w5-*.log` 与 change 的 `verification.md`。本轮重跑了受影响单元、Go 包、原生构建、发布和真实分享八回路，未重跑未修改的浏览器集合及完整 215 项 Go 集成，原结果保留为历史执行。当前规划为 43 个 requirements、188 个 scenarios、26/26 项任务，W5 修复检查无未处理 WARN；未提交、合并或归档。
