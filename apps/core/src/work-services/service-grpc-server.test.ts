import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChannelCredentials, status, type ServiceError } from "@grpc/grpc-js";
import { WorkServicesClient, type RpcDeploymentContext, type WorkConfig } from "@piwork/contracts";
import { CoreStore } from "@piwork/core-store";
import { ensureCorePaths } from "../application/paths.js";
import { ensureGenerationTlsIdentity } from "../runtime/mtls.js";
import { WorkServiceManagementService } from "./service-management.js";
import { WorkServiceGrpcServer } from "./service-grpc-server.js";

const NOW = "2026-09-22T00:00:00.000Z";
const INSTALLATION = "installation-test";
const WORK_ID = "work-0199e6d8grpc";

test("actual mTLS gRPC authenticates the current Work instance and fences stale identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-service-grpc-"));
  const paths = ensureCorePaths(root);
  const store = CoreStore.open({ databasePath: paths.databasePath });
  const services = new WorkServiceManagementService(store, { async start() {} });
  const server = new WorkServiceGrpcServer(paths, INSTALLATION, store, services);
  let client: WorkServicesClient | undefined;
  try {
    seedWork(store);
    store.ensureRuntimeGeneration(WORK_ID, 1, NOW);
    store.updateRuntimeGeneration(WORK_ID, 1, "ready", NOW, { instanceId: "agent-current", readySince: NOW });
    const identity = ensureGenerationTlsIdentity({
      runtimeDirectory: paths.runtimeDirectory,
      installationId: INSTALLATION,
      workId: WORK_ID,
      generation: 1,
      instanceId: "agent-current",
    });
    const port = await server.start("127.0.0.1:0");
    client = grpcClient(port, identity);
    const context = await deploymentContext(client);
    assert.equal(context.workId, WORK_ID);
    assert.equal(context.workspacePath, "/var/data/workspace");
    assert.equal(context.apiVersion, "v2");
    store.exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at)
      VALUES ('work-foreign-00000001','user-owner','foreign','stopped','stopped',1,1,'${NOW}','${NOW}')`);
    store.exec(`INSERT INTO service_heads(work_id,service_id,name,desired_revision,applied_revision,enabled,observed_state,tombstoned_at,last_error_json)
      VALUES ('work-foreign-00000001','service-foreign-00000001','foreign-service',1,NULL,0,'disabled',NULL,NULL)`);
    await assert.rejects(new Promise((resolve, reject) => client!.getService({ serviceId: "service-foreign-00000001" },
      (error, response) => error === null ? resolve(response) : reject(error))),
    (error: ServiceError) => error.code === status.NOT_FOUND);

    const wrongRole = new WorkServicesClient(`127.0.0.1:${port}`, ChannelCredentials.createSsl(
      readFileSync(identity.caCertificatePath),
      readFileSync(identity.clientPrivateKeyPath),
      readFileSync(identity.clientCertificatePath),
    ), {
      "grpc.ssl_target_name_override": "piwork-core",
      "grpc.default_authority": "piwork-core",
    });
    try {
      await assert.rejects(deploymentContext(wrongRole), (error: ServiceError) => error.code === status.UNAUTHENTICATED);
    } finally { wrongRole.close(); }

    store.updateRuntimeGeneration(WORK_ID, 1, "stopped", NOW);
    await assert.rejects(deploymentContext(client), (error: ServiceError) => error.code === status.FAILED_PRECONDITION);

    const other = ensureGenerationTlsIdentity({
      runtimeDirectory: paths.runtimeDirectory,
      installationId: INSTALLATION,
      workId: "work-0199e6d8other",
      generation: 1,
      instanceId: "agent-other",
    });
    const otherClient = grpcClient(port, other);
    try {
      await assert.rejects(deploymentContext(otherClient), (error: ServiceError) => error.code === status.FAILED_PRECONDITION);
    } finally { otherClient.close(); }
  } finally {
    client?.close();
    await server.close();
    await services.shutdown();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

function grpcClient(port: number, identity: ReturnType<typeof ensureGenerationTlsIdentity>): WorkServicesClient {
  return new WorkServicesClient(`127.0.0.1:${port}`, ChannelCredentials.createSsl(
    readFileSync(identity.caCertificatePath),
    readFileSync(identity.serviceClientPrivateKeyPath),
    readFileSync(identity.serviceClientCertificatePath),
  ), {
    "grpc.ssl_target_name_override": "piwork-core",
    "grpc.default_authority": "piwork-core",
  });
}

function deploymentContext(client: WorkServicesClient): Promise<RpcDeploymentContext> {
  return new Promise((resolve, reject) => client.getDeploymentContext({}, (error, response) => error === null ? resolve(response) : reject(error)));
}

function seedWork(store: CoreStore): void {
  const configuration: WorkConfig = {
    agentImage: { catalogId: "catalog-agent" }, skills: [], agentsMd: "", modelRef: "catalog-model", mcpServers: [],
    resources: { cpuMillis: 2_000, memoryBytes: 1_610_612_736, agentCpuMillis: 1_000, agentMemoryBytes: 805_306_368, maxServices: 4, maxRetainedVolumes: 2 },
    tools: { allowed: [], denied: [] },
  };
  store.exec(`INSERT INTO users(id, account, password_digest, role, enabled, created_at, updated_at)
    VALUES ('user-owner', 'owner', 'digest', 'user', 1, '${NOW}', '${NOW}')`);
  store.exec(`INSERT INTO works(id, owner_user_id, name, desired_state, observed_state,
    desired_revision, active_revision, control_version, created_at, updated_at)
    VALUES ('${WORK_ID}', 'user-owner', 'grpc', 'running', 'ready', 1, 1, 1, '${NOW}', '${NOW}')`);
  store.exec(`INSERT INTO work_config_revisions(work_id, revision, config_json, created_by_user_id, created_at)
    VALUES ('${WORK_ID}', 1, '${JSON.stringify(configuration)}', 'user-owner', '${NOW}')`);
  store.exec(`INSERT INTO quota_reservations(work_id, subject_kind, subject_id, desired_cpu_millis,
    desired_memory_bytes, occupied_cpu_millis, occupied_memory_bytes, service_slots, volume_slots, updated_at)
    VALUES ('${WORK_ID}', 'agent', 'agentd', 1000, 805306368, 1000, 805306368, 0, 2, '${NOW}')`);
}
