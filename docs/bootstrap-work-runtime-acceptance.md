# Bootstrap Work Runtime acceptance record

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
