# Work service reference

The service MCP server exposes `deployment_context`, `service_create`, `service_list`, `service_get`, `service_update`, `service_start`, `service_stop`, `service_restart`, `service_remove`, `service_retry`, `operation_get`, and `service_logs`. In the model tool list they use the provider-safe `work-services__<tool>` form, such as `work-services__service_create`. Core policy and readiness metadata retain the canonical `work-services.<tool>` name.

Use `/var/data/workspace` as the workspace mount target. A service can receive it read-only or read-write. A mount-free image-native service must use `/` as its working directory. `service_remove` removes the runtime and desired service while retaining the shared Work workspace.

Dependencies installed at runtime must use a reproducible command and a cache or environment below the workspace. Prefer images that already contain the required runtime. Store mutable application data below `data/<service-name>`.


Web base command: `/usr/local/bin/piwork-web run --app /var/data/workspace/apps/<service-name>` with the single `web` TCP port 8080 and HTTP `/health` readiness. Its checked build and actual running backend/frontend versions determine delivery; after edits use the stable Service update/restart path and original Operation, then query the new business result. `dev` is explicit and supports frontend HMR/backend reload. Never claim a file save or a user refresh completes deployment.

Service memory is unlimited; `memoryBytes` is a deprecated compatibility value. `deployment_context.serviceMemoryPolicy=unlimited` is explicit, while legacy total/availableMemory fields describe non-Service budgets. CPU/service/volume quotas still apply. sqlite3 in SDK bash uses the Agent image, not a binary inside the Service. Keep code and databases in the granted workspace and use normal Action/Query APIs for business operations.

Initialize a new standard application with the `initialize.mjs` beside the loaded deployment Skill, using Agent Node and authorized bash: `node <loaded-skill-directory>/initialize.mjs --template web-app --name <service-name>`. Existing targets, including empty directories/files/links, are refused before writes. Initialization creates the Spec before other template files; read/update it before implementing business changes. Do not first write SPEC.md or use mkdir/cp to bypass this guard. A failed initializer must not proceed to a Service mutation.
