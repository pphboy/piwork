# Service interaction contract, version 1

Any language may implement this contract. The bundled Python helper is source to copy into an application, not a mandatory platform SDK or npm module. The default workstation example uses Python 3.13, NiceGUI 3.17.1 and SQLite.

The Service owns business state. Pi owns durable goal progress, actual evidence and confirmed experience in this Work. Core owns runtime identity, infrastructure, model resources and package Apply. Share state by reading the Service's named queries and by reading the original Pi request receipt; do not copy business state into prompts or Core tables.

Put this connection in `.pi/services/<logical-name>.json`:

```json
{"contractVersion":1,"serviceName":"workstation","apiPortName":"http","mode":"pi-managed"}
```

For unmodified third-party software use `mode=external`: lifecycle, endpoint and logs are available, with no invented business observation. The host resolves only the declared private port of the currently bound Service; connection files contain no addresses or credentials.

The Service reads `/etc/piwork/interaction/config.json` containing contractVersion, workId, serviceId, serviceName, agentUrl, token and caPath. Use the token on backend HTTPS requests to agentd, and validate its CA. Authorize Pi's business calls using the same current token. Identity is read-only runtime material, never browser data, environment, workspace source or an exported file. Replacement rotates credentials. Apply of agentd preserves the identity of an existing Service. An imported Work has a new origin.

All routes below are relative to the Service's declared HTTP port:

| Route | Result |
| --- | --- |
| GET /pi/v1/capabilities | contractVersion=1, logicalServiceName, codeVersion, stateVersion, named queries/actions, facts/requestReasons, jobs support |
| POST /pi/v1/queries/:name | `{input}` → `{value,stateVersion,codeVersion,observedAt,checks:[{name,passed,summary}]}` |
| POST /pi/v1/actions/:name | `{actionId,input,expectedStateVersion,causationRequestId}` → original Action result |
| GET /pi/v1/actions/:actionId | Original result including actionId, actionName, input, expectedStateVersion, state, optional result/error/jobId, stateVersion, observedAt |
| GET /pi/v1/jobs/:jobId | jobId, actionId, state, optional result/error, artifacts (Work-relative paths), observedAt, deadlineAt |

Queries declare inputSchema and description. Actions declare inputSchema, mutation, requiresExpectedStateVersion, verificationQuery, mode=sync|async and maxWaitMs (when asynchronous). Events declare facts and requestReasons arrays; jobs is a boolean. IDs/names are bounded safe strings. No remote schema references, arbitrary host URLs or redirects. JSON request/result size is at most 64 KiB.

Action states are accepted/running/succeeded/failed/cancelled; Job states are the same. Save the Action fingerprint `(actionName,input,expectedStateVersion)` with its effects in one business transaction. The same ID and fingerprint returns the same original result; different content returns 409 ACTION_IDEMPOTENCY_CONFLICT. An expected version mismatch returns 409 ACTION_STATE_CONFLICT with no business effect. If a response is lost, Pi GETs the original ID. Unknown effects require attention and prohibit blind mutation replay. A known rejected attempt can be followed by a corrected Action after its lack of effect is proved.

Checks must inspect actual affected state or artifacts. At least one meaningful successful check is required to finish; accepted, a completion event, a successful SDK Run or a model's statement is insufficient. codeVersion describes actual code and is independent of the infrastructure Service revision.

Save outbox facts inside the same transaction as the business change. Event envelope:

```json
{"contractVersion":1,"eventId":"stable-local-id","origin":{"workId":"current-work","serviceId":"current-service"},"serviceName":"workstation","type":"agent.requested","occurredAt":"2026-10-03T00:00:00.000Z","stateVersion":"7","entityRef":null,"actionId":null,"jobId":null,"causationRequestId":null,"payload":{"reason":"review-gap","goal":"Verify that completed todos appear in the personal review","evidenceRefs":[]}}
```

