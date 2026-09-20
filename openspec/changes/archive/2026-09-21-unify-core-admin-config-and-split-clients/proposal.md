# Proposal

## Why

The current installation requires operators to run separate local Core commands
for administrator bootstrap, runtime configuration, and service startup. The
running Core then exposes only the user-facing client surface, so
there is no coherent control-plane CLI for initializing or managing the service.
The package and command boundaries also mix deployment control with the client
used by logged-in Work owners.

This change establishes one long-lived Core control plane that can start before
an installation is fully initialized, imports an optional `.env` file on first
startup, and exposes a dedicated `piwork-serve` operator CLI alongside a
separate `piwork-cli` user client.

## What Changes

- Add `piwork-serve` as the deployment and control-plane CLI for starting Core,
  bootstrapping the first administrator, managing users, and managing the
  installation-wide default runtime configuration.
- Add `piwork-cli` as the separately named authenticated client for login,
  identity, Work lifecycle, Work configuration, Sessions, Runs, and chat.
- Make `piwork-serve serve` keep Core available when the administrator or global
  default runtime is missing; health remains available and readiness reports the
  actionable initialization state.
- Add `serve --env-file <path>` support for first-start initialization from
  `.env`, `.env.test`, or another explicitly selected environment file.
- Move bootstrap, runtime configuration, and service startup onto the
  `piwork-serve` command surface; no `piwork-core` compatibility command is
  retained.
- Make `piwork-cli` the only user client command; no `piwork` compatibility
  alias is retained.
- Expose authenticated control-plane APIs for administrator/user management and
  global default runtime configuration without returning secret values.
- Make the global runtime configuration a default copied into new Works only.
  Changing it MUST NOT modify or restart existing Works.
- Expose independent per-Work configuration read/update/apply operations using
  desired and active revisions; Work configuration changes apply on an explicit
  apply/restart operation and do not interrupt the current Run implicitly.
- Do not create a default Work during `serve` startup.
- Keep operator credentials and user client credentials as separate trust
  boundaries; the operator CLI is not a substitute for a logged-in user client.

## Capabilities

### New Capabilities

- `serve-control-plane`: Operator-facing Core lifecycle, initialization state,
  environment-file import, operator credential, and control-plane API contract.

### Modified Capabilities

- `core-service-startup`: Core must serve before initialization is complete and
  must initialize missing administrator/default runtime state from an explicit
  env file without overwriting persisted state.
- `control-cli`: Split the operator CLI from the authenticated user client and
  define the command responsibilities and package names for both surfaces.
- `user-administration`: Add operator/control-plane user management commands and
  APIs while preserving administrator authorization and last-admin protection.
- `work-configuration`: Make the global runtime profile a new-Work default and
  require each Work to retain and independently update its own configuration.

## Impact

- CLI packages and binaries under `apps/cli`, `apps/core`, and workspace
  package scripts; this is an intentional command-name change to
  `piwork-serve` and `piwork-cli` without legacy aliases.
- Core HTTP routing, readiness state, runtime-profile/catalog handling, user
  administration, Work creation, and Work configuration lifecycle.
- Client SDK methods and credential-file handling for operator and user clients.
- Core-store configuration metadata and migrations where a Work must retain a
  resolved model/runtime selection independently of the global default.
- `.env` parsing, protected secret handling, test fixtures, integration tests,
  and operator documentation.
- Docker runtime resolution so a Work uses its saved configuration rather than
  rereading the installation default after it has been created.
