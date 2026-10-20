# Piwork Docker setup

**English** | [简体中文](README.zh-CN.md)

One Linux application serves Core, the full web workbench, administration and first-time setup. CLI remains an independent optional tool.

This release runs application Services without a Piwork memory cap or Service memory reservation. CPU, service/volume counts and Agent/helper memory policy still apply. Legacy Service memoryBytes values remain compatibility history; memoryLimitMode / serviceMemoryPolicy explicitly report unlimited, and zero is not a zero-byte allowance. A normal Core upgrade replaces older capped Service containers through managed recovery and retains workspace data. See [resource and upgrade details](../../openspec/specs/core-service-startup/spec.md) and the [Web base guide](../images/web-base/README.md).

## Docker Quick Start

<!-- docker-quickstart:start -->

Use Linux x86-64 and rootful Docker Engine 28+. One container serves the workbench, administration and first-time setup, with no environment variables or client CLI required:

This published image includes direct browser entry and web setup.

```sh
docker run --detach --init \
    --name piwork-core-quickstart \
    --network host \
    --restart unless-stopped \
    --stop-timeout 60 \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core \
    docker.io/pphboy/piwork-core:0.0.9-0901cf119dc1-0e1261f05b9d
```

On this computer or another computer, open `http://SERVER_IP:17891` using the server’s actual IP. An empty installation shows Create administrator; an initialized installation shows normal sign-in. No terminal authorization link is required.

Create the administrator with a password and matching confirmation, then sign in to **Quick setup** in Admin (`/admin/setup`). Follow the two-step guide: enter the model ID, API type, Base URL and API Key, or choose a saved model, then select **Save and continue**. This saves the model and binds CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. The Agent image is embedded with the server release and supplied automatically; it has no input, selector or advanced override. Model Test is explicit and optional; saving does not call the model. Open the workbench to create a Work, chat, manage files or open Services. Return through Admin **Overview → Quick setup** to change configuration. The topbar **Workbench** link remains available while preparation finishes; the completion action waits for all components. Saved accounts, models and Works survive restart.

One command starts two independent HTTP services in one process: ControlPlane defaults to `0.0.0.0:17891`, Core to `127.0.0.1:17871`. Browsers use the actual LAN IP on 17891 for all UI, files, events and `/services/<workId>/<serviceId>/<port>/`, without DNS or extra Service ports. The backend and CLI/operator call Core directly. Remote or bridge CLI requires explicit `--core-listen 0.0.0.0:17871` (or a reachable interface) and the appropriate network access; loopback is not reachable from a bridge container. Preserve container-reachable 7172 for internal Agent mTLS RPC, not browser access. User Services publish no host ports. HTTPS proxies must forward every path, SSE and WebSocket on the same origin; use a trusted TLS termination entry for Core if required.

Hosted Services share the workbench origin and must be trusted: scripts can use the current user’s UI permissions. Apps must support a dynamic Service URL prefix; old root-path apps, images and packages are not rewritten automatically. Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are sent only through HTTPS entries. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.

