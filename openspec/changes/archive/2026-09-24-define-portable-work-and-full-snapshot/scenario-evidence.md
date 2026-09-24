# Scenario evidence — 2026-09-24

This maps all 81 delta-spec scenarios to executable evidence. `acceptance` means `scripts/work-snapshot-acceptance.mjs` against the local classic Docker `overlay2` store. Test names below identify the relevant assertions; several scenarios deliberately combine unit coverage of a failure boundary with the normal end-to-end path. Containerd image-store daemon validation and 2 GiB stress are outside this change's agreed completion gate. The current private `first.work` was fully inspected offline (v1, 3 contexts, 1 service, 3 images, two model requirements, no external MCP secret requirements) and then successfully imported into an isolated temporary Core with matching model catalog credentials; it was never started or sent to the user's live Core. Final verification: `npm run build`, `npm run typecheck`, `npm test`, the full Docker `npm run test:integration` (2+6+8 passed, zero skipped), acceptance, `git diff --check`, and strict OpenSpec validation passed.

## agent-conversation (CONV-SNAPSHOT-001)

| Scenario | Evidence |
| --- | --- |
| Continue a copied Session | acceptance continues the same Session in both imported Works; `packages/work-store/src/snapshot.test.ts` rebuilds independent histories. |
| Keep a completed tool call historical | `apps/core/src/work-snapshots/metadata.test.ts` preserves opaque terminal operations without scheduling them; `apps/core/src/work-snapshots/access.test.ts` proves archived kinds are read-only; acceptance does not run an imported operation. |
| Reject hostile history metadata | `packages/work-store/src/snapshot.test.ts` rejects schema, Work scope and escaped SDK paths; `apps/snapshot-helper/src/history.test.ts` enforces these checks at upload. |
| Preserve an old context mismatch | `packages/work-store/src/snapshot.test.ts` keeps context identity; `apps/agentd/src/sessions.test.ts` rejects continuing a Session under a different active context; acceptance retains active A/desired B until apply. |
| Preserve an uninitialized empty history | acceptance exports/imports active-null Work without Work SQLite, then starts it; `apps/snapshot-helper/src/history.test.ts` and `packages/work-store/src/snapshot.test.ts` distinguish the valid all-absent case from orphan sidecars. |
| Keep native control history without replay | `apps/core/src/work-snapshots/metadata.test.ts` tests opaque request/result/error, unknown kind, create-work and re-export; `apps/core/src/work-snapshots/access.test.ts` tests safe projection and no scheduling. |

## control-cli (CLI-SNAPSHOT-001/002)

| Scenario | Evidence |
| --- | --- |
| Export and share | `apps/cli/src/work-snapshot.test.ts` verifies one completed export, 0600 package and no intermediate stdout; acceptance runs compiled CLI against the source Core with its own user credential, verifies the default `<workId>.work` path, 0600, complete package digest and size, then carries that file to a separate Core. |
| Do not overwrite a destination | `apps/cli/src/work-snapshot.test.ts` tests existing, raced and symlinked destinations, digest failure and retry; acceptance rejects a second default-path export before another Operation is accepted. |
| Inspect without login | `apps/cli/src/work-snapshot.test.ts` runs compiled offline CLI without credentials or network; `packages/work-package/src/codec.test.ts` verifies safe complete inspection. |
| Import an ordinary Work with only its file | `apps/cli/src/work-snapshot.test.ts` submits a verified v1 package with no name/bindings and checks the returned name; `apps/core/src/application/snapshot-http.test.ts` accepts the same request shape; acceptance uses compiled CLI `work import <file> --wait` against a distinct target Core with no name/bindings, checks the successful Operation, source name, stopped/no container/network/TLS, then explicitly starts and continues service and Session. It separately imports the available local `first.work` into an isolated Core without starting it. |
| Export without an output option | `apps/cli/src/work-snapshot.test.ts` checks ResourceId validation and the `<workId>.work` default before any file write; its export/download tests cover safe verified publication. |
| Recover after wait timeout | `apps/cli/src/work-snapshot.test.ts` uses a fake clock to verify export exit 5, retained snapshot ID and recovery command; `apps/core/src/work-snapshots/admission.test.ts` verifies replay does not recapture. |
| One JSON result | `apps/cli/src/work-snapshot.test.ts` tests completed export's only stdout object. |
| Preserve service boundary | `apps/cli/src/main.test.ts` and service CLI regressions reject service create/update; `npm test` runs both. |

## portable-work (PWORK-001..004)

