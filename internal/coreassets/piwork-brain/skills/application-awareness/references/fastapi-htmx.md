# FastAPI + htmx application development

Read for FastAPI/htmx creation, changes or diagnosis. Use the current task and existing deployment Skill; no separate design stage is needed.

Use the matching FastAPI image identity and fastapi-htmx starter. Keep route adapters, shared business/direct SQL, full pages, partials, CSS/plain JS and tests at the Spec's actual coordinates. UI and Agent reuse the same business methods and SQLite state. Bootstrap 5 provides CSS only; native HTML, htmx and small explicit JS implement behavior. No ORM, migration system or npm frontend build is part of the starter.

Use the request URL helper for href, form action, hx-*, downloads and navigation response headers. Hosted browser paths carry /services/<workId>/<serviceId>/<port>; internal /health and /pi/v1 remain root paths. Never persist identities into URLs or expose interaction tokens to JavaScript.

Each actual form request carries an Action ID and expectedStateVersion; the backend remains idempotent by that ID. Let htmx drop simultaneous form requests and disable submit buttons only while a request is in flight. Clear submitted input after capturing parameters. Do not store/restore form input or pending submissions and do not automatically retry POST. Show 400/409/422 errors, or an unconfirmed result on network failure/timeout, and only re-read the backend list. A missing reply is not proof that no write occurred. Agent original-Action recovery remains separate. Normal display polling must preserve editor input/focus and reject late old results. Query failure retains confirmed content with a stale notice; successful recovery clears the notice even when the version did not change.

Maintain page-files.json: complete template/static directories and added page modules contribute to frontendVersion. Production serves a checked version copy. Complete checks and the original Service update/restart after edits; verify actual running code and affected business results. A changed working file does not prove deployment. The page adopts ready versions at its current path once an in-flight form HTTP request ends; navigation and reload initialize an empty form. No persistent pending record or form-storage step gates page adoption.

Use one Uvicorn worker for this example's process-owned Job executor. Extra exact Python dependencies are prepared in Service with the existing deployment command, retained with wheels and reused offline. Agent bash does not thereby gain Python/pip.

With authorized browser capability, verify the actual Desktop Service entry, visible content, controls and automatic state changes. HTTP 200, Service Ready and API success prove their own layers. Without a usable authorized browser report the page as unverified. For failures inspect requests, HTML fragments, browser errors, DOM and scoped styles; retain unknown causes rather than replacing the stack. Custom CSS uses application-scoped names and preserves Bootstrap component behavior.