Optional [Compose](docker-compose.yml) (2.24+) and the [single-host example](../../examples/single-host/README.md) open the same web application. CLI is an optional advanced tool. See the [operations guide](#terminal-operations) for recovery.

<!-- docker-quickstart:end -->

## Native Linux application

<!-- native-quickstart:start -->

The Docker images already include the unified entry. To run it natively, [build the current source](../../AGENTS.md#构建与验证), then start the Linux program from the repository root; the built executable also works outside the checkout:

```sh
./dist/go/piwork --no-open
```

Data defaults to `piwork/server` in the user configuration directory and the listener to `0.0.0.0:17891`; use the actual IP link printed in the terminal. See `--help` for `--data-dir`, `--listen`, `--public-origin`, `--core-listen` and TLS options.

Open the actual IP address to create the administrator and sign in, with no extra link check. The Agent image is embedded with the server release and used automatically, with no image input or override; create the administrator and configure the model in the browser.

Retain the same `--data-dir` when using a custom data directory. Exiting this program stops managed Works under the Core shutdown contract; closing a browser does not.

If ControlPlane already occupies 17891 on this host, select `--port 17901` for independent Desktop; there is no automatic port change. CLI defaults to Core `http://127.0.0.1:17871`; explicit addresses and saved credentials take precedence and old addresses are not migrated. For an independent client built from this source, run `piwork-cli desktop --no-open` and open `http://desktop.localhost:17891/` in a browser on this computer (use the printed port if customized). The ordinary browser session is established automatically; a saved CLI login is reused, otherwise sign in normally. `piwork-cli desktop open --no-open` is an optional address lookup that issues no authorization. Refresh, a new browser and cleared Cookies all use the same address. A CLI container must publish the local loopback port and retain its state volume; open the printed address in the host browser, without requiring `docker exec ... desktop open`. Desktop and CLI share Core credentials; signing out clears that shared login, while closing the browser does not stop Works.

`piwork-cli` retains its independent Windows/Linux terminal and local Desktop modes; `piwork-console` is a standalone administrator entry and is not required for default startup. The historical [0.0.7 Linux bundle](https://github.com/pphboy/piwork/releases/download/v0.0.7/piwork-linux-amd64-0.0.7.tar.gz) and [experimental Windows CLI 0.0.5](https://github.com/pphboy/piwork/releases/download/v0.0.5/piwork-cli-windows-amd64-0.0.5.exe) do not contain the unified server entry.

<!-- native-quickstart:end -->

## Core Compose Demo

<!-- core-compose-demo:start -->

The optional Compose demo uses its own `/var/lib/piwork/core` directory. Stop an installation using the same ports normally before starting. Set up the administrator and model in the browser.

```sh
PIWORK_CORE_IMAGE=docker.io/pphboy/piwork-core:0.0.9-0901cf119dc1-0e1261f05b9d \
    docker compose -f compose.core.yaml up --detach --wait --wait-timeout 600 core
```

<!-- core-compose-demo:end -->

## Terminal operations

<!-- terminal-operations:start -->

Process health and runtime readiness are separate: the web pages and /healthz work before administrator/model setup, while /readyz remains unready.

```sh
docker exec piwork-core-quickstart piwork-serve --data-dir /var/lib/piwork/quickstart/core --json status
```

CoreRuntime uses the target Core’s embedded release Agent image. Remove `--agent-image` from old `config set` scripts; other model and Key options stay the same. Online operations use the target Core version; offline initialization uses the local server release. Reading or starting after an upgrade preserves the saved Runtime. Explicitly saving adopts the current release for future Work; existing Work stays unchanged.

```sh
docker exec --interactive --tty piwork-core-quickstart piwork-serve --data-dir /var/lib/piwork/quickstart/core config set --model-provider PROVIDER --model MODEL
```

One command starts two independent HTTP services in one process: ControlPlane defaults to `0.0.0.0:17891`, Core to `127.0.0.1:17871`. Browsers use the actual LAN IP on 17891 for all UI, files, events and `/services/<workId>/<serviceId>/<port>/`, without DNS or extra Service ports. The backend and CLI/operator call Core directly. Remote or bridge CLI requires explicit `--core-listen 0.0.0.0:17871` (or a reachable interface) and the appropriate network access; loopback is not reachable from a bridge container. Preserve container-reachable 7172 for internal Agent mTLS RPC, not browser access. User Services publish no host ports. HTTPS proxies must forward every path, SSE and WebSocket on the same origin; use a trusted TLS termination entry for Core if required.

Hosted Services share the workbench origin and must be trusted: scripts can use the current user’s UI permissions. Apps must support a dynamic Service URL prefix; old root-path apps, images and packages are not rewritten automatically. Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are sent only through HTTPS entries. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.

Paths identify the current Work/Service/declared port. Sign in normally after restart and revalidate the target; the old port pool and cross-port grants are removed.

Advanced deployment: `--public-origin` sets the exact public origin (client Forwarded headers are ignored); `--tls-cert` / `--tls-key` serve TLS on the browser entry. The key must be private. A trusted reverse proxy must forward the workbench and /services/ paths, including upgrades, on one origin with a trusted certificate. Model endpoints must be reachable from Work networks.

Optional test bootstrap: only the paired `PIWORK_ADMIN_ACCOUNT` and `PIWORK_ADMIN_PASSWORD` create the first administrator on an empty installation. Synthetic example values: `admin` / `synthetic-test-password`. Existing accounts are retained. Former model and Agent/helper initialization variables are removed; saved models remain usable.

Optional bridge CLI connects to a ready Core; first start the server explicitly with `--core-listen 0.0.0.0:17871` and permit that network. It retains its separate credential volume. Windows/Linux browsers use the web application directly without CLI.

```sh
docker run --rm --init --interactive --tty \
    --add-host host.docker.internal:host-gateway \
    --env PIWORK_CORE_URL=http://host.docker.internal:17871 \
    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client \
    docker.io/pphboy/piwork-cli:0.0.9-0901cf119dc1-0e1261f05b9d
```

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

Read back an unknown write before retrying. Recover the original Operation/Run IDs without creating or sending again:

```sh
piwork-cli operation show OPERATION_ID
piwork-cli run watch WORK_ID RUN_ID --after SEQUENCE
```

Normal shutdown stops this installation’s managed Works and retains IDs, history, volumes and desired state. Closing the browser or CLI does not stop Works.

```sh
docker stop --time 60 piwork-core-quickstart
test "$(docker inspect --format '{{.State.ExitCode}}' piwork-core-quickstart)" = 0
docker start piwork-core-quickstart
```

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Retain the data directory and matching Work volumes; do not use down -v or global prune. Stop the old Core normally before upgrading and reuse `--data-dir`; users and saved models do not need re-entry. Backups need a consistent Core directory and matching Work volumes.

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
