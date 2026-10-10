# Piwork Docker setup

**English** | [简体中文](README.zh-CN.md)

Start Core and CLI separately; Core manages the Agent, helpers, Services and Work storage. Native CLI delivery remains independent.

This release runs application Services without a Piwork memory cap or Service memory reservation. CPU, service/volume counts and Agent/helper memory policy still apply. Legacy Service memoryBytes values remain compatibility history; memoryLimitMode / serviceMemoryPolicy explicitly report unlimited, and zero is not a zero-byte allowance. A normal Core upgrade replaces older capped Service containers through managed recovery and retains workspace data. See [resource and upgrade details](../../docs/operations.md#service-资源与版本升级) and the [Web base guide](../images/web-base/README.md).

## Terminal Docker Quick Start

<!-- docker-quickstart:start -->

### Core

Use Linux x86-64 with Docker Engine 28+. The host environment must already contain `PIWORK_ADMIN_ACCOUNT`, `PIWORK_ADMIN_PASSWORD` (at least 12 characters), `PIWORK_MODEL_PROVIDER`, `PIWORK_MODEL`, and `PIWORK_API_KEY`. Optional `PIWORK_MODEL_BASE_URL` uses HTTPS reachable from Work containers; leave it unset when unused.

Run Core in the host terminal. The image includes release defaults and automatically prepares the Agent and helpers:

```sh
docker run --detach --init \
    --name piwork-core-quickstart \
    --network host \
    --restart unless-stopped \
    --stop-timeout 60 \
    --env PIWORK_ADMIN_ACCOUNT \
    --env PIWORK_ADMIN_PASSWORD \
    --env PIWORK_MODEL_PROVIDER \
    --env PIWORK_MODEL \
    --env PIWORK_API_KEY \
    --env PIWORK_MODEL_BASE_URL \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core \
    docker.io/pphboy/piwork-core:0.0.1-fc409adc1a0b-808d890c6607-dirty
```

Core can also be deployed alone with [Core-only docker-compose.yml](docker-compose.yml) (Compose 2.24+); CLI keeps its independent Docker command. Stop the previous Core before switching deployment methods, retaining the same data directory. For an optional combined setup, see [Single-host deployment](../../examples/single-host/README.md).

### CLI

Run CLI independently against an existing Core; no Core initialization variables are needed. This command connects to Core on the same host; replace `PIWORK_CORE_URL` for another Core. It waits for full readiness and opens a terminal:

```sh
docker run --rm --init --interactive --tty \
    --add-host host.docker.internal:host-gateway \
    --env PIWORK_CORE_URL=http://host.docker.internal:7171 \
    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client \
    docker.io/pphboy/piwork-cli:0.0.1-fc409adc1a0b-808d890c6607-dirty
```

Run the following **inside the CLI container**. Replace `ACCOUNT` with your account; login prompts for a hidden password. Creating a Work starts it automatically:

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

Replace `WORK_ID` with the actual `workId` returned by creation, then send your first message:

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

The reply appears in the terminal. Use `exit` to leave; the same CLI startup command reuses credentials and exiting the CLI does not stop Work. For failed readiness or interrupted observation, use the [terminal operations guide](#terminal-operations) to inspect status or recover the original Operation/Run without resubmitting.

<!-- docker-quickstart:end -->

## Core Compose Demo

<!-- core-compose-demo:start -->

This optional advanced Core-only Demo uses a separate `/var/lib/piwork/core` installation and the same Docker terminal CLI. It shares ports 7171/7172 with the default examples; stop the previous Core normally before switching. Use the existing initialization environment above. Mounting and safe initialization create a new empty directory; retain existing ownership and permissions.

```sh
PIWORK_CORE_IMAGE=docker.io/pphboy/piwork-core:0.0.1-fc409adc1a0b-808d890c6607-dirty \
    docker compose -f compose.core.yaml up --detach --wait --wait-timeout 600 core
```

Run this CLI command on the same host, then follow Quick Start inside the container to log in to this Demo, create a Work and chat. Readiness waiting is built into the image entrypoint:

```sh
docker run --rm --init --interactive --tty \
    --add-host host.docker.internal:host-gateway \
    --env PIWORK_CORE_URL=http://host.docker.internal:7171 \
    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client \
    docker.io/pphboy/piwork-cli:0.0.1-fc409adc1a0b-808d890c6607-dirty
```

<!-- core-compose-demo:end -->

## Terminal operations

<!-- terminal-operations:start -->

Inspect the default Docker run Core in the host terminal. Full readiness is different from process health; fix environment, socket, image or port failures before retrying the CLI:

```sh
docker exec piwork-core-quickstart piwork-serve --json status
docker logs --tail 100 piwork-core-quickstart
```

For Core-only Compose, use:

```sh
docker compose -f docker-compose.yml exec -T core piwork-serve --json status
docker compose -f docker-compose.yml logs --tail 100 core
```

Inside the CLI container, use the original returned IDs to recover an accepted Operation/Run without creating or sending again:

```sh
piwork-cli operation show OPERATION_ID
piwork-cli run watch WORK_ID RUN_ID --after SEQUENCE
```

`--wait` observes for up to 120 seconds. Ctrl+C during chat requests cancellation under the existing contract; continue a conversation using its original `SESSION_ID`. Credentials live in the separate volume. Exiting or rebuilding the CLI does not stop Work; repeat its startup command to return. Changed valid initialization values do not replace saved administrator/model settings; use existing operator commands for changes.

Stop the default Core normally and verify successful exit. Managed Works stop while IDs, history, volumes and desired state remain. Retain logs on failure; do not report confirmed shutdown:

```sh
docker stop --time 60 piwork-core-quickstart
test "$(docker inspect --format '{{.State.ExitCode}}' piwork-core-quickstart)" = 0
```

Restart with the retained data:

```sh
docker start piwork-core-quickstart
```

Use the following for Compose stop/restart. Normal operation does not use `down -v` or global prune. Back up the consistent Core directory and matching Work volumes; SQLite or an image alone cannot recover a complete Work. Pin release references for upgrade/rollback, retain the old Compose and manifest, and check format compatibility first. File exchange and custom CAs are optional advanced steps; the first chat needs no exchange volume.

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Windows Docker Desktop uses Linux containers; the terminal CLI connects to a reachable Linux Core. Replace `CORE_URL` with the actual address in PowerShell; login still prompts for a hidden password inside the container:

```powershell
docker run --rm --init --interactive --tty `
    --env PIWORK_CORE_URL=CORE_URL `
    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client `
    docker.io/pphboy/piwork-cli:0.0.1-fc409adc1a0b-808d890c6607-dirty
if ($LASTEXITCODE -ne 0) { throw 'CLI container failed' }
```

Remote Linux clients likewise replace the Core URL. HTTPS retains certificate verification. Model/MCP endpoints must be reachable from Core Work networks; the client host alias does not replace them.

<!-- terminal-operations:end -->

## Legacy 0.0.1 installer

<details>
<summary>Older installer and optional Desktop operations</summary>

The following commands belong to the verified older 0.0.1 installer. Use its own release.env and YAML, not the new repository Demo. These steps are separate from the new default Quick Start.

<!-- legacy-docker-quickstart:start -->

This example uses one Linux computer with a local rootful Docker Engine 28+ and `linux/amd64` images. Prepare a model provider, model ID, and API key; the model endpoint must be reachable from Work containers. Complete each step before continuing. If a command fails, stop and resolve it using the [terminal troubleshooting guide](README.md#terminal-operations).

**1. Download and verify the installer.**

Run these commands in your host terminal, starting in a new directory:

```sh
(
    set -eu
    mkdir piwork-preview-0.0.1 || exit
    cd piwork-preview-0.0.1 || exit
    PIWORK_RELEASE_URL=https://github.com/pphboy/piwork/releases/download/v0.0.1
    curl --fail --location \
        --output piwork-docker-0.0.1.tar.gz \
        "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz" || exit
    curl --fail --location \
        --output piwork-docker-0.0.1.tar.gz.sha256 \
        "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz.sha256" || exit
    sha256sum --check --strict piwork-docker-0.0.1.tar.gz.sha256 || exit
    tar -xzf piwork-docker-0.0.1.tar.gz || exit
    cd piwork-docker || exit
    sha256sum --check --strict SHA256SUMS || exit
) && cd piwork-preview-0.0.1/piwork-docker
```

**2. Configure and start Core.**

In the extracted installer directory, create a private `core.run.env`. New installers provide the run template; the fallback creates the same blank configuration for the published `0.0.1` installer:

```sh
(
    set -eu
    test ! -e core.run.env
    if [ -f core.run.env.example ]; then
        cp core.run.env.example core.run.env
    else
        cat > core.run.env <<'EOF'
# Docker run only. Enter raw values without surrounding syntax quotes; do not source.
# Administrator password: at least 12 characters. Keep this file private (0600).
PIWORK_ADMIN_ACCOUNT=
PIWORK_ADMIN_PASSWORD=
PIWORK_MODEL_PROVIDER=
PIWORK_MODEL=
PIWORK_API_KEY=
# Optional HTTPS endpoint reachable from Work containers; omit instead of leaving empty.
# PIWORK_MODEL_BASE_URL=https://your-model-endpoint.example/v1
EOF
    fi
    chmod 600 core.run.env
    ${EDITOR:-vi} core.run.env
)
```

Fill the five blank values. The administrator password must be at least **12 characters**. Enter raw values without adding surrounding syntax quotes; do not source this file or reuse the Compose-only `core.env` format. For a custom model endpoint, uncomment the HTTPS `PIWORK_MODEL_BASE_URL` example and replace it with an address reachable from Work containers. Omit it when using the provider's default.

Read the fixed image references from the verified `release.env` in the same host terminal:

```sh
PIWORK_CORE_IMAGE=$(
    sed -n '/^PIWORK_CORE_IMAGE=.*@sha256:[0-9a-f]\{64\}$/s/^PIWORK_CORE_IMAGE=//p' release.env
)
PIWORK_CLI_IMAGE=$(
    sed -n '/^PIWORK_CLI_IMAGE=.*@sha256:[0-9a-f]\{64\}$/s/^PIWORK_CLI_IMAGE=//p' release.env
)
test -n "$PIWORK_CORE_IMAGE" && test -n "$PIWORK_CLI_IMAGE"
```

Start Core. Docker creates its data bind directory, and Core makes a new empty installation private. Keep the same absolute path on both sides of the mount. Core listens on `7171` and `7172` and uses the existing authenticated HTTP/control interfaces; remote HTTPS setup is covered in the installation guide.

```sh
docker run --detach --init \
    --name piwork-core-quickstart \
    --user 0:0 \
    --network host \
    --env-file release.env \
    --env-file core.run.env \
    --env DOCKER_HOST=unix:///var/run/docker.sock \
    --env DOCKER_CONTEXT= \
    --env PIWORK_DATA_DIR=/var/lib/piwork/quickstart/core \
    --env PIWORK_CORE_URL=http://127.0.0.1:7171 \
    --env PIWORK_LISTEN=0.0.0.0:7171 \
    --env PIWORK_AGENT_GRPC_LISTEN=0.0.0.0:7172 \
    --env PIWORK_AGENT_GRPC_ADVERTISE=piwork-core:7172 \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core \
    --stop-timeout 60 \
    "$PIWORK_CORE_IMAGE" serve --allow-insecure-remote
```

Core automatically prepares the Agent and helper images. Its installation data persists in `/var/lib/piwork/quickstart/core`; Work data is managed by Core.

**3. Enter the CLI container.**

Run this in the same host terminal. It opens an interactive shell; the named state volume retains your login between containers:

```sh
docker run --rm --init -it \
    --add-host host.docker.internal:host-gateway \
    --env PIWORK_CORE_URL=http://host.docker.internal:7171 \
    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client \
    --entrypoint /bin/sh \
    "$PIWORK_CLI_IMAGE" -i
```

**4. Log in, create a Work, and receive a reply.**

Run the remaining commands **inside the CLI container**. First wait up to ten minutes for Core and its dependencies to be ready:

```sh
timeout 600 curl \
    --fail --silent --show-error \
    --output /dev/null --max-time 3 \
    --retry 120 --retry-delay 5 --retry-all-errors \
    "${PIWORK_CORE_URL}/readyz?profile=docker-delivery"
```

After the wait succeeds, replace `ACCOUNT` with the account configured in `core.run.env`. Login prompts for a hidden password. Creating a Work starts it automatically; `--wait` observes that operation until it succeeds:

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

Replace `WORK_ID` with the actual `workId` in the creation result, then send your first message:

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

The model reply appears in the terminal. Use `exit` to leave the container; the login volume and Work remain. Run the same CLI container command to return. If a Work operation or chat stream is interrupted, recover using its original ID as described in the [terminal operations guide](README.md#terminal-operations).

<!-- legacy-docker-quickstart:end -->

## Advanced installation and Desktop

## Requirements

- Core: Linux with a local rootful Docker Engine Unix socket.
- Client: Linux or Windows Docker Desktop in Linux-container mode; a browser is only used for the optional Desktop entry.
- Target: `linux/amd64`; Docker Engine 28+. Compose 2.24+ is needed only for the Core Demo and advanced Compose setups.
- A reachable model provider, its model ID, and an API key. The model endpoint must be reachable from the Linux Core's Work containers. A custom endpoint must use HTTPS.

On Linux, Core and CLI can run on the same computer. Windows clients connect to a reachable Linux Core; this installer does not deploy Core as a Windows container.

## 1. Download and verify 0.0.1 Preview

Use a new directory on each computer. Download the installer and checksum from [the release](https://github.com/pphboy/piwork/releases/tag/v0.0.1). The installer contains configuration templates, not offline images; Docker pulls images from `docker.io/pphboy`.

Linux Bash:

```bash
(
    set -euo pipefail
    mkdir piwork-preview-0.0.1 || exit
    cd piwork-preview-0.0.1 || exit
    PIWORK_RELEASE_URL=https://github.com/pphboy/piwork/releases/download/v0.0.1
    curl --fail --location --output piwork-docker-0.0.1.tar.gz "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz" || exit
    curl --fail --location --output piwork-docker-0.0.1.tar.gz.sha256 "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz.sha256" || exit
    sha256sum --check piwork-docker-0.0.1.tar.gz.sha256 || exit
    tar -xzf piwork-docker-0.0.1.tar.gz || exit
    cd piwork-docker || exit
    sha256sum --check SHA256SUMS || exit
) && cd piwork-preview-0.0.1/piwork-docker
```

Windows PowerShell:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    if (Test-Path .\piwork-preview-0.0.1) { throw 'Use a new installation directory' }
    New-Item -ItemType Directory .\piwork-preview-0.0.1 | Out-Null
    Set-Location .\piwork-preview-0.0.1
    $PIWORK_RELEASE_URL = 'https://github.com/pphboy/piwork/releases/download/v0.0.1'
    curl.exe --fail --location --output piwork-docker-0.0.1.tar.gz "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Installer download failed' }
    curl.exe --fail --location --output piwork-docker-0.0.1.tar.gz.sha256 "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz.sha256"
    if ($LASTEXITCODE -ne 0) { throw 'Checksum download failed' }
    $PIWORK_CHECKSUM = (Get-Content .\piwork-docker-0.0.1.tar.gz.sha256 -Raw).Trim()
    if ($PIWORK_CHECKSUM -notmatch '\A([0-9a-fA-F]{64})\s+piwork-docker-0\.0\.1\.tar\.gz\z') { throw 'Invalid checksum file' }
    if ((Get-FileHash .\piwork-docker-0.0.1.tar.gz -Algorithm SHA256).Hash -ine $Matches[1]) { throw 'Installer checksum mismatch' }
    tar -xzf piwork-docker-0.0.1.tar.gz
    if ($LASTEXITCODE -ne 0) { throw 'Extraction failed' }
    Set-Location .\piwork-docker
    Get-Content .\SHA256SUMS | ForEach-Object {
        if ($_ -notmatch '\A([0-9a-fA-F]{64})\s+\*?([a-zA-Z0-9_.-]+)\z') { throw 'Invalid internal checksum' }
        if ((Get-FileHash -LiteralPath $Matches[2] -Algorithm SHA256).Hash -ine $Matches[1]) { throw 'Internal checksum mismatch' }
    }
}
```

If any command fails, stop and resolve it before continuing. For an installer already on disk, checksum it before extracting, then run the internal checks above. Keep the existing installation's configuration and data when updating; do not extract over it.

Check Docker on each computer:

```sh
docker version
docker compose version
docker info --format '{{.OSType}}/{{.Architecture}}'
```

The engine must report Linux and amd64/x86_64, Engine 28+. Check Compose 2.24+ when choosing a Compose setup.

## 2. Initialize and start Core on Linux

From the extracted `piwork-docker` directory on the Core computer:

```bash
cp core.env.example core.env
chmod 600 core.env
${EDITOR:-vi} core.env
sudo install -d -m 0700 -o 0 -g 0 /var/lib/piwork/core
sudo install -d -m 0700 -o 0 -g 0 /var/lib/piwork/core-exchange
test -S /var/run/docker.sock
docker compose --env-file release.env --env-file core.env -f compose.core.yaml pull core
docker compose --env-file release.env --env-file core.env -f compose.core.yaml up -d --wait --wait-timeout 600 core
docker compose --env-file release.env --env-file core.env -f compose.core.yaml exec -T core piwork-serve --json status
docker compose --env-file release.env --env-file core.env -f compose.core.yaml exec -T core curl --fail --silent --show-error 'http://127.0.0.1:7171/readyz?profile=docker-delivery'
```

Fill `PIWORK_ADMIN_ACCOUNT`, `PIWORK_ADMIN_PASSWORD`, `PIWORK_MODEL_PROVIDER`, `PIWORK_MODEL`, and `PIWORK_API_KEY`. For a custom provider endpoint, uncomment and fill `PIWORK_MODEL_BASE_URL`. Keep secret values single-quoted as described in the template; do not source `core.env`. Image references come from `release.env`.

The defaults listen on ports 7171 and 7172. Port 7171 must be reachable by clients; Work containers must be able to reach 7172. This example uses HTTP; use an existing trusted HTTPS endpoint for remote HTTPS access.

Core automatically pulls and prepares its dependencies. If readiness times out, inspect status and logs, fix the cause, and repeat the same `up` command:

```sh
docker compose --env-file release.env --env-file core.env -f compose.core.yaml logs --tail 100 core
```

These initialization values fill missing persistent configuration. Restarting with changed values does not overwrite an existing administrator or model configuration. See the [full operations manual](README.zh-CN.md#64-core-operator-完整命令) for operator commands.

Core's data bind source and destination must use the same absolute path because the Docker Engine resolves Work bind mounts on its host. The examples create a fresh root-owned installation; existing installations must retain their ownership and configuration.

## 3. Start CLI Desktop and log in

Linux client, from its extracted installer directory:

```bash
cp client.env.example client.env
chmod 600 client.env
${EDITOR:-vi} client.env
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml -f compose.cli.linux.yaml pull cli
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml -f compose.cli.linux.yaml up -d --wait --wait-timeout 60 cli
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml exec -T cli piwork-cli desktop open --no-open
```

Windows client, from its extracted installer directory:

```powershell
Copy-Item .\client.env.example .\client.env
$PIWORK_CORE_URL = Read-Host 'Reachable Linux Core origin'
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'client.env'), "PIWORK_CORE_URL=$PIWORK_CORE_URL`n", [System.Text.UTF8Encoding]::new($false))
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml pull cli
if ($LASTEXITCODE -ne 0) { throw 'CLI image pull failed' }
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml up -d --wait --wait-timeout 60 cli
if ($LASTEXITCODE -ne 0) { throw 'CLI startup failed' }
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml exec -T cli piwork-cli desktop open --no-open
if ($LASTEXITCODE -ne 0) { throw 'Desktop open failed' }
```

For Linux on the Core computer, the default `http://host.docker.internal:7171` is suitable. For another computer or Windows, set `PIWORK_CORE_URL` to the reachable Linux Core origin, such as `http://CORE_LAN_IP:7171`, using the actual address.

Paste the complete `desktop open` link into a browser **on the client computer**. It grants local browser access for this Desktop instance; it does not log in to Core. In the login page, enter your Core URL, account, and password. Create a Work, which starts automatically, then open Chat, Services, or Files.

The link is single-use and expires after five minutes. Repeat `desktop open` to obtain another. Desktop is published only on the client's loopback port 17891. The CLI has its own state and exchange volumes; it does not mount the Docker socket or Core data.

## 4. Open again, log out, and stop

The following client commands work on Linux and Windows in the same installer directory:

```sh
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml exec -T cli piwork-cli desktop open --no-open
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml exec -T cli piwork-cli desktop logout
docker compose --env-file release.env --env-file client.env -f compose.cli.yaml stop cli
```

Stopping CLI leaves Works running. To start it again, repeat the platform's `up` and `desktop open` commands. After a container rebuild, old local browser authorization is invalid; obtain a new link.

On the Linux Core computer, shut down gracefully:

```bash
(
    set -euo pipefail
    docker compose --env-file release.env --env-file core.env -f compose.core.yaml stop core
    PIWORK_CORE_CONTAINER=$(docker compose --env-file release.env --env-file core.env -f compose.core.yaml ps --all --quiet core)
    test -n "$PIWORK_CORE_CONTAINER"
    test "$(docker inspect --format '{{.State.ExitCode}}' "$PIWORK_CORE_CONTAINER")" = 0
)
```

A successful normal Core shutdown stops all managed Work containers and retains their files, history, configuration, and desired running state. Restart Core with the same `up` command to recover them. A failed shutdown requires investigation; do not remove its diagnostics or data. Forced termination is not a successful normal shutdown.

See the [complete operations manual](README.zh-CN.md) for command-line-only usage, model changes, Services, files, `.work` import/export, updates, and data recovery. This Preview's platform evidence and limitations are listed on the release page. Native Windows CLI acceptance remains incomplete.


</details>
