# Proposal

## Why

Work 已具备独立上下文、规范化持久目录和附属服务生命周期，但这些内容仍分散在 Core 数据库、Work 私有卷、workspace 卷及 Docker 镜像中，不能作为一个完整单元分享与复用。本变更先定义可移植 Work 的统一组成与恢复契约，再以完整冷快照实现导出、分享和导入为独立 Work，为后续围绕 Work 的扩展建立边界。

产品目标是 **Work 整体搬家、开箱即用**：A 用户指定 Work 导出，B 用户只指定 `.work` 文件导入并显式启动后，原来的代码、配置、service、数据、开发环境和历史都在，pi-agentd 仍能通过目标 Core 的内置 `work-services` MCP 管理 service。用户不需要理解内部 ID、历史格式、逐项选择内容或编写 bindings；目标 Core 自动选取匹配模型并在启动时注入自己的模型凭证。

## What Changes

- 定义版本化 Work Spec、携带全部实际内容的 Work Package，以及具有独立所有者和运行身份的 Work Instance；Spec 是清单与引用关系，不是另一个默认配置模板。
- 完整携带 Work 两个受管持久卷中的代码、Git/隐藏文件、业务数据、开发依赖与用户目录，以及会话/Run 历史、全部保留上下文、active/desired 配置、服务定义与历史、持久资源预留/共享卷引用、固定镜像本体；不按名称、用途或敏感性过滤这些用户内容，不执行依赖重装来替代已有字节。现有 Work 的持久边界不包括容器临时可写层或未受管卷，不能把它们称为已导出内容。
- 采用整体快照恢复，不建立通用历史迁移框架：只读控制历史按现有记录归档，request/result/error 原文保留且不重放；仅为新实例实际运行和查询归属做必要的身份适配。重复导出也必须携带已经导入的历史。
- 导出仅接受已确认停止且无进行中控制操作的非删除 Work，持久锁定其变化直到包落盘；不自动停止、启动或应用配置。运行中内存、连接、tmpfs、宿主平台数据及远程系统数据不属于冷快照。
- 导入校验完整包后创建一个归属接收者的 stopped Work；新建平台 Work/service/context/卷身份并映射受管引用，保留服务 enabled、配置 pendingApply 和会话内容。导入不创建 Work 的 agent/service 容器、运行网络或证书；接收方显式启动时再由既有生命周期创建新的运行代次、网络与证书。导入成功不等于运行就绪。
- Work 自有文件和服务环境变量中的凭证原样携带；Core 登录/operator 凭证、mTLS 私钥及平台托管模型/MCP 密钥不进入包。接收方自动匹配其已有模型配置；内置 `work-services` 不使用 MCP secret 引用，首次启动由目标 Core 注入新的服务控制连接与证书。自定义外部 MCP 的平台 secret 引用不属于本轮开箱即用保证：无法在目标端自动恢复时导入明确失败，不静默发布不可用 Work。包按敏感用户数据处理；完整性校验不是发布者可信证明。
- 增加流式包上传/下载、持久 export/import Operation、幂等与重启恢复、隔离暂存与失败清理；CLI 提供 `work export <workId>` 与 `work import <file>` 的最短路径，输出文件名与导入名称可选，不新增 service create/update 命令。导入前错误必须显示具体安全 code 与处理方向，不再只显示笼统的拒绝消息。
- 第一版限定当前 split-private-workspace 布局、受支持的格式/历史 schema 和相同 Linux CPU 平台。包包含镜像，可在无源镜像仓库访问时恢复本地环境；不承诺外部模型/MCP/业务服务离线可用。
- 非目标：热快照/进程检查点、文件过滤、脱敏、包加密/签名/市场、增量备份、覆盖导入、合并、原地升级、跨架构转换、历史存储格式迁移、Dockerfile 构建或容器 commit。

首要验收是“stop → export → import → start → 继续使用”，并通过实际 pi-agentd MCP 请求证明导入后能够向目标 Core 查询和管理已恢复的 service。完整性、权限和失败清理是系统内部责任，不增加用户的数据分类、历史转换或手工修复步骤；简化实现不能变成只导出配置模板或遗漏原有内容。

## Capabilities

### New Capabilities

- `portable-work`: Work Spec/Package/Instance、完整内容闭包、格式版本、平台依赖和身份映射契约。
- `work-snapshots`: 完整冷快照导出、包校验/传输、导入提交、幂等、失败恢复和资源清理。

### Modified Capabilities

- `work-storage`: 完整导出两个持久卷、服务对共享卷的持久引用、文件元数据与链接；安全导入新存储而不改变原数据。
- `work-configuration`: 包内上下文独立恢复，保持 active/desired/pendingApply，自动解析接收方模型且不污染全局目录。
- `work-lifecycle`: 快照期间的互斥和恢复门禁、导入后保持 stopped、首次启动使用导入的 active 环境。
- `work-services`: 服务历史、tombstone、enabled、镜像与逻辑引用的独立恢复，以及跨安装后内置 MCP 控制能力的真实验收。
- `agent-conversation`: 保留私有历史并映射受管 Work/context 引用，不重放历史副作用。
- `work-access`: 完整包为 owner-only 内容权限，平台权限不随包迁移。
- `control-cli`: 用户级完整快照命令、流式本地文件、单结果输出与恢复指引。

## Impact

- `packages/contracts` 新增可移植描述和快照 API 类型；新 `packages/work-package` 提供版本化编解码、文件清单、哈希和校验，供 Core/CLI 与受信存储 helper 共用。
- `packages/core-store` 增量迁移，保存任务、导入暂存、Work 快照锁、包引用和导入来源；`packages/work-store` 增加离线历史检查与定点映射，不更改用户普通文件。
- `apps/core` 新增快照管理与流式 HTTP 路由，接入 lifecycle、configuration、service、access 和启动恢复；`packages/runtime-docker` 增加受管卷传输、镜像保存/加载和无代码执行的暂存验证。
- `packages/client-sdk`、`apps/cli` 增加传输接口与命令；README、operations 和新的真实 Docker 验收覆盖跨所有者、双副本、离线镜像、历史继续、目标 Core MCP service 操作和失败注入。
- **BREAKING（尚未归档的快照导入接口）**：移除导入请求及 CLI 中用户提供的 bindings；已有 `.work` 包中的依赖描述仍可读取，尤其现有无外部 MCP secret 的 `first.work`，但旧的显式 bindings 请求不能继续作为导入前提。缺少目标模型或含无法自动恢复的自定义外部 MCP secret 时返回可诊断错误。
- 保留既有非快照 API/CLI 行为及服务不允许构建镜像的约束；快照锁持有期间新增可观察的 `WORK_SNAPSHOT_BUSY` 冲突。数据库只做增量迁移，不自动转换旧存储布局；迁移后的数据库不能直接由旧二进制回滚使用。
- 主要风险：大包磁盘占用和传输中断、数据库/文件不一致、跨所有者引用泄露、不可信文件树/镜像/历史输入、含真实密钥和私人对话的分享包、不同平台运行不兼容。需要完整拒绝/回收与安全默认，而不能通过静默漏文件降低风险。
