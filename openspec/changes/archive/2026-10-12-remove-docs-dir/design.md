# Design

## Context

动机见 [proposal.md](proposal.md)。本次只处理当前工作树中的仓库开发文档及其依赖，不改写 Git 历史。

只读调查得到：

- 根 `docs/` 有 114 个文件：51 份 Markdown、48 个 PNG、11 个 Excalidraw、2 个 JSON、1 个 HTML 和 1 个 SVG。
- 已有 41 个主能力规格；9 个既有未归档变更中，7 个任务完成、2 个仍进行。迁移不能只看主规格，更不能把本次整理当作其他变更的验收或归档。
- `ui-language` 的 UIL-001 要求存在两份独立文档，BRN-007 要求独立 Baseline。两者通过本变更 delta 明确修改。
- 旧 UI 文档含七项平级导航，`integrate-delivered-webuis` 已改为三个工作区；当前 Console 源码另有独立 `AI models` 入口。本次只修正文档归属及冲突表达，保持当前界面。
- 两端 `copy-static.mjs`、CLI/Desktop 输入摘要、Docker 发布输入摘要、Go 原生 smoke 和多个夹具消费旧 Logo 路径。
- 开发清单与验收索引脚本写入根 `docs/`；`check-go-acceptance.mjs` 读取其中 970 条场景记录；原生发布脚本批量复制 Markdown 和该 JSON。
- 官网同步工具在另一个仓库操作 `docs/`，浏览器夹具在用户 Work 中构造同名目录。这些路径不是本次删除目标。

原 30 项任务已经执行，实际结果见 `evidence/verification.md`。随后的 `evidence/spec-verification.md` 发现三项待修复问题：C1 为归档后当前导航、迁移清单和打包仍依赖 active 路径；W1 为 UIL-012 的尺寸与现行任务表单不符；W2 为 dirty 构建将未提交材料链接到不包含对应内容的源码 commit。本次修订规划保留这些发现，新增任务落实修复，不改写原验证结论。

## Goals / Non-Goals

**Goals:**

- 当前规范可从 OpenSpec 查询；全部原文件具有可审阅的归属，不能用目录移动替代语义迁移。
- 删除旧目录后，构建、必要用户入口、开发验证和本地打包继续可用。
- 所属变更归档后仍能定位迁移目标和冻结输入；dirty 本地打包保留实际选用内容与有效链接。
- 将所有者主导的持久化规则落实到开发入口，并用检查阻止已知路径和生成入口回归。

**Non-Goals:**

- 不重新实现产品功能、不重新设计 UI、不改变产品 Work 的审批或运行机制。
- 不把所有 Markdown、用户 Work 文件或外部官网目录当作开发文档清理。
- 不归档其他变更，不声称历史场景重新通过，不自动构建/推送正式发行或修改外部官网工作树。

## Decisions

### 1. 需求、设计、证据和产物分别采用已有 OpenSpec 生命周期

当前需求进入能力 Spec；设计理由进入所属变更的 design；执行事实进入所属变更的 evidence；可重建输出默认进入 `dist/`。不新设 `notes/`、`design-docs/` 或顶层报告作为替代来源。

```text
Existing docs
    |
    +--> Current contracts --> Capability specs / relevant deltas
    +--> Historical facts --> Owning change / evidence
    +--> Product logo -----> Shared source assets
    +--> Generated output -> Ignored dist

New development knowledge
    |
    v
Conversation --> Owner-authorized OpenSpec change --> Spec --> Apply
```

相较于整目录改名或将全部原文塞入一个大 Spec，这种方式保留能力边界，并区分“当前必须如此”与“某次曾经如此”。已有 Spec 覆盖的内容只建立映射，不重复制造规范。

`AGENTS.md` 负责所有仓库开发代理的入口约定；`openspec/config.yaml` 补充规划与实施时的归属约束。只更新项目配置，不改写生成的技能包、不新建自定义工作流引擎。已授权变更内正常维护产物，不建立逐文件审批。

