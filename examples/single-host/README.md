# Single-host deployment

**English** | [简体中文](README.zh-CN.md)

Requires Linux x86-64, rootful Docker Engine 28+ and Compose 2.24+. The default starts only the unified application container; initialize in the browser without business environment variables. CLI uses an explicit optional profile.

Uses its own `/var/lib/piwork/examples/single-host/core` directory. Stop conflicting installations first, preserving their data.

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

```sh
docker compose -f docker-compose.yml logs core
```

Open the private setup link from the logs, create the administrator with password confirmation, sign in to Admin **Quick setup** (`/admin/setup`), enter or choose a model, then select **Save and continue** to save the model and CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. Return through **Overview → Quick setup** to change configuration, or use the topbar **Workbench** link to return. The release supplies the Agent image automatically, with no image input or advanced override. If the link expires:

```sh
docker compose -f docker-compose.yml exec -T core piwork-serve --data-dir /var/lib/piwork/examples/single-host/core setup link
```

The server listens on `0.0.0.0:7171` by default. Local or remote computers open `http://SERVER_IP:7171` using its actual non-loopback IP. A local network is sufficient; no public IP is required. Allow TCP 7171 for the main site and TCP 17891–17954 for Service entries (override with `--service-ports`); 7172 is internal Agent RPC, not a browser port. Piwork proxies these ports; user containers are not published directly. Opening only the main port leaves the workbench usable but Services unreachable. No domain, DNS or local proxy is required. HTTP is unencrypted; configure HTTPS explicitly for untrusted networks and expose/proxy both the main site and every Service entry port.

Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are sent only through HTTPS entries. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.

Optional CLI: run after Core is fully ready; its own volume retains credentials. Exiting CLI does not stop Works.

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