| Scenario | Evidence |
| --- | --- |
| A self-contained Work | acceptance restores context, services, image and both volumes into independent installations without the source registry; `apps/core/src/work-snapshots/capture.test.ts` verifies the package closure. |
| Reject missing or unknown structure | `packages/contracts/src/portable-work.test.ts` and `packages/work-package/src/codec.test.ts` reject absent/dangling fields and unsupported versions. |
| Reject an incomplete reservation graph | `packages/contracts/src/portable-work.test.ts` checks missing/extra/duplicate reservations; `apps/core/src/work-snapshots/metadata.test.ts` checks source rows. |
| Reject an incomplete storage graph | `packages/contracts/src/portable-work.test.ts` checks two roles and service keys; `apps/core/src/work-snapshots/metadata.test.ts` rejects missing/extra source volumes and consumers. |
| Preserve development and business state | acceptance runs retained `.venv`, `node_modules/.bin`, HOME tool and business SQLite and continues a Session without reinstall. |
| Platform credentials are not transferable authority | `apps/core/src/work-snapshots/metadata.test.ts` excludes platform material, `apps/core/src/work-snapshots/bindings.test.ts` uses recipient credentials; acceptance preserves a user token file and creates new runtime identity only on start. |
| Preserve historical definitions | `apps/core/src/work-snapshots/metadata.test.ts` and `publish.test.ts` retain revisions, tombstones and terminal failures; acceptance checks a tombstone does not revive. |
| Preserve a reservation after failed disable | `apps/core/src/work-snapshots/metadata.test.ts` captures actual desired budget; acceptance checks disabled/tombstone reservation through import and re-export. |
| Export an imported Work again | acceptance imports to a third Core and checks code, Session, business state, reservation and references; `apps/core/src/work-snapshots/metadata.test.ts` checks old plus new opaque history. |
| Import without the original registry | acceptance deletes the source service image before target import and still starts the service; `packages/runtime-docker/src/images.integration.ts` checks image identity and tag preservation. |
| Do not fabricate absent history | `apps/core/src/work-snapshots/metadata.test.ts` preserves unresolved service revision references; `apps/core/src/work-snapshots/preflight.test.ts` rejects a missing fixed image. |
| Reject another architecture | `apps/core/src/work-snapshots/import-worker.test.ts` rejects target Docker architecture mismatch before image load or Work publication and reports `PACKAGE_INCOMPATIBLE`; `packages/work-package/src/images.test.ts` rejects image/manifest platform mismatch. |
| Import twice independently | acceptance imports two Works, mutates one business database, and checks the other plus source retain their data; `apps/core/src/work-snapshots/metadata.test.ts` checks identity maps. |
| Resolve the recipient model without bindings | `apps/core/src/work-snapshots/bindings.test.ts` checks provider/model/normalized URL, newest revision, lexical tie and readable target credential; acceptance imports across installations with no bindings. |
| Report an unavailable model | `apps/core/src/work-snapshots/admission.test.ts` rejects before name/quota reservation with `TARGET_MODEL_UNAVAILABLE`; `apps/cli/src/work-snapshot.test.ts` checks safe code/hint and empty stdout. |
| Do not silently drop custom external MCP credentials | `apps/core/src/work-snapshots/admission.test.ts` rejects secret requirements before publication with `EXTERNAL_MCP_SECRET_UNAVAILABLE`; compiled CLI test checks the user-facing error. |
| Keep arbitrary application content | `packages/work-store/src/snapshot.test.ts` keeps text unchanged; `apps/core/src/work-snapshots/metadata.test.ts` maps only structured service references. |

## work-access (WACC-SNAPSHOT-001)

| Scenario | Evidence |
| --- | --- |
| Administrator cannot export private content | `apps/core/src/application/snapshot-http.test.ts` exercises administrator 403 for snapshot content; `apps/core/src/work-snapshots/access.test.ts` checks owner-only task and archive reads. |
| Forge ownership in the manifest | `packages/contracts/src/portable-work.test.ts` rejects unknown owner fields; `apps/core/src/work-snapshots/publish.test.ts` assigns recipient owner in publication. |
| Access a failed unpublished import | `apps/core/src/work-snapshots/access.test.ts` tests unpublished Operation owner-only access and safe failure projection. |
| Imported agent controls only its new Work | Acceptance closes source Core, starts target Work, and uses real pi-agentd SDK→MCP→target mTLS gRPC to stop/start its new service. It also uses the target generation's real mTLS identity to query and stop both a source service ID and another target Work's service ID, confirms `NOT_FOUND`, no new Operation, and unchanged foreign service state; `apps/core/src/work-services/service-grpc-server.test.ts` covers the isolated boundary. |

