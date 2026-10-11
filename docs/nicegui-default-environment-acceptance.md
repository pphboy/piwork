# NiceGUI 默认环境验收记录

本记录对应 `restore-nicegui-default-environment`，分别保留初次实现与页面身份修复的实际执行事实；不同候选的通过结果和测量不互相替代。

## 范围与状态

初次实现阶段的 NiceGUI contract-2 base 运行、依赖扩展、真实 SDK/MCP/Core/CLI/浏览器、完整 brain 与 scratch 宿主检查已通过。本次只交付本地候选，未推送镜像，未取得新版远端 registry digest；正式默认引用保持 candidate，不能称为远端可用。初次阶段的仓库完整构建/单元与类型检查、schema-4 迁移恢复与回滚/降级隔离回归均已通过。页面身份修复后的当前候选验证已完成，独立列出本轮重跑的检查及实际身份。

## 旧环境基线

- 基线源码：`5818e1de7bb5af9bd6305777fc88b40505a708b3`，默认脑包 `1.1.0`。
- Docker Engine：`26.1.5+dfsg1`；WSL2 Linux amd64，32 个逻辑 CPU；开发机 Node `24.20.0`、Go `1.25.5`。测试应用配额与每个场景的缓存条件记录在原始结果中；镜像已预备，镜像构建/拉取时间不计入应用启动。
- 原固定 base：`docker.io/pphboy/piwork-web-base:0.1.0-03395d0810f7-bbb24bdd0167-dirty@sha256:e83902fb568e97b2d01d488ce7c9c3d15f373ab58b46e041337baa832b8cfb81`。
- 实际 image ID：`sha256:3be06cbe6450c63d6def67cd2948be08fed635615a7d9d8982c2e710b5c06f3a`；原构建输入 hash：`bbb24bdd01672d007a68ef37402bd9548e0dca91527bc55a69394e3176e70665`。原制品的 commit/dirty 身份保持原值，不改写为本次基线源码身份。
- 冻结的源码、二进制、候选清单、阶段结果和原始日志位于被忽略的 `dist/nicegui-baseline/`；运行入口为其中的 `run-baseline.py`。镜像检查沿旧 `check-web-base.mjs` 增加纯计时，业务通过条件保留，显式离线准备和准备后的首次启动分别计量。
- 完整回路使用修改实现前编译的 `coreapp.test`，执行 `TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior`。测试只增加 chat/control/export/import 耗时及 workspace/快照字节日志，不改变业务断言、恢复预算或两份独立分享覆盖。

## 完整旧脑包迁移输入

仓库保留 [piwork-brain-fastapi-1.1.0.zip](../internal/coreapp/testdata/piwork-brain-fastapi-1.1.0.zip)，仅供迁移测试，不进入当前交付脑包。它包含该源码的完整认知、extension、部署 Skill/初始化入口、Reference、两个应用模板及依赖锁文件。

- 大小：96,235 bytes。
- SHA256：`47a8ef87a2782d810d1d45b76c42dc12e26530a1567abf81f2fe870335992333`。
- `go test -mod=readonly ./internal/coreapp -run '^TestFastAPIBrainMigrationFixtureIsCompleteAndPrepared$' -count=1 -v`：PASS。测试核对实际版本/旧栈资源，并经过现有 native 解包、OpenTree、ValidateArtifact 与 PackArchiveToSpool 流程。

## 初次实现候选的前后测量

本节 NiceGUI 数据对应输入 `85fb0b1a7e60bfa243929df5218300176fa4622b8d3edcd12bc02956ac0258c5` 的初次实现候选，保留其原测量，不转写为后续修复候选。以下为实际执行。两侧标准应用使用已预备镜像、干净应用依赖目录及 250 CPU ms；计时包含相应 Docker 命令。完整回路使用原场景/断言，两份导入各有新反馈及 SDK 候选验证。旧基线完整回路最终失败，不能将本表完整运行时长算作两次成功的性能倍率。30 分钟预算不是性能结果。

| 项目 | 旧 FastAPI/React 实测 | NiceGUI |
| --- | --- | --- |
| 标准依赖离线准备，250 CPU ms | 31,969 ms | 928 ms |
| 准备后的首次启动，250 CPU ms | 14,434 ms | 7,284 ms |
| 相同输入普通重启，250 CPU ms | 18,929 ms | 3,913 ms |
| 镜像检查 workspace 文件大小 | 198,238,658 bytes | 140,804 bytes |
| 完整回路分享前 workspace 文件大小 | 198,511,007 bytes | 329,445 bytes |
| 源 `.work` 大小 | 1,232,137,665 bytes | 816,053,530 bytes |
| 源导出 / 第一副本再导出 | 18,667 / 17,051 ms | 10,864 / 10,287 ms；第二副本再导出 12,277 ms |
| 两份独立导入 | 84,449 / 80,502 ms | 8,007 / 9,903 ms |
| 完整回路本次运行 | 620,224 ms，FAIL | 557,170 ms，PASS |

