# Web base 与默认开发环境验收

本记录对应 `add-default-demo-development-image` 的实际执行。工作区包含未提交修改，构建身份明确标记 modified=true；源码与构建输入摘要用于区分本次制品，不能只用版本前缀或历史验收替代它们。记录使用合成身份、确定性模型与独立 installation ID，不包含真实密码、模型 key、token 或私钥。

## 基础镜像

- 镜像：`docker.io/pphboy/piwork-web-base:0.1.0-03395d0810f7-3e95b4ed1d49-dirty`
- Registry digest：`sha256:5dae2dde7fd05c8af84c923af9a4e1892f829c7a604b67816c221f949c3db94c`
- Image ID：`sha256:d7537a79128ce1ac703b1efc14a5446177acdb1722b11afd7e0aa10799963054`
- 输入摘要：`3e95b4ed1d4943eb6f742e1e81cc7b42f885fef1d7d5e269190955743aaf4e31`
- 已推送并以独立空 Docker 配置匿名拉取相同 digest，核对 image ID、环境输入身份及实际运行。脑包引用已固定 tag@digest。

环境为 Linux amd64、Python 3.13.16、Node 24.21.0、FastAPI 0.143.0、React 19.3.0、TypeScript 7.0.2、Vite 8.3.4，sqlite3 系统包版本 3.40.1-2+deb12u2。本地解压后镜像体积为 487,749,376 字节（约 465 MiB）。完整来源、锁文件和用法见 Web base 手册：[English](../deploy/images/web-base/README.md) / [简体中文](../deploy/images/web-base/README.zh-CN.md)。

## 自动化事实

| 入口 | 实际验证 |
| --- | --- |
| `make generate`、`make build`、`make test` | Go/TS 生成、宿主构建、单元/契约、脚本与浏览器 TypeScript 检查通过 |
| `node scripts/check-native-boundary.mjs` | 平台源码/配置仍使用 Go 原生入口 |
| `node scripts/check-native-image-boundary.mjs` | Agent production/acceptance 的真实 sqlite3 CLI、保留 SDK/harness 及 Go helper 边界通过 |
| `node scripts/check-web-base.mjs`，以及 `web-app` 参数 | 独立无外网网络、非 root/只读根、离线依赖/检查/构建、单端口静态/API、sqlite3、可写依赖、重启数据保留；缺失离线包回退依赖，坏前端构建非零退出且不报告就绪 |
| `node scripts/check-web-base-core.mjs` | 真实 SDK/MCP/Core/CLI/浏览器：前后端自动采用、Agent Action 后的数据自动显示、草稿/路径保留、开发 HMR/后端重载、坏构建与断线恢复；普通读取不新增 Run/Goal 或 Apply |
| 同一 Core/CLI 验收 | 省略/历史正数 memoryBytes 的 Service 实际 Memory=0，触碰 192 MiB 页面并检查 RSS；旧受限实例在正常 Work 恢复中替换；派生镜像安装独立依赖并由 Core 部署；普通 Core 退出/重启恢复四个 Service |
| `TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior` | React 操作、反馈自动修复、Job 续接、Evidence、Memory 后续采用、候选 Apply 的实际行为成功/失败、两份独立完整包导入闭环通过，耗时 799.58 秒 |
| `TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations` | 离线跨安装映射、共享 workspace、disabled/tombstone、保留 CPU/slots/历史内存字段及目标 MCP 管理通过，耗时 454.85 秒 |
| 相邻 Kanban、legacy Memory 升级/回退/降级 fence、交互身份/持久事件回放回归 | 全部通过；schema-4 fixture 仅适配部署 driver/MCP，未替换旧 harness/store 或修改旧数据库 |
| `TestNativeDefaultBrainDeploysPublishedWebBaseDigest` | 全新默认脑包从实际 SDK 读取已发布固定引用，部署该 digest 并完成真实业务 Action，通过，耗时 77.99 秒 |

250 CPU 毫秒配额下，工作站与通用模板首次完整准备/检查/构建/启动分别实测约 48.5 秒和 49.5 秒，未扩大既有 120/300 秒就绪预算。所有测试资源按本次精确标签/installation ID 清理，不使用全局 prune。

首次回归发现的私网 HTTP 下 randomUUID 不可用已改为安全随机字节；旧手动刷新测试改为真实自动采用断言；额外 Agent Action 产生的合法 Chat 请求与被动页面读取分别核对。完整测试还补齐了现有原生验收夹具的公共 logo，忽略的旧 dist Go 脚本通过本地 module 边界隔离，未删除既有产物或跳过源码测试。

## 五角色交付与无解释器宿主