## work-configuration (WCFG-SNAPSHOT-001)

| Scenario | Evidence |
| --- | --- |
| No managed Skill exists on the recipient | `apps/core/src/work-snapshots/import-contexts.test.ts`, `owned-assets.test.ts` and acceptance use package-owned Skill trees. |
| Preserve unapplied changes | acceptance checks active A/desired B on import and first start, and only explicit apply activates B. |
| Preserve imported assets on an unrelated edit | `apps/core/src/work-snapshots/owned-assets.test.ts` tests unrelated edit retaining owned Skill/image and rejects cross-Work selection. |
| No successful source initialization | acceptance moves active-null Work and starts it; `apps/core/src/work-snapshots/import-contexts.test.ts` preserves null. |
| Preserve built-in service tools across installations | Acceptance keeps the source active `work-services` context, closes source Core, starts the target Work, then lists/stops/starts the restored service through pi-agentd's real SDK/MCP adapter and observes target Operations. |
| Do not reintroduce removed service tools | Acceptance exports/imports an active-null source Work with explicit `mcpServers: []`, confirms the target desired context remains empty despite target defaults, then starts it and checks the real pi-agentd tool list has no `work-services` tools. A separate source Work created with active deny policy is imported and started; its real pi-agentd tool list retains allowed service tools but hides `work-services.service_stop`. |

## work-lifecycle (WLIFE-SNAPSHOT-001)

| Scenario | Evidence |
| --- | --- |
| Start competes with export | `apps/core/src/work-snapshots/admission.test.ts` and `packages/core-store/src/snapshots.test.ts` test atomic exclusion of export and mutation acceptance. |
| Administrator tries an edit during export | `packages/core-store/src/mutation.ts` enforces the Work gate independently of principal; `packages/core-store/src/snapshots.test.ts` and `apps/core/src/work-snapshots/access.test.ts` test the gate and non-owner boundary. |
| Restore imported active context | `apps/core/src/work-snapshots/publish.test.ts` restarts a published stopped Work; acceptance verifies no runtime artifacts before explicit start and preserved active context thereafter. |
| Cleanup has not stopped a helper | `apps/core/src/work-snapshots/export-worker.test.ts` injects unconfirmed helper exit and checks `cleanup-pending` plus retained Work gate; `recovery.test.ts` covers the matching import cleanup rule. |

## work-services (WSRV-SNAPSHOT-001)

| Scenario | Evidence |
| --- | --- |
| Enabled and disabled services | acceptance explicitly starts imported enabled web while retained worker remains disabled; `apps/core/src/work-snapshots/publish.test.ts` checks stopped/disabled published state. |
| Shared storage survives import | acceptance checks mapped workspace service grants and retained business DB; `apps/core/src/work-snapshots/metadata.test.ts` checks tombstone grant. |
| Preserve failed retry budget | acceptance checks recovery count survives import and explicit retry resets it; `apps/core/src/work-services/service-management.test.ts` tests ordinary recovery policy. |
| Disabled service retains its reservation | acceptance checks desired and occupied quotas, no start, and third import after re-export; `apps/core/src/work-snapshots/admission.test.ts` counts disabled budget. |
| Manage restored services through target Core MCP | Acceptance verifies target service gets a new ID and pi-agentd invokes `service_list`, `service_stop`, `operation_get`, and `service_start` against target Core after source Core closes. |
| Preserve imported tool policy | `apps/agentd/src/application.test.ts` checks a denied `work-services.service_stop` tool is hidden; acceptance verifies source active, imported active and mounted context all contain the denial, and real imported pi-agentd readiness hides the tool. Its cold Work path confirms explicitly absent `work-services` is not restored from target defaults. |

## work-snapshots (WSNAP-001..005)

