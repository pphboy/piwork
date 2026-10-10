# Design

## Context

`internal/coreassets/piwork-brain/` 已包含 FastAPI + React + TypeScript + Vite 指导、固定 Web base 和模板，无需重写。当前 package version 为 `1.0.0`；`ensureBundledBrain` 在 `piwork_brain_seeded` 存在时直接返回，因此旧 Core catalog 仍可能保留 NiceGUI 内容。

当前检索未发现脑包源码中的 NiceGUI 引用；剩余匹配主要是历史验收记录、禁止使用旧栈的规格以及迁移描述。实施时仍核对依赖锁文件和交付清单，不能把“源码未匹配”当成全部交付产物已清理的证据。

## Goals / Non-Goals

**Goals:** 更新 Core 的内置 piwork-brain package，并让已有安装中仍为原内置来源的包在启动时取得新版。

**Non-Goals:** 独立修订体系、历史身份清单、管理状态 API/UI、新 Operation/升级调度、数据库迁移、Fedora 部署，以及已有 Work 的自动更新/Apply。

## Decisions

### 1. 使用普通 package 版本和现有内置来源

将当前内嵌脑包 package version 提升为 `1.1.0`，作为这次 FastAPI 内容更新的版本。后续内置包内容更新沿普通 package 版本维护，不增加 bundleRevision 或另一套版本记录。

新版交付移除 NiceGUI 的认知、代码、依赖、模板、启动入口及当前使用指导，不增加 NiceGUI 兼容层或回退。清理以当前有效交付为边界：历史设计、OpenSpec 归档和真实验收记录保留原事实；旧包迁移测试输入仅放测试夹具，不进入新脑包。既有 Work 已捕获的旧资源仍按原生命周期保留，不能用此次源码清理删除用户数据。

利用现有 Core artifact 来源识别内置包：旧 seed 创建的 `core:bundled-piwork-brain`，以及此入口后续创建的内置 artifact。普通管理员更新产生的 artifact 不属于该来源，不覆盖；不能仅凭 name 判断。禁用、移除及显式空默认继续保留，不删除 seed 标记来重新播种。相同已发布内置版本重复启动直接沿用；普通显式 Package Update 的完整内容身份校验保持原样。

### 2. 在现有准备入口更新 catalog

调整 `bundled_brain.go`：未 seed 时保留首次安装事务；已 seed 且仍为启用旧内置包时，调用现有 `prepareEmbeddedBrain` 和不可变制品发布路径，完整准备/校验后创建新 artifact 并切换 catalog head。使用版本和内容身份构造新的内置 artifact ID，不能原地改写旧包 bytes。

发布事务比较准备前的 head/generation，保留 enabled、默认集合及所有无关配置。内容未更新不增长 generation；失败或提交前中断保持旧 head，已成功提交后的重启沿用新 head。旧 artifact 按现有引用规则保留。

沿用现有 Core package 互斥与启动准备错误处理，不新增内部 principal、package 来源类型或 Operation。若现有任务恢复位置造成等待循环，只前移已有恢复调用并使用原门禁，不重做恢复/readiness 系统。准备失败通过现有 defaultContext 诊断反映。

### 3. 作用范围止于 Core 包库

成功后新建 Work 捕获当前 Core head；已有 Work 的 desired/active、Agent 镜像、Session、可编辑副本、业务数据和 Memory 均保持原边界。用户需要时使用已有 `--from-core` Update 和显式 Apply，不增加新的采用入口。

| 文件 | 作用 |
| --- | --- |
| `internal/coreassets/piwork-brain/` | 提升普通脑包版本，清理旧栈交付内容，保持 FastAPI 内容一致 |
| `internal/coreapp/bundled_brain.go` | 补充已 seed 内置包更新与原子发布 |
| `internal/coreapp/bundled_brain_test.go` 及对应 integration 测试 | 旧包更新、幂等、失败与选择保护 |
| `internal/coreapp/runtime_preparation.go` | 仅必要的原任务恢复/互斥次序调整 |
| `docs/piwork-brain.md` | 简短说明 Core 包更新与 Work 显式采用的区别 |

## Risks / Trade-offs

- [只改内嵌资源仍不能更新已有 catalog] → 必须覆盖已 seed 的旧内置包分支，而非只提升 manifest version。
- [管理员替换或删除被覆盖] → 只更新原内置来源且启用的包，发布时复核 head/generation，不重新加入默认。
- [包更新被误认为已有 Work 已采用] → 用新建/既有 Work 对照测试，保留原 Update/Apply 边界。
- [准备或发布失败] → 复用原隔离 helper、事务、错误处理及引用保留；不原地改写旧制品。

## Migration Plan

实施后，用户按原方式更新并启动 Core，沿原数据目录自动更新旧内置脑包。管理员定制保持原样；已有 Work 按需显式更新并 Apply。此次不执行实际部署或发布，也不扩展为通用包版本/降级管理能力。
