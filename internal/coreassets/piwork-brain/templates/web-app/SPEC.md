# Web application starter Spec

## Intent

Start a persistent Python + NiceGUI + SQLite Service. The included Todo/review/export example demonstrates the Service contract and can be replaced with the requested domain; the base image contains no business application.

## Objects

The sample has Todos, review projections, original Actions/Jobs and feedback receipts.

## State

Business data and the transactional outbox use data/<service-name>/workstation.sqlite. Service name comes from the current injected identity. Code and page versions identify the actual checked Python implementation and environment.

## Business Flow

UI and Agent call the same backend logic. Application updates are checked and deployed automatically; the page observes loaded versions and restores supported drafts without manual reload.

## Agent-operable Capabilities

Use /pi/v1/capabilities and the declared Query/Action/Job endpoints. Only explicit feedback starts an Agent goal. Replace these sample capabilities with the application's necessary domain contract.

## Implementation Map

- app.py: NiceGUI HTTP and Agent routes.
- workstation.py: sample business logic; piwork_protocol.py: transactional interaction contract.
- ui.py: NiceGUI pages and callbacks; image page client: version observation and draft recovery.
- page-files.json: additional page helpers/resources; the base retains default page entry inputs.
- requirements.in and requirements.lock: exact extra dependencies; standard packages come from the fixed base.

## Acceptance Criteria

piwork-web check runs isolated Python business/protocol/version tests. piwork-web run prepares and serves the actual checked version, reusing valid checks for identical input. Verify real business results, NiceGUI browser/HTTP/WebSocket behavior, automatic version adoption and retained data through the existing Service workflow.

## Environment and delivery

Use the matching contract-2 NiceGUI base. Standard dependencies are preinstalled; extra exact pins are prepared with the Service command `run --install-deps`, retained in the app and reused offline. Complete Python checks, the original Service deployment and actual runtime-version/business verification. Page versions represent Python UI/resources; preserve supported nonsecret drafts/path during automatic ready-version adoption. Never use an unpublished candidate as a published default, overwrite an existing app during initialization, or perform Docker exec/build from Agent.

Maintain `page-files.json` when page helpers/resources are introduced, split or removed. A listed helper/resource change must change frontendVersion; independent business changes must not. Invalid or missing declared files reject checks/startup instead of reusing old checks. Apps without a manifest retain the default input set.

Custom classes use the `webapp-` business prefix and are scoped to the application root; retain framework layout classes. Query failures preserve last confirmed content and drafts with a data-status notice; recovery clears that notice through the existing timer. Verify affected content, actions and state via the actual Desktop Service entry when an authorized browser is available; otherwise report the page as unverified. NiceGUI development and diagnosis guidance belongs to the peer application-awareness Skill and its conditional Reference.
