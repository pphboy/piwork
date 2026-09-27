# Skill Activation Specification

## Purpose

保证用户为 Work 选择的 Skills 能按确定版本实际进入 agent 的运行环境，并明确加载成功、内容漂移、无效制品和配置移除后的行为，使 Skill 定制成为可查询和可验证的产品能力。

## Requirements

### Requirement: Activate only configured immutable Skills

**Identifier:** SKILL-001

系统 SHALL 只从 Work-owned active context 加载显式选择的独立 Skills 及 enabled package 内 Skills；独立 Skills 按 Core-assigned directory name 选择并完整复制，并提供以该目录名标识的实际加载名称和状态。Runtime Skill identity SHALL remain the configured directory name even when Pi SDK metadata parsed from `SKILL.md` omits or declares a different `name`; such metadata MUST NOT rename the Core Skill. The runtime MUST NOT implicitly import Core-managed current content, operator source paths, host user directories, another Work, pending desired context, or unconfigured Skills. 创建 Work 时继承的默认 Skills SHALL immediately become independent Work-owned copies; only successfully applied active copies may enter conversational agent context. Candidate initialization for create/apply SHALL load only its Operation-captured Work-owned context with conversation routing closed; it is the sole exception to the active-context restriction and MUST NOT load a later pending edit.

The SDK Skill manifest location and supporting-file base directory SHALL resolve inside the exact Work-owned context selected for that runtime, not merely contain the expected Skill name. Newly constructed or restored SDK Sessions SHALL receive the validated resource loader for that context. Loading a Skill means SDK registration and accessible copied resources; it does not promise the model will choose that Skill on every prompt. SDK metadata disabling model invocation and explicit tool-deny policies SHALL remain effective and SHALL be distinguishable from load failure in runtime status.

独立 Skills 与 enabled Pi package 内 Skills SHALL 共存；后者按 PKGA-001 从同一 captured context 加载，以 SDK 资源 name 标识且保留 package 来源。独立 Skill 的 Core name 规则保持不变。独立 Skill selection 为空 SHALL 仅表示没有独立 Skills，不排除显式 enabled 包提供的 Skills；两者都为空才是全部 loaded Skills 为空。包内 Skill 与独立 Skill 或其他包重名 SHALL 按 PKGA-003 阻止 activation，禁止静默覆盖。现有独立 Skill 视图只解释独立选择，package 资源通过 package 视图补充，不把包内 Skill 错报为未配置外部 Skill。

#### Scenario: Configured Skill is usable
- **WHEN** a Work starts with a valid copied Skill containing instructions and supporting files
- **THEN** agent loads the complete Work-owned directory and reports the corresponding Core-assigned directory name as loaded

#### Scenario: SKILL metadata cannot rename a configured Skill
- **WHEN** configured Skill directory `code-review` contains a Pi SDK-loadable `SKILL.md` whose metadata omits `name` or declares `name: reviewer`
- **THEN** agent exposes and reports that Skill as `code-review`, while continuing to use the SDK-parsed instructions and supported runtime metadata

#### Scenario: Core-managed Skill changes
- **WHEN** Core-managed content for a selected name changes but a Work does not reselect and apply it
- **THEN** the Work continues using its copied content across stop, restart, and Core recovery

#### Scenario: Skill source changes
- **WHEN** an operator source directory or Core-managed current artifact changes after a Work copied that Skill
- **THEN** the Work continues loading its owned copy and never silently imports changed source content

#### Scenario: Default Skills are copied once
- **WHEN** a Work is created while defaults select Skills s-a and s-b
- **THEN** the Work stores complete independent copies and later default, enablement, update, or removal changes do not alter them

#### Scenario: Empty Skills remain isolated
- **WHEN** a Work active context contains neither standalone Skills nor Skills from enabled packages
- **THEN** the agent loads no host, Core, global, pending, or other-Work Skills and reports an empty configured Skill list

#### Scenario: Distinguish same-name copies
- **WHEN** Work A, Work B, and Core each contain different bytes for the same Skill name
- **THEN** a Run in A reading the Skill manifest and a referenced supporting file through SDK tools reads only A's active copy, and a Run in B reads only B's active copy

#### Scenario: Reject a loader bound to another directory
- **WHEN** the SDK returns a configured Skill whose manifest or base directory belongs to a global, other-Work, or pending context directory
- **THEN** initialization fails with `SKILL_DIRECTORY_MISMATCH`, no loaded success is reported for that Skill, and no Run is accepted

#### Scenario: Respect invocation controls
- **WHEN** a valid selected Skill disables model invocation or the resolved tool policy disables both read and bash
- **THEN** loading can succeed, runtime status reports `modelVisible: false` with reason `model-invocation-disabled` or `read-tools-disabled` respectively, and no denied tool is enabled to compensate

