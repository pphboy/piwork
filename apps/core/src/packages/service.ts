import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import { PiPackageArtifactMetadataSchema, PiPackageNameSchema, PiPackageSourceSchema,
  type PiPackageArtifactMetadata, type PiPackageCatalogEntry, type PiPackageOperationAcceptance, type PiPackageSource } from "@piwork/contracts";
import { type CoreStore, type PiPackageJobRecord, PiPackageStoreError } from "@piwork/core-store";
import { assertPiPackageEnvironment, parsePiPackageSource } from "@piwork/pi-package";
import { DockerRuntime, PiPackageHelperIncompatibleError } from "@piwork/runtime-docker";
import type { RuntimeProfileStore } from "../configuration/runtime-profile.js";
import { PiPackageWorker } from "./worker.js";

export class CorePiPackageService {
  readonly worker: PiPackageWorker;
  constructor(private readonly store: CoreStore, private readonly runtime: DockerRuntime,
    private readonly profiles: RuntimeProfileStore, private readonly trustedHelperImage: string,
    installationId: string, dataDirectory: string,
    publishWork?: (job: PiPackageJobRecord, metadata: PiPackageArtifactMetadata, artifactDirectory: string) => Promise<void>) {
    this.worker = new PiPackageWorker({ store, runtime, installationId, dataDirectory, publishWork });
  }

  list(operator: boolean): PiPackageCatalogEntry[] {
    return this.store.packages.listCatalog(operator).map((row) => this.summary(row.name));
  }

