# 测试与验收

本页描述 Go 平台和保留的 Pi Agent harness。源码构建和单元测试需要 Go 1.25.5、Node 24/npm、Git、Make 与 Bash；Docker 集成测试另外需要 Docker Engine，浏览器测试需要 Playwright Chromium，Console 浏览器夹具还需要 OpenSSL。发布包的宿主程序运行时不需要 Node、npm、Python、Go、Docker CLI 或 OpenSSL 可执行文件。Agent 镜像内仍包含 Node 和 Pi SDK。

## 统一入口

```sh
make generate          # 固定 proto 生成及 Go HTTP 契约
make build             # harness、浏览器资源和七个 Go 程序
make test              # Go 单元/契约、保留 harness 单元、浏览器类型检查
make test-integration  # 真实 Engine、确定性 Pi SDK、Go Desktop/Console 浏览器
make acceptance        # 集成测试及 970 项场景证据完整性门槛
make release           # 三个宿主入口和镜像清单、校验和、发布包
make test-native-host  # 发布包 + scratch 宿主 + 独立 Engine 的完整运行检查
```

`make acceptance` 在任一场景没有测试、命令和结果证据时失败。阶段及逐项结果见 [Go 迁移验收记录](go-migration-acceptance.md) 和 [场景索引](go-migration-scenarios.json)。单独执行 `go test -mod=readonly ./...` 可验证 Go 单元测试，不启动 Docker。
源码边界由 `node scripts/check-native-boundary.mjs` 核对，生产/验收镜像的入口、保留 TS 模块、生产依赖与四个镜像内 Go 程序由 `node scripts/check-native-image-boundary.mjs` 核对；二者已接入 `make acceptance`。

集成测试只使用固定的确定性模型和真实 Pi SDK，不会默认调用付费模型。需要真实提供商时，另行显式运行专用 smoke；它不替代确定性验收。

Go Engine 完整批次的单包时间上限为 120 分钟，包含真实故障、包准备和全闭包快照往返。若批次失败或超时，记录已完成、失败和未执行清单，以当前代码逐项复验；不能把超时命令记录为 PASS，也不能用历史场景索引替代实际执行。

## 干净 clone

在 Node 24、Go 1.25.5 下执行 `npm ci && make build && make test`，不需要真实模型配置或 Docker。`make test` 同时发现 `scripts/*.test.mjs`，覆盖客户端构建、平台检查和验收门槛。

浏览器依赖在仓库根目录安装：

```sh
npx playwright install chromium
npm run test:browser -w @piwork/console-webui
npm run test:browser -w @piwork/desktop-webui
```

以上浏览器夹具使用已构建的 Go 程序及合成 HTTP 数据。Console 的真实 Core/Package 测试通过 `npm run test:real-core -w @piwork/console-webui` 单独执行，需要可达的 Docker Engine 和 `make native-agent-images` 构建的 acceptance Agent；测试在保存 runtime 后等待后台准备就绪，各场景独立初始化。这个入口仍接入 `make test-integration`，不通过排除真实测试把集成失败记为通过。完整 Work/Run 流程仍按下节执行 Docker 集成验收。环境变量、数据和输出忽略规则及本次检查证据见 [开源发布检查](open-source-readiness.md)。

## Docker 隔离

`internal/testsupport` 为每次测试生成独立的 `piwork-test-<uuid>` 安装身份。测试创建的 Docker container/network/volume 均带 `piwork.installation_id`，发现、inspect 和清理只针对该身份。不得使用全局 prune、模糊名称过滤或跨安装清理。需要独立 Engine 时设置 `PIWORK_TEST_DOCKER_HOST=unix:///path/to/docker.sock`；测试宿主可以没有 Docker CLI，但构建镜像的开发入口需要它。