#### Scenario: Load a Skill from an explicitly enabled package
- **WHEN** 独立 skills=[]，enabled package tools 包含有效 Skill helper
- **THEN** 加载 helper 并记录来源 tools，独立 Skill selection 仍为空，不加载其他全局 Skill

#### Scenario: Reject a duplicate Skill across resource owners
- **WHEN** 独立 Skill helper 与 enabled 包内 helper 同名
- **THEN** 初始化失败为 PI_PACKAGE_RESOURCE_CONFLICT，不能重命名或覆盖以掩盖冲突

### Requirement: Fail required Skill initialization explicitly

**Identifier:** SKILL-002

第一版所有选中并复制的 Skills SHALL 作为必要初始化项；Work-owned copy 缺失、目录名与配置身份不匹配、根 `SKILL.md` 缺失、内容无法被 Pi SDK 解析或加载、内容损坏、重复配置名称或 resource loader 无法读取完整目录时 SHALL 阻止 agent ready，并报告安全的 Core-assigned Skill name 和可操作错误。Core import success MUST NOT be treated as proof that Pi SDK can load `SKILL.md`. `AGENTS.md` 内容缺失、编码无效或超出配置限制时也 SHALL 阻止 pending context 激活，而不得暴露 host or managed-storage paths.

Actual SDK parsing, complete-tree validation, exact configured-name membership, and directory validation SHALL finish before daemon readiness and before a create/start/apply Operation succeeds. Failure SHALL identify the safe Skill name, failing stage, stable code, and remediation in the Operation diagnostic; parsing only configuration descriptors or copying files SHALL NOT count as SDK loading. Empty selections SHALL pass the same readiness contract with an explicit empty loaded list.

#### Scenario: Corrupted Work-owned Skill
- **WHEN** copied Skill content fails validation before agent readiness
- **THEN** Work initialization fails, conversation remains unavailable, and no Core source or another Work copy is substituted

#### Scenario: Corrupted Skill artifact
- **WHEN** a Work-owned Skill is incomplete, corrupted, or inconsistent with its captured internal identity
- **THEN** Work initialization fails, the invalid content is not reported as loaded, and the prior active context is retained and restored according to WCFG-002 when present

#### Scenario: Invalid AGENTS content
- **WHEN** desired AGENTS content is unreadable or over-limit during apply
- **THEN** apply fails with a safe AGENTS configuration error and the previous active context is retained and restored according to WCFG-002

#### Scenario: SDK-invalid content accepted by Core import
- **WHEN** Core imported a regular SKILL.md that the SDK cannot register, and a new Work selects it
- **THEN** the accepted create Operation fails at `skill-load` with `SKILL_LOAD_FAILED` and the Skill name before any Session or Run can be accepted, even if no prompt has been submitted

#### Scenario: Incomplete or unsafe input
- **WHEN** a required manifest or supporting file is absent, unreadable, escaped through a symlink, modified after capture, or a configured name is duplicated
- **THEN** initialization fails at context validation with a safe field/Skill diagnostic and never falls back to another directory

#### Scenario: Pending load is not readiness
- **WHEN** SDK initialization has started but not completed
- **THEN** readiness remains false, loaded success is not fabricated from configured names, and conversation routing stays closed

### Requirement: Apply Skill changes at configuration activation

**Identifier:** SKILL-003

修改、添加或移除 Skill SHALL first build a complete Work-owned desired context while the running Work continues using active copies. Explicit apply SHALL activate exactly the desired context captured by that Operation only after readiness succeeds. A newer desired edit committed during apply SHALL remain pending. `AGENTS.md` changes SHALL follow the same active/desired behavior without public revision identifiers.

#### Scenario: Remove a Skill
- **WHEN** an owner removes a Skill from desired context and successfully applies it
- **THEN** the new active context and new Sessions omit that Skill while Runs already using the prior active context retain their original context identity

#### Scenario: Adopt updated managed content explicitly
- **WHEN** an owner reselects a Skill after its Core-managed content changes and successfully applies the desired context
- **THEN** the Work begins using its new owned copy while prior active copies remain isolated from the Core source

#### Scenario: Apply new AGENTS content
- **WHEN** an owner changes AGENTS content and explicitly applies the desired context
- **THEN** new Sessions use the new active content after readiness succeeds while Runs already using the old active context retain it

#### Scenario: Preserve a later Skill edit
- **WHEN** apply captures desired Skills B and the owner commits desired Skills C before B becomes ready
- **THEN** B may become active, C remains desired, and the Work reports `pendingApply: true`