### 2. 以完整迁移清单作为删除依据

实施开始时，在本变更创建 `evidence/migration-map.json`。它是本次迁移的审阅/验收附件，不是永久开发笔记，至少记录：

- 原根路径和原内容 SHA256、采集时实际 Git commit / dirty 状态。
- 内容类别及全部目标：能力路径与 Requirement 标识符、附件、产品资源或必要用户入口。
- 已有覆盖、补齐表达、保留历史或移除过期说明的理由；混合文档分别记录有效段落和历史段落。
- 新附件或二进制目标的摘要；确需修改的 Markdown 导航单独说明，不伪装成原文件未变化。

清单覆盖调查时全部 114 个文件；实施时重新枚举以发现新增文件，不能用固定数量掩盖遗漏。新增真实秘密或运行数据不进入附件。当前契约的唯一来源尚未完成对应 Spec 归属时，不删除该源文件。

针对 C1，将已实现的 v1 清单升级为 v2。变更产物目标由所属变更标识 `ownerChange` 和变更内相对路径 `artifactPath` 定位，Spec 目标继续带 Requirement 标识符，冻结附件继续带内容 SHA256；只有主规格和产品资源采用仓库内稳定路径。审阅用的目标描述也采用相同定位，不留下仍被当作实际目标使用的 active 绝对位置。升级保留原 `sourceCommit`、`sourceModified`、原文件 SHA256/字节数、段落映射和处理理由，不重新采集或改写原迁移身份。

使用一个小范围、只读的所属变更路径解析模块：先检查精确的 active 变更目录；不存在时，在 archive 中查找日期前缀后的完整变更标识，必须唯一。已归档材料可保留明确记录的归档位置作为定位约束。定位缺失、候选歧义、路径越界或经符号链接逃逸均明确失败；解析不移动目录、不修改引用、不复制附件。清单自身也按所属 `remove-docs-dir` 变更定位。`check-repository-docs.mjs` 与仍读取所属变更冻结输入的生成/验收入口共用此逻辑，避免每个脚本各写一份路径猜测；它不成为新的文档存储或工作流引擎。

下表是已确定的 51 份 Markdown 去向。`native-runtime-distribution` 和 `cli-runtime-portability` 尚在既有变更 delta 中，不伪造同名主规格、不自动归档它们。表中的“核对”是具体段落归属和覆盖校验，不是留待实施再决定总体迁移方案。

