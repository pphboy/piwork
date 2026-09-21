# Tasks

## 1. Contracts, validation, and migration

- [x] 1.1 Extend WorkConfig with required agentsMd content, a 256 KiB UTF-8 limit, normalization rules, and the full built-in tool name set; verify contract tests cover empty, valid, oversized, unknown-tool, and duplicate-Skill inputs (WCFG-001, RUNTIME-TOOLS-001).
- [x] 1.2 Add the Core schema migration for default_work_configuration and backfill agentsMd: "" into legacy Work revision JSON without changing revision or active pointers; verify opening a pre-change database reaches the new schema and preserves existing rows (WCFG-001, WCFG-003).
- [x] 1.3 Add Core store read/compare-and-swap methods for the revisioned default configuration and atomic default/runtime-linked updates; verify stale expected revisions return a conflict and no partial row is written (SERVE-CTRL-001, WCFG-002).

## 2. Operator default configuration

- [x] 2.1 Implement operator GET/PUT default-work control-plane routes with catalog, digest, AGENTS, tool-policy, and secret-redaction validation; verify unauthorized user tokens and invalid inputs are rejected without changing the prior default (SERVE-CTRL-001, SERVE-START-001).
- [x] 2.2 Integrate runtime profile initialization and updates with default Work image/model fields, seeding only when absent and leaving existing Works untouched; verify runtime changes update the default revision but not any stored Work revision (SERVE-CTRL-001, WCFG-001).
- [x] 2.3 Add piwork-serve config default-work show/set command parsing, stable JSON output, usage errors, and operator credential routing; verify the user credential file is never read and secrets never appear in output (CLI-OUTPUT-001, SERVE-CTRL-001).

## 3. Work creation and per-Work configuration

- [x] 3.1 Change Core Work creation to transactionally copy the current default, normalize complete configuration or explicit overrides, and retain idempotent behavior; verify two Works created around a default update retain different independent snapshots (CLI-WORK-001, WCFG-001).
- [x] 3.2 Add piwork-cli work create options for base image, repeatable Skill, AGENTS file, and config file precedence; verify duplicate/missing/oversized/unreadable inputs fail before a Work is created and host paths are not persisted (CLI-WORK-001, CLI-OUTPUT-001).
- [x] 3.3 Add user Work configuration Skills list/set and AGENTS show/set routes plus complete show/set handling with expected-revision compare-and-swap; verify unrelated fields are preserved, stale revisions conflict, and responses redact secrets (CLI-WORK-001, WCFG-001, WCFG-002).
- [x] 3.4 Add piwork-cli work config show, skills list/set, agents show/set, and apply commands with stable identifiers and no set-base-image command; verify each command calls the user endpoint, not the operator endpoint, and wrong-CLI invocations are rejected locally (CLI-WORK-001, CLI-OUTPUT-001).

## 4. Artifact preparation and runtime materialization

- [x] 4.1 Extend artifact preparation and validation to pin agent image and Skill digests, reject disabled/duplicate/mismatched artifacts, and validate AGENTS content before activation; verify failures leave the prior active revision unchanged (SKILL-002, WCFG-003).
- [x] 4.2 Extend RuntimeConfigurationMaterializer to write AGENTS.md, Skill files, active context identity, and resolved tool policy in the read-only runtime root with restricted modes and atomic staging; verify cleanup on failure and absence of host-path mounts (RUNTIME-MATERIALIZE-001, SKILL-001).
- [x] 4.3 Wire materialized mounts and revision/generation labels into DockerWorkRuntimeAdapter prepare/start/recovery; verify a valid Work has exactly one isolated container and reconciliation adopts it without duplicate instances (RUNTIME-MATERIALIZE-001).
- [x] 4.4 Make configuration apply prepare the new materialized context before swapping active revision, preserve the old root on failure, and keep active Runs on their original context identity; verify pending config changes do not interrupt a Run and failed apply is retryable (WCFG-002, CONV-CONTEXT-001).

## 5. Agentd and Pi SDK context

- [x] 5.1 Extend the agentd runtime configuration/protocol with Work context paths, Skill descriptors, AGENTS path, active context identity, and resolved tools; verify malformed or cross-Work context identities are rejected safely (CONV-CONTEXT-001, RUNTIME-MATERIALIZE-001).
- [x] 5.2 Connect loadConfiguredSkills and an isolated ResourceLoader with skillsOverride and agentsFilesOverride to every Pi SDK session; verify a Session sees exactly the active Work Skills and AGENTS content, no host resources, and fixed digest failures block readiness (SKILL-001, SKILL-002, RUNTIME-PI-001).
- [x] 5.3 Resolve the seven built-in tools with allowed/denied precedence and pass the result to createAgentSession while retaining deterministic fixture_echo only for deterministic tests; verify all defaults are available, denied tools are absent, and unknown host/Docker capabilities are rejected (RUNTIME-TOOLS-001, RUNTIME-PI-001).
- [x] 5.4 Bind restored Sessions and new Runs to the active context identity while keeping history and events secret-free; verify daemon replacement restores the same context and a cross-Work request cannot read it (CONV-SESSION-001, CONV-CONTEXT-001).

## 6. CLI and lifecycle integration tests

- [x] 6.1 Extend Core HTTP and CLI tests for default-work APIs, Work creation overrides, Skills/AGENTS commands, expected-revision conflicts, no existing-Work mutation, and secret-safe stable errors; verify JSON output remains exactly one value (CLI-OUTPUT-001, SERVE-CTRL-001).
- [x] 6.2 Add materialization and agentd unit tests for AGENTS modes, Skill digest/name validation, empty-Skill isolation, resource-loader contents, full tool set, deny policy, and failed activation (SKILL-001, SKILL-002, SKILL-003, RUNTIME-TOOLS-001).
- [x] 6.3 Add a real deterministic Docker acceptance flow that starts serve, bootstraps/configures, creates a Work with custom Skill and AGENTS content, chats through piwork-cli, applies a config revision, restarts Core/agentd, and continues the same Session; verify no duplicate Run is created after a lost observation (CLI-CHAT-001, RUNTIME-PI-001, CONV-SESSION-001).
- [x] 6.4 Add an opt-in real-model smoke that reads the configured provider credentials from the test environment, asserts a non-empty assistant result, and never logs the credential or secret path (RUNTIME-PI-001, CLI-OUTPUT-001).

## 7. Final verification and delivery

- [x] 7.1 Run package typechecks, focused unit tests, Core HTTP tests, and agentd tests; verify all pass with no generated secret or host-path artifacts (all modified requirements).
- [x] 7.2 Run the Docker acceptance script and, when credentials are configured, the opt-in real-model smoke; verify Work restart preserves database, active context, login session, and conversation history (CLI-CHAT-001, CONV-SESSION-001, RUNTIME-MATERIALIZE-001).
- [x] 7.3 Run openspec validate work-skill-context-and-open-tools --type change --strict and git diff --check; verify every requirement identifier has a test or acceptance assertion and the change is ready for archive (all modified requirements).