首次完整回路在浏览器直连私网时因环境代理返回 `ERR_EMPTY_RESPONSE`，87,053 ms 后失败；保留 `brain.log`，不算业务通过。排除测试进程的环境代理并明确 Chromium 私网直连后，第二次运行的页面操作、反馈修复、原异步 Job、候选 Apply、两份独立导入和各自的新反馈/SDK 证明均已执行到对应断言，最后一次再导出以 `SNAPSHOT_EXPORT_FAILED` 失败；原始输出为 `brain-direct.log`。该次失败不被写成完整回路 PASS，未取得的最终导出成功耗时不补造。

快照包含私有历史等数据，不能把其全部大小归因于 React 应用依赖。后续仅对同条件且成功取得的阶段作性能比较，并分别保留完整验收状态。

## 初次实现候选身份

- 版本引用：`docker.io/pphboy/piwork-web-base:0.2.0-5818e1de7bb5-85fb0b1a7e60-dirty`。
- 实际 image ID：`sha256:b76d1d8caf914fbcba2feb53c01af3a30b79028b5f0153d58b84f3c089a8a960`。
- 输入 SHA256：`85fb0b1a7e60bfa243929df5218300176fa4622b8d3edcd12bc02956ac0258c5`。
- 构建 commit：`5818e1de7bb5af9bd6305777fc88b40505a708b3`；dirty：`true`，保留实际身份，不改写为后续 Git 提交。
- 平台：Linux amd64；Python 3.13.16、NiceGUI 3.18.0、pip 26.2.1、sqlite3 CLI 3.40.1。依赖以镜像环境清单与仓库 lock 为准。
- 候选清单与详细机器可读证据位于被忽略的 `dist/web-base/`；维护源为 `deploy/images/web-base/`，旧发布身份另存于其中 `releases/fastapi-react-0.1.0.json`。

## 初次实现阶段验证

本节的原候选清单、release、验证 JSON、验收记录和日志已留存于 `dist/web-base/history/85fb0b1a7e60/`。其中 Action 接受窗口恢复、scratch 宿主、包采用和 schema-4 回归在此前实现阶段执行；适用于各自日志所记录的版本及其未改变的恢复/宿主边界，不作为后续页面身份修复候选已重新通过这些专项检查的声明。后续候选独立列出重新执行的范围。

| 检查 | 结果与原始依据 |
| --- | --- |
| 标准 workstation/web-app 离线、只读根、真实 HTTP/WebSocket、SQL、无标准环境副本、检查失败/恢复、重启持久化 | PASS，`standard-current.log`、`starter-current.log`、两份 validation JSON |
| Python 工具检查复用、输入失配、页面/业务/环境版本、实际加载版本 | PASS，5 个工具用例（含离线重建输入变化拒绝），`tools-validation.json` |
| 明确额外包安装、实际应用/命令、固定基础包、两个应用隔离、冲突/下载/完整性失败、并发/输入变化、断网/移动/环境变化重建 | PASS，`dependencies-final.log`、`dependencies-validation.json` |
| 真实 Core/SDK/MCP/CLI/浏览器、页面/业务/镜像环境自动采用、草稿/非根路径、开发重载、失败恢复、原初始化拒绝、内存/派生/生命周期 | PASS，`core-current.log`、`core-main-validation.json` |
| 实际 SDK 安装 Python 包、原 Operation、应用验证 Query、停用注册表后的重启/导入、草稿存储失败保留并恢复 | PASS，`core-current.log`、`core-dependencies-validation.json` |
| 完整 brain 回路、三次导出、两份独立导入各自新反馈/SDK 证明、候选成功/加载失败/行为失败与 Memory/原 Job 续接 | PASS，557.17 s，`brain-current.log` |
| Action 接受但尚未登记等待的中断恢复 | PASS，135.80 s，`brain-full.log`；保留原 Action/Job，不重放 mutation |
| Core 更新内置 catalog、旧 1.1.0 Work 保留、新 Work 加载新指导、显式空包与实际 SDK 工具、候选不冒充已发布 | PASS；`brain-adoption.log` 中旧包保护/候选拒绝通过；原过时 schema-4 断言修正后，显式空包场景在 `brain-full.log` 72.52 s 通过 |
| scratch Go 宿主与独立 Engine、真实用户浏览器、反馈/修复/Job/Memory、候选恢复和两个独立分享 | PASS，fixture `piwork-native-host-f484a327-d8d0-49e7-b724-e75d0d5ccbfc`，`native-host-check.log` |
| production/acceptance Agent 与原生 helper 镜像边界 | PASS，`native-image-check.log` |
| make test（含 build、Go/TS 单元与浏览器资源类型检查） | PASS，`make-test-final.log`；先前新增候选夹具漏同步说明的失败保留在 `make-test.log` |
| Quick Start 候选输入约束与已发布材料身份保护 | PASS；新候选仍拒绝输入漂移，发布记录只核对原身份和当前部署材料，不为新源码重写旧发布 SHA |
| 本地发布前证据、旧栈/失配/缺项拒绝、远端 tag 冲突保护 | PASS，`publication-current-preflight.log` 与发布入口测试；实际只执行 no-push preflight；旧候选 `publication-preflight.log` 保留原身份 |
| 旧 schema-4 迁移/进程恢复 | PASS，crash/stop/delete/apply 四分支 639.22 s，升级回滚/降级隔离 204.70 s；`history4-regression.log` |

