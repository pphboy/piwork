## MODIFIED Requirements

### Requirement: 产品资源和用户入口在迁移后继续可用

**Identifier:** RDOC-005

共享 Logo 等产品资源 SHALL 随所属实现交付，不依赖开发文档目录；Linux Core 内嵌管理区和 CLI 的原静态资源地址、两个二进制可用性、图片内容及品牌交互 SHALL 保持。构建输入摘要 SHALL 反映实际新路径与内容，不能通过固定旧 hash 或伪造元数据避免变更。

根 README.md/README.zh-CN.md SHALL 作为同步的精简项目介绍，保留顶部语言互链、简短产品说明、演示资源及有效文档导航；安装、首次配置、使用操作和构建命令 SHALL 通过既有官网、部署手册和开发入口承接，不在根 README 中内嵌或折叠重复教程。既有部署材料 SHALL 继续提供完整安装与操作说明，构建与验证入口 SHALL 继续可发现。本地发行材料 SHALL 使用明确清单，不再批量复制根 `docs/`。文档整理 SHALL 不自动对外发布或修改已发布制品身份。

当前 README 展示图等必要用户资源 SHALL 使用不随变更归档而移动的产品路径，历史原件仍按 RDOC-003 保留；当前用户导航、官网同步生成的导航和本地发行材料 SHALL 在相关变更归档前后保持有效。稳定用户入口 SHALL 指向已存在的有效规格或既有使用材料，不要求提前同步主规格或保留失效的 active 路径。

本地发行材料中的仓库文件链接 SHALL 仅在目标存在于实际选用的源码 commit、且该 commit 中目标内容与选用文件一致时转换为固定 commit 外链。新增或修改但尚未提交的必要文档及其本地图片、文档依赖 SHALL 随包保留为有效本地链接；所选材料无法安全随包提供或目标缺失时 SHALL 明确失败，不能生成无效外链、丢弃链接或伪造 commit。已经明确提供的外部 URL SHALL 保留原意；打包 SHALL 不因此复制全部历史附件或要求对外发布。

#### Scenario: 从独立程序读取 Logo
- **WHEN** 用户从无源码、无相邻图片文件的目录启动构建后的 piwork-core 或 piwork-cli
- **THEN** 原登录页、深链接和静态资源入口仍取得相同 Logo，不依赖根 `docs/` 或外部图片网站

#### Scenario: 生成新的本地候选
- **WHEN** Logo 源路径变更后生成本地构建或候选摘要
- **THEN** 使用实际新输入计算身份，既有发行记录保持原值，不自动推送镜像或更新官网

#### Scenario: 用户按 README 操作
- **WHEN** 用户阅读任一语言根 README 并需要安装、使用或构建 Piwork
- **THEN** 通过清晰链接进入对应官网文档、既有部署手册或开发入口，必要操作说明仍可取得，根 README 不重复教程或指向被删除的根文档

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

### Requirement: 提供按范围可执行的开发验证入口

**Identifier:** RDOC-008

仓库 SHALL 保留 npm ci / make build / make test 的无真实秘密基础流程，以及 generate、integration、acceptance、release 和独立 CLI/browser 入口；构建依赖与用户运行依赖分开。Docker 测试 SHALL 使用唯一 installation/fixture 标签并只清理自身资源，确定性 SDK 测试不默认调用付费模型；真实提供商/跨平台浏览器/SELinux 环境证据与合成夹具分别记录。生成报告默认 dist，超时/跳过不算通过，970 项历史索引不替代实际执行。浏览器、镜像及旧 history4 夹具须明确预备，不靠降低生产限额或删除场景通过。

#### Scenario: 选择专项验证入口
- **WHEN** 维护者选择修改范围内的验证并具备该项所需 Go/Node、浏览器或镜像依赖
- **THEN** 可通过以下已有入口执行，输出归属 dist 或已授权变更，未运行/未通过范围如实记录，不将命令示例当作执行结果

以下命令来自已有验证入口，必须先按对应测试条件预备 Agent/helper/base 与浏览器，不能直接用于真实用户安装。

```sh
make generate          # 固定 proto 生成及 Go HTTP 契约
make build             # harness、浏览器资源和两个 Linux 宿主程序
make test              # Go 单元/契约、保留 harness 单元、浏览器类型检查
make test-integration  # 真实 Engine、确定性 Pi SDK、Go Desktop/Core 管理 UI 浏览器
make acceptance        # 集成测试及 970 项场景证据完整性门槛
make release           # 两个 Linux 宿主入口和生产镜像清单、校验和、发布包
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
CGO_ENABLED=0 go build -mod=readonly -o dist/go/piwork-core ./cmd/piwork-core
CGO_ENABLED=0 go build -mod=readonly -o dist/go/piwork-cli ./cmd/piwork-cli
node scripts/measure-work-latency.mjs --mode both --samples 20 \
  --output dist/work-latency/after.json
```

```sh
node scripts/measure-work-latency.mjs --core dist/work-latency/baseline/piwork-core \
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
