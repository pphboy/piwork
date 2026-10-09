# Personal workstation Spec

## Intent

Provide persistent Todos, personal review and asynchronous review export. Users and the Agent operate the same business state and can inspect real feedback/results.

## Objects

- Todo: stable id, title and completed flag.
- Review: projection of current completed/open Todos.
- Export: original Action/Job identity, frozen Todo snapshot and persistent JSON artifact.
- Feedback: declared original request and its own readable receipt.

## State

`data/workstation/workstation.sqlite` holds authoritative business state and transactional outbox. `ws_meta.version` is the expectedStateVersion; codeVersion comes from `review_config.json`. Jobs retain original executor, deadline and terminal result. A replacement executor marks unfinished old Jobs interrupted; it does not replay them.

## Business Flow

Add Todo → complete Todo → inspect review → optionally request an export. UI callbacks and Agent Action endpoints call `Workstation.perform`; both query the same SQLite state. Explicit review feedback requests Agent verification/repair; ordinary facts do not start a model.

The initial review configuration intentionally excludes completed Todos as a repair fixture. A completed Todo must appear after the requested `includeCompleted` repair; the initial failing check is retained as evidence of the problem.

## Agent-operable Capabilities

- Queries: `todos`, `review`, `exports`.
- Actions: `todo_add`, `todo_complete`, `export_review`, each with a stable id and expected version.
- Async result: original Action GET and Job GET; `exports_exist` inspects the actual persisted artifact.
- Checks: `todos_readable`, `completed_in_review`, `exports_exist`.
- Explicit request reasons: `review_missing`, `export_review`; safe facts include pathname and business action/Job completion.

## Implementation Map

| Responsibility | Code coordinates |
| --- | --- |
| Capability/state/query/Action/export semantics | `workstation.py`: `Workstation.capabilities`, `query`, `perform`, `export`, `job` |
| Shared UI and HTTP entry points | `app.py`: `user_action` and `/pi/v1` routes |
| Idempotency/version checks/outbox/identity | `piwork_protocol.py`: `WorkProtocol.action`, `event`, `deliver_once` |
| Review behavior/version | `review_config.json`: `includeCompleted`, `codeVersion` |
| Business regression | `test_workstation.py`: `StationTest` |
| Protocol regression | `test_protocol.py`: protocol test cases |

## Acceptance Criteria

Run `python -m unittest test_protocol test_workstation` from the application directory. Confirm original Action fingerprint replay without another mutation, stale state rejection, actual completed review after repair, real export artifact, interrupted executor handling, import-origin isolation and safe pathname facts. In deployment, also verify Service HTTP/UI, named Actions/Queries and original receipts through the real SDK/MCP/Service path. A passing Python fixture alone does not establish deployment or real-model behavior.