web-app 独立检查的准备/准备后启动/重启为 999/7,810/3,924 ms，workspace 为 139,221 bytes。带额外包的真实 Core 分享快照为 815,968,444 bytes，注册表 disabled 的 stopped 导入在显式 Start 后实际读到 `1.0.0`。

快照仍有约 816 MB 的私有运行/历史内容，不据此删除 Agent SDK 或私有存储。默认应用环境复用主要减少应用准备、可写依赖文件和分享扫描工作；本记录分别给出已改善阶段及完整失败/通过状态，未承诺任意用户应用都会获得相同倍率。

## 页面身份修复后的当前候选

W1 已通过可扩展的 `page-files.json` 页面输入集合修复：清单中的辅助模块与本地资源参与 frontendVersion，独立业务实现保持页面版本稳定，无清单应用沿用默认集合。S1 已将最终发布预检引用纠正为 `publication-current-preflight.log`，历史日志保留原身份。

- 当前固定本地 tag：`docker.io/pphboy/piwork-web-base:0.2.0-5818e1de7bb5-6b6f6f8bbf62-dirty`。
- 实际 image ID：`sha256:1b2dc23ea6cc78f5986217a5c133f045334c81d30a53c833f73aa59abdad87a1`。
- 输入 SHA256：`6b6f6f8bbf625e2b36502349e5ba13992060aeab4b5239436c3288919ae7d44e`。
- 构建 commit：`5818e1de7bb5af9bd6305777fc88b40505a708b3`；dirty：`true`；Linux amd64，环境 contract 2，标准 Python/NiceGUI/pip/sqlite3 版本与上文相同。
- `dist/web-base/page-files-run-identity.json` 保存开跑身份、Go Core 二进制摘要、验收角色镜像及共享 tag 变化诊断；本节相对日志/JSON 名称均位于 `dist/web-base/`。镜像构建日志为 `page-files-image-build.log`，与已预备镜像内的应用计时分开。

| 当前候选检查 | 结果与证据 |
| --- | --- |
| 只读根、离线 Python 工具、页面辅助模块/资源、清单增删/兼容及无效输入拒绝 | PASS，21 用例，`page-files-tools.log`、`tools-validation.json` 的 8 项检查 |
| 标准 workstation 与 web-app | PASS，`page-files-standard.log`、`page-files-starter.log`，两份标准 validation JSON |
| 两套模板无清单与嵌套辅助模块 | PASS，4 组实际应用检查，各 11 用例，`page-files-template-compat.log` |
| 扩展 Python 依赖安装、隔离、失败保留及离线重建 | PASS，14 项，`page-files-dependencies.log`、`dependencies-validation.json` |
| 真实 SDK/MCP/Core/CLI/浏览器主检查，含仅辅助模块更新、采用一次、草稿/路径、环境切换与恢复 | PASS，17 项，`page-files-core.log`、`core-main-validation.json` |
| 固定镜像 ID 的 SDK 依赖安装、断网重启/分享及草稿存储失败恢复 | PASS，4 项，`page-files-core-dependencies.log`、`core-dependencies-validation.json`；与主检查合并的 `core-validation.json` 为 21 项 |
| 完整 brain 回路、两份独立分享、候选成功/加载失败/行为失败及原 Job/Memory 语义 | PASS，574.68 s，`page-files-brain.log` |
| 当前 Go 嵌入程序、coreassets/coreapp 单元及脚本契约 | PASS，`page-files-go-build.log`、`page-files-go-tests.log`、`page-files-script-tests.log`；初始化/发布契约修订后复跑见 `page-files-final-contract-tests.log` |
| 最终候选本地证据与远端固定 tag 冲突保护 | PASS，`publication-current-preflight.log`；该日志的 tag 与本节一致，实际没有 push |

七份标准/工具/依赖/Core 主检查/依赖检查/汇总 validation JSON 均通过，且 image ID/input hash 与本节一致。release 和脑包引用为该实际候选，仍为 candidate、anonymousReadable=false。

