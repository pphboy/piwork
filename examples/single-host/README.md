# Single-host deployment

**English** | [简体中文](README.zh-CN.md)

**Local candidate: images have not been pushed.**

Run Core and CLI as two separate containers on one Linux host with Compose. See [Quick Start](../../README.md#quick-start) for independent usage. Core is the background service; CLI is the terminal client. Exiting or reopening CLI leaves Core and its tasks running.

Requires Linux x86-64, rootful Docker Engine 28+ and Compose 2.24+. Exported host inputs: `PIWORK_ADMIN_ACCOUNT`, `PIWORK_ADMIN_PASSWORD` (at least 12 characters), `PIWORK_MODEL_PROVIDER`, `PIWORK_MODEL`, `PIWORK_API_KEY`; leave optional `PIWORK_MODEL_BASE_URL` unset when unused. Initialization inputs go only to Core.

Uses a separate `/var/lib/piwork/examples/single-host/core` directory and `piwork-single-host-client-state` volume, retaining permission checks. Ports 7171/7172 cannot be shared with another Core: stop conflicting services normally first, retaining their data. This example does not stop another installation automatically.

Obtain this directory’s `docker-compose.yml` and run from its directory. No clone, environment file or second YAML is needed. Start Core first:

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Open CLI; repeat only this command to return, without initialization inputs. If Core is absent or unready, CLI waits up to 600 seconds and fails safely without starting Core:

```sh
docker compose -f docker-compose.yml run --rm --no-deps cli
```

Inside CLI, replace ACCOUNT with your account; login prompts for a hidden password. WORK_ID comes from creation:

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

Use `exit` to leave; credentials persist and Work continues. Inspect status/logs and stop/restart Core (normal shutdown stops managed Works; restart restores their desired state):

```sh
docker compose -f docker-compose.yml exec -T core piwork-serve --json status
docker compose -f docker-compose.yml logs --tail 100 core
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Verify successful Core exit and retain its data, client volume and Work volumes; do not use `down -v` or global prune. Recover interrupted observation using original Operation/Run IDs without resubmitting. See the [Docker guide](../../deploy/docker/README.md#terminal-operations).

Maintenance: update the template, both language guides and referring documentation when images, environment, network, storage or readiness/shutdown rules change; run the Docker Quick Start checks.
