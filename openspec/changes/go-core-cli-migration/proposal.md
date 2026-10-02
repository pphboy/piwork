# Proposal

## Why

piwork 尚未发布，但宿主机上的 Core、CLI、浏览器服务端与平台 helper 已依赖多种解释器及外部命令。此次将平台运行机制统一为 Go 原生程序，使 Core 可作为独立二进制部署，同时保留已完成的产品能力、浏览器 UI 和容器内 Pi SDK 生态。

## What Changes

- 先完整实现 Go Core：启动和 operator 控制面、身份与授权、持久化、Work 生命周期和恢复、配置与 Skills、Pi Packages 编排、Agent RPC、Service 管理和访问、WebDAV、快照与 `.work` 导入导出。
- 再实现 Go 用户 CLI：现有命令、用户凭证、对话流、Operation 观察、本地 service proxy、WebDAV 入口以及离线包检查。
- 将 Desktop 本地服务端和 Console 管理服务端改为 Go。复用现有浏览器 TS/HTML/CSS、产品语言与交互，构建后的资源嵌入相应二进制。
- 将 file-helper、snapshot-helper、Pi package 准备 helper 和内置 Service MCP 服务端全部改为 Go。Core 直接调用 Docker Engine API，使用 Go 生成内部证书、处理 SQLite 和流式数据，正常运行不调用宿主机 Node/npm/Python、Docker CLI、openssl 或 Go 工具链。
- 完整保留 TS pi-agentd 作为 Pi SDK Agent harness，包含其 RPC 服务、Session/Run、历史存储、资源加载、模型/工具执行、MCP 客户端适配及必要 TS 依赖，随 Agent 镜像交付。Go Core 通过现有双向 gRPC 与其协作，不拆分或重写 harness。
- Go Service MCP 仍是 Agent 管理的 stdio 子进程；Go package-helper 仍在隔离准备容器中调度 npm/Git 和 Pi 包安装脚本。Node/npm 只作为镜像内 Pi 生态依赖保留。更新原生程序入口、镜像能力检查和发布清单，拒绝旧 TS helper 的运行回退。
- **BREAKING**：以空数据目录上的 Go 安装为迁移基线，不实现 TS 安装数据升级、跨 TS/Go 版本运行矩阵或旧版本回滚。识别到不支持的数据目录时明确拒绝，不自动清空。保留当前 `.work` V1 业务格式与 Go 安装自身的正常重启恢复能力。
- **BREAKING**：完成验收后删除被替换的 TS Core、CLI、Web 服务端、平台 helper 和仅供它们使用的依赖/入口，停止发布这些旧后端。最终交付 `piwork-serve`、`piwork-cli`、`piwork-console` 原生程序；`piwork` 继续仅作为 operator 入口别名。
- 统一 Core 优雅退出语义：关闭准入、有界停止受管 Work 容器、保留 desired 状态和数据；下次启动恢复 desired-running Work。取消启动规格中的历史 schema 8→9 升级要求，并消除命令名与旧版本验收文字的歧义。
- 为全部现行规格建立 Requirement/Scenario 到任务及验收证据的映射，按 Core、CLI、Web 服务端、最终源码清理逐阶段验收；明确保留的 TS 源码/依赖范围，并核验宿主和镜像内平台程序均为 Go。

### 目标与非目标

目标是交付能够覆盖现有完整产品闭环的 Go 平台，包含异常恢复、权限隔离、数据持久化和真实浏览器访问。TS 的生产保留边界为完整 pi-agentd harness 及其必要依赖、复用的浏览器 UI；其余平台程序全部使用 Go。既有默认端口、用户命令、HTTP/gRPC 业务契约、Service 域名规则、workspace 边界、导入导出和 UI 语言继续作为基线。

本次不扩展 Pi SDK、不重做浏览器 UI、不新增 Service 部署形式、系统 WebDAV 挂载兼容或公网分享，也不新增分布式 Core、远程 Docker 调度、热升级或跨平台产品支持。Node 等构建/测试工具可以保留在开发环境；Docker Engine、系统 CA 和操作系统设施仍是部署依赖。源码移除不授权删除现有开发数据或 Docker 资源。

## Capabilities

### New Capabilities

- `native-runtime-distribution`：原生程序与镜像交付、运行时依赖边界、Docker API 访问、嵌入式浏览器资源、跨语言协作、完整产品验收及旧平台实现移除。

### Modified Capabilities

- `core-service-startup`：统一优雅退出和恢复，改为明确的 Go 存储初始化/版本识别，移除历史 TS schema 升级承诺。
- `work-services`：保留稳定容器名和按完整受管身份恢复，替换以旧 TS 哈希名称容器升级为前提的验收场景。
- `control-cli`：将登录、身份和登出明确归属 `piwork-cli`，保留独立文件能力降级，去掉依赖旧 Core 发行版本的验收前提。

其他现有 capability 的业务要求不变，全部纳入本次实现与回归，不复制为新的能力规格。Go MCP/helper 的交付、镜像兼容检查和禁止 TS 回退由 `native-runtime-distribution` 定义；沿用 MCP、Pi package 和 `.work` 的业务协议及错误语义。

## Impact

- **代码**：新增根 Go module、`cmd/` 与 `internal/`；替换 `apps/core`、`apps/cli` 和 `apps/console` 的服务端、`apps/file-helper`、`apps/snapshot-helper`、`apps/service-mcp`、`apps/package-helper` 及 TS 平台存储/运行时库；浏览器代码独立组织，保留完整 Agent harness TS workspace 及所需依赖。
- **契约**：现有 Core HTTP、Desktop/Console 本地 API、两个 protobuf service、Agent 配置/mTLS、MCP 工具、Pi package 制品、Work history schema 3/storage layout 2、`.work` V1 保持。Go helper 的可执行入口与镜像能力标识更新；不兼容镜像明确失败，不按生产者语言拒绝兼容的 V1 包，也不自动替换包内固定镜像。Core 自身存储使用独立 Go 格式标识，不把 Work 私有数据库一起改版。
- **一致性与安全**：持久幂等、准入与代次隔离、资源配额、并发写入、取消和恢复、浏览器 origin/cookie/CSRF、文件路径与链接、用户/operator/Agent 凭证边界均需验证。
- **交付与文档**：更新根构建/测试命令、镜像、协议生成流程、README、部署/测试/Desktop/Console/文件/快照说明和当前架构图；新增真实 Go 验收记录。历史变更与历史验收记录保留事实，不改写成 Go 实现证明。
