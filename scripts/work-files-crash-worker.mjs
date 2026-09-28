import { CoreApplication } from "../apps/core/dist/application/core-application.js";
import { ensureCorePaths } from "../apps/core/dist/application/paths.js";
import { ensureInstallationId } from "../apps/core/dist/runtime/docker-work-runtime.js";
import { DockerRuntime } from "@piwork/runtime-docker";

const root = process.env.PIWORK_CRASH_DIR;
const volumeA = process.env.PIWORK_CRASH_VOLUME_A;
const volumeB = process.env.PIWORK_CRASH_VOLUME_B;
const helperImage = process.env.PIWORK_FILE_HELPER_TEST_IMAGE;
const password = process.env.PIWORK_CRASH_PASSWORD;
if (!root || !volumeA || !volumeB || !helperImage || !password) throw new Error("crash worker configuration is missing");
const WORK_A = "work-crash-a-12345678", WORK_B = "work-crash-b-12345678";
const paths = ensureCorePaths(root), installationId = ensureInstallationId(paths);
const crashStage = process.env.PIWORK_CRASH_STAGE;
const fileDocker = new DockerRuntime(installationId);
const hold = () => new Promise(() => {});
const reached = (stage) => process.stdout.write(JSON.stringify({ stage }) + "\n");
if (crashStage === "create-response") {
  const create = fileDocker.createFileHelper.bind(fileDocker);
  fileDocker.createFileHelper = async (spec) => { await create(spec); reached(crashStage); return hold(); };
} else if (crashStage === "remove") {
  fileDocker.removeFileHelper = async () => { reached(crashStage); return hold(); };
} else if (crashStage === "commit") {
  const start = fileDocker.startFileHelper.bind(fileDocker);
  fileDocker.startFileHelper = async (...args) => {
    const child = await start(...args);
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (frame, ...rest) => {
      if (Buffer.isBuffer(frame) && frame[0] === 4
        && JSON.parse(frame.subarray(5).toString()).phase === "commit") {
        reached(crashStage);
        return true;
      }
      return write(frame, ...rest);
    };
    return child;
  };
}
const stopped = new Set();
const runtime = { async prepare() {}, async start() { throw new Error("fixture must not start agent"); },
  async inspect(workId) { const running = !stopped.has(workId);
    return { exists: running, running, ready: running, instanceId: `instance-${workId}`, generation: 1 }; },
  async drain() {}, async stop(workId) { stopped.add(workId); }, async remove(workId) { stopped.add(workId); } };
const app = await CoreApplication.create({ paths,
  initialization: { administrator: { account: "owner", password }, runtime: {
    agentImage: "image:fixture", provider: "anthropic", model: "fixture", credential: "fixture-secret" } },
  runtimeFactory: async () => runtime, fileHelperImage: helperImage,
  fileDockerFactory: () => fileDocker });
const address = await app.listen({ host: "127.0.0.1", port: 0 });
const owner = app.store.getAuthenticationUserByAccount("owner").id;
if (!app.store.getWork(WORK_A)) {
  const now = new Date().toISOString();
  for (const [index, workId, volume] of [["a", WORK_A, volumeA], ["b", WORK_B, volumeB]]) {
    app.store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('${workId}','${owner}','crash-${index}','running','ready',1,1,'${now}','${now}');
      INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,created_at)
      VALUES ('volume-crash-${index}','${installationId}','${workId}',NULL,'workspace','${volume}','active',1,'${now}')`);
    app.store.ensureRuntimeGeneration(workId, 1, now);
    app.store.updateRuntimeGeneration(workId, 1, "ready", now, { instanceId: `instance-${workId}` });
  }
}
// This fixture supplies an already running runtime instead of a Work context; restore its observed projection after lifecycle recovery.
for (const workId of [WORK_A, WORK_B]) {
  if (app.store.getWork(workId).observedState !== "ready") {
    const now = new Date().toISOString();
    app.store.updateWorkObservedState(workId, "ready", now);
    app.store.updateRuntimeGeneration(workId, 1, "ready", now, { instanceId: `instance-${workId}` });
  }
}
const login = await app.identity.login("owner", password, "crash-acceptance");
process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token: login.token,
  installationId, pending: app.store.files.listPendingJobs().length,
  works: [WORK_A, WORK_B].map((workId) => ({ workId, observed: app.store.getWork(workId)?.observedState,
    desired: app.store.getWork(workId)?.desiredState, gate: app.store.files.getGate(workId)?.closed })) }) + "\n");
const stop = async () => { await app.close(); process.exitCode = 0; };
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
