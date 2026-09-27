# Copy and share a Work

A `.work` file is one full, cold copy of a Work. It includes the two managed volumes, code and development environment stored in them, Work-owned contexts, Skills and Pi packages with prepared dependencies, AGENTS.md, configuration revisions, services (including disabled or tombstoned records), desired resource reservations, volume references, terminal control history, private Session/Run history, and immutable container images. Export does not filter files or content. User-written secrets in `.env`, databases, source code, or history therefore travel with the file.

## Export

Stop the Work first; export never stops it for you:

```sh
piwork-cli work stop <workId> --wait
piwork-cli work export <workId>
```

The default output is `<workId>.work` in the current directory; use `--output demo.work` if preferred. The destination must not exist. The CLI saves a complete, verified file with mode `0600`; it never writes package bytes to stdout or overwrites a destination. Keep the resulting file private, and share it only with a trusted recipient. If export observation times out, the Operation continues on Core. Keep the printed `snapshotId` and retrieve the ready package later:

```sh
piwork-cli operation show <operationId>
piwork-cli work snapshot download <snapshotId> --output demo.work
```

The Core retains a ready package for 24 hours. Its status remains available through `work-snapshots/:snapshotId`, but a file past its retention deadline cannot start a new download. Your already downloaded `.work` file does not expire.

## Inspect and import

Inspect works offline, without login or network access:

```sh
piwork-cli work package inspect <workId>.work
```

Inspect hashes and validates the whole package, including each Pi package tree and its content digest, and displays only a safe summary with package names/versions and platform requirements. It does not open embedded SQLite databases or execute package code. `integrityVerified: true` does not mean that the recipient platform has validated the private history or installed the Work; upload and import revalidate independently.

The target Core automatically selects an enabled model matching the package's provider, model, and base URL, with a readable target credential. It does not copy the source model key or silently choose an unrelated default. If no match exists, configure one on the target Core and import again. Custom external MCP servers that require platform-managed secret references cannot yet be imported; the error `EXTERNAL_MCP_SECRET_UNAVAILABLE` is raised before a Work is created. Built-in `work-services` does not need such a secret and is reconnected to the target Core at first start.

```sh
piwork-cli work import <workId>.work --wait
piwork-cli work start <newWorkId> --wait
```

Import creates a new Work owned by the logged-in recipient and leaves it stopped. By default it uses the package's source name, adding `-2`, `-3`, and so on if needed; use `--name` to request a specific available name. The result includes the final name. It does not change or overwrite another Work, start containers, create a network/TLS identity, run service code, or restore the source installation's platform credential. A second import creates an independent copy with new Work/context/service/Operation IDs and new volumes. All retained Pi packages, including disabled, historical, and pending versions, come from the `.work` bytes; import does not consult the recipient Core catalog or reinstall from npm/Git/local/ZIP sources. The first explicit start uses the retained active context if one exists; a pending desired context remains pending until apply. Sessions and Runs in the private history remain available after import; their local Session/Run IDs are retained.

`--wait` observes import for at most 120 seconds. Without it, the command returns the accepted `operationId` immediately. On observation failure, retry `piwork-cli operation show <operationId>`; do not resubmit the package with a new idempotency key merely because it is slow. Import never starts the Work automatically.

The durable Work boundary is the two managed volumes and Work-owned platform records above. Container temporary writable layers and anonymous Docker volumes are not exported. Files stored outside the Work's managed paths are not magically part of a Work. See [package format](work-package-format.md) for technical details and [operations](operations.md#work-snapshot-operations) for helper, cleanup, and rollback procedures.
