# Verification Report: restore-nicegui-default-environment

核对日期：2026-10-11。本轮按 openspec-verify-change 重新读取规划、当前实现及执行材料，独立复核任务 7.1–7.3 完成后的结论；原 W1/S1 发现及原候选材料保留在 `dist/web-base/history/85fb0b1a7e60/verification.md`。验证依据为当前源码、12 个 delta 需求、62 个 Scenario、任务清单及实际候选执行结果。

## 结果

| 维度 | 状态 |
| --- | --- |
| Completeness | 33/33 任务完成；12/12 ADDED/MODIFIED 需求有实现及依据 |
| Correctness | 12/12 需求与 62 个场景已核对源码、测试和执行证据；W1 已关闭 |
| Coherence | 可扩展页面输入符合设计；文档、候选与预检材料一致；S1 已关闭 |

Task Completion、Spec Coverage、Requirement Implementation Mapping、Scenario Coverage、Design Adherence、Code Pattern Consistency 六项均进行了检查。CRITICAL、WARNING、SUGGESTION 均无未处理项。

## 需求与场景映射

共 10 个 MODIFIED、2 个 ADDED 需求，无 REMOVED/RENAMED 需求。以下为实现与场景依据；源码位置按当前工作区记录。

| 需求 | 场景数 | 主要实现与验证依据 |
| --- | ---: | --- |
| WEBBASE-001 | 4 | `deploy/images/web-base/Dockerfile:1`；双模板标准、sqlite3、普通 NiceGUI 脚本及 Core 派生镜像检查 |
| WEBBASE-002 | 4 | `deploy/images/web-base/tools/piwork_web.py:108`、`:124`、`:152`；离线标准环境、缺包拒绝、检查缓存及失败恢复用例 |
| WEBBASE-003 | 3 | 两模板 `app.py` 的同端口 HTTP/WebSocket/API/协议与 runtime health；标准浏览器、Core 授权入口和 dev 检查 |
| WEBBASE-004 | 5 | `internal/coreassets/piwork-brain/skills/deploy-work-service/initialize.mjs:19`；初始化拒绝/并发、真实 SDK 拒绝、只读 workspace 与额外包离线分享 |
| WEBBASE-005 | 3 | base 双语 README、环境/锁、`scripts/build-web-base.mjs:21`、历史固定 release；维护入口、兼容身份及旧 Work 保留检查 |
| WEBBASE-006 | 3 | `scripts/publish-web-base.mjs:15`、`:45` 及后续显式 push/匿名读取分支；正反契约、候选拒绝与实际 no-push 预检 |
| WEBBASE-007 | 10 | `piwork_web.py:44`、`:79`、runtime 固定加载身份和 page-client；工具及真实页面/业务/环境/辅助模块更新、草稿和失败恢复检查 |
| WEBBASE-008 | 5 | `deploy/images/web-base/tools/piwork_web_dependencies.py`；约束/继承环境、锁/wheels、串行准备/启用核对；14 项依赖与真实 SDK 应用使用/分享检查 |
| WEBBASE-009 | 3 | 验收记录中的旧/新输入、实测阶段、体积、失败与退步；当前候选七份验证材料、准确预检引用及历史证据分离 |
| BRN-008 | 8 | brain 1.2.0、Skill/Reference/两模板；`internal/coreapp/bundled_brain.go:26`、旧 1.1.0 完整 fixture、更新保护/资源及候选拒绝检查 |
| ADEP-002 | 12 | 部署 Skill、共享 initializer、持久 Service/Spec 与 deterministic SDK driver；原 Operation、依赖安装、实际查询、反馈/Job/Memory 与失败回路 |
| DUL-BRAIN-001 | 2 | Desktop 既有对象/显式 Apply 及独立 React 外壳；完整候选加载/行为失败检查、通用与派生 Service 接入 |

设计决策 1–8 已与实现核对。新工具、模板资源、隔离旧包夹具与验收入口沿用既有目录/职责，未发现显著代码模式偏差。条件性的实际发布尚未执行；发布场景按代码、契约及既有发布流程核对，本地候选未宣称公开可用。

## 已关闭的问题

### W1：页面辅助模块和本地资源的版本覆盖

[piwork_web.py](../../../../deploy/images/web-base/tools/piwork_web.py) 的 `page_files` 保留默认页面入口，读取可选 `page-files.json` 的附加文件集合，规范化路径、排序去重并绑定实际内容。辅助模块、资源或有效集合变化会改变 frontendVersion；仅独立业务实现变化保持 frontendVersion。无清单应用继续使用默认集合，无效格式、缺失文件、越界或符号链接明确失败。

两个模板交付清单，SPEC/README 与部署 Skill 说明页面拆分及资源增删时的维护职责。模板版本夹具复制实际声明的页面文件，支持嵌套路径和无清单应用。

[工具测试](../../../../deploy/images/web-base/test/test_runtime.py) 在真实解释器中导入并执行修改后的辅助模块，验证旧检查不能用于新输入，并覆盖资源变化、清单增删/稳定性、无清单兼容及无效输入拒绝。21 个工具用例通过；两套模板的无清单/嵌套辅助模块共 4 组应用检查通过，每组 11 个用例。

[Core 浏览器检查](../../../../scripts/check-web-base-core.mjs) 仅修改已声明的 `page_helpers.py`，确认 ui.py 与清单未变化、实际 codeVersion/frontendVersion 均变化、新页面自动采用一次、非根路径与草稿保留、iframe 保持、无额外 Run/Apply。该项已进入发布预检的必要检查集合。

