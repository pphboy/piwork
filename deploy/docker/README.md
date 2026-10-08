# Piwork Docker setup

[English](README.md) | [简体中文](README.zh-CN.md)

Start the Core and CLI containers to try Piwork. Core manages the Agent, helpers, Services, networks, and Work volumes. The native CLI remains available separately.

## Terminal Docker Quick Start

<!-- docker-quickstart:start -->

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

<!-- docker-quickstart:end -->

## Core Compose Demo

<!-- core-compose-demo:start -->

This optional Demo deploys **Core only** through Compose 2.24+. The CLI uses the same interactive Docker run as the default path. Use one Core example at a time: both listen on 7171/7172. If switching from the default example, stop that Core normally first. Demo data is in `/var/lib/piwork/core`, separate from `/var/lib/piwork/quickstart/core`.

After downloading and verifying the installer, run these commands on the Linux Core host. Create and edit the Compose-specific configuration; if you already have a valid `core.env`, retain it and skip this block:

```sh
(
    set -eu
    test ! -e core.env
    cp core.env.example core.env
    chmod 600 core.env
    ${EDITOR:-vi} core.env
)
```

Fill the same five initialization fields, with a password of at least 12 characters. Keep the Compose template's single-quote syntax to preserve literal `$` and spaces; escape a literal single quote as documented by Compose. Do not use `core.run.env` or source either file. A custom model Base URL must be HTTPS and reachable from Work containers.

Create fresh private directories, then start Core and wait for complete readiness. These directory commands are for a new root-owned installation; retain existing installation ownership and permissions.

```sh
sudo install -d -m 0700 -o 0 -g 0 /var/lib/piwork/core
sudo install -d -m 0700 -o 0 -g 0 /var/lib/piwork/core-exchange
test -S /var/run/docker.sock
```

```sh
docker compose \
    --env-file release.env \
    --env-file core.env \
    -f compose.core.yaml \
    up -d --wait --wait-timeout 600 core
```

Read the image references in the host terminal:

```sh
PIWORK_CORE_IMAGE=$(
    sed -n '/^PIWORK_CORE_IMAGE=.*@sha256:[0-9a-f]\{64\}$/s/^PIWORK_CORE_IMAGE=//p' release.env
)
PIWORK_CLI_IMAGE=$(
    sed -n '/^PIWORK_CLI_IMAGE=.*@sha256:[0-9a-f]\{64\}$/s/^PIWORK_CLI_IMAGE=//p' release.env
)
test -n "$PIWORK_CORE_IMAGE" && test -n "$PIWORK_CLI_IMAGE"
```

Enter the same terminal CLI:

```sh
docker run --rm --init -it \
    --add-host host.docker.internal:host-gateway \
    --env PIWORK_CORE_URL=http://host.docker.internal:7171 \
    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client \
    --entrypoint /bin/sh \
    "$PIWORK_CLI_IMAGE" -i
```

Inside the CLI container, wait for complete readiness, then log in with the Demo account and create a Work:

```sh
timeout 600 curl \
    --fail --silent --show-error \
    --output /dev/null --max-time 3 \
    --retry 120 --retry-delay 5 --retry-all-errors \
    "${PIWORK_CORE_URL}/readyz?profile=docker-delivery"
```

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

Use the actual creation `workId`:

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

Exit with `exit`. For Core status, shutdown, and recovery, see [terminal operations](#terminal-operations) and the advanced Core Compose commands below.

<!-- core-compose-demo:end -->

## Terminal operations

<!-- terminal-operations:start -->

For the default Docker run Core, use a host terminal in the installation directory to diagnose readiness or startup failures:

```sh
docker exec piwork-core-quickstart piwork-serve --json status
docker logs --tail 100 piwork-core-quickstart
```

Fix missing/invalid initialization values, socket access, image availability, or occupied ports before proceeding. A healthy process is not full delivery readiness. Readiness does not call the model; a failed model reply needs the existing runtime/model diagnostics. Once persistent administrator/model values exist, editing the initial env does not overwrite them; use the existing operator commands in the full manual.

If a Work operation is accepted but its wait times out or is interrupted, use the returned operation ID. If a chat stream disconnects, retain its Work/Run ID and last sequence. Run these **inside the CLI container** with the actual values; they observe the original request rather than submit a new one:

```sh
piwork-cli operation show OPERATION_ID
piwork-cli run watch WORK_ID RUN_ID --after SEQUENCE
```

`--wait` on Work operations observes for up to 120 seconds. An Operation or Run ID alone is not a successful result. Ctrl+C during chat requests cancellation under the existing CLI contract. Continue an existing conversation with `chat WORK_ID --session SESSION_ID --message 'Hello again, Piwork!'` using the original session ID.

Use `exit` to leave the CLI; its named state volume retains credentials and stopping CLI does not stop Work. To return, reread the image references if using a new host terminal and execute the same CLI Docker run, then wait for Core readiness. No extra login is needed while the saved credential remains valid for that Core.

To shut down the default Core normally, execute on the host and confirm exit code zero:

```sh
(
    set -eu
    docker stop --time 60 piwork-core-quickstart
    test "$(docker inspect --format '{{.State.ExitCode}}' piwork-core-quickstart)" = 0
)
```

The managed Work containers stop; their data, history and desired running state remain. A failed exit is not confirmed shutdown: retain its logs and investigate. Restart the same container, retaining its data:

```sh
docker start piwork-core-quickstart
```

For the Core Compose Demo, shut down with:

```sh
docker compose \
    --env-file release.env \
    --env-file core.env \
    -f compose.core.yaml \
    stop core
```

Use the Demo's original `up -d --wait --wait-timeout 600 core` to restart. Check the original Core container's exit status as shown in the advanced shutdown section. Do not use `down -v`, remove data, or globally prune resources. For file import/export or custom CA files, use the optional exchange storage in the full operations manual; the first conversation needs only the CLI credential volume.

### Windows or remote Linux clients

Windows Docker Desktop must use Linux containers. On the Windows client, in the verified installer directory, set the actual reachable Linux Core HTTP/HTTPS origin and start an interactive CLI. The Linux same-host host-gateway option is omitted:

```powershell
$PIWORK_CLI_IMAGE = (
    Get-Content .\release.env |
        Where-Object { $_ -match '^PIWORK_CLI_IMAGE=.+@sha256:[0-9a-f]{64}$' }
).Substring('PIWORK_CLI_IMAGE='.Length)
$PIWORK_CORE_URL = Read-Host 'Reachable Linux Core HTTP/HTTPS origin'
docker run --rm --init -it `
    --env "PIWORK_CORE_URL=$PIWORK_CORE_URL" `
    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client `
    --entrypoint /bin/sh `
    "$PIWORK_CLI_IMAGE" -i
if ($LASTEXITCODE -ne 0) { throw 'CLI container failed' }
```

Once inside the container, execute the same readiness wait, terminal login, Work creation and chat commands as above. Another Linux client uses the same Docker run with its reachable Core URL. HTTPS retains certificate verification; see the full guide for a custom CA. Model endpoints are reached from Linux Work containers, not from the client's network.

Terminal validation evidence is tracked separately in [Docker Quick Start acceptance](../../docs/docker-quickstart-acceptance.md); it does not replace the existing Windows/Desktop evidence.

<!-- terminal-operations:end -->

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
notepad .\client.env
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
