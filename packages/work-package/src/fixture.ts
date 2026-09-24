import { createHash } from "node:crypto";
import { WORK_BLOB_KINDS, type PortableWorkSpec, type WorkBlobKind, type WorkControlHistory, type WorkSourceIdentityMap } from "@piwork/contracts";
import { encodeWorkJson } from "./json.js";

/** Deterministic fixture source; no Docker, SQLite or executable content is opened. */
export function goldenWorkFixture(fileContent = Buffer.from("PRIVATE_CONTENT_SENTINEL")) {
  const data = new Map<string, Buffer>();
  const kinds = new Map<string, Set<WorkBlobKind>>();
  const add = (bytes: Buffer, kind: WorkBlobKind) => {
    const digest = createHash("sha256").update(bytes).digest("hex");
    data.set(digest, bytes);
    const uses = kinds.get(digest) ?? new Set<WorkBlobKind>(); uses.add(kind); kinds.set(digest, uses);
    return digest;
  };
  const now = "2026-09-23T00:00:00Z", sourceWorkId = "work-000000000001";
  const common = { uid: 10001, gid: 10001, mode: 493, mtimeNs: "1727049600123456789" };
  const root = { ...common, type: "directory", segmentsBase64: [] };
  const emptyFile = add(Buffer.alloc(0), "file");
  const secretFile = add(fileContent, "file");
  const emptyTree = add(encodeWorkJson({ version: 1, entries: [root] }), "tree");
  const tree = add(encodeWorkJson({ version: 1, entries: [root,
    { ...common, type: "file", segmentsBase64: [Buffer.from(".env").toString("base64")], blob: secretFile, size: data.get(secretFile)!.length },
    { ...common, type: "file", segmentsBase64: [Buffer.from("empty").toString("base64")], blob: emptyFile, size: 0 },
  ] }), "tree");
  const agents = add(Buffer.from("AGENTS_PRIVATE_SENTINEL: never execute this fixture"), "file");
  const imageConfig = add(encodeWorkJson({ os: "linux", architecture: "amd64", rootfs: { type: "layers", diff_ids: [] } }), "image-config");
  const history: WorkControlHistory = {
    version: 1, work: { name: "golden", createdAt: now }, configurationRevisions: [{ revision: 1, contextKey: "c-000001" }],
    operations: [{ id: "operation-000000000001", workId: sourceWorkId, serviceId: null, kind: "historic-unknown", state: "succeeded", targetVersion: 1,
      requestJson: "HISTORY_PRIVATE_SENTINEL", resultJson: null, errorJson: null, createdAt: now, updatedAt: now }], idempotency: [],
  };
  const identities: WorkSourceIdentityMap = { version: 1, sourceWorkId, contexts: [{ sourceId: "context-000000000001", key: "c-000001" }], services: [], operations: [{ sourceId: "operation-000000000001", key: "o-000001" }] };
  const control = add(encodeWorkJson(history), "control-history"), sourceIdentityMap = add(encodeWorkJson(identities), "identity-map");
  const spec: PortableWorkSpec = {
    formatVersion: 1, snapshotKind: "cold-full", createdAt: now, sourceName: "golden",
    compatibility: { os: "linux", architecture: "amd64", variant: null, agentProtocol: "v2", workHistorySchema: 3, storageLayout: 2 },
    activeContext: null, desiredContext: "c-000001",
    contexts: [{ key: "c-000001", createdAt: now, skillsTree: emptyTree, agentsBlob: agents, imageKey: "i-000001", configuration: {
      modelBindingKey: "m-000001", skills: [], mcpServers: [], tools: { allowed: [], denied: [] },
      resources: { cpuMillis: 1000, memoryBytes: 268435456, agentCpuMillis: 500, agentMemoryBytes: 134217728, maxServices: 2, maxRetainedVolumes: 4 },
    } }], services: [],
    quotaReservations: [{ subjectKind: "agent", subjectKey: "agentd", desiredCpuMillis: 500, desiredMemoryBytes: 134217728, serviceSlots: 0, volumeSlots: 2 }],
    volumes: [{ role: "agent-private", tree, serviceRefKeys: [] }, { role: "workspace", tree, serviceRefKeys: [] }],
    images: [{ key: "i-000001", imageId: `sha256:${imageConfig}`, platform: { os: "linux", architecture: "amd64", variant: null }, config: imageConfig, layers: [] }],
    bindings: { models: [{ key: "m-000001", provider: "deterministic", model: "test", baseUrl: null }], secrets: [] },
    history: { control, sourceIdentityMap },
    blobs: [...data].sort(([a], [b]) => a.localeCompare(b)).map(([digest, bytes]) => ({ digest, size: bytes.length, kinds: WORK_BLOB_KINDS.filter((kind) => kinds.get(digest)!.has(kind)) })),
  };
  return { spec, data, metadata: new Map(spec.blobs.filter((blob) => blob.kinds.some((kind) => kind !== "file" && kind !== "image-layer")).map((blob) => [blob.digest, JSON.parse(data.get(blob.digest)!.toString()) as unknown])) };
}
