# Proposal

## Why

当前宿主构建混合了服务端、客户端、独立 Console 和镜像内部 helper，启动及发布链路仍保留 MVP 阶段的管理命令、多平台和 CLI 容器路径。此次将产品入口收敛为两个 Linux 程序，连同废弃代码、构建脚本、示例和文档一起清理，使重复构建和发布得到明确、无残留的产物。

## What Changes

- **BREAKING**：宿主仅交付 `piwork-core`、`piwork-cli`；删除 `piwork-serve`、`piwork` 别名及独立 `piwork-console` 入口。Core 内嵌管理 UI、工作台和引导；MCP/helper 继续在 Agent/helper 镜像内交付。
- **BREAKING**：Core 无子命令一键启动，只提供 `--ui-port`、`--core-port`、`--data-dir` 三项运行配置；保留无副作用的帮助和版本查询。删除 serve、旧管理子命令、旧参数及其离线初始化/命令适配代码，不提供别名、转发或兼容模式。
- 明确保留 operator 身份、凭证生成与校验、受保护 `/control/*` API、管理员 API，以及用户/Work 权限边界。删除命令入口不删除后端能力，不引入凭证或业务数据迁移。
- UI 与 Core API 固定使用 HTTP；默认端口仍为 17891/17871，支持本机浏览器、服务器实际 IP 和外部 Linux CLI 连接。取消 public-origin、TLS 和 RPC 启动参数，内部 Agent mTLS 继续承担原身份校验。
- **BREAKING**：原生构建、发布和受支持运行平台仅为 Linux；沿用当前发行的 linux/amd64 目标，不新增架构。删除 Windows 等非 Linux 专用实现、目标、打包及验收入口；浏览器访问不受此原生平台边界限制。
- **BREAKING**：删除 CLI Docker 镜像、容器模式、Compose 服务、状态卷示例及终端交付脚本；保留 Core Docker 入口与 Agent/helper 镜像，原生 CLI 只连接已有 Core。
- 清理构建输出和 Release 流程：明确白名单、隔离暂存、校验成功后替换本地成品，不混入旧程序、其他平台、验收夹具和历史打包残留；镜像引用和程序身份来自同一次候选输入。
- 同步双语使用材料、Core-only Compose、单机示例、官网生成源、开发约定及现行规格；根 README 只调整平台短说明和有效导航，历史已发布制品身份不改写。

## Capabilities

### New Capabilities

无。复用现有交付、启动和客户端能力。

### Modified Capabilities

- `native-runtime-distribution`：两个宿主程序、镜像内 helper 边界及干净构建/发布。
- `core-service-startup`：Core 三项配置、HTTP 监听、生命周期和 UI 初始化。
- `serve-control-plane`：保留 operator 控制面，移除其 CLI、env-file/离线命令和独立 Console 交付要求。
- `serve-ui`：Core 内嵌管理界面的 HTTP 启动与来源校验。
- `control-cli`：保留原生用户客户端，移除 operator 命令和 CLI 容器模式要求。
- `cli-runtime-portability`：收敛到 Linux 原生支持、状态安全和独立构建验收。
- `docker-delivery`：Core-only 容器交付、四角色镜像候选、网络和材料一致性。
- `user-administration`：初始化及用户管理使用 UI/受保护 API，不再要求旧命令。
- `skill-management`：移除路径导入的 CLI 语法要求，保留 operator API 和管理员上传能力。
- `product-release-info`：Core 程序身份及内嵌管理区的版本展示。
- `ui-language`：使用 Core 预览管理 UI，资源随两个 Linux 程序交付。
- `repository-documentation-governance`：产品资源、构建验证和发行材料对齐新入口。

## Impact

涉及 `cmd/`、`internal/app/`、`internal/coreoperator/`、`internal/consoleapp/`、`internal/webapp/`、CLI 平台适配、构建身份及相关测试；Core/store/identity/Work 的业务契约保持，不能整包删除仍被 UI 或后端使用的代码。

构建及交付涉及 Makefile、package.json、scripts 下原生/客户端/Docker 构建打包与验证、CLI 目标配置、Dockerfile.core、Dockerfile.cli、Docker 候选角色和模板。使用材料涉及 deploy/docker、examples/single-host、README 双语平台说明、官网生成源及 AGENTS.md。

本变更只制作和验证本地候选，不包含 push、GitHub Release、官网部署或改写历史发行记录。不以“无兼容债务”扩大为 Work 数据格式、协议或通用客户端 HTTP(S) 能力重构。
