# Python HTTP service

Write `apps/demo/server.py` with `http.server.ThreadingHTTPServer(("0.0.0.0", 8000), Handler)`. Store the counter in `/var/data/workspace/data/demo/counter.json` using an atomic temporary-file rename.

Create the service with an available Python image, command `python3`, args `[/var/data/workspace/apps/demo/server.py]`, a read-write workspace mount, TCP port `http:8000`, and HTTP readiness path `/health`. After the create Operation succeeds, request `http://svc-demo:8000/` from the Work and confirm the counter changes. Stop and start the Work, then confirm the same counter data remains.
