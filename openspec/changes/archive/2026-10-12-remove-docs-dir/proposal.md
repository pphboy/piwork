# Proposal

## Why

仓库根 `docs/` 由 AI 在开发过程中持续扩充，混合了当前契约、操作说明、历史设计、验收和发行事实，形成了由 AI 自行维护的另一套开发依据。项目所有者要求移除该目录：当前有效内容进入 OpenSpec，需要持久化的新开发知识由所有者发起或授权 OpenSpec 变更后再落盘和执行。

## What Changes

- **BREAKING**：移除仓库根 `docs/` 及依赖其旧路径的当前导航、构建、生成和打包约定。业务 API、CLI 命令、Work 数据和运行行为不因本次整理改变。
- 对现有 114 个文件建立逐项去向。其中 51 份 Markdown 的当前有效约束按能力归入 OpenSpec Requirement / Scenario；已覆盖的内容建立映射并去重，历史建议不自动成为新需求。
- 按所有者已确认的处理方式，将有价值的历史设计、验收、发行身份、原型与截图保留为对应 OpenSpec 变更的附件，保留原版本、状态和证据适用范围。
- 将共享 Logo 和 README 展示图的产品副本放入 `apps/ui-shared/assets/`，展示图原件继续保留为本次变更的冻结证据；同步实际消费资源的构建、输入摘要、Docker 构建上下文、原生验证与相关夹具。
- 将 Go 迁移 JSON 证据归入 `go-core-cli-migration` 的附件；生成脚本默认输出到被忽略的 `dist/`，不重建 `docs/`，不默认覆写冻结证据。
- 更新中英文 README 和既有部署手册的必要说明与导航，保留面向使用者的入口；修订 `ui-language` 和 `piwork-brain` 中要求存在旧文档路径的条款。
- 新增仓库文档治理约束，并落实到 `AGENTS.md`、`openspec/config.yaml` 和可执行检查：AI 不自行创建开发笔记、设计报告或替代目录；发现需要持久化的内容时先在对话中说明，由所有者发起或授权 OpenSpec 变更。已授权变更内维护必要产物，不增加逐文件审批。
- 为根 `docs/` 缺失、当前引用有效、文件迁移完整及生成入口不回建目录建立检查，保留官网仓库的 `docs/`、用户 Work 中的同名目录和产品随包交付的 Markdown。
- 修复验收发现的归档路径依赖（C1）：当前用户入口和产品资源采用稳定路径，迁移清单及冻结输入按所属变更定位；在变更从 active 移入 archive 后，文档检查、生成和本地打包继续有效。
- 修复本地 dirty 构建的无效文档外链（W2）：只有目标存在于实际源码 commit 且内容与选用文件一致时才生成固定 commit 链接；新增或修改而未提交的必要文档及其本地依赖随包保留，不以失效链接代替。
- 修正规格中沿用旧文档的表单尺寸（W1）：以现行任务表单在 1440px 视口的 156px 标签、16px 间距及剩余控件宽度为准，保留其他容器和响应式规则，不通过改动现行 UI 消除规格差异。

## Capabilities

### New Capabilities

- `repository-documentation-governance`：定义所有者主导的开发文档持久化、Spec 归属、完整迁移、历史附件、资源/生成物边界及防止根 `docs/` 重现的验证要求；归档前后的引用、检查和打包保持有效，发行材料链接与实际选用内容一致。

### Modified Capabilities

- `ui-language`：将共享 UI 与产品表达规则直接归入 OpenSpec，移除对两份 `docs/` 文档的依赖，以当前 `serve-ui` 的有效导航和各容器实际布局处理历史冲突，修正 UIL-012 的任务表单基准。
- `piwork-brain`：将 BRN-007 的架构不变量直接保留在 Spec 中，初始来源和历史证据归入对应变更附件，移除 `docs/piwork-brain/BASELINE.md` 的路径要求。

- `agent-conversation`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `ai-model-management`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `control-cli`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `core-service-startup`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `desktop-webui`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `docker-delivery`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `pi-package-management`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `portable-work`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `serve-control-plane`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `service-network-access`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `work-file-access`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `work-services`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。
- `work-snapshots`：补齐从原文档提炼的现行操作、协议或交付边界，不新增产品行为。

其余能力的当前契约按设计中的迁移表核对、补齐表达和导航，不因文档整理引入新的产品行为。若迁移核对发现需要改变其他能力的 Requirement，先在本变更补齐对应 delta 和 proposal 声明，再处理该项；不能通过修改主规格或实现新功能绕过规划。

## Impact

- 文档与规格：根 `docs/`、`AGENTS.md`、中英文 README、既有部署/示例手册、`openspec/config.yaml`、相关能力及变更附件。
- 资源与交付：两端 `copy-static.mjs`、`apps/ui-shared/`、`scripts/build-cli.mjs`、`scripts/build-docker-release.mjs`、Docker ignore 文件及 Go 嵌入资源。
- 生成与核查：迁移清单及所属变更的只读路径解析、`scripts/check-repository-docs.mjs`、`scripts/stage-go-release-materials.mjs`、`scripts/collect-go-migration-boundary.mjs`、`scripts/update-go-acceptance-index.mjs`、`scripts/check-go-acceptance.mjs`、`scripts/check-native-boundary.mjs`、`scripts/package-go-release.sh`、`scripts/clinative/smoke.go`、官网同步脚本和相关 Node 测试夹具、Makefile 入口。
- 发行身份：资源路径进入输入摘要，后续本机构建须使用实际新摘要；不改写已发布镜像、历史 commit/dirty/hash/digest，不自动推送、发布、同步外部官网或归档其他变更。
- 实施与验收：原 30 项实施任务及其实际结果保留；`evidence/spec-verification.md` 发现的 C1、W1、W2 由新增的 7 项待办处理。本次 update 只修订规划，后续 apply 落实修复并重新验证；主规格同步与归档按独立请求执行。
