## MODIFIED Requirements

### Requirement: Import a complete Skill directory into Core

**Identifier:** SKM-001

Core SHALL 通过受保护 operator API 接受一个 path 字段进行目录导入，不要求或提供旧 skills add 命令。 Core SHALL require an absolute readable directory whose root is not a symbolic link, derive the sole public Skill identifier from the final non-empty directory basename after path normalization, and require that basename to match `[a-z0-9][a-z0-9-]{0,63}` without case conversion or character rewriting. The directory SHALL contain a readable regular `SKILL.md`; Core MUST NOT parse, decode, or derive identity or public metadata from its contents. Core SHALL recursively copy the complete directory into Core-managed durable storage and publish the Skill atomically only after validating the copied tree. The full source path MUST NOT be persisted, disclosed, or remain a runtime dependency. A Skill import SHALL contain at most 2,048 regular files and 32 MiB total content; symbolic links, devices, sockets, FIFOs, path escapes, duplicate directory basenames, and an individual file larger than 8 MiB MUST be rejected.

#### Scenario: Import a valid directory
- **WHEN** an operator adds absolute directory `/opt/piwork-skills/code-review` containing a regular `SKILL.md` and whose tree satisfies all import limits
- **THEN** Core returns enabled Skill `code-review`, preserves the complete copied tree in Core-managed storage, and no longer needs the source directory for later Work creation

#### Scenario: Reject an unsafe or malformed directory
- **WHEN** the source is relative, missing, unreadable, rooted at a symbolic link, contains a symbolic link or unsupported file type, exceeds an import limit, lacks a readable regular `SKILL.md`, or its directory basename is invalid
- **THEN** Core returns a field-specific import error and creates neither a visible Skill nor a partial managed artifact

#### Scenario: Reject a duplicate Skill name
- **WHEN** an operator adds a directory whose basename already identifies an existing Skill
- **THEN** Core returns `SKILL_ALREADY_EXISTS`, keeps the existing managed artifact unchanged, and 指向对应的更新 API

#### Scenario: Ignore SKILL metadata when assigning identity
- **WHEN** an operator adds directory `code-review` whose `SKILL.md` omits `name`, contains malformed frontmatter, or declares a different name
- **THEN** Core imports the bytes without parsing them and assigns public Skill identifier `code-review`; any Pi SDK format failure is reported later when a Work attempts to activate that copied Skill

#### Scenario: Reject non-operator import
- **WHEN** an ordinary user or unauthenticated caller attempts to import a Skill directory
- **THEN** Core rejects the operation without reading the supplied host path

### Requirement: Manage a Skill by its directory name

**Identifier:** SKM-002

Core SHALL 允许 operator 及已启用管理员通过各自受保护管理入口，使用导入时的 basename 查看、列出、更新、启用、禁用和移除 Skill。operator 的路径更新 SHALL 接受 API 的 path 字段，要求规范化来源目录 basename 等于目标 Skill，在完整树验证后原子替换当前 Core 制品。Core MUST NOT 在更新时解析 `SKILL.md`。添加或更新失败 MUST 保留原 catalog 与制品。Skill 仍被默认 Work 选择时 SHALL 拒绝禁用或移除；Core Skill 的更新、禁用或移除 MUST NOT 修改或破坏已有 Work 持有的副本。

管理员内容更新 SHALL 使用 SKM-004 的目录上传，要求所声明根目录名等于目标 Skill，成功后保留原 enabled 状态。内容入口不得读取调用者指定的宿主路径；operator 的原有路径导入继续有效。

#### Scenario: Update current content
- **WHEN** operator 从 basename 同样为 `code-review` 的合法目录更新 `code-review`
- **THEN** 后续 Work 复制新导入的完整制品，每个已有 Work 继续使用原有独立副本

#### Scenario: Reject an update name mismatch
- **WHEN** operator 使用另一个合法 Skill 名称的目录更新 `code-review`
- **THEN** Core 返回 `SKILL_NAME_MISMATCH`，保留现有 `code-review` 制品和状态

#### Scenario: Protect the default selection
- **WHEN** operator 尝试禁用或移除仍被默认 Work 配置选择的 Skill
- **THEN** Core 拒绝操作，要求先将该名称移出默认选择

#### Scenario: Remove an unreferenced managed Skill
- **WHEN** operator 移除不在默认 Work 选择中的启用或禁用 Skill
- **THEN** Core 将其移出发现列表和 Core 管理存储，保留副本的已有 Work 仍可启动和恢复

#### Scenario: 管理员更新禁用 Skill 的上传内容
- **WHEN** 已启用管理员上传与目标同名的合法目录更新禁用 Skill
- **THEN** 新内容原子发布且 Skill 仍为禁用，已有 Work 的副本保持不变
