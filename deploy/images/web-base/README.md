# Piwork Web base

**English** | [简体中文](README.zh-CN.md)

A reusable FastAPI + React + TypeScript + Vite development base for multiple Works. The Harness edits a shared workspace from the Agent container; Core runs an independent Service with this image. Application code/data belong to the Work. The image supplies a fixed toolchain, offline dependencies and common commands, and supports downstream FROM extensions.

<!-- web-base-reference:start -->
Published and anonymously verified:

```text
docker.io/pphboy/piwork-web-base:0.1.0-03395d0810f7-bbb24bdd0167-dirty@sha256:e83902fb568e97b2d01d488ce7c9c3d15f373ab58b46e041337baa832b8cfb81
```
<!-- web-base-reference:end -->

## Environment

The first release supports Linux amd64: Python 3.13.16, Node 24.21.0, FastAPI 0.143.0, React 19.3.0, TypeScript 7.0.2 and Vite 8.3.4. [environment.json](environment.json), [requirements.lock](requirements.lock) and [package-lock.json](frontend/package-lock.json) define the environment and complete locks. sqlite3 CLI is Debian 3.40.1-2+deb12u2. The Agent image also installs this command because AI bash executes inside Agent.

## Use in a Work

Copy the brain's templates/web-app/ into a writable apps/<service-name>, maintain its SPEC.md, then implement the business. templates/workstation/ is a complete feedback/asynchronous export example. The image itself contains no Todo application.

Use a published fixed tag@digest, command `/usr/local/bin/piwork-web`, args `["run", "--app", "/var/data/workspace/apps/<service-name>"]`, an explicit read/write workspace grant, web TCP 8080 and HTTP /health readiness. Read deployment_context for CPU/count admission. The normal readiness budget remains 120 seconds; the existing 300-second maximum can be selected explicitly.

Core injects identity/CA under /etc/piwork/interaction. Standard templates run as Core-managed Services; standalone Docker examples must not invent platform identities. Browser code calls its own same-origin backend and never receives a platform token.

Initialize through the `initialize.mjs` beside the loaded brain deployment Skill in Agent: `node <loaded-skill-directory>/initialize.mjs --template web-app --name <service-name>`. It writes the initial Spec before other template files and refuses every existing target before any write. Read and adapt the Spec before business implementation. Existing applications use targeted edits; repeat initialization never replaces source, locks, registration or data.

## Commands and automatic adoption

Run from the application directory:

```sh
piwork-web prepare
piwork-web check
piwork-web build
piwork-web serve
piwork-web run
piwork-web dev
```

prepare creates writable offline .venv/node_modules and restores the previous usable dependencies on failure. check runs isolated backend/frontend tests and type checks, recording .build/checks.json. build publishes matching frontend output; serve rejects stale source/build pairs; run combines these steps. Explicit dev mode supplies React Fast Refresh, backend reload and the same 8080 entry.

After edits, AI completes required checks/build and Service update/restart, then verifies actual codeVersion and business results. The default page checks safe versions every five seconds and on visibility/connection recovery, adopts a ready frontend, periodically re-reads business queries so Agent Actions appear without a Service restart, and restores supported nonsecret drafts/path. Users need no manual refresh. Failed/same/unreachable versions do not cause reload loops. Brain/Work configuration still requires the existing explicit Apply.

Both code and frontend versions bind the actual image environment identity as well as their source/locks. An environment-only rebuild/deployment also updates an open page; backend-only edits preserve the frontend version.

## Files, data and sqlite3

Source, locks, writable dependencies, caches, checks and builds stay under apps/<service-name>; business data stays under data/<service-name>. HOME/TMPDIR/caches point into workspace directories for UID/GID 10001:10001 and a read-only root filesystem. Ordinary startup never initializes over an existing application.

```sh
sqlite3 -readonly -json /var/data/workspace/data/<service-name>/app.sqlite 'SELECT name FROM sqlite_master WHERE type="table";'
```

Use the actual application database filename; the workstation example uses workstation.sqlite. AI uses the Agent command through authorized bash for data development/diagnosis. Ordinary business changes retain Query/Action/expectedStateVersion semantics; SQL does not authorize editing managed Core/history/Memory state.

## Maintenance and dependency extensions

| Location | Purpose |
| --- | --- |
| deploy/images/web-base/ | Long-term source, Dockerfile, locks, tools, environment and bilingual guides |
| scripts/ and Makefile | Build, validation and publication entry points |
| internal/coreassets/piwork-brain/ | Guidance, templates and fixed image reference |
| dist/web-base/ | Ignored local candidates and validation output |
| DockerHub pphboy/piwork-web-base | Published versions and registry digests |

After editing requirements.in, frontend/package.json and environment.json, regenerate locks with the fixed container toolchains, then build and validate. Developers need the repository build tools plus Docker Engine/CLI; user hosts gain no Node/Python/sqlite3 runtime requirement.

```sh
node scripts/lock-web-base.mjs
make web-base-image
node scripts/check-web-base.mjs
node scripts/check-web-base-core.mjs
```

Standard dependencies work offline. Missing additional wheels/cache fail explicitly. Retain exact application dependencies or derive a new image; running Pi receives no Docker build/socket capability. Downstream projects can extend a fixed version:

```dockerfile
FROM pphboy/piwork-web-base:0.1.0-03395d0810f7-bbb24bdd0167-dirty@sha256:e83902fb568e97b2d01d488ce7c9c3d15f373ab58b46e041337baa832b8cfb81
USER 0:0
# Install locked extra dependencies and copy your application during the build.
USER 10001:10001
CMD ["python", "/opt/my-app/main.py"]
```

## Memory, upgrades and publication

Application Services have no Piwork memory cap/reservation. Deprecated memoryBytes omission/zero means unlimited; legitimate older positive values remain history. memoryLimitMode/serviceMemoryPolicy explicitly report unlimited; zero is not a zero-byte allowance. CPU, service/volume counts and Agent/helper memory policy remain effective. Host/outer deployment determines available memory. See [operations](../../../docs/operations.md#service-资源与版本升级).

Local builds never push by default. Publication verifies candidate identity, offline and real SDK/CLI/browser evidence, and refuses to overwrite a different fixed tag. After explicit authorization, push and anonymously pull the same digest:

```sh
node scripts/publish-web-base.mjs
node scripts/publish-web-base.mjs --push
```

Then update the brain's fixed reference and build compatible Core/Agent images. Existing installations update their default catalog through normal package management before new Works capture the new brain. Existing Works retain captured packages/images; adoption uses selection, Package Update and explicit Apply. Five-role delivery follows the [existing release workflow](../../../docs/docker-release.md); this publisher does not replace its complete preflight.