用户已明确追加授权发布新版 Core、CLI、Agent、file-helper、snapshot-helper，并更新全部 Quick Start 材料。它们采用同一最终源码/输入、完整候选、绑定清单的发布预检和独立匿名验证；基础镜像保持独立版本。

五角色固定 tag 为 `0.0.1-03395d0810f7-47a2181c06cb-dirty`，源码输入摘要为 `47a2181c06cbf4df4ed1d7d1f9abde4fecd0641a304355408973ae6274692839`。绑定清单的 `push-commands.sh --check` 和 `--push` 全部通过；匿名验证记录时间为 `2026-10-09T16:51:53.682Z`（UTC）。独立空 Docker 配置逐个解析远端 manifest、拉取固定 tag@digest，核对本地验收 image ID、源码/提交标签、RepoDigests，并在断网/只读容器中运行各角色 Go 程序的 `--version`。全部验证通过。

| 镜像仓库（docker.io/pphboy） | Registry digest | Image ID |
| --- | --- | --- |
| piwork-core | `sha256:6dbd4adc788993a11c8128afb2d92b4b940ecb4e3e1f623cdcf3e0f6744f1357` | `sha256:bc90aaa8741f9998b34f50c1680d8c7644ecd54e5007620f306dc1aed2d0e4ea` |
| piwork-cli | `sha256:10b11e23f989b9b67ac6629c21adf8d22ab500d819035dafbd8d9068746cb92f` | `sha256:b3b5ddde86bec586fe0767e5d061d57f1870f396cd3f977321860ba4de886c65` |
| piwork-agentd | `sha256:7d847692fd3a0e514b47d3b7b4fbb6025fbb45a2cf6f576634f04d87126affd2` | `sha256:38c3e0a7dcec645c748ef2c04b9517e25738d43111fdbacaefdc7d730fabf0fc` |
| piwork-file-helper | `sha256:a5c538cb3f47ea1a9e801c0dc64c06abfe2316378f5fd97be867cf167f42cd00` | `sha256:ed1df2fd4ac581c9e703de4262fac770fd0ad2a2f408145f6e5ad551d5382065` |
| piwork-snapshot-helper | `sha256:cd20d70401d30702042ad5f9ba379e9f4f7ec584f836200eea21c4f9ba8a0151` | `sha256:915abc63a8d814e68ab7f3079b7896c76a962ba44c194638f752579e242b14f4` |

正式材料通过 `Dockerfile.docker-release` 的 `published-materials` 目标生成于 `dist/docker/web-base-release-published/published/`。其完整 `SHA256SUMS`、五角色 digest、源码身份与安装包覆盖检查通过。已同步根 README、Docker 安装手册的中英文版本、Core-only Compose、单机示例及 [仓库发布元数据](../deploy/docker/release.json)。`node scripts/check-docker-quickstart.mjs` 通过，`node --test scripts/check-docker-quickstart.test.mjs` 为 28 项全部通过、零跳过；保留原源码哈希门禁。OpenSpec 严格校验、已有与新增文件的空白检查和文档相对链接检查通过。

无解释器宿主 gate 已通过，fixture 为 `piwork-native-host-6b78bbc4-4ad1-4df3-8527-25ada3de0f1a`。独立 Engine 使用 Unix socket；被测 scratch 宿主只含发布包的 Core、CLI、Console 三个 Go 程序，`PATH=/nonexistent`。真实 SDK→Go MCP 部署、Service proxy、WebDAV、嵌入 Desktop/Console、React 页面/Action、自动反馈修复、异步 Job、经验采用、候选 Apply/恢复、模型切换及两份独立导入的新 SDK 行为证明全部通过。CLI 观察中断后继续查询原已受理 Operation，没有重新提交；Console 退出保留 Core、用户/operator CLI 和已受理 Operation。gate 正常退出并清理自身 fixture。

## 执行入口与范围

本次使用 Go 1.25.5、Node 24.20.0、Docker 26.1.5 和 Buildx。以下为对应检查的复现命令；Go integration 使用 acceptance Agent/helper、确定性模型及独立安装，不调用真实付费模型。

```sh
make generate
make build
make test
node scripts/check-native-boundary.mjs
node scripts/check-native-image-boundary.mjs
node scripts/check-web-base.mjs
node scripts/check-web-base.mjs dist/web-base/candidate.json web-app
node scripts/check-web-base-core.mjs
go test -mod=readonly -tags=integration -v -timeout=45m ./internal/coreapp \
  -run '^TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior$'
go test -mod=readonly -tags=integration -v -timeout=30m ./internal/coreapp \
  -run '^TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations$'
go test -mod=readonly -tags=integration -v -timeout=30m ./internal/coreapp \
  -run '^TestNative(KanbanSpecBeforeImplementationSharedUIActionsAndActualEval|LegacyMemoryUpgradeRollbackAndDowngradeFence|ServiceInteractionIdentityAndDurableEventReplay)$'
go test -mod=readonly -tags=integration -v -timeout=15m ./internal/coreapp \
  -run '^TestNativeDefaultBrainDeploysPublishedWebBaseDigest$'
node scripts/native-host-acceptance.mjs
```

