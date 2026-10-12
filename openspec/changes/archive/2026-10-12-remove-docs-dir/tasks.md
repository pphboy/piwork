# Tasks

实施依赖：先固定迁移清单和规范归属，再处理附件、资源与工具，随后切换用户入口并移除根目录。每组随改动完成自身检查；最后一组只做集成核对。任务状态依据实际实施与检查更新；本次结果见 evidence/verification.md，任务完成不代表历史验收或其他平台重新通过。

第 1–7 组的 30 项勾选保留原执行记录。后续核验在 `evidence/spec-verification.md` 发现 C1、W1、W2，第 8 组新增 7 项待办落实修复及回归；本次 update 仅修订规划，不代表这些问题已经解决。原验收报告、问题报告及与迁移无关的 Desktop 模型选择基线失败保持真实记录。

## 1. 迁移基线与开发入口

- [x] 1.1 在本变更建立 `evidence/migration-map.json`，逐文件记录实际 Git 身份、源 SHA256、类别、目标和处理理由；验证覆盖当前根 docs 全部文件，包含已调查的 114 项，并发现实施期间新增文件，不能只校验固定总数。（RDOC-002/003）
- [x] 1.2 修订 AGENTS 的文档、目录、CLI 平台和测试导航约定，明确所有者发起/授权 OpenSpec 后持久化、已授权范围内不逐文件审批，以及产品 Markdown 的功能边界；按 RDOC-001/007 的探索、proposal、apply 与模板场景人工核对条款，无新增长期开发文档入口。
- [x] 1.3 在现有 `openspec/config.yaml` 的适用规划/实施约束中补充文档归属和迁移规则，不重写技能包；通过 OpenSpec context / instructions 核对配置仍可解析且约束被正确提供，无新增产品审批阶段。

## 2. 有效契约归入 Spec

- [x] 2.1 处理 operations、selinux、native-agent-images、native-file-helper、pi-package-helper、sdk-adapter 的当前段落，按设计表映射到启动、生命周期、文件、包、Agent 和原生交付契约；验证每个有效段落有 Requirement 标识符及必要 Scenario，旧实现说明与历史 SDK 决策不被提升为新功能。（RDOC-002）
- [x] 2.2 处理 user-cli、cli-platforms、desktop-webui、serve-console 和两种语言 ai-models 的当前行为与命令示例；核对现行源码和有关未归档 delta，验证英文/中文来源去重、平台优先级/恢复规则和未完成 Windows 验收完整保留。（RDOC-002/005）
- [x] 2.3 处理 service-access、service-mcp、work-files、work-snapshot、work-package-format；验证 Service/MCP、路径与权限、stopped 导出导入、历史图片/Memory 格式等现有约束各有对应 Spec 表达，命令与当前 CLI help / 实现一致，没有新业务行为。（RDOC-002）
- [x] 2.4 完成 ui-language、product-language 到本变更 UIL-001/005/008/009/011/012 的转换，并保留现有未涉及的 Requirement / Scenario；验证当前 Console 工作区、独立 AI models、颜色与表单规则有直接 Spec 来源，所有当前依赖不再指向两份旧文档，不修改 UI 以迎合历史描述。
- [x] 2.5 完成 piwork-brain 与 BASELINE 当前约束的归属，BRN-007 直接保留 B01–B08，其他规则对应既有 piwork-brain / work-memory / web-development-base；验证原版本、所有者授权和产品最短路径/显式 Apply 边界均不变。
- [x] 2.6 处理 testing、open-source-readiness、docker-release 及 webui-integration 的当前验证/交付段落；验证命令和环境边界对应实际 Makefile / scripts，历史通过结论单独归属证据，不为本次整理重跑无关模型或完整 Docker 验收。（RDOC-002/006）
- [x] 2.7 汇总设计表中全部 51 份 Markdown 的段落归属；对需补齐其他能力表达的项目先更新本变更 proposal / delta，再迁移，不提前同步主规格；以 `openspec validate remove-docs-dir --strict` 和迁移清单核对没有仅搬进 evidence 的当前规范或未说明的信息丢失。

## 3. 历史证据与原型附件

