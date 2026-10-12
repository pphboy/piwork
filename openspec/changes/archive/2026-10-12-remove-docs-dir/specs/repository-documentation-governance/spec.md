# 仓库文档治理规格变更

## Purpose

明确由项目所有者主导的仓库开发文档持久化规则，使当前需求统一归属 OpenSpec，并在移除根 docs 目录时保留有效契约、必要使用入口和历史证据，防止 AI 在开发中自行建立另一套长期文档体系。

## ADDED Requirements

### Requirement: 由所有者发起或授权开发文档持久化

**Identifier:** RDOC-001

仓库开发代理发现需要持久化的新需求、设计决策、实现边界或开发知识时，SHALL 先在对话中说明内容和原因，由项目所有者发起或明确授权 OpenSpec 变更，再在该变更内形成或更新必要 Spec 及规划，随后通过 apply 执行。仅进行讨论、回答设计问题或要求继续调查 SHALL NOT 被解释为授权创建新的持久化开发文档或自行启动新变更。

代理 SHALL NOT 自行建立开发笔记、长期计划、设计报告、验收汇总或替代文档目录。已获授权的变更内 SHALL 允许按既定范围维护 proposal、design、specs、tasks 和必要验收附件，不要求所有者逐文件确认；新的范围或行为决策仍须按已有授权边界处理。只读调查、普通查询与临时验证输出 SHALL 不为此新增 OpenSpec 变更。

#### Scenario: 探索中发现值得保存的决策
- **WHEN** 代理调查后认为一项新设计需要长期保留，而所有者尚未授权捕获为 OpenSpec 变更
- **THEN** 代理在对话中说明并提示 OpenSpec 入口，等待所有者发起或授权，不创建笔记、报告或新的变更

#### Scenario: 所有者发起 proposal
- **WHEN** 所有者明确请求为已确认范围执行 openspec-propose
- **THEN** 代理在对应变更中生成必要规划和 Spec，完成后停在可审阅规划，不将该请求解释为实施授权

#### Scenario: 已授权变更内记录验收
- **WHEN** 所有者已授权 apply，代理完成范围内的必要验证
- **THEN** 代理可以更新原 tasks 和必要的变更附件，不再为每一份已约定产物重复索要确认

### Requirement: 当前开发契约统一归属 OpenSpec

**Identifier:** RDOC-002

仓库当前有效的需求和行为约束 SHALL 按能力归入 OpenSpec Requirement / Scenario，设计与理由归入对应变更；实现和验证 SHALL 能追溯到有效主规格及尚未同步的相关 delta。独立手册、历史设计、验收结论或模型记忆 SHALL NOT 成为另一套当前规范来源。

迁移 SHALL 对原根 `docs/` 每个文件记录原路径、内容类别、目标能力/Requirement 或附件路径及处理理由；当前混合文档 SHALL 分离有效契约与历史事实。已有规格覆盖的内容 SHALL 引用、去重；尚未覆盖但属于已确认现行行为的细则 SHALL 补齐对应规格表达。未经确认的历史建议、过期版本和未通过项 SHALL NOT 自动变成新的产品要求或通过结论。所有当前规范内容完成归属之前 SHALL 不删除其唯一有效来源，也不能只把整份当前手册改名放入 evidence 来代替转换。

#### Scenario: 一份文档混有契约与验收事实
- **WHEN** 原文同时描述当前恢复规则和某次测试结果
- **THEN** 恢复规则对应到能力 Requirement / Scenario，测试结果归属原变更附件并保留适用范围，两者各有迁移去向

#### Scenario: 历史设计与当前实现冲突
- **WHEN** 旧文档要求七项平级导航，而有效变更和当前实现采用工作区与模型管理入口
- **THEN** 迁移记录冲突并采用已确认的有效要求，不通过恢复旧 UI 或将历史文档升级为规范消除差异

#### Scenario: 尚未覆盖的有效细则
- **WHEN** 文档存在已确认的现行约束，而有效 Spec 尚未完整表达
- **THEN** 代理在已授权迁移范围内补齐相应 delta 和能力声明后再处理该项，不直接改写主规格、删除细则或据此扩展产品功能

### Requirement: 保留有价值的历史材料及其真实身份

**Identifier:** RDOC-003

有价值的历史设计、原型、截图、验收、发行记录和机器可读证据 SHALL 保留为对应 OpenSpec 变更的附件，并能查询原路径、所属变更、版本和适用范围。不能确定唯一原变更的历史材料 SHALL 归入本次迁移变更并记录其来源，不能伪造归属或创建虚构的历史变更。