| 原路径（相对 `docs/`） | 内容类别 | 规格或证据归属 |
| --- | --- | --- |
| `ai-models.md` | 契约 | `ai-model-management`；英文使用入口保留在 README/既有手册 |
| `ai-models.zh-CN.md` | 契约 | `ai-model-management`；与英文源合并、去重 |
| `application-awareness-acceptance.md` | 历史证据 | `archive/2026-10-11-add-application-awareness` |
| `bootstrap-work-runtime-acceptance.md` | 历史证据 | `archive/2026-09-20-bootstrap-work-runtime` |
| `cli-platforms.md` | 契约与进度 | `control-cli`、`desktop-webui`；`support-cross-platform-cli-and-default-desktop` 的 `cli-runtime-portability` delta 及原验证进度 |
| `core-release-0.0.4.md` | 发行事实 | `remove-docs-dir`；保留版本和所关联原变更，不能假定属于单一变更 |
| `core-release-0.0.5.md` | 发行事实 | `remove-docs-dir`；保留版本和所关联原变更，不能假定属于单一变更 |
| `design/architecture.md` | 早期设计 | `remove-docs-dir`；保持历史 TS 草案和未确认建议的原有标识 |
| `design/desktop-review/README.md` | 原型导航 | `remove-docs-dir`；与其依赖的原型/截图共同保留 |
| `design/piwork-desktop-prototype.md` | 早期原型 | `remove-docs-dir`；不以原型重新规定当前交互 |
| `desktop-webui-acceptance.md` | 累计历史证据 | `remove-docs-dir`；保留各段原变更/日期，不拆改已记录结论 |
| `desktop-webui.md` | 契约 | `desktop-webui`、`desktop-ui-language`；图片/版本说明同时核对 `improve-desktop-chat-and-release-info` delta |
| `docker-delivery-acceptance.md` | 历史证据 | `archive/2026-10-06-deliver-core-and-cli-with-docker` |
| `docker-quickstart-acceptance.md` | 历史证据 | `archive/2026-10-08-improve-readme-quickstart-docs` |
| `docker-release-publication-review.md` | 累计发行复核 | `simplify-docker-release-and-quickstart`；保留实际发布和网站复核范围 |
| `docker-release-quickstart-acceptance.md` | 累计发行证据 | `simplify-docker-release-and-quickstart`；原候选与最终候选分别保留 |
| `docker-release.md` | 契约与维护命令 | `docker-delivery`、`simplify-docker-release-and-quickstart`；必要使用命令归入既有部署手册 |
| `go-migration-acceptance.md` | 历史证据 | `go-core-cli-migration`；保持矩阵、条目 ID 与原状态 |
| `go-migration-final-report.md` | 历史交付报告 | `go-core-cli-migration`；当前边界核对该变更的 `native-runtime-distribution` delta |
| `go-migration-ui-review.md` | 历史证据 | `go-core-cli-migration` |
| `improve-desktop-chat-and-release-info-acceptance.md` | 历史证据 | `improve-desktop-chat-and-release-info` |
| `native-agent-images.md` | 契约与构建示例 | `go-core-cli-migration` 的 `native-runtime-distribution` delta；默认环境核对 `web-development-base` |
| `native-file-helper.md` | 契约 | `work-file-access`；原生交付核对 `native-runtime-distribution` delta |
| `nicegui-default-environment-acceptance.md` | 历史证据 | `archive/2026-10-11-restore-nicegui-default-environment` |
| `open-source-readiness.md` | 约定与历史检查 | `repository-documentation-governance`；原检查结论作为 `remove-docs-dir` 的来源附件 |
| `operations.md` | 契约与运维入口 | `core-service-startup`、`work-lifecycle`、`work-services`；必要操作并入既有入口 |
| `pi-package-helper.md` | 契约 | `pi-package-management`、`pi-package-activation`；原生 helper 边界核对 `native-runtime-distribution` delta |
| `piwork-brain/BASELINE.md` | 架构不变量与来源 | 本变更 `piwork-brain` 的 BRN-007；原件归 `archive/2026-10-09-simplify-piwork-brain-and-extract-work-memory` |
| `piwork-brain/memory-acceptance.md` | 历史证据 | `archive/2026-10-09-simplify-piwork-brain-and-extract-work-memory` |
| `piwork-brain/verification.md` | 历史核验 | `archive/2026-10-09-simplify-piwork-brain-and-extract-work-memory` |
| `piwork-brain-go-acceptance.md` | 历史证据 | `archive/2026-10-04-rebase-piwork-brain-onto-go-core` |
| `piwork-brain.md` | 契约 | `piwork-brain`、`work-memory`、`web-development-base`；历史采用事实分离为附件 |
| `product-language.md` | 契约 | 本变更 `ui-language`；Desktop 专项规则核对 `desktop-ui-language` |
| `sdk-adapter.md` | 契约与决策 | `agent-conversation`、`runnable-work-runtime`、`work-agent-feedback`、`work-memory`；原生边界核对 `native-runtime-distribution` delta |
| `selinux-snapshot-acceptance.md` | 历史证据 | `archive/2026-10-05-fix-selinux-snapshot-compatibility` |
| `selinux.md` | 契约 | `core-service-startup`、`work-snapshots`；原兼容性证明链接到对应历史变更 |
| `serve-console.md` | 契约与预览命令 | `serve-ui`、`serve-control-plane`、`ui-language`；核对 `integrate-delivered-webuis` delta |
| `service-access.md` | 契约 | `work-services`、`service-network-access`、`browser-service-access` |
| `service-mcp.md` | 契约 | `work-services`、`agent-service-deployment`、`mcp-tool-access`；Go 程序交付边界归原生交付 delta |
| `testing.md` | 验证契约与命令 | RDOC-006、对应能力的 Scenario 和所属变更验证附件；统一执行入口继续由 Makefile/scripts 提供 |
| `ui-language.md` | 契约 | 本变更 `ui-language`；共享颜色及表单基准入 UIL-011/012 |
| `ui-prototypes/delivered-acceptance-matrix.md` | 原型覆盖输入 | `integrate-delivered-webuis`；保持原型证据与真实后端验收的区分 |
| `ui-prototypes/desktop-webui-brief.zh-CN.md` | 原型输入 | `integrate-delivered-webuis`；当前交互由 `desktop-ui-language` / `desktop-webui` 承载 |
| `ui-prototypes/serve-ui-brief.zh-CN.md` | 原型输入 | `integrate-delivered-webuis`；当前交互由有效 `serve-ui` / `ui-language` 承载 |
| `user-cli.md` | 契约与命令示例 | `control-cli`；首次使用入口保留在双语 README |
| `web-base-acceptance.md` | 历史证据 | `archive/2026-10-10-add-default-demo-development-image` |
| `webui-integration.md` | 实现对照与历史证据 | 当前边界核对 `serve-ui`、`desktop-webui` 及 `integrate-delivered-webuis` delta；原交付/验收记录归该变更附件 |
| `work-create-start-latency-acceptance.md` | 历史证据 | `archive/2026-10-11-reduce-work-create-and-start-latency` |
| `work-files.md` | 契约 | `work-file-access`、`work-access` |
| `work-package-format.md` | 契约 | `portable-work`；历史图片与 Memory 字段核对 `agent-conversation`、`work-memory` 及相关 delta |
| `work-snapshot.md` | 契约与命令示例 | `work-snapshots`、`portable-work`；必要用户命令保留在 README |

