# Proposal

## Why

Piwork 已能从 npm/Git 获取 Pi 包，但真实发布的包目前仍无法使用：缺少 package helper 的旧 agent 镜像会导致笼统的准备失败；更换镜像后，`npm:pi-subagents@0.71.0` 又因其发布产物依赖 `typebox` 而未通过清单校验。即使允许安装，该包的动态工具也要求 Pi 0.86.1，而 Piwork 目前固定为 0.86.0。操作员需要一条可复现的路径，覆盖在线获取、安装、Work 启用和实际 SDK 工具调用，并能安全地区分镜像与包的不兼容原因。

## What Changes

- 将内置 Pi SDK 系列精确升级到 0.86.1，并从同一源码修订版重新构建生产、验收 agent 镜像及可信 package helper。运行时与已准备产物仍按 SDK 身份精确匹配；现有 Work 在显式更新前继续使用其已捕获的镜像和包字节。
- 允许包私有的 `typebox` 运行时依赖，以兼容已发布的 `pi-subagents@0.71.0`，但四个 Pi 核心 API 包仍须由宿主提供。冻结产物保留原始清单和依赖字节，不暗中重写或省略；发布前根据所选 agent 镜像校验声明的 Pi 宿主 peer 版本范围。
- 在接受新的包 Operation 前识别缺少 package-helper 契约的 agent 镜像或可信 helper 镜像，并返回明确且安全的兼容性错误。清单错误和宿主版本错误使用不同错误码，不泄露子进程输出、凭据或宿主路径。
- 让隔离 Work 容器内由包启动的子代理能找到与该 Work 镜像匹配的 Pi 安装目录和可执行入口。子代理只继承该 Work 的容器资源，不能借包安装访问宿主或 Core。
- 增加固定版本、访问真实 npm registry 的 `npm:pi-subagents@0.71.0` 验收：安装到 Core、复制到 Work、应用配置、确认 SDK 注册、前台调用 `subagent` 工具，并验证后台子代理生命周期。同时保留本地 fixture 和 npm/Git 回归覆盖。验收必须验证实际行为，不能只检查安装 Operation。

这次仅放宽包私有 `typebox` 的兼容规则，并不承诺任意在线包或 Pi 版本均可运行。其他 Pi 核心模块仍由宿主提供。不迁移 Core 数据库或 `.work` 格式；已冻结的包保留原有 SDK 环境记录，跨不兼容镜像使用时明确失败。

## Capabilities

### New Capabilities

- `online-pi-package-compatibility`：在线 npm/Git 包准入、宿主依赖与版本校验、helper 镜像预检、安全诊断和真实在线包验收。

### Modified Capabilities

- `runnable-work-runtime`：向包启动的子代理暴露已捕获镜像中的 Pi 安装，同时保持 Work 隔离和经验证的就绪状态。

## Impact

- SDK 与镜像：`package.json`、`package-lock.json`、`Dockerfile.agentd`、agent 镜像构建与验收，以及 package-helper 镜像契约。
- 包准备与验证：`apps/package-helper/src/`、`apps/core/src/packages/`、`packages/pi-package/src/artifact.ts`、`artifact-sync.ts` 和 Docker 运行时镜像检查。
- 运行时：`apps/agentd/src/package-resources.ts`、Pi SDK 执行器、Work 容器环境与就绪测试；包启动的子代理仍在 Work 容器内运行。
- 外部系统：固定版本的 `pi-subagents@0.71.0` npm registry 压缩包、Docker 和现有确定性模型验收路径。不引入私有 registry 凭据，也不授予对 Core 密钥的访问。
