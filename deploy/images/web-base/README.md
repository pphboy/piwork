# Piwork NiceGUI base

**English** | [简体中文](README.zh-CN.md)

A reusable Python 3.13 + NiceGUI + SQLite environment for application Services. Agent edits the shared Work workspace; Core runs the application in a separate Service. Standard packages and browser resources are already installed in the image. Applications need no npm install, frontend build, or copy of the standard Python environment.

## Browser Service paths

The current source candidate supports `/services/<workId>/<serviceId>/<port>/` on the ControlPlane origin (default port 17891). Core 17871 is used by the backend and CLI. This path support requires a rebuilt base candidate; the published release record below retains its actual older identity.

NiceGUI already uses the validated `X-Forwarded-Prefix` for its own links, resources and Socket.IO. Keep `ui.link` and framework download paths application-relative; do not prefix them twice. For custom Python HTML/resources use `browser_url(request, '/path')` from `piwork_web_runtime`. After `page_head(ui, loaded)`, custom browser fetches use `window.piworkAppURL('/path')`. The runtime helper scopes drafts and feedback by browser session and Service target. Internal `/health` and `/pi/v1` continue at the container root.

Hosted Services share the workbench origin and must be trusted: their scripts can act with the current user's UI permissions. Server-response Cookies remain partitioned by session/Service/port; JavaScript Cookie access is not synchronized. Old root-path applications must be explicitly adapted. Import preserves captured images, source and data; it neither rewrites URLs nor upgrades the base automatically. Independent CLI Desktop retains its own root entry.

## Availability and identity

The current source defines environment contract **2**, version series **0.2.0**, Python **3.13.16**, NiceGUI **3.18.0**, pip **26.2.1**, and sqlite3 CLI **3.40.1-2+deb12u2**, initially for Linux amd64. Exact standard dependencies are in [requirements.lock](requirements.lock); [environment.json](environment.json) fixes the upstream Python image. The built read-only manifest also records installed packages and the actual input hash.

<!-- web-base-reference:start -->
**Published and anonymously verified.** `docker.io/pphboy/piwork-web-base:0.2.0-5818e1de7bb5-6b6f6f8bbf62-dirty@sha256:c85c9928549f5b6a58dd519bbf1840fe83e52b9da22eaae556f7aca64b448098` is the fixed Linux amd64, contract-2 base. [release.json](release.json) records the actual build commit/dirty flag, input hash, image ID and registry digest; the bundled brain uses this verified reference. `dist/web-base/candidate.json` retains the local build identity. The previous FastAPI/React release remains in [the historical release record](releases/fastapi-react-0.1.0.json).
<!-- web-base-reference:end -->

## Use in a Work

For a new Pi-managed application, invoke `node <loaded-skill-directory>/initialize.mjs --template web-app --name <service-name>` through authorized **Agent bash**. `workstation` selects the feedback/export example. The initializer rejects every existing target before writes, creates SPEC.md first and copies an editable application into `apps/<service-name>`. Maintain existing applications with targeted edits; do not initialize them again.

Use an actual verified image reference, explicit read/write workspace grant, command `/usr/local/bin/piwork-web`, args `["run", "--app", "/var/data/workspace/apps/<service-name>"]`, TCP port 8080 named `web`, and HTTP `/health` readiness. Source, checks and temporary files stay under the app; business data stays in `data/<service-name>`. Core injects interaction identity and CA at `/etc/piwork/interaction`; they never enter browser JavaScript or source.

The same base can run an ordinary NiceGUI script with its own `python app.py` command, or be extended with `FROM`. It contains no Todo/review business application and requires no Pi identity for an ordinary script. Pi-managed templates use the existing Service protocol.

## Commands and adopting changes

Inside the **Service base**, in the application directory:

```sh
piwork-web prepare
piwork-web check
piwork-web serve
piwork-web run
piwork-web dev
```

`prepare` selects the standard or prepared extra environment. `check` runs Python source/application checks. `run` prepares, runs missing/mismatched checks and serves; identical input reuses valid checks on restart. `serve` refuses unmatched checks. `dev` explicitly enables Python reload. There is no separate frontend build command.

After editing, Pi completes necessary checks and the original Service update/restart, then verifies the actually running codeVersion and business result. The template adopts ready versions automatically, restores its supported nonsecret Todo-title draft and current path, and re-reads shared business state. Failed checks, temporary disconnection and unchanged versions do not cause reload loops. These actions do not Apply brain/Work configuration.

The application exposes safe versions at `/api/runtime-version`: codeVersion binds source/configuration, extra dependency locks and the actual base environment; frontendVersion binds Python page/resources, locks and environment. A writable marker does not change the process's loaded version.