真实 Core 的 package、file 和 snapshot 测试需要事先构建 Agent 及 helper 镜像。`make test-integration` 完成这些构建；直接运行 Go integration test 时，应按 [Go 迁移验收记录](go-migration-acceptance.md) 给出固定镜像环境变量。Core/CLI 子进程测试在 PATH 中移除解释器和 Docker CLI；Pi Agent 容器内仍使用它自己的 Node 运行时。

## 多供应商模型专项

平铺模型 CRUD、旧 Provider 数据映射、消息 Test 和固定执行绑定由 `internal/coreapp/model_*_test.go` 验证；真实 SDK 的未知 ID 普通请求、Responses effort、Messages budget/adaptive 和子代理授权材料由 `apps/agentd/src/model-providers.test.ts` 验证。Console 浏览器测试覆盖 advisory Test、Key 的内存草稿、未知写入读回和窄屏生命周期；Desktop 测试覆盖默认失效后选择其他模型、Thinking 和新聊天契约的资源命令。

构建 Agent、file/snapshot helper 和两个宿主界面后，可以执行完整专项：

```sh
PIWORK_TEST_MODEL_BROWSER=1 \
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance \
go test -mod=readonly -tags=integration ./internal/coreapp \
  -run '^TestNative(MultiProviderLifecycleThinkingAndPackageRoundTrip|ManagedModelEditsInflightReplayAndRestart|ModelURLNormalizationAndErrorRecovery|FlatUnknownDefaultAndDuplicateModelConnections)$' \
  -count=1 -v -timeout=25m
```

专项使用独立安装、本地协议服务器、合成 Key 和临时测试 CA。Core 与容器内 SDK 保持 TLS 验证；测试临时派生镜像只信任该 CA，完成后精确清理本次资源。`PIWORK_TEST_MODEL_BROWSER=1` 还通过真实 Console/CLI Desktop 界面添加、Test 和切换模型，并将截图写到被忽略的 `dist/model-browser-evidence/`。快照 helper 必须与新模型字段校验同时更新；旧 helper 不能被记作完整多供应商包往返通过。

SELinux 快照回归见 [专用验收流程](selinux-snapshot-acceptance.md)。`PIWORK_TEST_SELINUX=1` 启用真实标签测试，并要求宿主为 Enforcing；未设置时该平台用例明确跳过。常规树库测试仍检查用户属性、ACL/capability 名称、异常枚举和失败后的内容保留。独立 Docker helper 验收脚本只创建带精确安装标签的测试卷和容器，按该身份清理，不操作现有 Work。

浏览器测试源位于 `apps/desktop-webui/test` 与 `apps/console-webui/test`，测试进程只启动 Go CLI、Go Console 和 Go Core。Chrome/Edge 人工界面 Review 与无解释器宿主的发布包验收单列在迁移阶段 gate 中；自动 Chromium 通过不能替代它们。
Desktop 的真实 Go Core/CLI 联合脚本已接入 `make test-integration`，默认使用 Playwright Chromium。Chrome 或 Edge 的正式界面验收可分别使用 `PIWORK_TEST_BROWSER_BIN=/path/to/browser PIWORK_TEST_SCREENSHOT_DIR=/path/to/evidence npm run test:real-core -w @piwork/desktop-webui` 执行；脚本为每次测试创建独立 Core 数据目录和受管 Work，并在结束后清理。该脚本依赖预先构建的 Agent 与原生 file/snapshot helper 镜像。

完整包包含固定镜像，大包验收应将 `TMPDIR` 指向空间充足的磁盘目录；内存盘 `/tmp` 的可用空间不足时，Desktop 按规定保留 1 GiB 余量并拒绝暂存，不能降低生产空间限制来通过测试。

