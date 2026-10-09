---
name: deploy-work-service
description: Specify, develop, deploy and verify a persistent, Agent-operable Work Service using the existing SDK and Service contract.
---

# Develop a persistent Service

For an operation on an existing Service, discover its capabilities, perform the named Query / Action, verify the actual result and return it. Do not edit code, create a Spec or start development tests for ordinary operations.

For construction or a code/configuration change:

1. Call `work-services__deployment_context`. Read [deployment request shapes](reference.md) and [the Service contract](../../references/service-contract.md). Use the actual Work resources and any appropriate language; [the Python protocol helper](../../templates/workstation/piwork_protocol.py) and workstation example are optional.
2. Before implementation, maintain `apps/<service-name>/SPEC.md`: Intent, Objects, State, Business Flow, Agent-operable Capabilities, Implementation Map and Acceptance Criteria. Keep it short. For an existing Service, read the current Spec and relevant code, update only affected sections, and retain concrete file/function coordinates. If its Spec is absent, derive the necessary current design from real code before changing it. Do this automatically without intermediate user Spec/Plan/Eval approvals.
3. Keep source/configuration and reproducible offline dependencies in `/var/data/workspace/apps/<service-name>` and business data in `/var/data/workspace/data/<service-name>`. Keep a code/configuration checkpoint and an actual codeVersion. Do not rely on /tmp, the container layer or runtime downloads for persistence.
4. Implement the core business logic once for both UI and Agent. Provide the existing capabilities, Queries, idempotent Actions with expectedStateVersion, Action/Job result access, meaningful checks and transactional outbox. Register `.pi/services/<service-name>.json`. Third-party code remains external and uses actual lifecycle/endpoints/log observations.
5. Use an existing runtime image, fixed dependencies, 0.0.0.0 binding, declared API port and readiness probe. Create/update the stable Service with a stable mutation key and expected definition version. Observe the original Operation, actual readiness and safe failure logs. No Docker build, host mount/port, privilege or Docker socket is required.
6. Run or update the existing tests for the affected Acceptance Criteria. Inspect actual exit/result output; retain the command, changed files and meaningful output in the existing SDK history/Files. Query the running Service and verify affected business results with Evidence. Process readiness, file creation and test declarations alone do not prove completion.
7. Use the original Action/Job identities and waiting/recovery rules in the Reference. Preserve unknown effects and business data. A code/configuration restore does not undo business transactions. Ordinary facts do not start Agent goals; only the Service's declared explicit feedback does.
8. If tests or business checks fail, attempt a bounded minimal repair under the existing Run/request budgets. Preserve failed results, original acceptance criteria and code recovery basis. If unresolved, report what changed and what remains unverified; do not claim Verified or publish failed learning.
9. Report changed files/features, current Spec coordinates, actual deployment, checks and Evidence through the existing Chat/Run/Service/Files/CLI results. Stage reusable verified knowledge in independent Work Memory when useful. Do not create a separate ledger, evaluation engine or task scheduler.

The Service backend reads its injected interaction identity and CA; keep tokens out of browser JavaScript, environment, Work source and exports. Record only safe pathname/business facts, and expose own-request receipts through the backend as specified in the Reference.

When copying a template from the frozen package, make the separate application copy writable and preserve executable bits. Never modify the frozen mount. Formal Brain software maintenance follows the Reference's existing Package update path; Memory changes never enter it.
