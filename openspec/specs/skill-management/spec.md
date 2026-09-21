# Skill Management Specification

## Purpose

定义 Core 如何从 operator 提供的目录安全导入和管理完整 Skill 制品，并以导入目录 basename 作为稳定公开身份供默认配置与 Work 选择。

## Requirements

### Requirement: Import a complete Skill directory into Core

**Identifier:** SKM-001

`piwork-serve skills add` SHALL accept exactly one `--path <directory>` from an authenticated operator. Core SHALL require an absolute readable directory whose root is not a symbolic link, derive the sole public Skill identifier from the final non-empty directory basename after path normalization, and require that basename to match `[a-z0-9][a-z0-9-]{0,63}` without case conversion or character rewriting. The directory SHALL contain a readable regular `SKILL.md`; Core MUST NOT parse, decode, or derive identity or public metadata from its contents. Core SHALL recursively copy the complete directory into Core-managed durable storage and publish the Skill atomically only after validating the copied tree. The full source path MUST NOT be persisted, disclosed, or remain a runtime dependency. A Skill import SHALL contain at most 2,048 regular files and 32 MiB total content; symbolic links, devices, sockets, FIFOs, path escapes, duplicate directory basenames, and an individual file larger than 8 MiB MUST be rejected.

#### Scenario: Import a valid directory
- **WHEN** an operator adds absolute directory `/opt/piwork-skills/code-review` containing a regular `SKILL.md` and whose tree satisfies all import limits
- **THEN** Core returns enabled Skill `code-review`, preserves the complete copied tree in Core-managed storage, and no longer needs the source directory for later Work creation

#### Scenario: Reject an unsafe or malformed directory
- **WHEN** the source is relative, missing, unreadable, rooted at a symbolic link, contains a symbolic link or unsupported file type, exceeds an import limit, lacks a readable regular `SKILL.md`, or its directory basename is invalid
- **THEN** Core returns a field-specific import error and creates neither a visible Skill nor a partial managed artifact

#### Scenario: Reject a duplicate Skill name
- **WHEN** an operator adds a directory whose basename already identifies an existing Skill
- **THEN** Core returns `SKILL_ALREADY_EXISTS`, keeps the existing managed artifact unchanged, and directs the operator to the update command

#### Scenario: Ignore SKILL metadata when assigning identity
- **WHEN** an operator adds directory `code-review` whose `SKILL.md` omits `name`, contains malformed frontmatter, or declares a different name
- **THEN** Core imports the bytes without parsing them and assigns public Skill identifier `code-review`; any Pi SDK format failure is reported later when a Work attempts to activate that copied Skill

#### Scenario: Reject non-operator import
- **WHEN** an ordinary user or unauthenticated caller attempts to import a Skill directory
- **THEN** Core rejects the operation without reading the supplied host path

### Requirement: Manage a Skill by its directory name

**Identifier:** SKM-002

Core SHALL let an authenticated operator show, list, update, enable, disable, and remove a managed Skill using the basename assigned at import. Update SHALL accept `--path`, require the normalized source directory basename to equal the named Skill, and atomically replace the Core-managed current artifact only after complete tree validation. Core MUST NOT parse `SKILL.md` during update. Add or update failure MUST leave the previous catalog state and managed artifact unchanged. Disable or remove SHALL be rejected while the Skill is selected by the default Work configuration. Updating, disabling, or removing a Core-managed Skill MUST NOT mutate or invalidate a copy already owned by a Work.

#### Scenario: Update current content
- **WHEN** an operator updates `code-review` from a valid directory whose basename is also `code-review`
- **THEN** future Work copies use the newly imported complete artifact while every existing Work continues to use its own prior copy

#### Scenario: Reject an update name mismatch
- **WHEN** an operator updates `code-review` from a directory whose basename is another valid Skill name
- **THEN** Core returns `SKILL_NAME_MISMATCH` and preserves the existing `code-review` artifact and state

#### Scenario: Protect the default selection
- **WHEN** an operator attempts to disable or remove a Skill selected by the default Work configuration
- **THEN** Core rejects the operation and requires the operator to remove that name from the default selection first

#### Scenario: Remove an unreferenced managed Skill
- **WHEN** an operator removes an enabled or disabled Skill that is absent from the default Work selection
- **THEN** Core removes it from discovery and Core-managed storage while existing Works retaining copied content remain startable and recoverable

### Requirement: Discover selectable Skills without host details

**Identifier:** SKM-003

Authenticated users SHALL be able to list and show enabled Skills by their Core-assigned directory name before creating or configuring a Work. Operators SHALL additionally see disabled Skills, aggregate file count and byte size, timestamps, and management state. Core MUST NOT expose metadata parsed from `SKILL.md`. Ordinary-user responses, Work configuration responses, Session history, Run events, and errors MUST NOT disclose the original import path, Core-managed storage path, internal content digest, Skill file contents, or another Work's copied files. Results SHALL be ordered by Skill name.

#### Scenario: User lists selectable Skills
- **WHEN** a logged-in user lists Skills while `code-review` is enabled and `legacy-review` is disabled
- **THEN** the response includes directory-derived name `code-review`, omits `legacy-review`, and contains no host path, managed-storage path, parsed `SKILL.md` metadata, or file content

#### Scenario: Operator lists all managed Skills
- **WHEN** an authenticated operator lists Skills
- **THEN** the response contains enabled and disabled entries in name order with their public management state and without Skill file contents

#### Scenario: Show an unavailable Skill
- **WHEN** a user requests a missing or disabled Skill by name
- **THEN** Core returns the same public unavailable result without revealing whether a hidden host path exists
