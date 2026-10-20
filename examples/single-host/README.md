# Single-host deployment

**English** | [简体中文](README.zh-CN.md)

Requires Linux x86-64, rootful Docker Engine 28+ and Compose 2.24+. The default starts only the unified application container; initialize in the browser without business environment variables. CLI uses an explicit optional profile.

Uses its own `/var/lib/piwork/examples/single-host/core` directory. Stop conflicting installations first, preserving their data.

This published image includes direct browser entry and web setup.

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Open `http://SERVER_IP:17891` directly, create the administrator with password confirmation, sign in to Admin **Quick setup** (`/admin/setup`), enter or choose a model, then select **Save and continue** to save the model and CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. Return through **Overview → Quick setup** to change configuration, or use the topbar **Workbench** link to return. The release supplies the Agent image automatically, with no image input or advanced override. No extra authorization link is required.

One command starts two independent HTTP services in one process: ControlPlane defaults to `0.0.0.0:17891`, Core to `127.0.0.1:17871`. Browsers use the actual LAN IP on 17891 for all UI, files, events and `/services/<workId>/<serviceId>/<port>/`, without DNS or extra Service ports. The backend and CLI/operator call Core directly. Remote or bridge CLI requires explicit `--core-listen 0.0.0.0:17871` (or a reachable interface) and the appropriate network access; loopback is not reachable from a bridge container. Preserve container-reachable 7172 for internal Agent mTLS RPC, not browser access. User Services publish no host ports. HTTPS proxies must forward every path, SSE and WebSocket on the same origin; use a trusted TLS termination entry for Core if required.

Hosted Services share the workbench origin and must be trusted: scripts can use the current user’s UI permissions. Apps must support a dynamic Service URL prefix; old root-path apps, images and packages are not rewritten automatically. Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are sent only through HTTPS entries. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.

This example explicitly binds Core to `0.0.0.0:17871` for the optional bridge CLI; restrict the reachable network as needed. Optional CLI: run after Core is fully ready; its own volume retains credentials. Exiting CLI does not stop Works.

```sh
docker compose -f docker-compose.yml run --rm --no-deps cli
```

```sh
piwork-cli login --account ACCOUNT
piwork-cli work create --name 'My Work' --wait
```

```sh
piwork-cli chat WORK_ID --message 'Hello, Piwork!'
```

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Normal shutdown preserves users, models, Work IDs, history and volumes. Do not use down -v or global prune. See the [installation guide](../../deploy/docker/README.md#terminal-operations).
