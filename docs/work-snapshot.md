# Copy and share a Work

A `.work` file is one full, cold copy of a Work. It includes the two managed volumes, code and development environment stored in them, Work-owned contexts, Skills and Pi packages with prepared dependencies, AGENTS.md, configuration revisions, services (including disabled or tombstoned records), desired resource reservations, volume references, terminal control history, private Session/Run history, and immutable container images. Export does not filter files or content. User-written secrets in `.env`, databases, source code, or history therefore travel with the file.

## Export

Stop the Work first; export never stops it for you. The same CLI proxy can transfer the running Work's `/var/data/workspace` through `http://127.0.0.1:17890/works/<workId>/files/`. Stop closes file admission and waits for file helpers to exit and clean their precise temporary files. Export checks the file journal and actual helper containers again; a pending upload or unconfirmed cleanup blocks export even when Work metadata says stopped. Restore Docker and use `work stop` or `work retry` to resume cleanup. WebDAV's method subset does not reduce the existing `.work` export scope; see [Work file access](work-files.md).

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

The durable Work boundary is the two managed volumes and Work-owned platform records above. Container temporary writable layers and anonymous Docker volumes are not exported. Files stored outside the Work's managed paths are not magically part of a Work. See [package format](work-package-format.md) for technical details and [operations](operations.md#证书恢复和退出) for helper, cleanup, and rollback procedures.

## Native Go Core implementation

The migration implementation uses the Go Core and a separate native `piwork-snapshot-helper` image. Core talks directly to the selected local Unix Engine API. It does not run Docker CLI, Node, Python, SQLite CLI, or a TS snapshot helper on the host. The helper is a bounded container with only the recorded job mounts; it copies archive bytes and rebuilds managed schema-4 history without executing imported programs. Pi Agentd and its SDK continue to run inside the imported Agent image after explicit Start.

Core independently validates the full package and the embedded Agent image's native Service MCP and package helper, Node ABI, Pi SDK version, architecture, and protocol. An image containing only the previous TS platform helpers returns `PACKAGE_INCOMPATIBLE`; import never replaces an incompatible image or extends V1. An offline inspect reports `integrityVerified: true` and `installationValidated: false`, regardless of the target installation's credentials and quota.

The HTTP sequence is: explicit Work Stop and confirmed stopped Operation → `POST /api/v1/works/<workId>/exports` → observe its Operation → full `GET /api/v1/work-snapshots/<snapshotId>/content` → offline inspect → full `POST /api/v1/work-packages` → `POST /api/v1/work-imports` → observe the stopped imported Work → explicit Work Start. Upload and download use complete bodies, declared size and SHA-256; snapshot content rejects every Range request with 416. Transfer failure preserves the original snapshot receipt; retry starts from byte zero with that receipt, without submitting another export.

Snapshot Operations, including failed imports whose Work was never published, are visible only to the task owner. Imported terminal Operations are safely queryable using their new IDs; `GET /api/v1/works/<workId>/import-provenance` returns the package digest, import Operation, and historical ID map. These history records never enter an execution queue. An active import or transfer lease prevents GC from deleting package bytes. Cleanup uses exact recorded installation/Work/job identities, preserves shared images and unknown files, and retains reservations when resource absence cannot be confirmed.

Native acceptance (the CLI migration has its own later gate):

```sh
bash scripts/build-go.sh
TMPDIR="$HOME/.cache/piwork-native-tests" \
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance \
CGO_ENABLED=0 go test -mod=readonly -tags=integration ./internal/coreapp \
  -run 'TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations|TestNativeCoreSnapshotJobsRecoverAcrossActualProcessCrashes' \
  -count=1 -v -timeout=20m
```

The first test executes the sequence above with two independent installations, takes the source offline, continues a real SDK Session, calls the target Go MCP, and re-exports the imported Work. The second uses actual Core subprocess SIGKILL boundaries and a final SIGTERM; production has no fault-injection endpoints. See [migration acceptance](go-migration-acceptance.md) for the recorded runs and incomplete later gates.

## 多供应商模型绑定

导入使用目标 Core 已启用供应商的模型及目标 Key，按接口、Model ID、规范化端点和能力描述匹配；源供应商 ID、API Key 和执行授权不迁移。缺少匹配默认模型时返回 TARGET_MODEL_UNAVAILABLE。多个目标供应商使 Session 偏好有歧义时，保留历史和 Thinking，由所有者显式重选。新增可选模型能力描述由支持它的读取器严格校验，旧读取器明确拒绝未知字段。见 [多供应商模型](ai-models.md)。

模型配置现在按单条模型独立管理，不需 Provider 或能力 JSON。未知 Model ID 可按指定协议普通执行，其 `thinkingLevel:null` 表示未请求额外 Thinking，与旧记录缺省 Off 不同；Go/TS 历史校验、快照/helper 和跨安装重绑定保留该事实。公开 Chat 通过版本 3 协商 nullable 行为；旧读取器不支持时明确拒绝，需升级后导入，不能把 null 改成 Off。源模型身份、Key 和在途授权不随包复制。