`make test-native-host` 使用开发机 Docker CLI/Node/OpenSSL 准备测试夹具；这些工具不在被测宿主内。测试创建带唯一 fixture label 的临时 `docker:27-dind` 特权容器作为独立 Engine，并把发布包三个程序放在 scratch 容器中，共享该 Engine 的 Unix socket 和同机数据路径。被测 Core/CLI/Console 的根文件系统没有解释器、shell、Go、Docker CLI 或 OpenSSL，PATH 为 `/nonexistent`。脚本验证真实 SDK→Go MCP 部署、Service proxy、WebDAV、嵌入 Desktop/Console、Export/Inspect/Import/Start 和 workspace 数据，再核对实际进程及缺失工具。准备 fixture 时需要 `docker:27-dind` 和 `python:3.13-slim`；后者仅运行用户测试 Service。结束只清理该 fixture 的 container、volume、scratch image，不清理其他安装。此 gate 已接入 `make acceptance`。


当前 brain 回归使用 `internal/coreapp/brain_workstation_integration_test.go`、`brain_candidates_integration_test.go`、`run_models_integration_test.go` 和 `service_interactions_integration_test.go`；所有平台控制由 Go Core 与原生 helper 处理，确定性模型只在 acceptance Agent 镜像中注册。工作站 fixture 使用与交付相同的 FastAPI + React + TypeScript + Vite Web base。Agent 和 base 都预装 sqlite3 CLI，真实 SDK bash 与 Service 分别验证；这些是容器工具，不是宿主依赖，也不限制用户选择技术栈。`node scripts/check-web-base.mjs` 在无外网的独立网络验证离线准备、只读根、业务/版本及持久化，真实 Core/CLI/浏览器回归另行验证用户无需手动刷新。

Web base 的额外入口为 `node scripts/check-web-base.mjs dist/web-base/candidate.json web-app`（通用模板）和 `node scripts/check-web-base-core.mjs`（真实 SDK/MCP/Core/CLI/浏览器、热更新、失败恢复、派生镜像及内存政策）。生成镜像后执行，使用已构建的 acceptance Agent/helper 与 Go 程序；输出在被忽略的 `dist/web-base/`，资源只按本次唯一标签/installation ID 清理。

旧历史迁移回归另外需要预备的真实 schema-4 Agent 镜像 `piwork-memory-history4:acceptance`。`make native-history4-web-base-fixture` 在它之上仅适配确定性部署 driver 和 Go Service MCP，不替换 schema-4 harness/store；设置 `PIWORK_TEST_NATIVE_HISTORY4_IMAGE=piwork-memory-history4-web-base:acceptance` 执行升级/进程恢复回归。该依赖属于开发验收，不是用户运行依赖，也不通过更改旧数据库伪造迁移。

`node scripts/check-native-boundary.mjs` 扫描当前 apps/packages、scripts、构建与运行配置、锁文件及当前 docs。仅规则文件自身、注入测试和明确列出的历史验收记录排除；不会排除整个 scripts。`node --test scripts/check-native-boundary.test.mjs` 注入旧启动脚本、动态 import、运行配置、lock 和当前文档，验证 gate 逐一拒绝，合法 Agent/browser 引用仍通过。镜像和 release 有各自独立的内容 gate。

## 独立 Memory 验收

本变更沿用现有测试体系。存储/联合事务/版本与失效测试位于 `packages/work-store/src/memory.test.ts`，TS 冷历史验证在 `snapshot*.test.ts`；原生 schema 4/5 与 Memory 图、重建测试在 `internal/workhistory/memory_test.go`。`npm run test:unit -w @piwork/work-store` 和 `go test -mod=readonly ./internal/workhistory` 不依赖 Docker 或真实模型凭据。

Memory 子进程测试在真实磁盘 SQLite 的 COMMIT 前/后 SIGKILL writer，再原路径恢复，检查请求与 Memory 一致且不重放 Run。这是进程中断验收，不是物理断电实验。完整迁移/回退、固定旧镜像、真实 SDK/Service 与两份 Export/Import 按当前 change 的 T01–T06 任务分别执行；未执行的项目不能用这些单测标为通过。Memory 不新增通用 Eval 平台。