- [x] 3.1 按设计归属迁移各验收记录、发行记录、Brain 历史核验、原型输入和跨变更累计记录；验证目标原变更存在，来源不明确者由本变更承接，原日期、版本、状态、commit/dirty/hash/digest 和结论保留。（RDOC-003）
- [x] 3.2 将 57 份设计 PNG / Excalidraw、Desktop 展示图和 Brain HTML / SVG 迁入指定附件层级，与原型导航一起修复相对链接；用源/目标 SHA256 验证二进制与冻结图形内容不变，Markdown 导航差异在清单注明。
- [x] 3.3 将 Go 迁移的两个 JSON 和相关验收/交付记录冻结到 `go-core-cli-migration/evidence/legacy-docs/`；验证原 970 条记录的 ID、状态、tests/commands/results 及两个 JSON 的内容摘要完全保留，原通过门槛不改变。
- [x] 3.4 修复其他变更和历史附件中指向已迁文档的实际 Markdown 导航，原始路径文字与历史命令保留；验证历史条款、任务完成状态和发行身份没有被改写，也没有自动归档任何既有变更。

## 4. 共享资源与构建依赖

- [x] 4.1 将 Logo 移至 `apps/ui-shared/assets/piwork-logo.png` 并更新两端 copy-static；验证源/目标图片摘要一致，运行两端 WebUI build，生成的公开图片和 Go 嵌入资源保持对应。
- [x] 4.2 更新 CLI/Desktop 和 Docker 发布的输入摘要消费路径，以及对应合成仓库夹具；运行 `build-cli.test.mjs`、`build-docker-release.test.mjs`、`check-cli-platform.test.mjs`，验证资源变化影响实际摘要、缺失资源明确失败，旧发行记录未被回填。（RDOC-005）
- [x] 4.3 更新根、Core、CLI 的 Docker ignore Logo 例外并核对相关 Dockerfile 的共享资源复制；验证允许新资源且保持 env/私钥/数据/OpenSpec 排除，使用对应上下文检查或受控构建证明无旧目录依赖，不推送镜像。
- [x] 4.4 更新 `scripts/clinative/smoke.go` 的预期资源源路径并完成宿主程序资源构建；运行相关 Go 静态资源/本机 Desktop 测试，验证原两个静态 URL 和无源码目录下的 Logo 可用，不将本机结果报告为 Windows 实机验收。

## 5. 生成入口与防止目录回归

- [x] 5.1 调整 `collect-go-migration-boundary.mjs` 默认输出到 `dist/verification/`；在无根 docs 的隔离副本运行生成入口，验证输出存在、原冻结附件摘要不变且根 docs 不出现。（RDOC-006）
- [x] 5.2 调整 `update-go-acceptance-index.mjs` 使用新冻结输入并在 dist 生成 JSON / Markdown；配套受控夹具验证 36/260/970 的原矩阵约束、重复 ID、场景改变、缺少通过证据及未验证状态保留，不能依赖被删除的旧 Markdown 模板。
- [x] 5.3 调整 `check-go-acceptance.mjs`、Makefile 的 acceptance-index / acceptance 输入连线；运行对应 Node 单元测试及隔离 `make acceptance-index`，验证完整证据通过、缺失证据失败，默认调用不修改持久文件或恢复根 docs。
- [x] 5.4 更新 `check-native-boundary.mjs` 及其夹具，将当前规范/命令示例扫描转向有效 Spec 和既有用户入口；运行 `check-native-boundary.test.mjs`，验证当前材料的旧平台入口仍被拒绝、历史证据按精确范围保留。
- [x] 5.5 新增 `scripts/check-repository-docs.mjs` 和必要测试并接入普通验证；以隔离夹具证明未跟踪根 docs、悬空当前链接、非法生成目标会失败，历史文字、外部官网 docs、用户 Work 同名目录和产品 Markdown 不会误报。（RDOC-004/007）

## 6. 双语使用入口与本地打包

- [x] 6.1 同步根中英文 README、deploy/docker、deploy/images/web-base 和 examples/single-host 的必要使用说明与文档导航，采用新 Logo 和展示图去向；检查两种语言章节、命令、架构图、限制与实际目标一致，所有当前本地链接有效。（RDOC-005）
- [x] 6.2 更新 `sync-docker-quickstart.mjs` 的说明模板和 `sync-docker-website.mjs` 的上游链接映射；执行 `node scripts/check-docker-quickstart.mjs` 与 `node --test scripts/check-docker-quickstart.test.mjs`，在合成官网夹具验证新导航及既有启动命令一致，真实官网工作树不被写入。
- [x] 6.3 将 `package-go-release.sh` 改为明确的用户材料清单，移除 docs 通配复制和历史 JSON 打包；以合成打包输入、Shell 语法检查和 staging 文件/链接核对验证必要双语说明、图片、校验清单及源码 commit 链接正确，无隐式正式发布。（RDOC-005）

## 7. 移除目录与集成核对

