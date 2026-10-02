# Bootstrap Work Runtime acceptance record

> 历史 TS Core 验收记录。下列 npm 命令及结果适用于迁移前的实现，不是当前 Go 平台的测试入口或验收证据。当前命令见 [测试说明](testing.md)，Go 迁移进度见 [验收记录](go-migration-acceptance.md)。

The repeatable acceptance entry point is `npm test` followed by `npm run test:integration`. The suite uses temporary SQLite directories and Docker labels scoped by `installation_id`; it never invokes a global Docker cleanup.

The covered path is bootstrap administrator, authenticated Work ownership, immutable configuration revisions, Work start/stop recovery, persistent agent sessions and Runs, MCP/Skill isolation, service create/update/disable/restart/remove, quota reservation, retained volumes, and cross-owner authorization. Failure fixtures cover model/runtime failures, readiness failure, required/optional MCP behavior, stale cursors, and interrupted operations.

Recovery checks are intentionally restart-safe: pending operations are scanned from SQLite, service definitions remain in `service_revisions`, tombstoned services remain addressable for cleanup, and stopped Works are not implicitly started. Transport errors are reported separately from a business Run terminal result.

For a clean verification run:

```sh
npm run typecheck
npm run build
npm test
npm run test:integration
openspec validate --change bootstrap-work-runtime --strict
```