迁移 SHALL 保留原 commit、dirty 状态、输入摘要、镜像 ID/digest、执行结果、未完成项及既有测试状态；相对导航修复 SHALL 不改变这些事实。冻结图片和机器可读证据 SHALL 可核对迁移前后的内容摘要。当前迁移通过 SHALL 不自动意味着历史验收、原生 Windows、真实模型或 Docker 闭环重新通过。

#### Scenario: 移动发行记录
- **WHEN** 已发布制品的记录作为附件迁移
- **THEN** 其原身份和值保持，后续源码路径或构建摘要变化不被回填成原发布身份

#### Scenario: 移动验收 JSON 与原型
- **WHEN** 机器可读场景记录和原型图迁入对应变更
- **THEN** 原记录条目、状态与二进制内容可核对，未验证项不变为通过，原型截图不被当作新实现证据

#### Scenario: 来源跨多个早期讨论
- **WHEN** 一份历史草案无法证明属于某个单独变更
- **THEN** 将其保留为本次迁移的来源附件并说明已知事实，不为整齐归档编造所有者授权或历史变更

### Requirement: 根 docs 目录移除并具有检查入口

**Identifier:** RDOC-004

仓库根 `docs/` SHALL 不再存在。当前用户导航、构建、打包和生成入口 SHALL 不依赖被移除的路径，开发检查 SHALL 对根目录重现、当前悬空引用和生成入口回建目录明确失败，并能定位问题。

迁移清单中的变更产物及相关冻结输入 SHALL 能按所属变更和变更内相对位置定位，不把未归档目录的具体路径作为永久身份。所属变更从 active 移入 archive 后，迁移目标校验、冻结输入读取及文档检查 SHALL 继续有效；归档前后的定位 SHALL 保留原源文件摘要、采集 commit / dirty 状态、Requirement 标识符和证据身份。缺失、歧义或越出所属变更的定位 SHALL 明确失败，检查 SHALL 只读，不以恢复旧目录、覆写引用或重建附件副本获得通过。

检查 SHALL 区分本仓库根路径、原始历史路径文字、外部官网仓库路径和用户 Work 中的同名目录；不得通过全局删除字符串 `docs/` 或禁止用户文件目录实施规则。规则和检查只能证明约定及可观察的仓库状态，SHALL NOT 被宣称为已实现独立 Agent 身份或不可绕过的人工授权隔离。

#### Scenario: 代理重新创建根 docs
- **WHEN** 新变更在仓库根创建了 `docs/`，包括尚未跟踪的文件
- **THEN** 仓库检查失败并指出该目录，不能因未进入 Git 清单或加入 ignore 而通过

#### Scenario: 生成入口仍写旧路径
- **WHEN** 在无根 `docs/` 的隔离仓库副本执行相关生成入口
- **THEN** 入口使用新的输出位置或明确拒绝非法目标，不重新创建根 `docs/`

#### Scenario: 外部官网和用户目录同名
- **WHEN** 测试夹具包含 Work 内的 `docs/`，或官网工具操作另一个仓库的 `docs/`
- **THEN** 检查按所属根区分，相关行为保留，同时本仓库当前导航不得链接到已移除文件

#### Scenario: 所属变更尚未归档
- **WHEN** 迁移清单引用的 Spec delta 或冻结证据仍在所属 active 变更中
- **THEN** 检查能定位并验证实际目标、Requirement 或内容摘要，冻结输入读取正常，不修改清单或证据

#### Scenario: 所属变更完成归档
- **WHEN** 隔离仓库中的所属变更按正常流程同步规格并移入 archive，active 原位置已不存在
- **THEN** 同一迁移清单和冻结输入入口仍能定位对应产物，当前文档检查通过，源文件和冻结证据的身份不变，不重建原 active 目录或根 `docs/`

#### Scenario: 所属变更定位无效
- **WHEN** 清单引用的所属变更不存在、存在多个无法唯一判定的候选，或相对位置越出该变更
- **THEN** 检查明确报告定位错误而失败，不任选历史版本、不修改路径，也不静默跳过目标

### Requirement: 产品资源和用户入口在迁移后继续可用

**Identifier:** RDOC-005

共享 Logo 等产品资源 SHALL 随所属实现交付，不依赖开发文档目录；Console 和 Windows/Linux CLI 的原静态资源地址、独立二进制可用性、图片内容及品牌交互 SHALL 保持。构建输入摘要 SHALL 反映实际新路径与内容，不能通过固定旧 hash 或伪造元数据避免变更。

中英文 README 和既有部署材料 SHALL 保留必要的用户介绍、使用入口、构建命令和有效导航；本地发行材料 SHALL 使用明确清单，不再批量复制根 `docs/`。迁移 SHALL 不自动对外发布或修改已发布制品身份。