  show(name: string, operator: boolean): PiPackageCatalogEntry & { resolvedSource: string } {
    this.assertName(name);
    const row = this.store.packages.getCatalog(name);
    if (!row || (!operator && !row.enabled)) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${name} is not installed`);
    const metadata = this.metadata(row.headArtifactId);
    return { ...this.summary(name), resolvedSource: metadata.resolvedSource };
  }

  private summary(name: string): PiPackageCatalogEntry {
    const row = this.store.packages.getCatalog(name);
    if (!row) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${name} is not installed`);
    const metadata = this.metadata(row.headArtifactId);
    return { name, version: metadata.version, sourceKind: metadata.sourceKind, enabled: row.enabled,
      isDefault: this.store.packages.isDefault(name), resourceCounts: metadata.resourceCounts };
  }

  private metadata(id: string): PiPackageArtifactMetadata {
    const artifact = this.store.packages.getArtifact(id);
    if (!artifact) throw new Error("package catalog points to a missing artifact");
    const metadata = JSON.parse(artifact.metadataJson) as unknown;
    if (!Check(PiPackageArtifactMetadataSchema, metadata)) throw new Error("package catalog metadata is invalid");
    return metadata as PiPackageArtifactMetadata;
  }

  private assertName(name: string): void {
    if (!Check(PiPackageNameSchema, name)) throw new TypeError("invalid package name");
  }

  private async assertHelperImages(...imageIds: string[]): Promise<void> {
    try {
      for (const imageId of imageIds) await this.runtime.inspectPiPackageHelperContract(imageId);
    } catch (error) {
      if (error instanceof PiPackageHelperIncompatibleError) {
        throw new PiPackageStoreError("PI_PACKAGE_HELPER_INCOMPATIBLE", "Selected agent image does not provide the package helper contract");
      }
      throw error;
    }
  }

  /** Return the first enabled package that cannot run in the selected agent image. */
  async incompatiblePackage(imageId: string, packages: readonly { name: string; enabled: boolean; metadata: PiPackageArtifactMetadata }[]): Promise<string | undefined> {
    const enabled = packages.filter((item) => item.enabled);
    if (enabled.length === 0) return undefined;
    const environment = await this.runtime.inspectPiPackageEnvironment(imageId);
    for (const item of enabled) {
      try { assertPiPackageEnvironment(item.metadata.preparedEnvironment, environment); }
      catch { return item.name; }
    }
    return undefined;
  }

  async install(source: PiPackageSource, addToDefaults: boolean, idempotencyKey: string): Promise<PiPackageOperationAcceptance> {
    return this.accept("install", null, source, addToDefaults, idempotencyKey);
  }

  async update(name: string, source: PiPackageSource, idempotencyKey: string): Promise<PiPackageOperationAcceptance> {
    this.assertName(name);
    return this.accept("update", name, source, false, idempotencyKey);
  }

  private async accept(kind: "install" | "update", name: string | null, source: PiPackageSource, addToDefaults: boolean, idempotencyKey: string): Promise<PiPackageOperationAcceptance> {
    if (!Check(PiPackageSourceSchema, source) || source.kind === "core") throw new TypeError("invalid Core package source");
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 256) throw new TypeError("invalid idempotency key");
    let sourceSemantic: unknown, sourceUploadId: string | undefined;
    if (source.kind === "npm" || source.kind === "git") {
      const parsed = parsePiPackageSource(`${source.kind}:${source.spec}`);
      sourceSemantic = { kind: parsed.kind, spec: source.spec };
    } else {
      const upload = this.store.packages.getUpload(source.uploadId);
      if (!upload || upload.actorId !== "operator" || upload.scopeKind !== "core" || !upload.digest) {
        throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "package upload is unavailable");
      }
      sourceSemantic = { kind: upload.sourceKind, digest: upload.digest, size: upload.size };
      sourceUploadId = source.uploadId;
    }
    const now = new Date();
    const requestDigest = createHash("sha256").update(JSON.stringify({ kind, name, source: sourceSemantic, addToDefaults })).digest("hex");
    const replay = this.store.packages.findReplay("operator", { kind: "core" }, kind, idempotencyKey, requestDigest);
    if (replay) return { operationId: replay.operationId, workId: null, correlationId: replay.operationId,
      reused: true, scope: "core", kind: `pi-package-${kind}`, name };
    if (sourceUploadId !== undefined && this.store.packages.getUpload(sourceUploadId)?.state !== "ready") {
      throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "package upload is unavailable");
    }
    if (kind === "update" && !this.store.packages.getCatalog(name!)) {
      throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", `package ${name} is not installed`);
    }
    const profile = this.profiles.load();
    const image = await this.runtime.prepareImage(profile.agentImage);
    const trusted = await this.runtime.prepareImage(this.trustedHelperImage);
    await this.assertHelperImages(image.imageId, trusted.imageId);
    const environment = await this.runtime.inspectPiPackageEnvironment(image.imageId);
    const accepted = this.store.packages.accept({ actorId: "operator", scope: { kind: "core" }, kind,
      prepareImageId: image.imageId, trustedHelperImageId: trusted.imageId,
      preparedEnvironmentJson: JSON.stringify(environment), addToDefaults, idempotencyKey, requestDigest,
      requestJson: JSON.stringify({ kind, name, source, addToDefaults }), sourceJson: JSON.stringify(source),
      ...(sourceUploadId === undefined ? {} : { sourceUploadId }), ...(name === null ? {} : { packageName: name }),
      deadlineAt: new Date(now.getTime() + 30 * 60_000).toISOString(), now: now.toISOString() });
    if (!accepted.reused) this.worker.kick();
    return { operationId: accepted.operationId, workId: null, correlationId: accepted.operationId,
      reused: accepted.reused, scope: "core", kind: `pi-package-${kind}`, name };
  }

  async acceptWork(input: { actorId: string; workId: string; imageIdentity: string; kind: "install" | "update";
    name: string | null; source: PiPackageSource; idempotencyKey: string }): Promise<PiPackageOperationAcceptance> {
    const { actorId, workId, imageIdentity, kind, name, source, idempotencyKey } = input;
    if (!Check(PiPackageSourceSchema, source) || !/^sha256:[a-f0-9]{64}$/.test(imageIdentity)
      || typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 256) throw new TypeError("invalid package request");
    if (kind === "update") { if (name === null) throw new TypeError("invalid package name"); this.assertName(name); }
    let sourceSemantic: unknown, sourceUploadId: string | undefined;
    if (source.kind === "npm" || source.kind === "git") {
      const parsed = parsePiPackageSource(`${source.kind}:${source.spec}`);
      sourceSemantic = { kind: parsed.kind, spec: source.spec };
    } else if (source.kind === "upload") {
      const upload = this.store.packages.getUpload(source.uploadId);
      if (!upload || upload.actorId !== actorId || upload.scopeKind !== "work" || upload.workId !== workId || !upload.digest) {
        throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "package upload is unavailable");
      }
      sourceSemantic = { kind: upload.sourceKind, digest: upload.digest, size: upload.size };
      sourceUploadId = source.uploadId;
    } else {
      if (kind === "update" && source.name !== name) throw new TypeError("invalid package name");
      sourceSemantic = { kind: "core", name: source.name };
    }
    const now = new Date(), requestDigest = createHash("sha256").update(JSON.stringify({ kind, name, source: sourceSemantic })).digest("hex");
    const replay = this.store.packages.findReplay(actorId, { kind: "work", workId }, kind, idempotencyKey, requestDigest);
    if (replay) return { operationId: replay.operationId, workId, correlationId: replay.operationId,
      reused: true, scope: "work", kind: `pi-package-${kind}`, name };
    if (sourceUploadId !== undefined && this.store.packages.getUpload(sourceUploadId)?.state !== "ready") {
      throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "package upload is unavailable");
    }
    const trusted = await this.runtime.prepareImage(this.trustedHelperImage);
    await this.assertHelperImages(imageIdentity, trusted.imageId);
    const environment = await this.runtime.inspectPiPackageEnvironment(imageIdentity);
    const accepted = this.store.packages.accept({ actorId, scope: { kind: "work", workId }, kind,
      prepareImageId: imageIdentity, trustedHelperImageId: trusted.imageId,
      preparedEnvironmentJson: JSON.stringify(environment), addToDefaults: false, idempotencyKey,
      requestDigest, requestJson: JSON.stringify({ kind, name, source }),
      sourceJson: JSON.stringify(source),
      ...(sourceUploadId === undefined ? {} : { sourceUploadId }), ...(name === null ? {} : { packageName: name }),
      deadlineAt: new Date(now.getTime() + 30 * 60_000).toISOString(), now: now.toISOString() });
    if (!accepted.reused) this.worker.kick();
    return { operationId: accepted.operationId, workId, correlationId: accepted.operationId,
      reused: accepted.reused, scope: "work", kind: `pi-package-${kind}`, name };
  }

  setEnabled(name: string, enabled: boolean): PiPackageCatalogEntry {
    this.assertName(name);
    this.store.packages.setCatalogEnabled(name, enabled, new Date().toISOString());
    return this.summary(name);
  }

  remove(name: string): void {
    this.assertName(name);
    this.store.packages.removeCatalog(name);
  }

  operation(operationId: string): Record<string, unknown> {
    const job = this.store.packages.getJob(operationId);
    if (!job || job.scopeKind !== "core") throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "package operation was not found");
    const operation = this.store.getOperation(operationId);
    if (!operation) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "package operation was not found");
    return { operationId, workId: null, kind: operation.kind, state: operation.state, packagePhase: job.phase, name: job.packageName,
      result: operation.resultJson ? JSON.parse(operation.resultJson) : null,
      error: operation.errorJson ? JSON.parse(operation.errorJson) : null,
      createdAt: operation.createdAt, updatedAt: operation.updatedAt };
  }
}
