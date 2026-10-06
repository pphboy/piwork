# Proposal

## Why

目前已有原生 Core/CLI 和 Agent、文件、快照 helper 镜像，但没有能够直接交付的 Core/CLI 镜像与完整安装材料。只给两个 Dockerfile 不能让用户完成初始化、登录、运行 Work、访问 Service/Files、导入导出及恢复：Core 的 Docker socket、宿主路径和运行网络，以及 CLI Desktop 的本机入口和浏览器授权都需要明确配置。

本变更交付两个用户入口镜像及配套发行包。管理员在 Linux 启动 Core 并用环境变量提供首次默认值；Core 自动准备运行依赖。用户在自己的 Linux 或 Windows Docker Desktop 电脑启动 CLI Desktop，通过同机浏览器登录 Core 并完成使用。无 Desktop 的 CLI Docker 用法同时保留并完整文档化，现有原生 CLI 的构建、发布和用法继续保留。

## What Changes

- 发布同一版本的 Core、CLI 镜像和 `piwork-docker` 发行包，包含固定镜像引用的 `release.env`、两份环境变量示例、Core/CLI Compose 配置、Linux 客户端网络覆盖文件和中文操作手册。用户只手动启动 Core、CLI 两个入口；Agent/Service/helper 容器、Work 网络及数据卷由 Core 管理，实际运行容器数可以大于二。
- 修复安装手册中只计算 hash、未比较可信预期值及缺少已有本地包入口的问题：补齐 Linux/Windows 的完整校验、解压和安装步骤，失败时停止安装。补充取得实际下载地址时的可选下载命令；本次修复不执行发行、上传或公共下载站点验收。
- Core 在 Linux 使用 host 网络，通过 Unix Docker socket 调用 Engine API；Core 数据目录在宿主与容器使用相同绝对路径。首次通过环境变量初始化管理员、模型和默认 Agent；已存在的持久配置不被重新创建容器覆盖。
- Core 将缺失运行镜像的拉取、协议校验、默认上下文准备和恢复放入可取消、可重试的后台流程；修复文件/快照 helper 首次失败后不能重试的问题。复用 `/healthz`、`/readyz` 和 `piwork-serve status`，补充交付就绪 profile 和安全组件状态，不新增 `deployment` 等用户命令。
- 统一 Core startup 的关闭和重启规范：Core 正常退出前关闭本安装全部受管 Work 的 Agent/Service，保留记录、数据和运行意图，重启后按原意图恢复；不要求 Work 在 Core 退出期间持续运行。关闭失败沿用非零退出及有界恢复诊断，CLI 退出不停止 Work。
- CLI 显式容器模式允许 Desktop/proxy 监听容器内 `0.0.0.0`，宿主发布地址限定为 `127.0.0.1`；保持本地 Host/Origin、启动票据、浏览器会话及平台认证边界。容器不启动内部浏览器；用户通过同一容器中的 `desktop open --no-open` 获取新链接，启动日志不持久化票据。
- CLI 状态与文件交换分别持久化；说明容器访问公网、宿主服务、远端 Core、自定义 CA，以及 Desktop 与无 Desktop 命令之间的凭证共享和切换规则。
- 中文手册提供完整原生命令的 Docker 调用，包括首次安装、打开/注销 Desktop、Core 配置管理、无 Desktop 业务命令、文件交换、故障检查、重启/升级/回退和保留数据的卸载。直接使用 `docker compose`、`docker run`、`piwork-serve`、`piwork-cli`，不增加 `pcore`、`pcli`、`poperator` 或用户命令封装脚本。
- 发布验收覆盖 Linux Core 冷启动/失败恢复，以及 Linux 和 Windows Docker Desktop 的浏览器登录、Work/Run、Service、Files、快照与重建恢复。无 Desktop CLI Docker 提供能力和文档，但不设本次 Docker 端到端验收用例或发布门禁；原生 CLI 继续执行既有检查。

明确不包含：Windows 上运行 Core、Windows 容器、额外的管理端产品、用户自行编排 Work 容器、任意 Docker 资源清理、新的业务命令或 Work 存储格式、HTTP 非 loopback 模型 Base URL 的放开，以及尚未具备整套运行镜像支持的架构。首发镜像目标为 `linux/amd64`，Windows Desktop 使用 Linux 容器；新增架构必须另有整套镜像和验收证据。

验证后的本次修复仅统一 Core 正常关闭全部 Work 的规范、修正完整安装与校验命令并更新本机候选材料。此前已授权完成的镜像交付和实机使用证据保留；不新增自动发行流程，不执行镜像 push、包上传、Release 创建或托管服务配置，不索取发布地址和凭证，也不把实际对外发行作为本次修复的完成条件。

## Capabilities

### New Capabilities

- `docker-delivery`：两个入口镜像、配套发行材料、网络/socket/存储契约、完整操作文档、版本一致性与交付闭环验收。

### Modified Capabilities

- `core-service-startup`：首次环境变量初始化、后台运行依赖准备与恢复、兼容的默认就绪检查和交付 profile、组件状态及关闭行为。
- `control-cli`：显式容器模式、本机发布端口后的 Desktop/proxy 行为、容器内可信 `desktop open/logout`、持久状态与原生命令兼容性。
- `work-access`：容器端口转发场景的本地入口规则；保留 Desktop/WebDAV 的认证隔离、精确 Host/Origin 和可信控制通道约束。

## Impact

涉及 `internal/coreapp` 的初始化/恢复/helper 状态与探针，`internal/cli` 的监听、本地来源检查和浏览器打开策略，以及新增镜像构建、Compose、发布材料和验收记录。默认管理 API 的严格状态 DTO、Work/Run/Service/Files/快照业务 API 和协议格式继续复用；就绪扩展限于既有探针与控制面状态入口。

安全与持久化重点是 Core 的 Docker socket 权限、宿主/容器路径一致、每安装仅一个 Core、不可变镜像身份、CLI 本机入口及秘密不进入镜像/公开状态/常规日志。Core 重建必须同时保留 Core 数据与其管理的 Work 卷；镜像回退不等于数据回退。

本变更与 `support-cross-platform-cli-and-default-desktop` 的原生 CLI 交付并行：复用已有 Desktop 和 Windows/Linux 客户端能力，不替它完成原生平台验收，也不将 Docker 变成原生 CLI 的运行依赖。