| Scenario | Evidence |
| --- | --- |
| Export a stopped Work | acceptance performs real stopped export/download; `apps/core/src/work-snapshots/export-worker.test.ts` checks stable IDs, sealed file and gate release. |
| Do not stop implicitly | `apps/core/src/work-snapshots/preflight.test.ts` rejects running container/in-flight control; acceptance uses explicit stop. |
| Reject stale stopped metadata | `apps/core/src/work-snapshots/preflight.test.ts` checks running service and unavailable Docker despite stopped metadata. |
| Do not mutate unfinished history | `packages/work-store/src/snapshot.test.ts` rejects nonterminal Run without repair; `apps/core/src/work-snapshots/preflight.test.ts` checks quiescence. |
| Stopped Work with retained budget | `apps/core/src/work-snapshots/preflight.test.ts` accepts nonzero source occupied counters; acceptance exports retained desired service budget. |
| Export a never-initialized stopped Work | acceptance exports active-null/no-SQLite source without starting it; `apps/snapshot-helper/src/history.test.ts` validates empty history. |
| A package exceeds JSON request size | acceptance transfers valid 8 MiB package via HTTP streams; `apps/core/src/application/snapshot-http.test.ts` covers streaming headers/body. |
| Duplicate blobs cannot bypass restore limits | `packages/work-package/src/codec.test.ts` counts repeated file references against restore budget. |
| Tamper or truncate | `packages/work-package/src/codec.test.ts` and `apps/core/src/application/snapshot-http.test.ts` reject wrong bytes/hash and incomplete uploads. |
| A hostile file tree | `packages/work-package/src/tree.test.ts` rejects traversal, duplicate/link-parent/special entries; `apps/snapshot-helper/src/filesystem.test.ts` refuses unsupported source nodes. |
| Inspect has no execution side effects | `packages/work-package/src/codec.test.ts` checks sanitized inspect; `apps/cli/src/work-snapshot.test.ts` checks offline/no credential/no network. |
| A complete installation | acceptance checks stopped published Work, exact quotas/references, no container/network/TLS before start; `apps/core/src/work-snapshots/publish.test.ts` checks atomic rows. |
| Concurrent automatic names | Acceptance imports the same package twice without name and receives source name plus `-2`; `apps/core/src/work-snapshots/admission.test.ts` covers deleted Work, name holds, Unicode truncation, and same-key replay. |
| Explicit name conflict | `apps/core/src/work-snapshots/admission.test.ts` checks explicit occupied name returns `WORK_NAME_CONFLICT`; compiled CLI test checks safe code/hint and exit 6. |
| Reject insufficient recipient capacity | acceptance forces insufficient quota and verifies refusal; `apps/core/src/work-snapshots/admission.test.ts` checks disabled/tombstone and occupied budgets. |
| Resume normal use after moving a Work | acceptance runs original dev command, HOME tool, service, DB and Session after explicit start. |
| Fail before publication | `apps/core/src/work-snapshots/import-worker.test.ts` injects restore failure; `apps/core/src/work-snapshots/publish.test.ts` checks transaction rollback. |
| No privilege bypass through a package | `packages/contracts/src/contracts.test.ts` rejects privileged/host mount fields; `apps/core/src/work-snapshots/admission.test.ts` rejects recipient budget excess. |
| Lost acceptance response | `apps/core/src/work-snapshots/admission.test.ts` replays the same package digest and explicit-name/null key across package IDs and expiry, returning the originally chosen name. |
| Core crashes before publication | `apps/core/src/work-snapshots/recovery.test.ts` tests interruption/cleanup at accepted, image, volume, helper and context stages. |
| Core crashes after publication | `apps/core/src/work-snapshots/publish.test.ts` restarts after commit and keeps one stopped Work/successful Operation. |
| Retry a download | `apps/cli/src/work-snapshot.test.ts` retries a failed download; `apps/core/src/application/snapshot-http.test.ts` verifies stable content access. |
| Expired content | `apps/core/src/work-snapshots/gc.test.ts` checks lease protection, expired tombstone and owner-only 410. |
| Disabled user during observation | `apps/core/src/application/snapshot-http.test.ts` tests disabled account then re-login; `apps/cli/src/work-snapshot.test.ts` preserves accepted identity on observation failure. |

## work-storage (WSTOR-SNAPSHOT-001)

| Scenario | Evidence |
| --- | --- |
| Preserve a development tree | `packages/runtime-docker/src/snapshot-helper.integration.ts` restores both roots and executes a `node_modules/.bin` link; acceptance executes retained `.venv` and HOME tools. |
| Do not follow an external link | `packages/runtime-docker/src/snapshot-helper.integration.ts` and `packages/work-package/src/tree.test.ts` preserve absolute/dangling link targets without reading or writing through them. |
| Reject an unsupported entry honestly | `apps/snapshot-helper/src/filesystem.test.ts` rejects xattr, socket and FIFO; real Docker helper integration checks whole capture fails for FIFO. |
| Independent restore and WAL | acceptance checks the committed WAL record in both imported Works and mutates only the first business DB; `packages/work-store/src/snapshot.test.ts` checks rebuild semantics. |
| Preserve a stale reference after failed removal | `apps/core/src/work-snapshots/metadata.test.ts` captures tombstone grant; acceptance checks mapped service references in both imports and re-export. |
| Do not silently omit another retained volume | `apps/core/src/work-snapshots/metadata.test.ts` rejects extra/missing volume and unmappable consumer. |
