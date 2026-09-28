import { CoreStore } from "@piwork/core-store";
import { DockerDependencyError, type ContainerInspection, type DockerRuntime } from "@piwork/runtime-docker";
import { WorkContextStore } from "../configuration/work-context.js";
import { collectWorkSnapshotMetadata, type WorkSnapshotMetadata } from "./metadata.js";

export class SnapshotPreflightError extends Error {
  constructor(readonly code: "SNAPSHOT_REQUIRES_STOPPED" | "SNAPSHOT_RUNTIME_UNAVAILABLE" | "SNAPSHOT_IMAGE_MISSING" | "SNAPSHOT_STORAGE_UNREADABLE" | "WORK_BUSY") {
    super(code); this.name = "SnapshotPreflightError";
  }
}
type SnapshotDockerReads = Pick<DockerRuntime, "listManagedContainers" | "requireManagedVolume" | "inspectCapturedImage">;
const fail = (code: SnapshotPreflightError["code"]): never => { throw new SnapshotPreflightError(code); };
function scope(error: unknown, missing: SnapshotPreflightError["code"]): never {
  if (error instanceof DockerDependencyError && error.reason === "RESOURCE_MISSING") fail(missing);
  return fail("SNAPSHOT_RUNTIME_UNAVAILABLE");
}
function confirmStopped(containers: readonly ContainerInspection[], workId: string): void {
  for (const container of containers) {
    if (container.labels?.["piwork.work_id"] !== workId) continue;
    if (container.running || container.status !== "exited") fail("SNAPSHOT_REQUIRES_STOPPED");
  }
}

/** Read-only preflight, repeated after the durable Work gate has been acquired. */
export async function preflightWorkSnapshot(input: {
  readonly store: CoreStore; readonly contexts: WorkContextStore; readonly runtime: SnapshotDockerReads;
  readonly installationId: string; readonly workId: string; readonly currentExportOperationId?: string;
}): Promise<WorkSnapshotMetadata> {
  const { store, contexts, runtime, installationId, workId } = input;
  const work = store.getWork(workId, true);
  if (!work || work.deletedAt !== null || work.desiredState !== "stopped" || work.observedState !== "stopped") fail("SNAPSHOT_REQUIRES_STOPPED");
  if (store.files.hasPending(workId)) fail("WORK_BUSY");
  if (store.listWorkControlOperations(workId).some((operation) => operation.id !== input.currentExportOperationId && (operation.state === "pending" || operation.state === "running"))) fail("WORK_BUSY");
  let agent: ContainerInspection[], services: ContainerInspection[], files: ContainerInspection[];
  try { [agent, services, files] = await Promise.all([runtime.listManagedContainers("agent"),
    runtime.listManagedContainers("service"), runtime.listManagedContainers("file-helper")]); }
  catch (error) { scope(error, "SNAPSHOT_RUNTIME_UNAVAILABLE"); }
  confirmStopped(agent!, workId); confirmStopped(services!, workId);
  const workFileHelpers = files!.filter((container) => container.labels?.["piwork.work_id"] === workId);
  if (workFileHelpers.some((container) => container.running)) fail("SNAPSHOT_REQUIRES_STOPPED");
  if (workFileHelpers.length > 0) fail("WORK_BUSY");
  const metadata = collectWorkSnapshotMetadata(store, contexts, workId, input.currentExportOperationId ?? "", installationId);
  for (const volume of metadata.volumes) {
    const logicalId = volume.role === "agent-private" ? "work-private" : "work-workspace";
    let actual: { volumeName: string };
    try { actual = await runtime.requireManagedVolume(workId, logicalId); }
    catch (error) { scope(error, "SNAPSHOT_STORAGE_UNREADABLE"); }
    if (actual!.volumeName !== volume.record.runtimeName) fail("SNAPSHOT_STORAGE_UNREADABLE");
  }
  for (const image of metadata.images) {
    let actual: Awaited<ReturnType<SnapshotDockerReads["inspectCapturedImage"]>>;
    try { actual = await runtime.inspectCapturedImage(image.imageId); }
    catch (error) { scope(error, "SNAPSHOT_IMAGE_MISSING"); }
    if (actual!.imageId !== image.imageId) fail("SNAPSHOT_IMAGE_MISSING");
  }
  return metadata;
}
