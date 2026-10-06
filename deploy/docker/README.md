# Piwork Docker setup

[English](README.md) | [简体中文](README.zh-CN.md)

Start the Core and CLI containers to try Piwork. Core manages the Agent, helpers, Services, networks, and Work volumes. The native CLI remains available separately.

## Requirements

- Core: Linux with a local rootful Docker Engine Unix socket.
- Client: Linux or Windows Docker Desktop in Linux-container mode, with the browser on the client computer.
- Target: `linux/amd64`; Docker Engine 28+ and Compose 2.24+.
- A reachable model provider, its model ID, and an API key. The model endpoint must be reachable from the Linux Core's Work containers. A custom endpoint must use HTTPS.

On Linux, Core and CLI can run on the same computer. Windows clients connect to a reachable Linux Core; this installer does not deploy Core as a Windows container.

## 1. Download and verify 0.0.1 Preview

Use a new directory on each computer. Download the installer and checksum from [the release](https://github.com/pphboy/piwork/releases/tag/v0.0.1). The installer contains configuration templates, not offline images; Docker pulls images from `docker.io/pphboy`.

Linux Bash:

```bash
(
    set -euo pipefail
    mkdir piwork-preview-0.0.1
    cd piwork-preview-0.0.1
    PIWORK_RELEASE_URL=https://github.com/pphboy/piwork/releases/download/v0.0.1
    curl --fail --location --output piwork-docker-0.0.1.tar.gz "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz"
    curl --fail --location --output piwork-docker-0.0.1.tar.gz.sha256 "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz.sha256"
    sha256sum --check piwork-docker-0.0.1.tar.gz.sha256
    tar -xzf piwork-docker-0.0.1.tar.gz
    cd piwork-docker
    sha256sum --check SHA256SUMS
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

The engine must report Linux and amd64/x86_64, Engine 28+ and Compose 2.24+.

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

Paste the complete `desktop open` link into a browser **on the client computer**. It grants local browser access for this Desktop instance; it does not log in to Core. In the login page, enter your Core URL, account, and password. Create and start a Work, then open Chat, Services, or Files.

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
