# Piwork Docker setup

**English** | [简体中文](README.zh-CN.md)

One Linux application serves Core, the full web workbench, administration and first-time setup. CLI remains an independent optional tool.

This release runs application Services without a Piwork memory cap or Service memory reservation. CPU, service/volume counts and Agent/helper memory policy still apply. Legacy Service memoryBytes values remain compatibility history; memoryLimitMode / serviceMemoryPolicy explicitly report unlimited, and zero is not a zero-byte allowance. A normal Core upgrade replaces older capped Service containers through managed recovery and retains workspace data. See [resource and upgrade details](https://github.com/pphboy/piwork/blob/main/openspec/specs/core-service-startup/spec.md) and the [Web base guide](../images/web-base/README.md).

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
    docker.io/pphboy/piwork-core:0.0.16-73dbea6e5c20-102f826ec67a
```

On this computer or another computer, open `http://SERVER_IP:17891` using the server’s actual IP. An empty installation shows Create administrator; an initialized installation shows normal sign-in. No terminal authorization link is required.

Create the administrator with a password and matching confirmation, then sign in to **Quick setup** in Admin (`/admin/setup`). Follow the two-step guide: enter the model ID, API type, Base URL and API Key, or choose a saved model, then select **Save and continue**. This saves the model and binds CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. The Agent image is embedded with the server release and supplied automatically; it has no input, selector or advanced override. Model Test is explicit and optional; saving does not call the model. Open the workbench to create a Work, chat, manage files or open Services. Return through Admin **Overview → Quick setup** to change configuration. The topbar **Workbench** link remains available while preparation finishes; the completion action waits for all components. Saved accounts, models and Works survive restart.

One process serves two HTTP listeners: UI defaults to `0.0.0.0:17891`, Core to `0.0.0.0:17871`. Browsers use only UI, including files, events and `/services/<workId>/<serviceId>/<port>/`; the backend calls Core over fixed loopback HTTP. External Linux CLI connects directly to the server Core port. Change ports only with --ui-port/--core-port. UI accepts actual local IPv4 addresses, localhost, loopback and the machine hostname, validates Host, Origin and CSRF, and ignores Forwarded. Each address needs its own login. HTTP only; no HTTPS, custom domain or reverse proxy configuration. Internal Agent callbacks retain container-reachable mTLS on 7172. User Services publish no host ports. Model endpoints must be reachable from Work networks.

Hosted Services share the workbench origin and must be trusted: scripts can use the current user’s UI permissions. Apps must support a dynamic Service URL prefix; old root-path apps, images and packages are not rewritten automatically. Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are not forwarded through the HTTP entry. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.

Optional [Compose](docker-compose.yml) (2.24+) and the [single-host example](../../examples/single-host/README.md) open the same web application. CLI is an optional advanced tool. See the [operations guide](#terminal-operations) for recovery.

<!-- docker-quickstart:end -->

## Native Linux application

<!-- native-quickstart:start -->

[Build the current source](https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证), then run from the repository root. Released programs also work outside the checkout. Native programs support Linux x86-64 only.

```sh
./dist/go/piwork-core
```

Core includes administration, the workbench and first-time setup. Its only startup settings are `--ui-port` (17891), `--core-port` (17871), and `--data-dir` (piwork/server under the user configuration directory). `--help` and `--version` only display information. Ports must be distinct, within 1–65535 and different from internal RPC 7172. Relative data paths resolve from the working directory.

```sh
./dist/go/piwork-core --ui-port 17991 --core-port 17971 --data-dir /var/lib/piwork/custom/core
```

Choose one startup command. Open the printed HTTP URL, create the administrator, then configure models and runtime in Admin Quick setup. On a headless server, open that address manually. Ctrl+C stops this installation’s managed Works while preserving data, history and desired state; restart with the same data path.

The Linux native client starts Desktop by default and connects to an existing Core. Select another Desktop port when the local Core UI already uses 17891. The client requires no Docker and does not start or stop Core.

```sh
./dist/go/piwork-cli --core http://127.0.0.1:17871 desktop --port 17901 --no-open
```

Open `http://desktop.localhost:17901/` locally. Desktop shares user credentials with terminal commands but has its own default Core preference. Business commands select --core, PIWORK_CORE_URL, saved credentials, then the local default. Closing the browser or CLI does not stop Works. Windows browsers can also access the Linux Core UI.

<!-- native-quickstart:end -->

## Core Compose Demo

<!-- core-compose-demo:start -->

The optional Compose demo uses its own `/var/lib/piwork/core` directory. Stop an installation using the same ports normally before starting. Set up the administrator and model in the browser.

```sh
PIWORK_CORE_IMAGE=docker.io/pphboy/piwork-core:0.0.16-73dbea6e5c20-102f826ec67a \
    docker compose -f compose.core.yaml up --detach --wait --wait-timeout 600 core
```

<!-- core-compose-demo:end -->

## Terminal operations

<!-- terminal-operations:start -->

Process health and runtime readiness are separate: /healthz is available before web setup finishes; /readyz remains unready. Manage users, models, runtime and dependency preparation in embedded Admin. Operator credentials and protected management APIs remain separate from user CLI credentials.

```sh
curl --fail http://127.0.0.1:17891/healthz
docker logs --tail 100 piwork-core-quickstart
```

Core also keeps a private process log in `logs/core/` under its data directory. Each start writes a new `core-<bootId>-<segment>.jsonl` shard; shards rotate at 16 MiB, the installation retains at most 256 MiB for 7 days, and file writes sync about once per second plus on rotation, export boundaries and normal shutdown. Keep the Core data volume mounted to preserve these shards across container replacement. File coverage begins after the installation lock and includes managed diagnostics, performance events, standard application logs and startup/shutdown records. `--help`/`--version`, invalid startup, errors before that lock and native runtime crashes outside the application log writer remain console/stderr only; this is not a complete raw-stderr capture.

Before removing or replacing an Agent or Service instance, Core archives that exact instance's retained stdout/stderr under `logs/works/` in the data directory. Archives are kept for 7 days, up to 512 MiB per Work and 2 GiB per installation, removing the oldest unreferenced archives first. Containers replaced or removed before this release cannot be backfilled; existing containers keep their actual log driver and only new Agent/Service instances use the bounded 16m × 4 json-file policy. Keep the data volume mounted.

Administrators can export Core safe platform logs plus all of their own Work logs from the Linux CLI or the Desktop account menu (**Export logs**). Export never stops or applies a Work. CLI: `piwork-cli --core http://SERVER_IP:17871 login --account admin`, then `piwork-cli --core http://SERVER_IP:17871 logs export --output ./piwork-logs.zip`; recover the original task with `logs show EXPORT_ID` and `logs download EXPORT_ID --output FILE`. Ready archives are kept for 24 hours; partial results keep complete=false and list gaps in manifest.json. Closing the UI panel or interrupting the CLI does not cancel an accepted Core task. The GUI flow requires no commands; download the ZIP and send it manually to a trusted maintainer. This feature does not upload it automatically.

One process serves two HTTP listeners: UI defaults to `0.0.0.0:17891`, Core to `0.0.0.0:17871`. Browsers use only UI, including files, events and `/services/<workId>/<serviceId>/<port>/`; the backend calls Core over fixed loopback HTTP. External Linux CLI connects directly to the server Core port. Change ports only with --ui-port/--core-port. UI accepts actual local IPv4 addresses, localhost, loopback and the machine hostname, validates Host, Origin and CSRF, and ignores Forwarded. Each address needs its own login. HTTP only; no HTTPS, custom domain or reverse proxy configuration. Internal Agent callbacks retain container-reachable mTLS on 7172. User Services publish no host ports. Model endpoints must be reachable from Work networks.

Hosted Services share the workbench origin and must be trusted: scripts can use the current user’s UI permissions. Apps must support a dynamic Service URL prefix; old root-path apps, images and packages are not rewritten automatically. Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are not forwarded through the HTTP entry. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.

Optional test bootstrap: paired PIWORK_ADMIN_ACCOUNT and PIWORK_ADMIN_PASSWORD initialize only the first administrator on an empty installation. Existing accounts are retained. Default setup needs no business environment variables; model and image settings are not read from initialization env.

On the Linux client, select an existing Core address and enter the password interactively. ACCOUNT and WORK_ID come from your account and creation result:

```sh
export PIWORK_CORE_URL=http://SERVER_IP:17871
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

Read back unknown writes and recover original Operation/Run IDs without resubmitting. Files and packages use local client paths, with no exchange volume.

```sh
piwork-cli operation show OPERATION_ID
piwork-cli run watch WORK_ID RUN_ID --after SEQUENCE
```

Normal Core shutdown stops this installation’s managed Works and preserves identities, history, volumes and desired state. Closing a browser or CLI does not stop Core or Works.

```sh
docker stop --time 60 piwork-core-quickstart
test "$(docker inspect --format '{{.State.ExitCode}}' piwork-core-quickstart)" = 0
docker start piwork-core-quickstart
```

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Retain the same Core directory and matching Work volumes. Stop normally and take a consistent backup before upgrading. Keep prior image references and manifests; roll back only with compatible formats. Do not use down -v or global prune. Work exports are not installation backups: Stop before export and explicitly Start after import.

<!-- terminal-operations:end -->