- [x] 7.1 在规范归属、附件迁移和依赖切换完成后删除根 docs；运行迁移清单完整性、目标/链接和摘要核对及 `node scripts/check-repository-docs.mjs`，验证全部原文件已处理、根目录不存在且没有当前入口依赖旧路径。（RDOC-002/003/004）
- [x] 7.2 在无根 docs 的状态完成 `make build`、`make build-cli` 和相关 Node / Go 检查；资源构建后运行两端现有浏览器资源用例，验证独立宿主程序的 Logo、深链接与嵌入资源保持，已通过的同输入检查不无理由重复。
- [x] 7.3 执行 `make test`、`node scripts/check-native-boundary.mjs`、Docker Quick Start 检查、严格 OpenSpec 校验和 `git diff --check`；将实际命令、身份、结果及未执行的平台/真实交互范围记录为本变更验收附件，不把历史 970 项或原型证据替代本次检查。
- [x] 7.4 按 AGENTS 说明拟提交的功能资源/工具与测试、双语用户说明、开发约定、规格/附件边界和顺序，并核对完整序列的一致性；以最终 diff / 清单证明没有新建 OpenSpec 之外的开发文档、没有改写既有发布身份或混入用户数据，主规格同步与归档保持待所有者另行请求。

## 8. 核验问题修复与归档回归

- [x] 8.1 修复 C1 的产物定位：按设计将迁移清单升级为 v2，以所属变更和变更内相对路径定位 delta / evidence，并提供只读解析供检查和冻结输入入口复用；同时验证 active、唯一 archive、缺失、歧义和路径越界场景，以及全部 114 项原 source SHA256 / 字节数、采集 commit / dirty、段落归属和冻结证据身份不变。（RDOC-003/004）
- [x] 8.2 修复 C1 的当前导航和展示资源：在 `apps/ui-shared/assets/desktop-preview.png` 保留与冻结原件相同字节的产品副本，同步双语 README、既有部署入口和官网模板到稳定资源及已存在的主规格/使用入口；运行文档与 Docker Quick Start 检查，并在合成官网和归档布局中核对链接有效、两种语言同步，不提前同步主规格或写入真实官网。（RDOC-005）
- [x] 8.3 修复 C1 的冻结输入和发行 staging：将 Go 验收索引生成及冻结回退改为所属变更定位，staging 消费稳定产品资源，清理剩余 active 路径依赖；配套测试在所属变更实际移入隔离 archive 后，清单检查、索引生成和材料 staging 继续成功，默认输出仍在 dist，冻结 JSON / 原矩阵摘要不变且没有恢复 active 目录或批量复制历史附件。（RDOC-004/005/006）
- [x] 8.4 修复 W2 的发行链接：固定 commit 外链同时验证 Git 对象存在与选用内容字节一致；新建或修改而未提交的必要文档按实际内容及本地文档/图片依赖闭包随包保留，越界或缺失目标明确失败；增加 clean 精确对象、新增 dirty 文档、已存在但修改的 dirty 文档、相对链接/图片闭包及缺失目标夹具，核对包内可达性和外链实际对象，不伪造 commit 或将提交/发布作为前提。（RDOC-005）
- [x] 8.5 修复 W1 的迁移解释并核对 UIL-012：更新迁移清单中相关表单尺寸说明，复用实际 Console 样式在 1440px 参考视口验证任务表单 156px 标签、16px 间距及最大网格内 540px 控件，同时检查现行响应式断点、360px 单列、其他管理容器和登录例外；记录计算布局证据，不通过修改 CSS 或统一所有表单列宽迎合旧文档。（UIL-012、RDOC-002）
- [x] 8.6 完成跨入口归档回归：在一次性仓库副本先执行 active 检查，再构造主规格同步后的布局并将所属变更移入带日期的 archive，确认原位置缺失后重跑文档检查、冻结输入生成、发行 staging 和相关 Node / 原生边界 / Docker Quick Start 检查；验证源证据身份不变、根 docs 不存在、检查只读，普通测试不依赖全局 OpenSpec CLI，不同步或归档实际工作树。（RDOC-004/005/006）
- [x] 8.7 按实际受影响输入完成必要的构建与相关测试、严格 OpenSpec 校验和 `git diff --check`，在本变更另行记录实际修复验收并重新 verify C1/W1/W2；保留原两份报告与已知 Desktop 基线失败及未执行范围，不把新结果回填为旧结论，不无理由重跑完整模型/Docker 验收，不自动提交、推送、发布、同步主规格或归档。
