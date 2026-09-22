# Spec Delta

## ADDED Requirements

### Requirement: Use one persistent workspace across agent tools and deployments

**Identifier:** WSTOR-SERVICE-001

SDK file/shell execution SHALL use the canonical Work workspace `/var/data/workspace`; deployed services with a workspace grant SHALL use that path or a validated child directory. An image-native service without a workspace grant SHALL explicitly use `/` as its working directory and SHALL receive no persistent workspace. Its storage SHALL have a durable identity separate from agent-private database/history storage. Service mounts SHALL explicitly select workspace access as none, read-only, or read-write, and services SHALL NOT select arbitrary host paths or the agent-private volume. Files written by agent tools SHALL be readable by granted services; files created by a service with write access SHALL be readable and editable by agent tools under the configured shared identity. Only workspace files are persistent application data; container writable layers, /tmp, and process memory are not.

#### Scenario: Write then deploy without copying through Core
- **WHEN** agent SDK write creates apps/demo/server.py and the service receives read-only workspace access
- **THEN** the service reads the same persisted file through its mount without uploading source or mounting a host path

#### Scenario: Share business data
- **WHEN** the service with read-write workspace access writes data/demo/counter.json
- **THEN** agent tools can read it, and service/agent replacement reuses the same bytes

#### Scenario: Enforce a read-only grant
- **WHEN** a service granted read-only workspace access tries to write a file
- **THEN** the write fails without changing workspace contents

#### Scenario: Protect private state
- **WHEN** a deployment requests the agent database volume or attempts to traverse outside allowed workspace paths
- **THEN** the request is rejected before resource creation

#### Scenario: Reject missing storage on recovery
- **WHEN** a previously bound workspace volume is absent
- **THEN** recovery reports CONTEXT_NOT_FOUND or WORKSPACE_NOT_FOUND and does not silently initialize an empty replacement

### Requirement: Retain shared workspace independently of service removal

**Identifier:** WSTOR-SERVICE-002

Deleting or disabling a service SHALL NOT remove shared workspace files or reduce another resource storage access. A workspace SHALL retain a reference while its Work exists, even if no service uses it. Deleting Work SHALL retain both private and workspace volumes by default with owner-scoped records; only explicit authorized purge of unreferenced volumes can delete them. Historical combined storage layouts SHALL fail with CONTEXT_FORMAT_UNSUPPORTED rather than being migrated, reset, or silently mounted as a shared workspace.

#### Scenario: Delete one of two workspace consumers
- **WHEN** service A is removed while service B and the Work reference the workspace
- **THEN** the workspace remains, B can access its data, and an explicit purge returns a reference conflict

#### Scenario: Restart current storage layout
- **WHEN** Core and agentd restart using a Work created by this version
- **THEN** the same two volume identities, program files, business data, and Session history are restored