对其他能力补齐表达时，先在本变更加入对应 delta 并同步 proposal 的 capability 声明，再迁移该内容；主规格同步保持独立生命周期。没有当前证据支持的新行为留在对话中请所有者决策，不因旧文档存在就实施。

### 3. 历史附件保留原归属，无法唯一归属的由本变更承接

对能明确定位的原变更，统一采用：

`openspec/changes/<change-or-archive-path>/evidence/legacy-docs/<原 docs 相对路径>`

路径里的原目录层级保留，减少原型及图文之间的相对链接损失。已归档变更只补入原有材料的附件和必要导航修复，不修改原需求、任务完成状态、日期、发布身份或结论。未来生成脚本不覆写这些冻结附件。

早期架构、Desktop 原型、累计跨变更验收和没有单一所属变更的发行记录，保留在本变更的 `evidence/legacy-docs/`；清单记录已知的原变更关联，不为了归属整齐创建虚构历史。

非 Markdown 去向为：

| 原文件集合 | 数量 | 目标 |
| --- | --- | --- |
| `docs/images/piwork-logo.png` | 1 | `apps/ui-shared/assets/piwork-logo.png`，共享产品输入 |
| `docs/images/desktop-preview.png` | 1 | 原件冻结于本变更 `evidence/legacy-docs/images/desktop-preview.png`；相同字节的产品展示副本位于 `apps/ui-shared/assets/desktop-preview.png`，供 README 与本地打包使用 |
| `docs/design/**` 中 PNG / Excalidraw | 57 | 本变更 `evidence/legacy-docs/design/`，逐文件保留原型来源 |
| `docs/piwork-brain/architecture.html`、`architecture.svg` | 2 | 已归档 `simplify-piwork-brain-and-extract-work-memory` 的同层级附件 |
| `docs/go-migration-boundary.json`、`go-migration-scenarios.json` | 2 | `go-core-cli-migration/evidence/legacy-docs/`，冻结现有清单和 970 条证据 |

Baseline 原件保留其 1.0.0 来源与测试映射；BRN-007 直接承载 B01–B08。当前规则引用 Spec，原始授权引用附件与 Git 历史，不把附件继续当作第二份可独立演化的规范。

