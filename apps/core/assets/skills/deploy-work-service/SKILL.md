---
name: deploy-work-service
description: Deploy a durable application service into the current Work when the user asks to keep a server or background process running.
---

# Deploy a Work service

Use this Skill when the user wants an application to keep running after the current turn.

1. Call `work-services__deployment_context` to confirm the current Work and writable persistent workspace.
2. Put program files below `/var/data/workspace/apps/<service-name>` and business data below `/var/data/workspace/data/<service-name>`. Read back critical files before deployment. Do not depend on the container writable layer or `/tmp` for persistent data.
3. Use an existing runtime image. Do not request a Docker build, Dockerfile, host mount, host port, privileged mode, or Docker socket.
4. Bind network servers to `0.0.0.0`. Declare the internal port and a readiness probe. Other processes in this Work use `svc-<service-name>`. Call `work-services__service_create` with a stable idempotency key and reuse the same key and payload if the reply is lost.
5. Poll `work-services__operation_get` and `work-services__service_get` until the service is ready or failed. On failure, call `work-services__service_logs` and report its safe diagnostic.
6. Verify the endpoint from the Work. Explain that `service_stop` disables future restoration, while stopping the Work preserves enabled state and restores the service when the Work starts.

See [reference.md](reference.md) for the request shape and [examples/python-http.md](examples/python-http.md) for a Python standard-library example.