POST this envelope to `https://agentd:7444/pi/v1/events`. New durable receipts return 201; replay returns 200 with the same eventId/requestId. Same identity with different content is 409 SERVICE_EVENT_CONFLICT. Wrong/historical origin is a permanent error. Reject oversized events (64 KiB), goals (8 KiB), undeclared reasons and agent-caused recursive goals. Facts only record observation; only explicit `agent.requested` starts Pi. Result facts with the original actionId/jobId/causationRequestId wake only its registered wait and are still verified by GET/query.

Producer retry uses the original eventId and unchanged body with 1/2/4/8/16/30-second backoff, at most 30 seconds, and a ten-second network timeout. Lost responses do not create another ID. Retain permanent failures and expired goals for diagnosis. On import compare stored origin to current runtime origin; mark old outbox rows historical without sending. A normal restart with the same Work/Service origin can deliver its existing outbox. Recover long Jobs by proving the executor/result; absent executors become interrupted/failed rather than restarting effects.

Record `page.visited` payload as `{pathname:"/review"}` only, excluding query/fragment, DOM and form input. Business actions have explicit semantic facts. Browser pages call their own Service backend. That backend GETs `/pi/v1/requests/:requestId` or POSTs `/pi/v1/requests/:requestId/cancel` on agentd, then returns only safe own-request state/result/evidence. Tokens cannot inspect another Service's request, submit arbitrary Chat Runs or access Core.

Pi's fixed workflow is receive → query → Action → original result/Job wait → actual verification → writeback → confirmed experience → later Run adoption. One goal has one waitRef `{kind:job|action|package-operation|apply,serviceName?,id,deadlineAt,nextPhase:verifying|adopting,verificationGoal}`. A waiting Run releases the slot. Only declared original results are checked every five seconds or on matching facts. Verification cannot repeat mutation. The owner may cancel Pi continuation; business jobs/data and desired packages remain. Retry creates a new linked goal and first checks all original effects.

Initial goals expire after 24 hours; Job waits use the minimum of declared maximum, remaining goal lifetime and 24 hours. A brain candidate waits up to seven days for explicit Apply. Four automatic Runs per goal, thirty minutes each, one active Run per Work. Terminal goals never revive from late events. Work Stop/recovery does not replay an interrupted prompt. Source observations, evidence, experience and old requests travel with a cold export; imported requests are historical and cannot resume.

The four brain tools call an agentd-only Unix socket unavailable to Service containers: `brain_service` (discover/query/action/action_get/job_get/verify), `brain_feedback` (events/request_get/wait/finish/cancel), `brain_experience` (list/stage/commit/status), `brain_package_update` (prepare/status). The host derives current Run, source scope and policy. Experience commit is atomic with verified completion; package preparation never implicitly Applys.

Brain preparation requires `{operation:"prepare",submissionKey,verificationGoal,verificationTarget:{contractVersion:1,toolName:"package:piwork-brain:<native-name>",input:{...},checkNames:[...]}}`. Fix one meaningful behavior acceptance before preparation, including for Skill improvements. Input is at most 8 KiB, the whole target at most 16 KiB, with 1–8 unique ASCII names matching `[A-Za-z0-9][A-Za-z0-9._:-]*` and at most 64 characters. No credentials, fixed endpoints or host paths. The feedback and update tools cannot be their own proof. A changed target conflicts under the same key.

After explicit Apply, execute exactly that tool/input in the compatible SDK Run. Required checks must all exist once and pass; no returned check may fail. Actual ToolResult.details.checks supplies custom brain checks; brain_service queries use details.result.checks. The host records the actual call and candidate/context association, and finish requires that same goal and current Run's evidence. Status and Skill reads are load/call facts, not behavior proof. Missing/failed checks need attention while active/loaded remain true. Same-content updates still execute the target. An old unfinished live candidate with no target needs a new explicit goal and key; imported history cannot be used as current proof.

After interruption before wait registration, the ready host reads only persisted original Action/Job or candidate receipt. Terminal results continue verification; running results register the same sole wait; missing/mismatched/unprovable results need attention. No original prompt, POST or package preparation is replayed. Unproved waits expire as needs_attention/REQUEST_EXPIRED, including equal request/Job deadlines and stopped time; business results and data are not rolled back.