当前 README 展示图等必要用户资源 SHALL 使用不随变更归档而移动的产品路径，历史原件仍按 RDOC-003 保留；当前用户导航、官网同步生成的导航和本地发行材料 SHALL 在相关变更归档前后保持有效。稳定用户入口 SHALL 指向已存在的有效规格或既有使用材料，不要求提前同步主规格或保留失效的 active 路径。

本地发行材料中的仓库文件链接 SHALL 仅在目标存在于实际选用的源码 commit、且该 commit 中目标内容与选用文件一致时转换为固定 commit 外链。新增或修改但尚未提交的必要文档及其本地图片、文档依赖 SHALL 随包保留为有效本地链接；所选材料无法安全随包提供或目标缺失时 SHALL 明确失败，不能生成无效外链、丢弃链接或伪造 commit。已经明确提供的外部 URL SHALL 保留原意；打包 SHALL 不因此复制全部历史附件或要求对外发布。

#### Scenario: 从独立程序读取 Logo
- **WHEN** 用户从无源码、无相邻图片文件的目录启动构建后的 Console 或 CLI
- **THEN** 原登录页、深链接和静态资源入口仍取得相同 Logo，不依赖根 `docs/` 或外部图片网站

#### Scenario: 生成新的本地候选
- **WHEN** Logo 源路径变更后生成本地构建或候选摘要
- **THEN** 使用实际新输入计算身份，既有发行记录保持原值，不自动推送镜像或更新官网

#### Scenario: 用户按 README 操作
- **WHEN** 用户阅读任一语言 README 或既有安装手册
- **THEN** 必要使用入口仍可用，导航指向有效 Spec、对应变更或既有手册，不指向被删除的根文档

#### Scenario: 归档后展示和打包
- **WHEN** README 展示图原件所属变更已归档，维护者检查双语导航、同步工具的合成输出并准备本地发行材料
- **THEN** 展示图仍从稳定产品路径取得，当前导航与打包入口继续有效，不依赖已经移走的 active 目录

#### Scenario: 选用文档与源码 commit 一致
- **WHEN** 未随包复制的文档存在于实际源码 commit，且内容与打包选用文件完全一致
- **THEN** 发行材料可使用该实际 commit 的有效仓库链接，不能替换成另一版本以掩盖目标缺失

#### Scenario: 新增文档尚未提交
- **WHEN** dirty 工作树中被选用材料引用一份实际源码 commit 不包含的新文档
- **THEN** 新文档及必要本地依赖随包保留，链接在包内可达，不生成指向该 commit 缺失对象的外链

#### Scenario: 已有文档修改后尚未提交
- **WHEN** 被引用文档存在于实际源码 commit，但工作树选用内容已修改
- **THEN** 打包保留实际选用内容及其必要本地依赖，不把旧 commit 中的不同内容当作这份材料的目标

#### Scenario: 打包引用目标缺失或无法提供
- **WHEN** 所选材料的本地链接目标不存在，或无法在允许的范围内安全打包且不满足固定 commit 外链条件
- **THEN** 打包明确指出该链接并失败，不留下悬空引用、不静默删除说明，也不修改既有发行身份

### Requirement: 生成输出与持久化证据具有不同生命周期

**Identifier:** RDOC-006

开发清单、日志、截图和验收索引的默认生成输出 SHALL 位于被忽略的临时产物目录，不默认写入新的持久化开发文档或覆写历史附件。需要保留的结果 SHALL 仅在所有者已授权的 OpenSpec 变更范围内成为有来源和身份的附件；已归档证据不得被普通重新生成入口静默更新。

验收索引 SHALL 沿用既有条目身份、证据完整性和状态校验，重新生成、目录迁移和统计汇总 SHALL NOT 自动把未验证项置为通过。相关可执行验证入口 SHALL 保持可发现，必要命令示例与作用范围归属 Spec 或对应变更。

#### Scenario: 默认更新开发清单
- **WHEN** 维护者运行开发边界或验收索引生成入口
- **THEN** 输出写入临时产物目录，原冻结附件不变，根 `docs/` 不出现

#### Scenario: 原证据中存在未验证项
- **WHEN** 生成脚本读取历史场景索引并重生成报告
- **THEN** 保持原条目状态和必要通过证据校验，不因本次文件迁移报告全量通过

### Requirement: 文档治理只约束仓库开发文档

**Identifier:** RDOC-007

本规则 SHALL 约束仓库开发代理自行建立的长期开发文档。用户明确要求的既有 README / 安装说明维护、源码中的注释、测试夹具，以及随产品交付并影响 Agent 行为的 brain.md、SKILL.md、Reference、模板 README 和 SPEC.md SHALL 按实际职责维护，不能仅因 Markdown 扩展名或用户 Work 使用同名目录而删除。

