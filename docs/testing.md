# Testing policy

`npm test` removes ambient variables whose names end in `API_KEY`, `AUTH_TOKEN`,
`ACCESS_TOKEN`, `CLIENT_SECRET`, or `MODEL_SECRET` before it starts workspace
tests. Unit and local protocol tests must use deterministic model and MCP
fixtures and must not make paid model requests.

`npm run acceptance` is the required product-boundary check. It builds the
deterministic agent image, launches compiled Core and CLI child processes, and
uses a unique Docker installation label. It scrubs ambient model credentials,
does not call an external model, and always removes only resources with its own
installation label. `npm run real-model-smoke` is opt-in and is never treated
as a substitute for deterministic acceptance.

`npm run test:integration` creates a unique `PIWORK_TEST_INSTALLATION_ID` with a
`piwork-test-<uuid>` shape. Every Docker resource created by a test must carry
the label `piwork.installation_id=<installation_id>`. Discovery and cleanup must
use the exact `PIWORK_TEST_DOCKER_FILTER` passed by the runner. Helpers reject
empty, wildcard, human-chosen, and production-looking IDs before any runtime
operation is attempted.

Integration tests must never run global Docker cleanup commands. On failure,
they may leave resources carrying their exact generated label for diagnosis;
the same exact label is the only allowed cleanup scope.
