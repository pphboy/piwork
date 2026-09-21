# Spec Delta

## MODIFIED Requirements

### Requirement: Activate only configured immutable Skills

**Identifier:** SKILL-001

系统 SHALL 按 Work active configuration 加载指定 Skill 的固定制品身份，提供实际加载列表和版本。MUST NOT 隐式导入宿主用户目录、其他 Work 或配置外的 Skills。Work 创建时复制的默认 Skills SHALL 成为该 Work 独立 desired/active 配置的一部分；只有 active revision 中的 Skills 才可进入 agent context。

#### Scenario: Configured Skill is usable
- **WHEN** Work 启动时配置一个包含可识别指令的有效 Skill
- **THEN** agent 的实际加载上下文包含该指令，查询结果显示对应 Skill 与固定版本

#### Scenario: Skill source changes
- **WHEN** Skill 来源的可变引用变化，但 Work 仍使用旧配置 revision
- **THEN** 系统继续加载该 revision 绑定的制品，或明确报告制品不可获取，不能静默加载新内容

#### Scenario: Default Skills are copied once
- **WHEN** Work is created while the global default selects Skills s-a and s-b
- **THEN** the Work stores those selections independently and later default changes do not alter its active or desired Skill set

#### Scenario: Empty Skills remain isolated
- **WHEN** a Work active revision contains no Skills
- **THEN** the agent loads no host or global Skills and reports an empty configured Skill list

### Requirement: Fail required Skill initialization explicitly

**Identifier:** SKILL-002

第一版所有配置的 Skills SHALL 作为必要初始化项；无法下载、摘要不匹配、格式无效或名称冲突时 SHALL 阻止 agent ready，并报告 Skill 标识及可操作错误。`AGENTS.md` 内容缺失、编码无效或超出配置限制时也 SHALL 阻止对应 revision 激活。

#### Scenario: Corrupted Skill artifact
- **WHEN** 实际 Skill 内容不匹配所选固定摘要
- **THEN** Work 初始化失败，不开放对话，也不把错误制品当作已加载

#### Scenario: Invalid AGENTS content
- **WHEN** the active configuration contains unreadable or over-limit AGENTS content
- **THEN** Work readiness fails with a safe AGENTS configuration error and the previous active revision remains usable

### Requirement: Apply Skill changes at configuration activation

**Identifier:** SKILL-003

修改或移除 Skill SHALL 遵循 work-configuration 的版本应用规则；当前运行保持旧配置，下一次成功启动后实际加载集合必须与新配置相符。`AGENTS.md` 的修改 SHALL 遵循相同规则。

#### Scenario: Remove a Skill
- **WHEN** 用户从 desired configuration 移除 Skill 并重启 Work
- **THEN** 新 active revision 中不再出现该 Skill，旧进程缓存不能继续注入其指令

#### Scenario: Apply new AGENTS content
- **WHEN** an owner changes AGENTS content and explicitly applies the new desired revision
- **THEN** new Sessions use the new content after successful activation, while Runs already using the old active revision keep their original context
