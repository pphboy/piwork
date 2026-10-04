# Spec Delta

## ADDED Requirements

### Requirement: 从当前 Work 准备同名脑包候选

**Identifier:** PKG-BRAIN-001

已启用脑包的 Pi SHALL 能提交当前 Work 内 `.pi/packages/piwork-brain/` 的候选更新，返回持久 package Operation；该入口仅接受本 Work、同名脑包及基于实际 active 的候选，不能将任意宿主路径、另一 Work 或 Core catalog 作为写入目标。正常客户端本地目录/ZIP 上传仍使用原协议。

系统 SHALL 在准备前完整捕获候选内容并校验大小、路径、链接、manifest 和期望内容；准备与依赖执行 SHALL 沿用既有隔离 helper、环境、时限和资源约束。捕获后源文件继续变化不得改变已接受候选。准备成功 SHALL 只将候选合并到最新 desired，保留无关编辑，遵循现有包准备和 Work 生命周期门禁；不得隐式 Apply、启动 Work 或取消 Run。

候选所依据的同名 desired 或 active 包被用户替换、移除或禁用时 SHALL 报候选冲突，不覆盖用户选择。稳定 Agent 幂等身份与键 SHALL 在进程替换后保持重放结果，失败新尝试使用新键，且同键异候选内容冲突。

新的 live 候选提交 SHALL 包含单个具体能力验收项，固定目标脑包工具、输入和必要 checks，并与原目标、提交键及捕获内容一起持久保存。验收项属于幂等内容；新候选缺失或非法验收项 SHALL 在准备前拒绝。同键改变验收项不得覆盖原回执，准备后不得另选容易通过的无关检查替代原目标。

#### Scenario: Pi 准备可应用的候选
- **WHEN** Pi 修改 Work 内脑包副本并提交同名候选
- **THEN** 既有准备流程形成完整 Work 自有制品及 desired 更新，原 active 继续使用，原 Operation 可查询

#### Scenario: 源文件在捕获后变化
- **WHEN** 候选已经捕获后 Pi 或用户继续修改工作区副本
- **THEN** 原 Operation 使用已捕获内容，后续内容只有新的候选提交才采用

#### Scenario: 用户替换候选基础
- **WHEN** 准备期间同名包的 desired/active 被替换、移除或禁用
- **THEN** 原候选明确冲突且不发布覆盖，无关 desired 编辑保持有效

#### Scenario: 越界来源与 Stop 竞争
- **WHEN** 请求指定另一 Work/宿主目录，或 Stop/Delete 已关闭提交门禁
- **THEN** 来源越界在捕获前拒绝，迟到准备结果不能写回 desired、Apply 或复活 Work

#### Scenario: 改变验收项后重用提交键
- **WHEN** 源内容不变但同一提交键的工具、输入或必要 checks 被改变
- **THEN** 返回幂等冲突，原候选、验收项及回执保持，不开启第二次准备

#### Scenario: 新候选未提供合法验收项
- **WHEN** 新的 live 候选缺少具体能力验收项或指定越界工具、超限输入、空检查集合
- **THEN** 准备前明确拒绝，不产生假的已准备或等待 Apply 状态

### Requirement: 候选状态与采用结果通过现有包视图展示

**Identifier:** PKG-BRAIN-002

Work 包视图和相关 Operation SHALL 显示候选属于当前 Work 文件来源、准备进度、desired/active/runtime loaded 区别，以及关联原请求的等待 Apply、失败或已采用结果；不得公开宿主路径、凭据或内部制品 digest。基础 package artifact 的 sourceKind 可保留 local，候选来源通过独立安全元数据说明。

用户 SHALL 通过既有显式 Apply 操作采用候选。安装成功与 loaded、loaded 与完成原目标的能力验证 SHALL 分开；取消 Pi 请求不删除已经提交的 desired，Apply 失败保留 prior active 和原诊断。只有匹配原验收项的实际 SDK 行为证明通过，原目标才能宣称能力已验证；行为不通过不改写实际 loaded。若候选内容与当前已验证 active 相同 SHALL 确认无需内容变更，并执行同一具体验收项后才完成，不制造永久等待 Apply。

候选 SHALL 按同一 Work、候选发布后受理且捕获了同一启用脑包制品的 Apply 关联最近真实 Operation，而非仅匹配发布时 context ID。无关配置保存改变 context ID 时，加载失败及 prior active 恢复仍 SHALL 关联原请求并明确失败或需处理；不得继续伪装等待首次 Apply。发布前、另一 Work 或实际脑包内容不同的 Apply SHALL NOT 被认领，名称/version 相同不等于内容相同。

公开候选 SHALL 提供受理时 active/desired 选择及与当前状态的匹配摘要、固定验证目标与能力、安全输入摘要、必要 checks，以及匹配 Apply 的原 ID/状态。无匹配 Apply 与观测不可用 SHALL 分开；来源与受理时事实不得由当前值或模型文字补造，安全边界保持。

#### Scenario: 看见等待应用的候选
- **WHEN** 候选准备成功但尚未 Apply
- **THEN** Settings 显示 Saved/Not applied、Work 文件来源及 Apply 入口，当前 loaded 仍为旧版

#### Scenario: 加载失败后恢复
- **WHEN** 用户 Apply 一个无法加载的脑包候选
- **THEN** 原 Operation 显示失败及真实回退状态，旧 active 保留，原请求明确失败或需处理

#### Scenario: 相同内容候选
- **WHEN** 候选完整内容等于当前已验证 active
- **THEN** 原请求确认无需变更，实际 SDK 执行原验收项并通过必要 checks 后完成，不等待不存在的 pendingApply或跳过行为证明

#### Scenario: 加载通过而目标行为未通过
- **WHEN** Apply 加载候选成功但相关行为 checks 未通过
- **THEN** Packages 如实显示当前 loaded，原目标及证据显示需处理而非 capability verified，不隐式回滚、Apply 或删除 desired

#### Scenario: 无关保存后的候选加载失败
- **WHEN** 候选发布后用户保存无关 AGENTS/Skills，随后包含同一候选的另一个 context 被 Apply 且加载失败
- **THEN** 原候选查询返回该失败 Apply 的原 ID/状态，原请求明确失败或需处理；旧 active、无关 desired 编辑和原数据保持，不重新 prepare 或 Apply

#### Scenario: 不认领其他 Apply 结果
- **WHEN** 存在发布前、其他 Work 或同名/version 但不同脑包内容的 Apply
- **THEN** 这些 Operation 不成为本候选的采用或失败依据；匹配结果只能来自发布后本 Work 中真实受理的相同启用脑包制品

#### Scenario: 安全候选详情可查询
- **WHEN** 所有者读取一个已持久受理的候选
- **THEN** 可取得受理基线、固定目标/能力/安全输入摘要/必要 checks、准备结果及对应原 Apply，不能取得凭据、宿主路径、context identity 或制品 digest
