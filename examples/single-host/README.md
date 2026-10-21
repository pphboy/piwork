# Single-host deployment

**English** | [简体中文](README.zh-CN.md)

Requires Linux x86-64, rootful Docker Engine 28+ and Compose 2.24+. The default starts only the unified application container; initialize in the browser without business environment variables. Use the Linux native CLI as the client.

Uses its own `/var/lib/piwork/examples/single-host/core` directory. Stop conflicting installations first, preserving their data.

This published image includes direct browser entry and web setup.

```sh
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Open `http://SERVER_IP:17891` directly, create the administrator with password confirmation, sign in to Admin **Quick setup** (`/admin/setup`), enter or choose a model, then select **Save and continue** to save the model and CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. Return through **Overview → Quick setup** to change configuration, or use the topbar **Workbench** link to return. The release supplies the Agent image automatically, with no image input or advanced override. No extra authorization link is required.

One process serves two HTTP listeners: UI defaults to `0.0.0.0:17891`, Core to `0.0.0.0:17871`. Browsers use only UI, including files, events and `/services/<workId>/<serviceId>/<port>/`; the backend calls Core over fixed loopback HTTP. External Linux CLI connects directly to the server Core port. Change ports only with --ui-port/--core-port. UI accepts actual local IPv4 addresses, localhost, loopback and the machine hostname, validates Host, Origin and CSRF, and ignores Forwarded. Each address needs its own login. HTTP only; no HTTPS, custom domain or reverse proxy configuration. Internal Agent callbacks retain container-reachable mTLS on 7172. User Services publish no host ports. Model endpoints must be reachable from Work networks.

Hosted Services share the workbench origin and must be trusted: scripts can use the current user’s UI permissions. Apps must support a dynamic Service URL prefix; old root-path apps, images and packages are not rewritten automatically. Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are not forwarded through the HTTP entry. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.

An optional Linux native client connects to the existing Core. Exiting the client leaves Core and Works running:

```sh
piwork-cli --core http://SERVER_IP:17871 desktop --port 17901
```

```sh
docker compose -f docker-compose.yml stop core
docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core
```

Normal shutdown preserves users, models, Work IDs, history and volumes. Do not use down -v or global prune. See the [installation guide](../../deploy/docker/README.md#terminal-operations).
