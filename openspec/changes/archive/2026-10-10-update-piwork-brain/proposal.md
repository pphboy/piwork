# Proposal

## Why

Core 内嵌的 piwork-brain 已使用 FastAPI + React + TypeScript + Vite，但旧安装完成一次 seed 后不会更新 Core 包库中的内置包。此次只把 Core 的 piwork-brain package 更新到当前内容，使用户以后替换并启动 Core 后，新建 Work 能使用新版脑包。

## What Changes

- 更新 Core 内置 piwork-brain 的普通 package 版本，沿用已经完成的 FastAPI 技术栈、Web base 固定引用及模板。
- 移除当前交付内容中 NiceGUI 相关的认知、代码、依赖、模板、运行入口及使用指导，不保留兼容层或回退路径。历史归档和真实验收记录保留原事实；迁移测试所需旧输入仅作为测试夹具。
- 在现有内置包准备入口补充旧内置包更新：完整准备成功后切换 Core catalog head；重复启动不重复发布，失败保留旧包。
- 保留已有默认选择及管理员对包的替换、禁用和移除；已有 Work 继续沿现有 Update / 显式 Apply 采用，不批量修改。
- 仅补充相关测试及必要的脑包说明。不新增版本管理体系、状态 API、Console/Desktop UI、升级任务机制或发布/部署工作。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `piwork-brain`：首次默认选择仍只初始化一次，Core 自身的内置脑包允许在后续启动时更新。
- `pi-package-management`：明确此内置包更新只作用于 Core catalog，沿用原准备、发布及 Work 副本隔离规则。

## Impact

主要涉及 `internal/coreassets/piwork-brain/`、`internal/coreapp/bundled_brain.go` 及对应测试；仅在启动次序或包任务互斥需要时小幅调整 `runtime_preparation.go`。发现仍生效的 NiceGUI 依赖、入口或使用说明时一并清理，必要说明更新到 `docs/piwork-brain.md`。不改公共契约、UI、数据库 schema，不重新设计现有 FastAPI 镜像，不操作 Fedora，不执行对外发布。
