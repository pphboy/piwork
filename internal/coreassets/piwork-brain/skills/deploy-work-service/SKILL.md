---
name: deploy-work-service
description: Create, operate and improve a persistent Work service with observable actions, feedback, verification and portable offline dependencies.
---

# Develop a workstation Service

1. Call `work-services__deployment_context`. Read [deployment request shapes](reference.md) and [the language-neutral Service contract](../../references/service-contract.md). Use any suitable language; [the Python helper](../../templates/workstation/piwork_protocol.py) and NiceGUI example are optional.
2. Persist code, configuration, venv and offline dependencies below `/var/data/workspace/apps/<service-name>`; persist SQLite/business data below `/var/data/workspace/data/<service-name>`. Never depend on /tmp or the container layer for restart. Prepare dependencies once, then start offline without package downloads.
3. For code you implement, deliver capabilities, named queries, idempotent Actions with expectedStateVersion, queryable Action/Job results, successful verification checks and transactional outbox. Add `.pi/services/<service-name>.json` with contractVersion=1, serviceName, apiPortName and mode=pi-managed. Third-party code uses mode=external and only actual lifecycle/endpoints/log observations.
4. The Service backend reads `/etc/piwork/interaction/config.json` and its TLS CA. Keep identity and tokens out of browser HTML/JavaScript, environment, Work files and exports. Record pathname and business actions; never record query strings, form content or DOM. Expose safe own-request receipts through the Service backend.
5. Use an existing runtime image, bind 0.0.0.0, declare the API port and readiness probe, and call `work-services__service_create` with a stable key. Do not request a Docker build, host mount/port, privilege or Docker socket. Observe the original lifecycle Operation and Service readiness; report actual safe logs on failure.
6. Discover using `brain_service`, execute with a stable Action ID and original input/version, read the original Action after an uncertain reply, then query real verification checks. Register a long Job using `brain_feedback.wait` and end the Run. Finish with verified evidence; do not treat accepted or your own message as completion.
7. Before modifying code/config, create a Work code checkpoint and codeVersion. Update/restart the stable Service, verify actual business behavior, and restore the checkpoint on failure. Preserve business databases; code restoration cannot undo unknown effects. Persist recoverable Job state; after executor loss report interruption rather than replaying its work.
8. A declared explicit `agent.requested` goal lets the resident Pi loop investigate and improve the source Service, verify and confirm evidence/experience. Ordinary events do not run a model. Use the four brain tools and fixed cognition, without adding Core business state or a scheduler.
9. For brain changes edit `.pi/packages/piwork-brain`, prepare a fixed candidate with verificationGoal and verificationTarget (one canonical brain tool, exact input and required checkNames). Wait for the user to Apply, then execute that same target in the compatible SDK Run and inspect actual behavior checks before finish. Skill changes need a corresponding behavior query/tool; reading the Skill or calling status proves no target behavior. Missing/failed checks need attention while actual loaded stays visible. Keep source edits until explicitly replaced. Verify Stop/Export/Import/Start with offline dependencies, fresh identities, historical old requests and no old outbox/job replay; recipient updates need their own fixed target and SDK evidence.

See [deployment request shapes](reference.md) for the existing Work infrastructure tools.

When using templates copied from the frozen package, make the separate application copy writable by the Work user (preserve executable bits). Never edit the frozen package mount.