### S1：最终候选的预检证据引用

[验收记录](../../../../docs/nicegui-default-environment-acceptance.md) 区分初次候选的测量及历史检查与修复后的当前候选，最终预检引用为 `publication-current-preflight.log`。该日志实际包含当前 tag `0.2.0-5818e1de7bb5-6b6f6f8bbf62-dirty`，旧 `publication-preflight.log` 保留原候选事实。

七份 validation JSON、当前 release 与脑包引用的 image ID/input hash 均匹配当前候选。发布入口还验证新的页面辅助模块、清单与浏览器检查集合；缺少这些检查时契约测试明确拒绝。

## 当前候选与实际执行

- 本地 tag：`docker.io/pphboy/piwork-web-base:0.2.0-5818e1de7bb5-6b6f6f8bbf62-dirty`。
- image ID：`sha256:1b2dc23ea6cc78f5986217a5c133f045334c81d30a53c833f73aa59abdad87a1`。
- 输入 hash：`6b6f6f8bbf625e2b36502349e5ba13992060aeab4b5239436c3288919ae7d44e`。
- 源码 commit：`5818e1de7bb5af9bd6305777fc88b40505a708b3`；dirty=true。

| 检查 | 实际结果与依据（dist/web-base/） |
| --- | --- |
| Python 工具 | 21 通过；`page-files-tools.log`、`tools-validation.json`（8 项） |
| 双模板标准镜像 | 通过；`page-files-standard.log`、`page-files-starter.log`、两份标准 validation JSON |
| 双模板无清单/嵌套辅助模块 | 通过；`page-files-template-compat.log` |
| 扩展依赖 | 14 项通过；`page-files-dependencies.log`、`dependencies-validation.json` |
| Core/SDK/MCP/CLI/浏览器 | 主检查 17 项、依赖检查 4 项通过；`core-validation.json` 合计 21 项，关联两份分项 JSON |
| 完整工作站 | 574.68 s 通过；`page-files-brain.log`；保留三次导出、两份独立导入、新反馈/SDK、候选成功/加载失败/行为失败、Memory/原 Job 语义 |
| Go 嵌入程序及相关单元 | 构建与 coreassets/coreapp 测试通过；`page-files-go-build.log`、`page-files-go-tests.log` |
| 脚本契约 | 37 项通过；`page-files-script-tests.log`；修订后的初始化/发布契约另有 `page-files-final-contract-tests.log` |
| 平台与文档边界 | 当前源码 native boundary、Quick Start 检查及相关测试、严格 OpenSpec 校验、diff 空白检查通过 |
| 本地发布预检 | 通过；`publication-current-preflight.log`，仅执行 no-push 分支 |

Core 依赖独立回路首次失败的诊断保留在 `page-files-core.log`，主检查的通过结果也在该文件。开跑后共享 Agent/helper tag 发生变化；实际检查确认后来的 Agent 不含 Python 依赖验收 driver。使用开跑记录中的固定 Agent/file-helper/snapshot-helper image ID 单独重跑后通过，输出为 `page-files-core-dependencies.log`；`page-files-run-identity.json` 保留身份及变化诊断。原失败没有被删除或写成通过。

## 范围与一致性

已重新核对 WEBBASE-001–009、BRN-008、ADEP-002、DUL-BRAIN-001 的实现与场景映射。版本修复沿现有 base/tools、模板与 scripts 入口完成，Agent harness、Desktop/Console、Core 生命周期和公共协议职责保持。历史旧脑包夹具、固定发布身份和既有 Work 保护逻辑保留；当前 Go 单元覆盖脑包交付、内置更新与管理员保护。

scratch 宿主、schema-4 专项、Action 接受窗口及全仓库 make test 是此前实施阶段的通过记录；本轮重跑范围以上表为准，未把历史专项写成新候选重新执行。当前完整回路比前次 557.17 s 增加 17.51 s，已记录退步和并行开发环境条件；旧 FastAPI 完整基线失败，性能结论继续按实际取得的阶段区分。

## 本轮重新执行的检查

- 当前候选 Python 工具：21 通过，`dist/web-base/reverify-tools.log`。
- build/publish/initialize/quickstart 脚本：37 通过、0 失败/跳过，`dist/web-base/reverify-scripts.log`。
- 当前脑包交付、内置更新/保护、完整旧 FastAPI fixture Go 单元：通过，`dist/web-base/reverify-brain-unit.log`。
- 严格 OpenSpec 校验、Quick Start 一致性与 `git diff --check`：通过。
- 当前源码 inputHash、实际镜像 ID/标签及镜像内全部工具字节：一致；七份 validation JSON、release、脑包引用与最终预检日志：一致。

本轮复查了匹配候选的 Core/浏览器和 574.68 s 完整工作站日志及分项证据，没有重新运行整套长测。六项验证检查均有可用材料，没有未验证项；重新执行范围与证据复查范围如实区分。原共享 tag 变化导致的失败及固定 ID 重试证据继续保留。

## 最终判断

W1/S1 均已关闭，没有未处理的 CRITICAL、WARNING 或 SUGGESTION，可归档。本次交付为已验证本地候选，state=candidate、localValidationState=verified、anonymousReadable=false。对外发布及匿名固定 digest 拉取/运行仍需后续明确发布要求。
