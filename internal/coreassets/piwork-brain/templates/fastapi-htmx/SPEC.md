# FastAPI Web application Spec

## Intent

Provide a persistent Todo, personal review and asynchronous export Service using FastAPI, Jinja2, htmx, Bootstrap 5 CSS and direct SQLite SQL. Replace the sample domain as requested.

## Objects

Todos, review projections, original Actions/Jobs, feedback receipts and export files.

## State

Business state and outbox are authoritative in data/<service-name>/workstation.sqlite. UI and Agent share Workstation. Source, exact extra requirements and retained wheels belong in apps/<service-name>.

## Business Flow

UI forms and Agent JSON call the same mutations. Pages poll current state without replacing the editor. Checked code copies are deployed through the existing Service Operation; ready page versions are adopted automatically at the same path. Forms capture and clear input, send once and never persist or replay submissions; navigation/reload starts an empty form.

## Agent-operable Capabilities

Use /pi/v1/capabilities, Queries, idempotent Actions with expectedStateVersion, original Action/Job lookup and feedback. Only explicit feedback starts an Agent goal.

## Implementation Map

- app.py: create_app, lifespan and single-worker Uvicorn launch.
- agent_api.py: register_agent_api, existing JSON contract.
- pages.py: register_pages, full pages, fragments and downloads.
- ui_actions.py: register_ui_actions, HTML forms and errors.
- workstation.py: Workstation, shared business and direct SQL.
- piwork_protocol.py: WorkProtocol, transactions, Actions and outbox.
- templates/page.html and templates/partials/business.html: page structure and business display.
- static/page-client.js: request ordering, simple form feedback, polling and ready-version adoption.
- static/style.css: application overrides of Bootstrap CSS.
- page-files.json: page modules and complete template/static directory inputs.
- tests/: application route tests; test_workstation.py/test_protocol.py: shared contracts.

## Acceptance Criteria

Checks parse Python/Jinja and run the actual tests. Verify UI and Agent state, conflicts, original IDs, errors, automatic state updates and protected inputs through the actual Service prefix. Verify a page-only and business-only edit, loaded versions, feedback/export and persistence. No ORM, migration tooling or frontend build is needed.
