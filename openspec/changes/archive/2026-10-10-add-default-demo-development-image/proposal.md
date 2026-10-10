# Proposal

## Why

Piwork-brain 目前只有依赖 Python/NiceGUI 离线 wheel fixture 的工作站示例，缺少能供后续 Work 直接复用和派生的标准 Web 开发环境，修改后也缺少保证服务与已打开页面自动采用新内容的交付规则。用户已确定采用 FastAPI + React + TypeScript + Vite 作为默认技术栈，移除 Service 内存限制，并要求镜像预装 sqlite3 命令，使 AI 能直接开发、检查数据和完成无需用户手动刷新的应用交付。

## What Changes

- 新增通用基础镜像 `docker.io/pphboy/piwork-web-base`，源码、锁文件、通用启动工具及双语 README 位于 `deploy/images/web-base/`；镜像可直接承载 workspace 应用，也可由其他项目通过 `FROM` 扩展。变更名沿用用户指定的 `add-default-demo-development-image`，镜像与产品概念不使用 demo 命名。
- 基础环境提供 Python 3.13、Node 24、FastAPI/Uvicorn、React/TypeScript/Vite、sqlite3 命令及标准模板所需的锁定离线依赖，适配 UID/GID `10001:10001`、只读根文件系统及共享 workspace；默认由 FastAPI 单端口提供 API 和构建后的前端，另有显式开发模式。
- 为 Agent 生产/验收镜像同样预装 sqlite3 命令，使 AI 可从现有 bash 工具访问获准 workspace 数据库；不能只给 Service 镜像安装，也不以 Python sqlite3 模块替代 CLI。工具存在仍遵守 Work 权限及业务 Action 契约。
- 将“修改后使内容实际生效”纳入 brain/harness 的交付认知：自动执行必要的检查、构建、Service 更新/重启及新版本验证；开发模式前后端热更新，默认运行模式由应用自身检测已就绪版本并自动更新页面，保留可恢复草稿与路径，无需用户手动刷新。此规则不触发脑包自身自动 Apply，也不强制刷新 Desktop 外壳或第三方页面。
- 将 brain 的默认 Web 开发指导和工作站模板切换到新环境，保留业务状态、Query/Action/Job、outbox、反馈、验证及 Memory 闭环；删除当前模板、依赖和指导中的 NiceGUI 默认认知，历史验收记录保留原事实。
- **BREAKING**：取消所有受管应用 Service 的平台内存限制及 Service 内存准入/预留，不只调大默认值；CPU、服务数、卷数及 Agent/helper 的既有资源政策保持各自语义。旧协议的内存字段保留兼容读取，但不能重新施加 Service 内存限制。
- 新 brain 固定采用已验证的镜像版本及 digest；既有 Work 的脑包仍经 Package Update 和显式 Apply 采用，不静默替换已捕获包或镜像。
- 修复核验发现的两项偏差：模板初始化在写入 SPEC.md、应用文件或注册信息之前拒绝已有目标，部署指导与实际 SDK 验收共用不覆盖入口；前端版本由源码、锁文件及实际基础环境摘要共同派生，仅升级基础环境并重新交付时，已打开页面也能自动采用对应产物。补充拒绝覆盖和仅环境变化的真实回归，不以原有勾选或源码变化场景替代证明。
- 提供独立构建、离线运行、派生使用和真实 SDK/MCP/浏览器验收；实施阶段按用户追加授权发布验证通过的 Web base 及新版 Core/CLI/Agent/file-helper/snapshot-helper 五角色镜像到 DockerHub `pphboy` 命名空间，记录远端 digest 并验证匿名拉取。规划阶段不构建、不推送。

## Capabilities

### New Capabilities

- `web-development-base`: 可直接使用和派生的默认 Web 基础镜像，覆盖工具链/sqlite3、离线准备、启动、应用自动刷新、workspace、版本、维护位置、文档和 DockerHub 交付。

### Modified Capabilities

- `piwork-brain`: 规定 Web 应用默认技术栈、固定基础镜像、修改后自动生效意识及现有 Work 的显式采用边界。
- `agent-service-deployment`: 部署 Skill 默认采用基础镜像和新模板，自动完成修改后的必要更新、刷新及真实版本验证。
- `runnable-work-runtime`: Agent 镜像预装可从现有 SDK bash 调用的 sqlite3 CLI，沿用不可变镜像选择及工具权限。
- `work-services`: 移除 Service 内存限制，明确旧字段兼容、配额、运行、幂等及快照恢复语义。
- `work-configuration`: Work 内存政策不再用于限制或预留 Service 内存，保留 Agent 内存和 CPU/数量准入。
- `desktop-ui-language`: 将当前工作站示例描述改为默认 Web 技术栈，保持现有界面与框架可覆盖性。

## Impact

- 受影响实现：`internal/coreassets/piwork-brain/` 的认知、模板和应用版本刷新客户端、`internal/coreassets/brain.go` 的嵌入内容、`Dockerfile.agentd`、Agent image boundary 检查、`internal/servicedefinition/definition.go`、`internal/coreapp/service_*.go`、`work_config_validate.go`、`internal/corestore/quota.go`、`internal/dockerengine/resources.go`。
- 受影响契约：现行原生 HTTP schema 源 `internal/contracts/schemas.json`、`proto/work-services.proto`、`internal/servicemcp/tools.json` 及 `make generate` 的 Go DTO、Go/TS proto、golden 产物；Service 定义、deployment_context、当前投影及快照校验需一致。
- 构建与验证：新增 `deploy/images/web-base/` 和专用 scripts/Make 入口；替换 `scripts/build-workstation-fixture.mjs` 的 NiceGUI fixture 路径；调整真实工作站及 Service/配额/Docker 回归，补充 Agent/base 两侧 sqlite3 和页面保持打开期间自动采用新版的验收。Agent CLI 增加需要构建并验证新 Agent 镜像；基础镜像独立于五角色发布集合，用户已追加授权五角色的构建与发布；采用现有发行清单/预检/匿名核验流程，更新全部 Quick Start 材料，保留原源码一致性门禁。
- 核验后的修复交付：已有发布和通过记录保留其实际版本与范围；修复 runner/脑包/验收 driver 后，以新固定版本重新构建、验证并发布 Web base 和与最终源码一致的五角色，匿名核验后更新默认引用与正式材料。不得覆盖旧固定 tag，或把旧镜像的通过记录当成修复版证据。
- 文档：明确本仓库 `deploy/images/web-base/` 为长期维护源，脑包保存使用指导/模板/固定引用，`dist/web-base/` 是构建产物，DockerHub 是发布位置；根 README 双语导航、基础镜像双语 README、Docker 安装材料和测试说明同步当前语义及自动更新/sqlite3 用法。遵守既有 Quick Start 检查，新增验证记录只写本次真实结果，不改写历史记录。
- 无宿主 Python/Node 新运行依赖，不向 Work 授予 Docker build、Docker socket、宿主挂载或公开端口。首版发布平台为现行 Core 对应的 `linux/amd64`；其他架构不在本次交付承诺内。
