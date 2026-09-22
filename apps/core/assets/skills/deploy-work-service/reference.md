# Work service reference

The service MCP server exposes `deployment_context`, `service_create`, `service_list`, `service_get`, `service_update`, `service_start`, `service_stop`, `service_restart`, `service_remove`, `service_retry`, `operation_get`, and `service_logs`. In the model tool list they use the provider-safe `work-services__<tool>` form, such as `work-services__service_create`. Core policy and readiness metadata retain the canonical `work-services.<tool>` name.

Use `/var/data/workspace` as the workspace mount target. A service can receive it read-only or read-write. A mount-free image-native service must use `/` as its working directory. `service_remove` removes the runtime and desired service while retaining the shared Work workspace.

Dependencies installed at runtime must use a reproducible command and a cache or environment below the workspace. Prefer images that already contain the required runtime. Store mutable application data below `data/<service-name>`.
