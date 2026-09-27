# Proposal

## Why

Core 目前只能分发完整 Skill 目录，pi-agentd 的隔离 ResourceLoader 明确返回空 extensions、prompts 和 themes，无法管理和实际使用 Pi package。MVP V1 需要让 operator 配置默认包、Work 独立安装和应用包，并把实际包内容及依赖随 `.work` 完整搬迁，形成可观测、可重试和可测试的生命周期。

## What Changes

- 新增 Core Pi package 包库、启用状态和独立默认选择；支持 `install --default` 原子安装并加入默认集合，已有默认引用阻止 disable/remove。
- Core 与 Work 均支持 npm、Git、本地目录、ZIP 四种来源；本地内容由执行 CLI 的机器上传。统一以有效 `package.json.name` 标识包，重复 install 拒绝，显式 update 可更换来源但不能改名。
- 安装在隔离环境解析来源、准备依赖并冻结完整制品。Core 主进程和 CLI 不执行第三方安装脚本或 extension。安装/更新使用持久 Operation、幂等键、等待与安全诊断。
- 完成公开 npm package 的真实 Core 安装链；以固定版本 `pi-web-access@0.31.0` 的成功发布和默认集合可见性作为本轮验收门槛，安全错误分类不能代替安装成功。`--wait` 不因本地固定时限退出，短暂观察故障后继续查询原 Operation；用户主动中断仅停止本地等待。
- 新建 Work 捕获当时默认包的独立副本；已有 Work 的安装、更新、启用、禁用、移除仅修改 desired，经显式 apply 验证后成为 active。`--from-core` 显式采用当前 Core 制品，普通重启不更新包。
- 扩展 pi-agentd 的 SDK 资源加载、extension 事件与工具注册、现有工具策略及 readiness 握手。区分制品已安装、desired、active 和当前实际加载，停止后不能展示过期加载成功。
- 扩展两个 CLI：operator 包库/默认集合/任务查询；用户包发现、创建选择、Work 包管理与任务查询；共用上传、来源解析输入和输出约定。
- `.work` 默认包含全部保留 context 引用的包、依赖、启用状态和 active/desired 差异。导入无需源包仓库或目标 Core 同名包，直接恢复制品，不执行安装、构建或 extension；原子发布 stopped Work。
- **BREAKING**：按用户明确决定，package 完成后的 MVP 才定义完整 V1。直接修改 Work 配置、context、持久数据及 `.work` V1 契约；`.work formatVersion` 保持 1，不提供旧 Work/旧包/旧存储迁移、自动补字段或双版本解码。无包的新 V1 显式记录空集合。
- 提供同一示例包的四种来源测试，覆盖真实 Pi SDK 工具调用、默认继承、版本隔离、失败恢复、并发、Core 重启和完整搬迁。

非目标：包自动升级或向已有 Work 推送默认变化；安装命令隐式 apply；独立资源级开关；交互式 TUI 扩展界面；新增私有 npm/Git 凭证管理；包发布市场；修改用户代码；历史 Work 兼容。现有独立 Skill 管理保留，包内资源随整个 package 管理。

## Capabilities

### New Capabilities

- `pi-package-management`: 四种来源、统一身份、隔离制品准备、Core 包库、Work desired 管理、上传、Operation、并发和回收。
- `pi-package-activation`: Work-owned package 的 SDK 资源加载、headless extension 生命周期、工具策略、冲突检查和实际运行状态。

### Modified Capabilities

- `control-cli`: 明确两个 CLI 的 package 命令、来源参数、等待/输出与 `.work` inspect 扩展。
- `serve-control-plane`: operator 包库、默认 package 选择和仅限 Core 任务的查询授权。
- `work-configuration`: 必需 packages 字段、独立 context 副本、desired/active、创建选择及无兼容的最终 V1。
- `skill-activation`: 明确独立 Skills 与显式选择 package 的 Skills 共存、来源隔离和冲突处理。
- `runnable-work-runtime`: 制品挂载、SDK Session 绑定、包/工具 readiness 验证及无需逐包重建 agent 镜像。
- `work-lifecycle`: package Operation 纳入 Work 的并发、停止/删除和冷快照门禁。
- `portable-work`: 最终 V1 的 package 制品闭包、跨 context 版本和接收端独立恢复。
- `work-snapshots`: package 完整捕获、静态校验、无执行导入、inspect 和失败清理。

## Impact

- 控制/API：`apps/core/src/application/core-application.ts`、新增 package 服务和 operator Operation 路由；扩展 `/control/default-work`、Work create/configuration、readiness DTO。新增 `/control/packages`、`/api/v1/packages`、Work-scoped packages 和分作用域的二进制上传；不混用现有整个 Work 的 `/api/v1/work-packages`。
- 客户端：`apps/core/src/cli.ts`、`apps/cli/src/main.ts` 及新命令模块、`packages/client-sdk`；本地目录/ZIP 共用有界上传与校验。
- 数据：`packages/contracts`、`packages/core-store`、Core paths、WorkContextStore、不可变 package 制品/上传/任务记录；新 V1 空集合和当前版本重启恢复，不编写旧数据迁移。
- 运行：`packages/pi-adapter`、`apps/agentd`、agent proto、`packages/runtime-docker`、`Dockerfile.agentd`。新增隔离安装 helper，与所选 agent 环境配合准备依赖；复用已有 Pi SDK 0.86.0，不将主依赖升级夹带进本变更。
- 搬迁：`packages/work-package`、`apps/core/src/work-snapshots`、`apps/snapshot-helper`、snapshot runtime adapter、`.work` fixtures 和 `docs/work-package-format.md`。
- 外部依赖：npm registry、Git 服务、Docker；增加经过固定版本锁定的 ZIP 读写依赖。包代码及依赖安装脚本具有 Work 环境内代码执行能力，隔离安装 helper 不携带 Core/operator/model 凭证、Docker socket 或其他 Work 数据。
- 主要风险：安装阶段执行与输出边界、依赖目录/链接的可移植性、SDK 自发现越界、扩展工具冲突与策略绕过、异步完成覆盖后续配置、制品误回收和 `.work` 漏项。design/specs/tasks 对这些提供确定行为与验收场景。

参考：上游 [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) 的包结构与资源发现；本项目实际集成契约以锁定的 SDK 0.86.0 和本变更 specs 为准。