Go 测试按 [测试说明](testing.md) 设置本次 acceptance 镜像。旧 Memory 场景另以 `PIWORK_TEST_NATIVE_HISTORY4_IMAGE=piwork-memory-history4-web-base:acceptance` 使用 schema-4 兼容夹具。scratch gate 将临时目录放在开发机磁盘的被忽略输出目录，避免 tmpfs 容量影响；测试驱动机的 Node/Docker/OpenSSL 不进入被测宿主。

本记录覆盖本变更相关真实回归及无解释器宿主 gate，没有宣称执行全部 `make acceptance` 场景、全部客户端平台矩阵或真实外部模型验证。已列出的最终检查均通过；早期失败经修复后重跑，不以历史 NiceGUI 验收替代新栈证据。

## 核验后修复（2026-10-10）

前面的发布身份、耗时与通过记录继续代表首轮制品。本节记录 openspec-verify-change 发现的两个问题及修复版交付，不能把首轮成功当成修复已验证。

- 重复初始化：旧确定性部署先写 Spec 再覆盖式复制模板。现由部署 Skill 的 `initialize.mjs` 统一初始化，独占创建应用目标，任何已有目录/文件/链接均在写入前拒绝；Spec 先于其余模板落地。SDK driver 明确处理失败，不继续 Service mutation。单元回归覆盖首次成功、源码/Spec/锁/注册信息/数据保留、空目录/文件/链接拒绝与并发单写入者；真实 SDK 回归修改现有文件后重复调用，验证拒绝、原内容与 Service revision 保持，事件流没有后续 create/update/restart。
- 环境身份：codeVersion/frontendVersion 组合实际镜像环境摘要与对应源码/锁摘要，相同输入稳定、后端单独修改保持前端版本、生成产物不参与自引用。真实 Core/CLI/浏览器在应用源码/锁不变时切换实际环境身份不同的镜像，确认新 bundle、版本变化、同一 iframe 内一次自动文档加载、草稿/路径保留，以及无额外被动 Run/Apply。
- 页面交付回归同时补齐运行模式切换：版本端点返回 development/static，页面自动采用相应 Vite/构建后入口，持续开发时仍由 HMR 处理。Desktop 保留同 Work/Service/已声明端口在 enabled Starting 时的已开页面；Work 从 Degraded 恢复 Ready 时，先移除过期提示节点，避免移动 iframe 祖先并再次进入已消费的启动票据页面。停止/停用、初始未就绪、端口撤下与既有权限边界保持实际检查。

修复版 Web base 已推送并匿名拉取核对：

- 固定引用：`docker.io/pphboy/piwork-web-base:0.1.0-03395d0810f7-bbb24bdd0167-dirty@sha256:e83902fb568e97b2d01d488ce7c9c3d15f373ab58b46e041337baa832b8cfb81`
- Image ID：`sha256:3be06cbe6450c63d6def67cd2948be08fed635615a7d9d8982c2e710b5c06f3a`
- 输入摘要：`bbb24bdd01672d007a68ef37402bd9548e0dca91527bc55a69394e3176e70665`
- 本地解压体积：487,762,478 字节（约 465 MiB）。

两模板离线验证均通过；250 CPU 毫秒配额下，工作站冷启动 44,822 ms，通用模板 45,332 ms。真实 SDK/MCP/Core/CLI/浏览器完整脚本正常退出通过，包括初始化拒绝、前后端及仅环境更新、开发热更新、失败构建修复、两侧 sqlite3、192 MiB 有界分配、旧内存限制替换和 Work/Core 恢复。全新默认 Work 的已发布 digest 部署与业务 Action 回归通过（81.42 秒）。

最终 `make generate build test`、原生源码边界通过。Desktop 全套浏览器在隔离/串行运行中为 223 项、222 通过、零失败、1 项既有跳过（实际等待五分钟的未使用登录票据过期用例）；初始化与相关失败用例另有聚焦回归通过。旧 Memory/Kanban/交互回归通过，跨离线安装映射在磁盘临时目录完整退出通过（633.22 秒）。

