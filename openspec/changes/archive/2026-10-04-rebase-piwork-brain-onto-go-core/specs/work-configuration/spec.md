# Spec Delta

## MODIFIED Requirements

### Requirement: Support current-format context without legacy reconstruction

**Identifier:** WCFG-005

最终 MVP V1 SHALL 初始化全新存储并恢复本版写入的 Work/Session 数据，不转换历史描述、不从可变 Core/默认内容重建缺失快照、不把未绑定历史 Session 分配给当前 context。不支持的格式 SHALL 明确返回 `CONTEXT_FORMAT_UNSUPPORTED`；必需当前 context 缺失 SHALL 返回 `CONTEXT_NOT_FOUND`。系统 MUST NOT 自动删除、重置或改写不支持的用户数据。

本 change SHALL 直接定义包含 package 的最终 MVP V1，不提供旧 Work/context/存储/`.work` 迁移、双版本读取或缺字段补空。最终 context SHALL 显式包含 packages、packageBindings 和 packageContractVersion=1；缺字段按 CONTEXT_FORMAT_UNSUPPORTED 处理，缺少现行格式引用的制品按 CONTEXT_NOT_FOUND 或 PI_PACKAGE_ARTIFACT_MISSING 处理。启动旧非空持久 store SHALL 在迁移前返回 CORE_STORAGE_FORMAT_UNSUPPORTED，原数据不变；新 V1 同版本重启必须可恢复。

最终 MVP 的受管 Work 私有历史 SHALL 只使用 schema 4，新数据直接初始化完整模型/反馈/证据/经验结构；同版本恢复原数据，不提供旧 TS Core、schema 3 或旧候选格式的转换路线。不支持的数据 SHALL 在写入前明确拒绝并保留原内容。

#### Scenario: Fresh install and same-version restart
- **WHEN** 全新安装创建带 Skills 和 Session 的 Work，随后 Core 与 agentd 使用该数据重启
- **THEN** 原 Work 自有 context、Session 历史和用户凭据继续可用，不经过历史转换

#### Scenario: Unsupported historical context
- **WHEN** Work 引用了不支持的对象形态 Skill 选择，或缺少必需的 context 归属元数据
- **THEN** 激活以安全格式错误及修复方向失败，不导入默认值、改写记录或重置数据

#### Scenario: Do not backfill packages into old contexts
- **WHEN** 旧 context 缺少 packages 或 packageContractVersion
- **THEN** 明确拒绝，不推断空集合或用 Core 默认补齐

#### Scenario: Fresh empty package configuration
- **WHEN** 新 V1 Work 没有选择任何 package
- **THEN** 配置、context 和导出清单均显式记录空集合，并支持同版本重启

#### Scenario: 当前私有历史同版本恢复
- **WHEN** Go Core 和 Agent 使用本版创建的 schema 4 数据重启
- **THEN** 当前历史、处理引用和经验完整恢复，不重新执行既有 prompt 或业务 mutation

#### Scenario: 非当前私有历史
- **WHEN** 持久历史缺少当前必需 schema 或候选验收字段
- **THEN** 返回安全格式或数据错误，不升级、补造字段、清空用户数据或自动执行

## ADDED Requirements

### Requirement: 聊天选择和可变经验独立于 Work 配置

**Identifier:** WCFG-BRAIN-001

Session 模型偏好和有效经验 SHALL 使用 Work 私有数据保存，不改变 active/desired、pendingApply 或工具授权。每个已接受 Run SHALL 固定实际模型和采用经验版本；脑包副本编辑及候选准备只影响其各自状态，只有显式 Apply 才改变实际 active 包。新 Work 省略 Packages 时采用已经准备好的 Go 默认脑包，显式空集合保持为空；导入使用包内资源而不复制接收方默认。

#### Scenario: 保存聊天偏好或经验
- **WHEN** 所有者选择下次模型，或 Pi 提交已经验证的经验
- **THEN** 后续执行取得新值，当前 Run 快照保持，Work 配置及 pendingApply 不因这些动作改变

#### Scenario: 编辑脑包副本与普通重启
- **WHEN** 用户只编辑工作区脑包副本，随后停止并启动 Work
- **THEN** 运行仍加载原 active 包，编辑内容必须通过候选及显式 Apply 才采用
