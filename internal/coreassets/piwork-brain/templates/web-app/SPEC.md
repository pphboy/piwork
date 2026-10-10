# Web application starter Spec

## Intent

Start a persistent FastAPI + React + TypeScript + Vite Service. The included Todo/review/export example demonstrates the Service contract and can be replaced with the requested domain; the base image contains no business application.

## Objects

The sample has Todos, review projections, original Actions/Jobs and feedback receipts.

## State

Business data and the transactional outbox use data/<service-name>/workstation.sqlite. Service name comes from the current injected identity. Code and frontend versions identify the actual checked build.

## Business Flow

UI and Agent call the same backend logic. Application updates are checked and deployed automatically; the page observes loaded versions and restores supported drafts without manual reload.

## Agent-operable Capabilities

Use /pi/v1/capabilities and the declared Query/Action/Job endpoints. Only explicit feedback starts an Agent goal. Replace these sample capabilities with the application's necessary domain contract.

## Implementation Map

- backend/main.py: FastAPI UI and Agent routes.
- workstation.py: sample business logic; piwork_protocol.py: transactional interaction contract.
- frontend/src/App.tsx: React UI; version-client.ts: version observation and draft recovery.
- app.py: server entry; requirements.lock and frontend/package-lock.json: dependencies.

## Acceptance Criteria

piwork-web check runs isolated backend and frontend tests. piwork-web run prepares/builds/serves the actual checked version. Verify real business results, browser/API behavior, automatic version adoption and retained data through the existing Service workflow.