执行中发现的失败如实保留：早期 Core 脚本复用会话未进入预期创建路径，改用同 Work 的独立会话；revision 断言改为初始化前真实基准；单次采用按文档请求计数，排除 SPA pushState。保留 iframe 后实际验收暴露开发模式遗留和状态提示移除时的文档卸载，已按上述实现及回归修正。部分全套浏览器并发/受负载运行出现既有异步设置/历史回读用例失败，聚焦及最终隔离全套重跑通过，没有删除用例或放宽断言。

开发机 `/tmp` 为 tmpfs；并发 Go 验收曾出现空间不足，导入业务断言虽通过但测试进程失败，不计为完整通过。工作站尝试还出现 SIGPIPE、导出失败及整体 15 分钟上下文耗尽。仓库内长临时路径又触发 Unix socket 长度拒绝；最终开发检查改用磁盘短路径 `/var/tmp`，对应 endpoint 用例与完整基础检查重跑通过。生产路径和 120/300 秒 readiness 未延长。 完整工作站包含约 1.23 GB 包的三次导出、两次导入及各自反馈/候选证明；确认整体 15 分钟测试上下文会提前取消有效操作后，测试驱动总截止时间调整为 30 分钟，完整重跑全部断言。该调整不修改产品的 readiness、Run/Goal 或单个快照操作预算；被中断的旧尝试不计为通过。

完整工作站在 30 分钟总测试驱动上下文中正常退出通过，耗时 1232.86 秒；三次导出、两份独立导入、各自新反馈/SDK 候选证明，以及原 Work 的候选成功/失败与恢复断言全部保留并通过。

最终无解释器宿主 gate 正常退出 PASS，fixture 为 `piwork-native-host-5205dcae-dc0e-4661-bc6d-5ce5f54f0173`。scratch 中三个 Go 程序、独立 Engine Unix socket、实际进程及缺失工具检查通过；浏览器/反馈/Job/经验/候选/模型、两份独立导入各自新 SDK 证明及 Console 退出不停止 Core/Work 全部通过。大包 CLI 等待中断沿原 Operation 查询，不重新提交；导出驱动也支持按原 Snapshot ID 调用现有 snapshot download 恢复，未调整 CLI 或产品等待预算。fixture 自身清理完成。

修复版五角色已按绑定清单的发布入口完整推送，固定 tag 为 `0.0.1-03395d0810f7-c70a7cb33564-dirty`，源码输入摘要为 `c70a7cb33564caaa64b93b0d7ee0c20cb784d00966192999f09720ed22251ad3`。独立空 Docker 配置匿名解析、拉取每个固定 digest，核对 config image ID、源码/提交/协议标签和 RepoDigests，并在断网/只读容器中执行对应原生程序版本；全部通过。匿名验证记录时间：`2026-10-10T02:00:18.476Z`（UTC）。

| 镜像仓库（docker.io/pphboy） | Registry digest | Image ID |
| --- | --- | --- |
| piwork-core | `sha256:05745c1a38cf6db9ee2d25941ab4af6ccc4c478e016bc0ce4207f2c546f72a00` | `sha256:039c0ba38878730b65fa8b6eaf1c68133604fc580f518ee5bee0e6d0adf77be4` |
| piwork-cli | `sha256:20079fffb906b5f86a00c739087d16c7e5ff640fdfb48434c62cb0fa073242bc` | `sha256:ae61d93e6b11b361268f3ec491cb03daa5353f0152fe274ebed2c45de0a193da` |
| piwork-agentd | `sha256:84ddb2351bbd98d8429c9912a2ba2355cbb67581b490f74bba55a63a377d0dde` | `sha256:e6cf5f37ac75529ffbfd6915482ea4025019beb8cb33308a6c9e71f34f7584dc` |
| piwork-file-helper | `sha256:0a69bc8d62c8a1d8679512102b4a9a8997bd787d205454ca7f4d10ff299d2b83` | `sha256:d81b36851dce9ef51f2b81ccdc134c883aaafd2e15820c4c4d74c529e20395ee` |
| piwork-snapshot-helper | `sha256:f60e29de5808f496220d0dd28ec26479bd275e5bff585a56d77764bf6b58d4cf` | `sha256:e261c8016c30f41b630aedee9b05328ac90862fa2c9302e5b19232d119d8f054` |

正式 published-materials 位于 `dist/docker/web-base-repair-release/published/`，完整 SHA256SUMS、源码/镜像身份和安装包覆盖检查通过。根 README、Docker 安装手册的中英文版本、Core-only Compose、单机示例及仓库发布元数据均同步为 published。Quick Start 检查通过，脚本测试为 28 项通过、零跳过，源码哈希门禁保留。两处核验警告的初始化拒绝与环境升级自动采用均有实际回归闭环；严格规格、文档链接/固定引用及新增/已有文件空白检查完成后，本变更可进入归档流程。
