import { appendFileSync } from "node:fs";
import { CoreApplication } from "../apps/core/dist/application/core-application.js";
import { ensureCorePaths } from "../apps/core/dist/application/paths.js";

const dataDirectory = process.env.PIWORK_SHUTDOWN_DIR;
const eventsPath = process.env.PIWORK_SHUTDOWN_EVENTS;
if (!dataDirectory || !eventsPath) throw new Error("shutdown fixture paths are required");

const workId = "work-shutdown-12345678";
const now = new Date().toISOString();
let agentRunning = true;
const record = (event) => appendFileSync(eventsPath, `${event}\n`);
const runtime = {
  async prepare() {}, async start() { throw new Error("unexpected start"); },
  async inspect() { return { exists: agentRunning, running: agentRunning, ready: agentRunning,
    instanceId: "shutdown-agent", generation: 1 }; },
  async drain() {},
  async stop() { record("agent-stop"); agentRunning = false; },
  async remove() { agentRunning = false; },
};
const fileDocker = { async inspectFileHelper() { return new Promise(() => {}); } };
const app = await CoreApplication.create({ paths: ensureCorePaths(dataDirectory),
  initialization: { administrator: { account: "owner", password: "correct horse battery" },
    runtime: { agentImage: "image:fixture", provider: "anthropic", model: "fixture", credential: "fixture-secret" } },
  runtimeFactory: async () => runtime, fileDockerFactory: () => fileDocker });
await app.listen({ host: "127.0.0.1", port: 0 });
const ownerId = app.store.getAuthenticationUserByAccount("owner").id;
app.store.exec(`INSERT INTO login_sessions(id,user_id,token_digest,expires_at,created_at)
  VALUES ('session-shutdown','${ownerId}','digest','2027-01-01T00:00:00Z','${now}');
  INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
  VALUES ('${workId}','${ownerId}','test','running','ready',1,1,'${now}','${now}')`);
app.store.files.acceptJob({ id: "filejob-shutdown-1234", workId, ownerUserId: ownerId,
  sessionId: "session-shutdown", coreEpoch: app.fileCoreEpoch, runtimeGeneration: 1,
  kind: "GET", state: "accepted", trustedImageId: `sha256:${"a".repeat(64)}`,
  volumeName: "workspace-test", pathSegmentsJson: "[]", destinationSegmentsJson: null,
  acceptedAt: now, deadlineAt: "2027-01-01T00:30:00Z", updatedAt: now,
  cleanedAt: null, errorCode: null },
{ id: "attempt-shutdown-1234", jobId: "filejob-shutdown-1234", kind: "request", epoch: 1,
  containerName: "piwork-file-shutdown", containerId: null, state: "planned", createdAt: now, updatedAt: now });
app.store.files.updateAttempt("attempt-shutdown-1234", "planned", "created", now, "attempt-shutdown-1234");
app.store.files.updateJobState("filejob-shutdown-1234", "accepted", "cleanup-pending", now, "FILE_CLEANUP_REQUIRED");
app.services.stopServices = async () => { record("service-stop"); };
// Model a background recovery task that only completes after shutdown aborts it.
app.fileRecoveryTask = new Promise((resolve) =>
  app.fileRecoveryAbort.signal.addEventListener("abort", resolve, { once: true }));
process.stdout.write("READY\n");
process.once("SIGTERM", () => {
  void app.close(250).then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
});