### 4. 产品图片采用稳定资源路径，保持运行入口

`apps/ui-shared/` 已承载两端共享颜色。将 Logo 置于其 `assets/`，由 Desktop / Console 各自构建复制到原公开静态位置，再同步到 Go 嵌入资源。保持 `/desktop/piwork-logo.png` 和 `/piwork-logo.png` 不变，不重新生成或压缩图片。

README 展示图采用同目录下的 `desktop-preview.png` 产品副本，与冻结原件按 SHA256 核对。双语 README、同步模板和发行 staging 使用该稳定资源，不再消费本次变更的 active 附件路径。展示副本服务于产品介绍和打包，不额外嵌入浏览器程序或改变运行时资源。

具体依赖：

| 文件/模块 | 调整职责 |
| --- | --- |
| 两端 `scripts/copy-static.mjs` | 从共享资源读取相同图片 |
| `scripts/build-cli.mjs`、`scripts/build-docker-release.mjs` | 对实际新资源路径及内容计算输入摘要 |
| 根及 Core/CLI Docker ignore 文件 | 移除旧 Logo 例外，允许共享资源；不放开 secrets 或整个 OpenSpec |
| `scripts/clinative/smoke.go` | 从新源路径取得预期图片并验证独立二进制 |
| `build-cli`、`build-docker-release`、`check-cli-platform`、`check-docker-quickstart` 的测试夹具 | 合成仓库使用新资源路径，保留摘要变化与资源缺失等负向检查 |
| Go 嵌入模块 | 构建后核对图片和宿主资源同步；只提交仓库实际跟踪的产物 |

发布摘要包括路径，移动图片后新候选身份变化是预期结果。已有 release.json、固定镜像和历史验收不为匹配新源码而回填。若正式候选检查要求重建，只生成必要本地候选；不将推送或新发行作为本次迁移完成条件。

### 5. 历史证据只读，生成脚本默认写入 dist

- `collect-go-migration-boundary.mjs` 默认写 `dist/verification/go-migration-boundary.json`。
- `update-go-acceptance-index.mjs` 从原变更冻结的 JSON 和 verification-matrix 读取，默认写 `dist/verification/go-migration-scenarios.json` 与 `go-migration-acceptance.md`。不能依赖旧目录中的 Markdown 模板。
- 上述冻结输入和 `check-go-acceptance.mjs` 的冻结回退按 Decision 2 的所属变更定位；`go-core-cli-migration` 归档后仍读取同一份证据，生成输出继续留在 dist，不恢复 active 目录或覆写历史。
- 保留现有 36 capability / 260 Requirement / 970 Scenario 的身份、去重、证据完整性、变更审阅和原状态校验；这是该历史矩阵的边界，不是未来所有新规格的固定数量。
- `check-go-acceptance.mjs` 与 `make acceptance-index` / `make acceptance` 使用明确的新输出或冻结输入，保持缺失通过证据时失败，不修改测试通过门槛。
- 默认生成不写持久附件。需要保留的新结果通过已授权变更的验收步骤显式纳入；脚本不提供无条件覆写历史的默认快捷路径。
- `check-native-boundary.mjs` 将当前规范/命令示例扫描转向主规格和必要的当前使用入口，历史附件按精确范围排除；原有被替换平台入口的拒绝继续有效，不把整个 OpenSpec 作为免检区。

相较于让旧脚本继续改写归档，这种方案使重新运行报告与历史事实互不覆盖，也使默认开发命令不隐式持久化新文档。

### 6. 用户说明保留入口，打包使用明确清单

根双语 README 继续提供介绍、首次使用、架构、构建和限制。长期的当前行为导航优先指向已经存在的 `openspec/specs/<capability>/spec.md`，使用有效的文件或既有锚点；开发/验证入口可指向现行 AGENTS 和既有命令。尚未同步的新治理能力不通过伪造主规格或提前同步解决导航。当前入口不再以 `remove-docs-dir` 的 active delta 和历史附件作为永久使用路径；历史证据保留在所属变更，通过其规划和清单追溯。部署专属命令继续维护在已有 `deploy/docker/`、`deploy/images/web-base/` 与 `examples/single-host/` 的双语入口，不扩展新的开发文档目录。

