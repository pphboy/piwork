# Agent Service Deployment Specification

## Purpose

Enable the Work agent to turn user-requested persistent applications into Core-managed private services using a default instructional Skill and MCP tools, with shared durable files, verifiable deployment outcomes and automatic lifecycle recovery.

## Requirements

### Requirement: Seed and select the deployment Skill through managed snapshots

**Identifier:** ADEP-001

A fresh installation SHALL import the bundled `deploy-work-service` directory into the ordinary Core-managed Skill catalog and select it in the initial default Work configuration. The seed SHALL be atomic and recorded once; restart MUST NOT overwrite operator edits, re-enable a disabled Skill, resurrect a removed Skill, or repopulate intentionally cleared defaults. Work creation with omitted Skill selection SHALL copy the default Skill into Work-owned context and require actual SDK load before ready. Explicit names replace defaults and explicit no-Skills produces no selected Skill. Existing Works SHALL not be silently modified; adoption requires explicit selection and apply. Skill updates SHALL use the managed data path and SHALL NOT require rebuilding the agent image.

#### Scenario: Load the fresh default deployment Skill
- **WHEN** a fresh configured installation creates a Work without a Skill override
- **THEN** the Work owns deploy-work-service and readiness/runtime status confirms SDK loading from its own copied directory

#### Scenario: Respect no-Skills
- **WHEN** a user creates a Work with --no-skills
- **THEN** the deployment Skill is absent even if default MCP tools remain configured

#### Scenario: Do not reseed operator changes
- **WHEN** the operator removes the Skill from defaults and updates, disables or removes its catalog entry, then Core restarts
- **THEN** the operator choices survive and no existing Work copy changes

#### Scenario: Recover interrupted first seeding
- **WHEN** Core fails before first-run seeding commits
- **THEN** retry publishes one complete validated managed Skill and one default selection, with no duplicate catalog entry

### Requirement: Guide deployments using persistent code and explicit verification

**Identifier:** ADEP-002

The deployment Skill SHALL instruct the agent to use deployment_context to discover workspace/tool availability and quota, write code under apps/<service-name> and business data under data/<service-name>, use existing runtime images, declare reproducible dependency installation when needed, bind network services to 0.0.0.0, and use the returned Work-private endpoint. It SHALL instruct the agent to reuse a matching existing service through an explicit update, use stable mutation keys for retries, observe durable Operations, read failures/logs, and verify the application from agentd before reporting success. It SHALL distinguish process readiness from application readiness, explain that persistence requires shared storage and startup reproducibility, and SHALL not represent a background process in agentd, Skill loading alone, or an accepted create as successful persistent deployment. It SHALL document stop/disable versus Work stop and prohibit purging shared data as a repair shortcut.

#### Scenario: User requests persistence
- **WHEN** the user asks the agent to keep a Python HTTP application running across Work restarts
- **THEN** the loaded Skill directs code/data placement and MCP deployment, then operation and HTTP verification

#### Scenario: Dependencies need installation
- **WHEN** the application requires a package absent from its existing image
- **THEN** the deployment defines a pinned reproducible install/start procedure using writable workspace or reports failure; it does not request an image build

#### Scenario: Tools are unavailable
- **WHEN** the Skill is selected but the MCP server was removed or service_create denied
- **THEN** the agent explains the missing deployment capability without claiming persistence from a local background process

### Requirement: Prove deployment with real SDK MCP containers and retained files

**Identifier:** ADEP-003

Required automated product acceptance SHALL execute a deterministic model through the real Pi SDK, consume the loaded deployment Skill and discovered MCP schemas, write a Python HTTP application through SDK tools, and invoke service MCP tools through Core gRPC into a real Docker container using a preexisting Python image. From agentd it SHALL verify an HTTP response and a persisted business-data marker, then stop/start the Work and gracefully restart Core and verify service restoration and marker retention without new model redeployment calls. Tests SHALL verify no image build/commit occurs during deployment and no host port is published. Isolation, self-management rejection, stale credentials, failed deployment diagnostics and default Skill/tool loading SHALL have automated coverage; no live model provider credential is required.

#### Scenario: Complete the Python HTTP demo
- **WHEN** the end-to-end acceptance runs against fresh storage and compatible prebuilt images
- **THEN** actual SDK and MCP calls create one service, agentd receives its expected response, and the data marker survives Work/Core restart

#### Scenario: Separate fixture from implementation shortcuts
- **WHEN** the deterministic fixture chooses a deployment tool
- **THEN** the actual MCP transport and gRPC server execute it; a mocked direct call to the service manager cannot satisfy acceptance
