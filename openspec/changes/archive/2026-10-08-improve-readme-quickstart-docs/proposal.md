# Proposal

## Why

当前 README 的 Docker Quick Start 要求配置两套 Compose 并进入 Desktop，首次使用者不能直接在终端完成 Core 与 CLI 的试用。用户需要配置完成后分别用一条 Docker 命令启动两个入口，再登录、创建 Work 并看到第一条模型回复，同时让示例代码保持规整、可读。

## What Changes

- 将中英文 README 的默认 Quick Start 改为 Linux 同机的纯终端流程：Docker run 启动 Core，一次 Docker run 进入 CLI 交互容器，等待就绪后执行登录、创建和聊天。
- 默认展开 Docker 路径，折叠连接已有 Core 的原生 CLI 路径；两条路径都明确使用业务子命令，Logo 居中，长命令按参数分组续行。
- 新增 Docker run 专用的 `core.run.env.example`，与 Compose 的引用和插值规则分开；保留已发行旧包的可执行入口，缺少新模板时用内嵌的空白示例创建独立配置。
- 保持 Core 同绝对路径数据挂载、Docker socket 与 60 秒关闭预算；CLI 仅持久化用户凭证，不要求 Desktop、端口发布或文件交换卷。
- 将 Compose 作为可选的 Core 部署 Demo，复用同一终端 CLI 入口；已有 Desktop 功能和高级安装材料继续兼容。
- 将新模板纳入安装包与 SHA256 清单，并增加 README、Docker run、Compose Demo 与打包材料的一致性检查和维护约定。
- 为 Linux 默认终端路径和 Core Compose Demo 补充独立的命令验证、状态保持与真实模型回复证据，明确区分候选材料、历史验收和正式发行。

## Capabilities

### New Capabilities

无。复用现有 Docker 交付能力。

### Modified Capabilities

- `docker-delivery`：调整发行模板、平台依赖、客户端存储和操作文档要求；明确 README 的终端默认入口、Compose Demo 的可选地位、材料维护和终端路径验收。

## Impact

- 文档与材料：根目录中英文 README、Docker 安装手册、环境示例、Core Compose Demo 使用说明和 AGENTS.md 维护约定。
- 打包与检查：`scripts/build-docker-release.mjs` 的材料清单，以及新的 Docker Quick Start 一致性检查和必要的合成夹具测试。
- 不改变公共 API、Go/TypeScript 业务实现、CLI 命令、凭证格式、Core 数据格式、既有 Desktop 默认行为和 Work 生命周期；不改动其他进行中的 OpenSpec change。
- 管理员密码和模型 key 仅进入私有 Core 配置文件；CLI 通过 TTY 登录并只挂载用户状态卷。测试使用独立数据目录、安装身份和精确资源清理。
- 当前修复不推送 Docker 镜像、不上传安装包或创建 Release。既有 `pphboy` 登录不构成推送授权；公开下载继续对应实际已发行材料，发布新候选需要用户另行判断。