`package-go-release.sh` 继续使用明确材料清单，`stage-go-release-materials.mjs` 负责双语 README、LICENSE、必要安装材料和稳定产品图片及其链接，不批量复制全部开发 Markdown 或 970 条历史验收 JSON。原有静态材料先按清单复制，再处理所选 Markdown/HTML 中的本地文件链接，保留源相对层级并检查本地依赖闭包：

- 目标已随包提供时保留有效本地链接；必要图片和操作材料继续随包。
- 仅用于深入阅读且未随包的目标，只有通过 `git cat-file` 证明实际源码 commit 存在该文件、且对象字节与工作树选用文件完全一致时，才转为该 commit 的仓库外链。仅检查路径存在不足以覆盖已修改文件。
- 目标为新文件或内容已修改时，将实际选用文件及必要的本地文档/图片依赖加入包，保留有效相对链接。循环引用去重，查询和片段保留；不为节省材料而链接到旧 commit 中的不同内容。
- 本地目标缺失、越出仓库或属于不允许打包的内容时明确失败；不删除链接、不伪造 SHA、不扩大成全量历史复制。原本明确写出的外部 URL 不改写。

打包使用实际 commit 与 dirty 身份，支持当前未提交工作树；不以要求提交、推送或发布作为解决 W2 的前提。离线运行资源仍嵌入程序，不增加运行时网络依赖。验证材料链接同时核对“目标对象存在”和“内容一致”，不只断言 URL 含某个 SHA。

`sync-docker-quickstart.mjs` 的资源说明模板和 `sync-docker-website.mjs` 的上游文档链接映射使用稳定资源与已存在的用户/主规格入口，以隔离合成官网夹具验证归档前后导航。保留它们操作外部官网 `docs/` 的能力；本次不运行真实官网写入。

### 7. 路径检查覆盖可执行依赖，行为约束由开发入口表达

新增 `scripts/check-repository-docs.mjs` 并接入正常验证入口，至少检查根 `docs/` 的实际存在、当前用户入口的本地 Markdown/HTML 图片与文档链接、已登记生成入口的输出位置及迁移清单的目标有效性。根目录检测覆盖未跟踪文件，不能以 .gitignore 掩盖回归。

用隔离夹具验证“根 docs 回建”“当前链接悬空”“错误生成路径”会失败，“历史路径文字”“外部官网 docs”“Work 内 docs”“随产品交付的 Markdown”不会误报。相关生成入口在无旧目录的合成仓库运行，并核对冻结证据摘要不变。

新增归档生命周期夹具：先在 active 布局执行清单/文档检查、冻结输入生成和发行 staging，再在同一隔离副本中构造规格同步后的主规格布局并将所属变更实际移到带日期的 archive，确认 active 目录不存在后重跑相同入口。覆盖本次变更与 Go 迁移冻结输入的归属；目标不存在、歧义和越界分别保留负向用例。普通测试可用合成目录完成，不给 `npm ci` / `make test` 增加全局 OpenSpec CLI 依赖；如另用 CLI 核对，只操作一次性副本，绝不归档实际工作树。检查和 staging 前后核对源证据摘要、根 docs 缺失及输入文件未被检查器改写。

原始命令、历史路径、Spec 中的失败场景不按普通当前链接处理。对主规格尚待本变更 delta 替换的旧文档要求，依据有效 delta 判断，不为使字符串检查通过重写历史。检查证明目录和依赖约束；所有者授权的语义由 AGENTS / OpenSpec 工作流执行，不声称静态检查能提供独立身份审批隔离。

### 8. UIL-012 校正到现行容器与响应式布局

