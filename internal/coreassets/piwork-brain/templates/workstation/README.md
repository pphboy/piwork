# Personal workstation example

This example uses Python 3.13, NiceGUI 3.17.1 and SQLite. Other languages follow
the same Service contract; the platform does not prescribe a language.

Read [SPEC.md](SPEC.md), copy the template into `apps/workstation`, record the code checkpoint and prepare
its locked wheels there once. Use `prepare.sh` to install only those wheels into
the persistent `.venv`. Start `.venv/bin/python app.py` offline in a Python 3.13
Service image, mounted at `/var/data/workspace`, with the `web` TCP port 8080 and
`/health` readiness. Persist business files under `data/workstation`. Put
`{"contractVersion":1,"serviceName":"workstation","apiPortName":"web","mode":"pi-managed"}`
in `.pi/services/workstation.json`. Runtime injects backend interaction identity
and TLS CA in `/etc/piwork/interaction`; these never belong to Work source.

The initial `review_config.json` intentionally omits completed Todos. Complete a
Todo, open Personal review and report the omission. The backend commits an
explicit `agent.requested` event to the same SQLite outbox used for facts. Pi
reads original state, checkpoints the code, fixes `includeCompleted`, queries
the actual review, stages an evidence-backed rule and finishes. The page shows
the original receipt and Pi request; Chat shows the same goal and evidence. A
later accepted Run adopts the verified experience.

`export_review` returns an original asynchronous Job. Pi registers that ID and
ends its Run, leaving Chat available. The worker writes a persistent artifact,
commits the Job and its completion fact, and Pi queries that same Job before
verification. A restarted executor marks unfinished old Jobs interrupted;
imports neither replay an old Job nor deliver old-origin outbox events.

Action IDs are stable idempotency keys and require a state version. An uncertain
reply is reconciled by GET of the same Action. UI callbacks record semantic
actions without recording text input. Page events contain pathname only.
Cancellation stops Pi continuations, leaving business effects and exports.
Stop/Export/Import/Start preserves code, locked wheels, venv, data, receipts and
experience; a new independent runtime gets fresh Service credentials.

NiceGUI's local assets and server lifecycle use the official
[3.17.1 API](https://github.com/zauberzeug/nicegui/tree/v3.17.1/nicegui).