The default page inputs are `app.py`, `ui.py`, `page-client.js` and `style.css` when present. Extend them with app-relative helper/resource paths in `page-files.json`:

```json
{"files": ["pages/header.py", "assets/theme.css"]}
```

Maintain this list and the application Spec when splitting pages or adding/removing resources. Effective paths are sorted and deduplicated; changing a listed file or the effective set changes frontendVersion, while independent business changes leave it stable. Missing/invalid files, escaping paths and symlinks fail checks/startup. Keep business modules, data, caches and dependency environments out of the list. Existing apps without a manifest retain the default page inputs.

## Additional Python packages

Put exact **additional** pins in the app's `requirements.in`, for example `package-name==1.2.3`, or a local wheel path below the app. Explicit preparation may acquire compatible packages from a reachable registry:

```sh
piwork-web prepare --install-deps
```

For Agent-driven installation, Pi writes the declaration and uses the existing Service command/Operation with `run --install-deps`; Agent bash itself has no Python/pip, and does not use Docker exec/build. Once prepared, the same input never re-downloads, including when the Service definition retains that flag.

Extra packages are installed with pip into a writable, versioned `.deps/` environment which inherits standard packages. `requirements.lock`, validated wheels, and the active environment record are retained. Checks, the application and installed console scripts use the selected interpreter. The installer does not upgrade fixed base packages; conflicts, unavailable system libraries, download or integrity failures are reported and preserve the previous valid environment and data. Standard applications create no full venv/node_modules. Removing an extra environment or moving an app allows exact offline reconstruction from retained materials, with the matching base available.

System libraries or changes to the base package versions belong in a derived image. At build time, a downstream Dockerfile can switch to root to install fixed dependencies, then return to `USER 10001:10001`. Applications using the version adapter must bind their derived environment manifest to their actual build inputs; do not advertise a modified environment using the unchanged base manifest.

Build with `docker build --build-arg NICEGUI_BASE=<verified-fixed-reference> -t my-nicegui-app:local .`, providing your own app and complete hashed requirements.lock. A verified local candidate is valid for this local development build; use a published fixed digest for distribution.

```dockerfile
ARG NICEGUI_BASE
FROM ${NICEGUI_BASE}
USER 0:0
COPY requirements.lock /opt/my-app/requirements.lock
RUN python -m pip install --require-hashes -r /opt/my-app/requirements.lock
COPY app.py /opt/my-app/app.py
USER 10001:10001
CMD ["python", "/opt/my-app/app.py"]
```

## Persistence, identity and sqlite3

The runtime uses UID/GID **10001:10001**, a read-only root filesystem and only its granted workspace for writable HOME/TMPDIR/cache/dependencies. Stop/Start and Service replacement retain source, locks and data. Full Work export/import retains extra installation materials; import produces a stopped Work, and the user explicitly starts it. The fixed base image must be available on the destination. Existing Work packages/applications/images are not automatically converted.

Both Agent and the base provide the real sqlite3 CLI. AI bash runs in Agent; a Service-only command is not evidence that Agent can execute it. Ordinary business changes still use the named Query/Action contract.

```sh
sqlite3 -readonly -json /var/data/workspace/data/<service-name>/workstation.sqlite 'SELECT name FROM sqlite_master WHERE type="table";'
```

Application Services have no Piwork memory cap/reservation; deprecated memoryBytes is compatibility history, not an available budget. CPU and count admission still apply. See [operations](../../../openspec/specs/core-service-startup/spec.md).

## Maintain, validate and publish

The authority is this repository directory. Brain templates/references consume it; `dist/web-base/` contains ignored local outputs; DockerHub holds published artifacts. Developer image checks require Docker Engine/CLI and the repository's Node tooling; product hosts gain no Python/Node/sqlite3 dependency.

```sh
node scripts/lock-web-base.mjs
make web-base-image
node scripts/test-web-base-tools.mjs
node scripts/check-web-base.mjs
node scripts/check-web-base.mjs dist/web-base/candidate.json web-app
node scripts/check-web-base-dependencies.mjs
node scripts/check-web-base-core.mjs
```

Real Core/SDK/browser checks also need the compatible acceptance Agent/helper images and built Go programs described in [testing](../../../AGENTS.md#构建与验证). Tests use unique installation/fixture labels and only clean their own resources. Preparation/start/restart, workspace/snapshot sizes and complete sharing are measured separately; a timeout budget is not a measured performance result.

Local build/validation does not push. Publication uses `scripts/publish-web-base.mjs` only after explicit release authorization, validates the exact current candidate and evidence, rejects conflicting remote tags, and verifies anonymous digest pull/run before updating the formal brain reference. Old commit/dirty/input/digest identities remain unchanged.