W1 通过修正规格及迁移清单的解释解决。当前 Console `task-content` 表单在 1440px 参考视口下为最多 712px 内部网格，标签 156px、间距 16px、控件占剩余宽度，达到最大宽度时为 540px；帮助与动作沿 172px 的起点对齐。基础 `.field` 在其他容器中仍有 176px 标签和最多 520px 控件的规则，不能全局替换。

保留 `apps/console-webui/public/style.css` 的现行容器覆盖和响应式断点：任务表单在不同断点调整列宽与缩进，窄屏折为单列；360px 下输入、帮助、错误和动作同列可达。实施中复用实际样式验证 1440px、现有断点和 360px 的计算布局，同时抽查非任务容器与登录例外。测试证明规格与现行布局一致，不通过改 CSS 或重新设计页面迎合迁移前的文档。

## Risks / Trade-offs

- [把历史草案重新升级为当前约束] → 每份源文档标明当前/历史归属，核对源码和有效 delta；冲突记入本变更而非改产品来迎合旧文档。
- [文档移除但信息只被搬到 evidence] → 迁移清单必须为当前段落指向 Requirement；只有历史事实采用附件，完整覆盖后删除。
- [跨附件相对链接失效] → 保留原相对层级，使用迁移映射修复 Markdown 导航；二进制与 JSON 保持字节身份。
- [变更归档后 active 路径失效] → 当前入口采用稳定路径，清单与冻结输入按所属变更定位，并在隔离副本中实际移动目录复测检查和 staging。
- [dirty 材料被链接到缺失或过期的 Git 对象] → 固定 commit 外链要求对象存在且字节一致；其余必要材料按实际内容和本地依赖闭包随包提供。
- [旧表单说明引发 UI 回退] → UIL-012 按现行容器与参考视口校正，以计算布局核对，不改产品样式来迁就旧文档。
- [Logo 移动导致构建和输入摘要失真] → 两端构建、摘要门禁、Go smoke 与合成夹具同改；旧发布身份保留真实原值。
- [默认生成污染归档] → 默认 dist 输出、冻结输入只读，并测试原文件摘要不变和旧目录缺失。
- [其他未归档变更仍引用旧路径] → 只修复当前可执行导航及明确路径依赖，保留原任务事实，主规格同步/其他变更归档不捆绑本次迁移。
- [治理扩张为产品审批机制] → RDOC-007 明确作用域，BRN-007 保留产品普通任务的最短路径规则。

## Migration Plan

1. 采集原文件和身份，建立清单；按上表补齐有效契约归属及两个明确冲突的 delta。
2. 迁移历史附件和共享资源，修复链接；同步生成入口、构建、原生打包及对应夹具。
3. 更新 AGENTS、项目 OpenSpec 配置和双语用户导航；加入路径检查。
4. 确认清单全部覆盖、现行依赖已改、新资源构建通过后删除根 `docs/`，在无该目录状态下执行相关验证。
5. 保存本次实际验收到本变更附件；未执行的平台或真实交互明确保留原状态。提交前按 AGENTS 说明拆分范围：规格表达/历史附件、功能资源与工具及测试、双语使用文档、开发约定分别组织；跨组依赖在完整序列后集成核对。
6. 按新增任务修复 C1/W1/W2：先升级清单定位并验证身份保留，再修复稳定资源/导航、冻结输入和打包链接，核对 UIL-012 与现行布局。每项同时完成自身回归，最后做 active → archive 隔离集成验证。
7. 保留已有验收与问题报告，后续 apply 将实际修复结果另行记录并重新 verify；已知与迁移无关的 Desktop 模型选择基线失败和未执行范围继续如实说明，不将历史任务勾选解释为新增修复已完成。
8. 等所有者另行请求，再按 OpenSpec 同步与归档流程处理实际变更；不自动归档其他变更。归档夹具验证不等于执行实际同步或归档。

本次变更不触及用户数据和运行中的安装。回退使用对应 Git 提交恢复源码路径、脚本和文档；不能为了回退改写已发布身份或删除用户资源。无影响规格、方案或任务拆分的待定问题。