仓库文档整理 SHALL 不向产品 Work 注入新的 OpenSpec 审批阶段，不改写正常业务、Memory、Service Spec、Package Update / Apply 或工具权限边界。临时验证产物 SHALL 不成为长期规范的替代来源。

#### Scenario: 模板内包含 SPEC.md 与 Skill
- **WHEN** 迁移检查遇到脑包或模板随产品交付的 Markdown
- **THEN** 保留其功能归属及对应测试，不按开发笔记清理，也不强制产品内用户采用仓库开发工作流

#### Scenario: 只修改既有安装说明
- **WHEN** 所有者已授权修正 README 或部署手册中的使用命令
- **THEN** 在原文件和已授权范围内完成对应语言修改，不自行拆出一份新的开发报告或新增审批步骤


### Requirement: 提供按范围可执行的开发验证入口

**Identifier:** RDOC-008

仓库 SHALL 保留 npm ci / make build / make test 的无真实秘密基础流程，以及 generate、integration、acceptance、release 和独立 CLI/browser 入口；构建依赖与用户运行依赖分开。Docker 测试 SHALL 使用唯一 installation/fixture 标签并只清理自身资源，确定性 SDK 测试不默认调用付费模型；真实提供商/Windows/SELinux 平台证据与合成夹具分别记录。生成报告默认 dist，超时/跳过不算通过，970 项历史索引不替代实际执行。浏览器、镜像及旧 history4 夹具须明确预备，不靠降低生产限额或删除场景通过。

#### Scenario: 选择专项验证入口
- **WHEN** 维护者选择修改范围内的验证并具备该项所需 Go/Node、浏览器或镜像依赖
- **THEN** 可通过以下已有入口执行，输出归属 dist 或已授权变更，未运行/未通过范围如实记录，不将命令示例当作执行结果

以下命令来自已有验证入口，必须先按对应测试条件预备 Agent/helper/base 与浏览器，不能直接用于真实用户安装。

```sh
make generate          # 固定 proto 生成及 Go HTTP 契约
make build             # harness、浏览器资源和七个 Go 程序
make test              # Go 单元/契约、保留 harness 单元、浏览器类型检查
make test-integration  # 真实 Engine、确定性 Pi SDK、Go Desktop/Console 浏览器
make acceptance        # 集成测试及 970 项场景证据完整性门槛
make release           # 三个宿主入口和镜像清单、校验和、发布包
make test-native-host  # 发布包 + scratch 宿主 + 独立 Engine 的完整运行检查
```

```sh
npx playwright install chromium
npm run test:browser -w @piwork/console-webui
npm run test:browser -w @piwork/desktop-webui
```

```sh
PIWORK_TEST_MODEL_BROWSER=1 \
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance \
go test -mod=readonly -tags=integration ./internal/coreapp \
  -run '^TestNative(MultiProviderLifecycleThinkingAndPackageRoundTrip|ManagedModelEditsInflightReplayAndRestart|ModelURLNormalizationAndErrorRecovery|FlatUnknownDefaultAndDuplicateModelConnections)$' \
  -count=1 -v -timeout=25m
```

```sh
npm ci
mkdir -p dist/go
CGO_ENABLED=0 go build -mod=readonly -o dist/go/piwork-serve ./cmd/piwork-serve
CGO_ENABLED=0 go build -mod=readonly -o dist/go/piwork-cli ./cmd/piwork-cli
node scripts/measure-work-latency.mjs --mode both --samples 20 \
  --output dist/work-latency/after.json
```

```sh
node scripts/measure-work-latency.mjs --core dist/work-latency/baseline/piwork-serve \
  --mode api --samples 20 --baseline --output dist/work-latency/before-api.json
```

```sh
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:chat-release-validation \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:chat-release-validation \
PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:chat-release-validation \
go test -mod=readonly -tags=integration ./internal/coreapp \
  -run '^TestNativeChatImagesAndOfflinePackageRoundTrip$' -count=1 -v -timeout=20m
```

```sh
npm run build -w @piwork/pi-adapter -w @piwork/agentd
PIWORK_TEST_APPLICATION_AWARENESS_EVIDENCE=dist/application-awareness/sdk-history.json \
  node --test apps/agentd/dist/brain-resources.test.js packages/pi-adapter/dist/sdk-smoke.test.js
go test -mod=readonly ./internal/coreassets ./internal/coreapp \
  -run 'Test(Brain|BundledBrain|FastAPIBrain)'
```

```sh
npm run build -w @piwork/pi-adapter -w @piwork/agentd
node --test apps/agentd/dist/brain-resources.test.js packages/pi-adapter/dist/sdk-smoke.test.js
node scripts/check-web-base.mjs dist/web-base/candidate.json web-app
node scripts/check-web-base.mjs dist/web-base/candidate.json workstation
node scripts/check-web-base-core.mjs --main-only
```
