# Spec Delta

## Purpose

保证用户为 Work 选择的 Skills 能按确定版本实际进入 agent 的运行环境，并明确加载成功、内容漂移、无效制品和配置移除后的行为，使 Skill 定制成为可查询和可验证的产品能力。

## ADDED Requirements

### Requirement: Activate only configured immutable Skills

系统 SHALL 按 Work active configuration 加载指定 Skill 的固定制品身份，提供实际加载列表和版本。MUST NOT 隐式导入宿主用户目录、其他 Work 或配置外的 Skills。

#### Scenario: Configured Skill is usable

- **WHEN** Work 启动时配置一个包含可识别指令的有效 Skill
- **THEN** agent 的实际加载上下文包含该指令，查询结果显示对应 Skill 与固定版本

#### Scenario: Skill source changes

- **WHEN** Skill 来源的可变引用变化，但 Work 仍使用旧配置 revision
- **THEN** 系统继续加载该 revision 绑定的制品，或明确报告制品不可获取，不能静默加载新内容

### Requirement: Fail required Skill initialization explicitly

第一版所有配置的 Skills SHALL 作为必要初始化项；无法下载、摘要不匹配、格式无效或名称冲突时 SHALL 阻止 agent ready，并报告 Skill 标识及可操作错误。

#### Scenario: Corrupted Skill artifact

- **WHEN** 实际 Skill 内容不匹配所选固定摘要
- **THEN** Work 初始化失败，不开放对话，也不把错误制品当作已加载

### Requirement: Apply Skill changes at configuration activation

修改或移除 Skill SHALL 遵循 work-configuration 的版本应用规则；当前运行保持旧配置，下一次成功启动后实际加载集合必须与新配置相符。

#### Scenario: Remove a Skill

- **WHEN** 用户从 desired configuration 移除 Skill 并重启 Work
- **THEN** 新 active revision 中不再出现该 Skill，旧进程缓存不能继续注入其指令
