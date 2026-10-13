# Proposal

## Why

当前 Quick Start 仍要求下载并校验压缩包、准备环境文件和读取 release.env，发布的镜像也缺少完整启动默认值，用户无法直接试用 Core 与 CLI。需要把默认交付入口收敛为已发布镜像、独立启动的 Core 和 CLI，让已有初始化环境变量的用户在终端以最少步骤收到第一条模型回复；同机合并部署作为可选示例提供。

## What Changes

- 使用 `docker build` 构建、`docker push` 发布 Core、CLI、Agent 和 helper 镜像；Core/CLI 从源码在多阶段构建中完成编译，维护者不必在宿主安装 Go、Node、npm 或 Make。生成发行材料也通过 Docker 构建目标完成，不增加独立发布的 Release 工具镜像。
- Core 镜像携带非敏感的发行依赖引用、监听和数据路径默认值，保留自动拉取、协议核验及恢复行为。账号、密码和模型凭据从已有宿主环境传入，镜像和公开材料不保存真实秘密。
- **BREAKING**：CLI Docker 镜像的无参数入口改为等待 Core 完整就绪后进入交互终端；显式业务命令和显式 Desktop 命令继续转发给现有 CLI，原生 CLI 的默认 Desktop 保持。
- 默认入口为 Core、CLI 各一条独立 `docker run` 命令。Core 单独提供 Compose 部署方式；CLI 默认不使用 Compose，只连接已运行且可达的 Core，其启动、退出和重进不改变 Core 生命周期。Linux 同机试用保留最短路径，远端连接按平台手册说明。
- 将包含 Core 与 CLI 两个独立容器的合并 Compose 整理为 `examples/single-host/` 下的“单机部署示例”（Single-host deployment），提供双语说明并由 README、安装手册和官网引用。示例无需 release.env、env_file、include 或第二个 YAML，使用独立数据目录与状态卷，随发行持续更新、检查。
- 从中英文 README 的 Quick Start 移除 “Download and verify the installer” 和 “Configure and start Core” 及其配置步骤，改为独立的 Core、CLI 已发布镜像命令，并链接 Core Compose 和可选单机部署示例；保留折叠的原生 CLI 替代路径，使用规整的多行命令。
- 将完整 Architecture 章节移到 Problem 前面，保持 Piwork Logo 居中及现有尺寸；同步安装材料和 `/home/p/Projects/pphboy.github.io/piwork` 的中英文官网内容。
- 将旧压缩包、环境模板和 Desktop Compose 材料保留为对应旧版本或高级入口，不再作为新 Quick Start 的依赖；更新材料检查和候选清单，防止新旧契约混用。
- 发布入口在首次推送前核对全部角色的实时本地镜像身份、已审阅清单和远端标签；本地标签变化、远端身份冲突或查询无法确认均阻止任何推送。官网同步覆盖 First Work 等全部当前启动引用，连续版本同步与过期引用由检查验证。
- 本地构建、检查及候选清单先完成供用户审阅；只有用户明确判断并授权后才推送。Docker Hub 已登录 pphboy 不代表推送获准；未发布的候选不能被写成已可下载或启动的正式版本。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `docker-delivery`：改变默认交付材料、镜像入口、发行构建方式、独立启动、Core Compose、单机部署示例、终端 Quick Start、文档布局、官网同步及验收约定。
- `core-service-startup`：支持 Core 镜像携带非敏感发行默认配置，在保留显式输入与持久配置优先级的前提下完成环境变量初始化。

## Impact

- 构建与交付：`Dockerfile.core`、`Dockerfile.cli`、现有 Agent/helper Dockerfile、新增发行材料构建目标、`scripts/build-docker-release.mjs` 及相关构建脚本、`config/docker-release.json`、`.dockerignore`。
- Core 与 CLI 容器入口：`internal/coreapp/serve.go`、初始化测试和非敏感发行配置加载；CLI 镜像入口与就绪等待。保留既有业务命令、认证边界、Work 生命周期、数据权限和原生发行链。
- 文档与材料：根目录双语 README、`deploy/docker/`、规划新增的 `examples/single-host/`、`docs/` 安装和验收说明、`scripts/check-docker-quickstart.mjs` 及其测试；官网对应双语页面、下载材料和维护说明。
- 验证：Docker 构建及身份检查、独立 Docker 默认路径、Core Compose 配合独立 CLI 及单机部署示例的真实 Core/模型交互、持久化与关闭恢复、合成环境值检查、官网构建和文档一致性检查。其他进行中的 OpenSpec change 及其未完成平台验收保持独立。
