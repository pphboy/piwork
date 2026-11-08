# Piwork FastAPI + htmx base

[简体中文](README.zh-CN.md)

A Linux amd64 application Service environment: Python 3.13, FastAPI + Uvicorn, Jinja2, htmx, Bootstrap 5 CSS, python-multipart, pytest/httpx, pip and SQLite with the sqlite3 CLI. The brain starter supplies the example; the image contains no business application. Agent edits shared workspace files; Python runs in Service. NiceGUI remains the default starter.

## Environment and identity

Exact Python dependencies are in [requirements.lock](requirements.lock); [environment.json](environment.json) fixes the upstream image. [Browser resource identities and licenses](vendor/manifest.json) bind local htmx and CSS. No CDN, npm frontend build, ORM or migration system is needed. Runtime supports UID/GID 10001:10001, a read-only root and a granted writable workspace.

**Published and anonymously verified.** Use the fixed Linux amd64 reference below. [release.json](release.json) records the actual source commit, dirty state, input hash, image ID, registry digest and anonymous runtime result. The bundled brain uses the same fixed reference. `dist/fastapi-htmx-base/candidate.json` retains the local build identity; previous NiceGUI and FastAPI/React records keep their original identities.

```text
docker.io/pphboy/piwork-fastapi-htmx-base:0.1.1-08fc54adda53-291497dc377a-dirty@sha256:2314f5a787a1be0e575c892899e32cb779cacd163d02a137c777e3a0358a1aad
```

## Direct use and starter

Ordinary applications can use their own `python app.py` or Uvicorn command without a Piwork identity. They must bind 0.0.0.0 at the declared Service port. To extend the environment, use `ARG FASTAPI_BASE` followed by `FROM ${FASTAPI_BASE}` and install your own exact dependencies at build time; supply the verified fixed reference as the build argument.

For a Pi-managed app, use the brain [starter](../../../internal/coreassets/piwork-brain/templates/fastapi-htmx/README.md) and its no-overwrite initializer. Set Service command `/usr/local/bin/piwork-fastapi` and args `["run", "--app", "/var/data/workspace/apps/<service-name>"]`. It prepares dependencies, checks a version copy and runs exactly that copy. `prepare`, `check` and `serve` are also available; `serve` requires passed checks. Standard dependencies are inherited, not copied into workspace.

## Editing and persistence

Source and locks live in apps/<service-name>, business data in data/<service-name>. .build/releases holds checked application copies; editing the working source does not change the running copy. Complete the Service update/restart and verify /api/runtime-version and real business results. The corrected starter sends each form once, clears captured input and does not store/restore submissions or automatically retry POST. On failure/timeout it shows error/unconfirmed status and only reads backend state. Navigation/page-version adoption initializes an empty form. Normal state polling preserves unrelated editing input within the current document. The example uses a single Uvicorn worker because Jobs have one process owner.

Hosted URLs use the request's validated /services/<workId>/<serviceId>/<port> prefix. Internal probes and Agent APIs remain /health and /pi/v1. UI and Agent share business state; tokens stay on the backend. Bootstrap CSS supplies appearance, with interaction implemented through native HTML, htmx and plain JS.

Extra exact requirements belong in requirements.in; `run --install-deps` explicitly acquires missing compatible packages in Service. Locks, wheels and .deps stay in the app; subsequent starts reuse or rebuild them offline. Conflicts cannot replace standard packages. System libraries require a derived image. sqlite3 is available in this Service environment; Agent bash has its own separately supplied CLI, not Service Python/pip.

Stop/Start, Service replacement and full Work export/import preserve source, extra dependency materials and data. Import remains stopped until explicit Start. Keep the fixed image available at the destination. Restore code/config with matching dependency records without claiming to roll back business transactions.

## Maintenance and verification

The authority is this repository directory plus ../web-common for shared dependency preparation. Brain templates/references consume its environment. Developer builds require repository Node/Docker tooling; product hosts gain no Python/Node dependency.

```sh
node scripts/lock-fastapi-htmx-base.mjs
make fastapi-htmx-base-image
node --test scripts/build-fastapi-htmx-base.test.mjs
node scripts/check-fastapi-htmx-base.mjs
```

Run commands from the repository root. Local checks do not push images. Explicitly authorized publication uses `node scripts/publish-fastapi-htmx-base.mjs --sdk-report <matching-SDK-result.json> --push`; omit --push for preflight only. It rejects conflicting fixed tags, verifies the exact candidate evidence, and checks anonymous digest pull/run before recording publication. Validation must match the actual candidate image ID/input hash. Broader SDK feedback/import validation uses the existing Core integration runner; targeted runs remain partial results.

[Previous 0.1.0 publication](releases/0.1.0-08fc54adda53-44102ae552dd-dirty.json) retains its original identity and verification facts.