本轮扩展依赖独立回路首次执行返回 `skill-read:none`，保留失败诊断在 `page-files-core.log` 的主检查成功之后。检查发现共享 Agent/helper tag 在测试期间改变：开跑 Agent ID `sha256:bb519e79b91d870476f6caefc43b158f6ffb82a3220f9b27a02c49f2846c9cb4` 包含 Python 依赖验收 driver，后来的 `sha256:0582dd0ffe4762d1988813828377ff24752383b8c92571e2d9e8150e5b477763` 不包含。随后用开跑记录中的 Agent、file-helper、snapshot-helper 固定 image ID 单独重跑并通过，保留主检查及原失败输出，没有改写共享 tag 或减少验收条件。

| 修复后实测 | 数值 |
| --- | --- |
| workstation 准备 / 准备后首启 / 同输入重启 | 970 / 7208 / 3975 ms |
| workstation 镜像检查 workspace | 142,110 bytes |
| web-app 准备 / 准备后首启 / 同输入重启 | 1043 / 7182 / 4064 ms |
| web-app 镜像检查 workspace | 140,499 bytes |
| 完整回路分享前 workspace / 源快照 | 334,188 / 816,069,838 bytes |
| 源导出 / 第一副本再导出 / 第二副本再导出 | 12,875 / 10,714 / 12,497 ms |
| 两份导入 | 9,005 / 8,618 ms |
| 额外 Python 依赖的断网分享快照 | 815,984,946 bytes |

完整回路从初次实现的 557.17 s 变为本次 574.68 s，增加 17.51 s；如实保留退步，不推断原因或宣称本次修复进一步缩短完整验收。两次均为单次开发环境观察，本轮有并行检查；几百毫秒轮询量化差异不作性能结论，旧 FastAPI 基线失败也不换算成成功倍率。scratch 宿主、schema-4 专项、Action 接受窗口和全仓库 make test 的此前通过记录保留在历史阶段；本轮重跑范围以上表为准。

## 发布与资源边界

本次没有 push、官网发布或改写已发布 Core/CLI/旧 base 身份。新版正式可用状态仍需另有明确发布要求，完成匿名固定 digest 拉取/运行后才更新正式引用。

所有 Engine、网络、容器和卷按测试自己的 installation ID 或唯一 fixture label 创建/清理；本地候选镜像与旧固定镜像作为产物保留，没有执行全局 prune。原始 `.work`、Core 数据、私钥、凭据与完整运行输出只在被忽略的临时/`dist/` 位置使用，不进入 Git 或本记录。


初次实现的最终检查补充了离线重建过程中依赖声明或锁被改动时的启用前拒绝。该变更产生上列 `85fb0b1a7e60` 候选；该阶段的工具、标准应用、扩展包、Core/浏览器和完整 brain 均重新绑定该候选 image ID/input hash 验证。此前 547.71 s 的成功完整回路保留在 brain-full.log，初次实现最终回路为 brain-current.log 的 557.17 s。计时是单次开发环境观察，开发检查存在后台负载，就绪轮询为旧 500 ms/新 250 ms；几百毫秒量化差异不作性能结论，完整失败与通过不换算成功倍率。

## 归档后的授权发布

用户随后明确要求发布 Core 与 NiceGUI base。2026-10-11 执行 `node scripts/publish-web-base.mjs --push`，通过固定 tag 冲突预检、推送、空 Docker 配置的匿名 digest 拉取及只读运行检查。

- 正式引用：`docker.io/pphboy/piwork-web-base:0.2.0-5818e1de7bb5-6b6f6f8bbf62-dirty@sha256:c85c9928549f5b6a58dd519bbf1840fe83e52b9da22eaae556f7aca64b448098`。
- registry digest：`sha256:c85c9928549f5b6a58dd519bbf1840fe83e52b9da22eaae556f7aca64b448098`。
- 实际 image ID：`sha256:1b2dc23ea6cc78f5986217a5c133f045334c81d30a53c833f73aa59abdad87a1`；input hash 保持 `6b6f6f8bbf625e2b36502349e5ba13992060aeab4b5239436c3288919ae7d44e`。
- 真实构建身份继续为 `5818e1de7bb5af9bd6305777fc88b40505a708b3`、dirty=true，不改写为后续提交。
- 发布原始输出：`dist/web-base/nicegui-publication.log`；匿名验证记录：`dist/web-base/published.json`。

上文候选阶段的状态与验收事实保留。脑包以 1.2.1 补丁版采用正式固定引用，使已经安装 1.2.0 的 Core catalog 也能触发升级；既有 Work 仍按原 Package Update/Apply 流程采用。Core 自身的发行身份与验证结果单独记录。
