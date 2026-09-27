import { createHash, randomUUID as cryptoRandomUUID } from "node:crypto";
import { constants, createReadStream, mkdirSync, rmSync } from "node:fs";
import { link, mkdir, open, rm, stat, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { CoreStore, type PiPackageJobRecord } from "@piwork/core-store";
import { PiPackageStoreError } from "@piwork/core-store";
import { DockerRuntime } from "@piwork/runtime-docker";
import { PiPackageInstallRequestSchema, PiPackageUpdateRequestSchema, PiPackageNameSchema, sortPiPackageSelection,
  AdminCreateUserRequestSchema, AdminResetCredentialRequestSchema, AdminEmptyActionSchema, AdminRuntimeInputSchema,
  AdminDefaultWorkPatchSchema, ADMIN_JSON_MAX_BYTES, normalizeAgentsMd,
  AdminPackageInstallRequestSchema, AdminPackageUpdateRequestSchema,
  type PiPackageArtifactMetadata, type PiPackageWorkEntry } from "@piwork/contracts";
import { Check } from "typebox/value";
import type { TSchema, Static } from "typebox";
import { CorePiPackageService } from "../packages/service.js";
import { receivePiPackageUpload } from "../packages/upload.js";
import { collectPiPackageArtifactGarbage, collectPiPackageUploadGarbage } from "../packages/gc.js";
import { PiPackageInputError } from "@piwork/pi-package";
import { SnapshotHelperAvailability } from "../work-snapshots/helper-availability.js";
import { authorizeSnapshotOwner, importProvenance } from "../work-snapshots/access.js";
import { WorkSnapshotAdmission } from "../work-snapshots/admission.js";
import { preflightWorkSnapshot } from "../work-snapshots/preflight.js";
import { executeExportSnapshot } from "../work-snapshots/export-worker.js";
import { executeImportSnapshot } from "../work-snapshots/import-worker.js";
import { recoverSnapshotJobs } from "../work-snapshots/recovery.js";
import { collectSnapshotGarbage } from "../work-snapshots/gc.js";
import { status as grpcStatus } from "@grpc/grpc-js";
import { IdentityService } from "../identity/sessions.js";
import { bootstrapAdministrator } from "../identity/bootstrap-admin.js";
import { UserAdministrationService } from "../identity/user-administration.js";
import type { UserPrincipal } from "../work-access/policy.js";
import { WorkLifecycleService, type WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import type { CorePaths, ListenAddress } from "./paths.js";
import { RuntimeProfileStore, validateRuntimeProfileInput, type RuntimeProfile } from "../configuration/runtime-profile.js";
import { WorkConfigurationService } from "../configuration/work-config.js";
import { WORK_PACKAGE_MIME, type RuntimeSkillState, type WorkConfig, type ImportWorkRequest } from "@piwork/contracts";
import { parseWorkJson, readWorkPackage, WORK_PACKAGE_LIMITS } from "@piwork/work-package";
import { DockerWorkRuntimeAdapter, ensureInstallationId, type ConversationGateway, type RuntimeSkillStateGateway } from "../runtime/docker-work-runtime.js";
import { ensureOperatorCredential, verifyOperatorCredential } from "./operator-credential.js";
import { assertValidPassword } from "../identity/password.js";
import { InputValidationError } from "../input-validation.js";
import { WorkConfigurationValidator } from "../configuration/validation.js";
import { registerRuntimeProfileCatalog, resolveRuntimeProfileFromWorkConfig, runtimeImageCatalogId, runtimeModelCatalogId } from "../configuration/runtime-catalog.js";
import { SkillArtifactStore } from "../configuration/skill-artifact-store.js";
import { CoreSkillService } from "../configuration/skills.js";
import { receiveSkillUpload } from "../configuration/skill-upload.js";
import { WorkContextStore, packageNameKey, type WorkContextPackageSource, type WorkContextSnapshot } from "../configuration/work-context.js";
import type { WorkContextSnapshotInput } from "@piwork/core-store";
import { emitDiagnostic } from "../work-management/diagnostics.js";
import { WorkServiceManagementService, type ServiceRuntimeAdapter } from "../work-services/service-management.js";
import { WorkServiceGrpcServer } from "../work-services/service-grpc-server.js";

export type ReadinessReason = "STORE_OPEN" | "LISTENING" | "ADMIN_REQUIRED" | "RUNTIME_NOT_CONFIGURED" | "RUNTIME_UNAVAILABLE" | "FILESYSTEM_MIGRATION_REQUIRED" | "RECOVERING" | "READY" | "SHUTTING_DOWN";

export interface FirstRunInitialization {
  readonly administrator?: { readonly account: string; readonly password: string };
  readonly runtime?: {
    readonly agentImage: string;
    readonly provider: string;
    readonly model: string;
    readonly baseUrl?: string;
    readonly credential: string;
  };
}

export interface CoreApplicationOptions {
  readonly paths: CorePaths;
  readonly runtimeFactory?: (application: CoreApplication) => Promise<WorkRuntimeAdapter>;
  readonly dependencyCheck?: () => Promise<void>;
  readonly initialization?: FirstRunInitialization;
  readonly agentGrpcAdvertise?: string;
  readonly agentGrpcListen?: string;
  readonly snapshotHelperImage?: string;
  readonly packageHelperImage?: string;
  readonly snapshotHelperResolver?: (reference: string) => Promise<string>;
  readonly snapshotDockerFactory?: (installationId: string) => DockerRuntime;
  readonly packageDockerFactory?: (installationId: string) => DockerRuntime;
}

export class CoreApplication {
  readonly store: CoreStore;
  readonly identity: IdentityService;
  readonly lifecycle: WorkLifecycleService;
  readonly users: UserAdministrationService;
  readonly workConfigurations: WorkConfigurationService;
  readonly runtimeProfiles: RuntimeProfileStore;
  readonly skills: CoreSkillService;
  readonly workContexts: WorkContextStore;
  readonly skillArtifacts: SkillArtifactStore;
  readonly services: WorkServiceManagementService;
  readonly snapshotHelper: SnapshotHelperAvailability;
  readonly snapshotAdmission: WorkSnapshotAdmission;
  readonly packages: CorePiPackageService;
  private readonly snapshotTasks = new Set<Promise<unknown>>();
  private readonly snapshotAbort = new AbortController();
  private snapshotRecoveryDone = false;
  private snapshotGcTimer?: NodeJS.Timeout;
  private snapshotGcTask?: Promise<void>;
  private snapshotGcRunning = false;
  private runtime?: WorkRuntimeAdapter & Partial<ConversationGateway> & { close?: () => void };
  private serviceRuntime?: ServiceRuntimeAdapter;
  private server?: Server;
  private serviceGrpc?: WorkServiceGrpcServer;
  private state: ReadinessReason = "STORE_OPEN";
  private packageRecoveryDone = false;
  private skillUploadsActive = 0;
  private runtimeRefreshTask?: Promise<void>;
  private configurationMutationTask: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(
    readonly paths: CorePaths,
    store: CoreStore,
    identity: IdentityService,
    lifecycle: WorkLifecycleService,
    workContexts: WorkContextStore,
    services: WorkServiceManagementService,
    snapshotHelper: SnapshotHelperAvailability,
    private readonly options: CoreApplicationOptions,
  ) {
    this.store = store;
    this.identity = identity;
    this.lifecycle = lifecycle;
    this.services = services;
    this.snapshotHelper = snapshotHelper;
    this.users = new UserAdministrationService(store);
    this.workConfigurations = new WorkConfigurationService(store);
    this.workContexts = workContexts;
    this.runtimeProfiles = new RuntimeProfileStore(paths.runtimeProfilePath, paths.secretsDirectory);
    this.snapshotAdmission = new WorkSnapshotAdmission(store, this.runtimeProfiles);
    const installationId = ensureInstallationId(paths);
    this.packages = new CorePiPackageService(store, options.packageDockerFactory?.(installationId) ?? new DockerRuntime(installationId), this.runtimeProfiles,
      options.packageHelperImage ?? "piwork-agentd:local", installationId, paths.dataDirectory,
      (job, metadata, artifactDirectory) => this.publishWorkPackage(job, metadata, artifactDirectory));
    this.skillArtifacts = new SkillArtifactStore(paths.skillsDirectory);
    this.skills = new CoreSkillService(store, this.skillArtifacts);
    this.skills.cleanupOrphans();
    const skillUploadRoot = join(paths.dataDirectory, "skill-uploads");
    rmSync(skillUploadRoot, { recursive: true, force: true });
    mkdirSync(skillUploadRoot, { recursive: true, mode: 0o700 });
    if (this.store.snapshots.listJobs(true).length === 0) this.workContexts.cleanupOrphans(new Set(
      this.store.listWorkContextSnapshots().map((snapshot) => `${snapshot.workId}\0${snapshot.snapshotId}`),
    ));
  }

  static async create(options: CoreApplicationOptions): Promise<CoreApplication> {
    if (options.initialization?.administrator !== undefined) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(options.initialization.administrator.account)) {
        throw new InputValidationError("account must be a valid identifier");
      }
      assertValidPassword(options.initialization.administrator.password);
    }
    if (options.initialization?.runtime !== undefined) validateRuntimeProfileInput(options.initialization.runtime);
    const store = CoreStore.open({ databasePath: options.paths.databasePath });
    try {
      ensureOperatorCredential(store, options.paths.operatorCredentialPath);
      if (!store.hasEnabledAdministrator() && options.initialization?.administrator !== undefined) {
        await bootstrapAdministrator({ store, ...options.initialization.administrator });
      }
      const profiles = new RuntimeProfileStore(options.paths.runtimeProfilePath, options.paths.secretsDirectory);
      if (!profiles.inspect().configured && options.initialization?.runtime !== undefined) {
        profiles.configure(options.initialization.runtime);
      }
      if (profiles.inspect().configured) {
        const profile = profiles.load();
        registerRuntimeProfileCatalog(store, profile);
        ensureBundledDeploymentSkill(store, options.paths);
        ensureDefaultWorkConfiguration(store, profile);
      }
      const identity = await IdentityService.create({ store });
      const workContexts = new WorkContextStore(options.paths.workContextsDirectory);
      let application!: CoreApplication;
      let runtime: WorkRuntimeAdapter = unavailableRuntime("runtime is not initialized");
      const services = new WorkServiceManagementService(store, proxyServiceRuntime(() => application?.serviceRuntime));
      const lifecycle = new WorkLifecycleService(store, proxyRuntime(() => application?.runtime ?? runtime), undefined, undefined, undefined, services, workContexts, undefined, ensureInstallationId(options.paths));
      const snapshotHelper = await SnapshotHelperAvailability.resolve(options.snapshotHelperImage,
        options.snapshotHelperResolver ?? ((reference) => new DockerRuntime(ensureInstallationId(options.paths)).resolveSnapshotHelperImage(reference)));
      application = new CoreApplication(options.paths, store, identity, lifecycle, workContexts, services, snapshotHelper, options);
      if (!store.hasEnabledAdministrator()) application.state = "ADMIN_REQUIRED";
      else if (!profiles.inspect().configured) application.state = "RUNTIME_NOT_CONFIGURED";
      else application.state = "STORE_OPEN";
      return application;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  async listen(address: ListenAddress): Promise<ListenAddress> {
    if (this.closed) throw new Error("CoreApplication is closed");
    if (this.server !== undefined) throw new Error("CoreApplication is already listening");
    this.server = createServer((request, response) => void this.route(request, response));
    this.server.requestTimeout = 31 * 60_000;
    if (this.state === "STORE_OPEN") this.state = "LISTENING";
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(address.port, address.host, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
    const actual = this.server.address();
    if (actual === null || typeof actual === "string") throw new Error("Core HTTP listener has no TCP address");
    if (this.options.agentGrpcListen !== undefined) {
      this.serviceGrpc = new WorkServiceGrpcServer(this.paths, ensureInstallationId(this.paths), this.store, this.services);
      await this.serviceGrpc.start(this.options.agentGrpcListen);
    }
    await this.refreshRuntime();
    this.packages.worker.kick();
    return { host: address.host, port: actual.port };
  }

  status(): { readonly state: ReadinessReason; readonly ready: boolean; readonly checks: Record<string, boolean> } {
    const runtimeConfigured = this.runtimeProfiles.inspect().configured;
    return {
      state: this.state,
      ready: this.state === "READY",
      checks: {
        administrator: this.store.hasEnabledAdministrator(),
        runtimeConfigured,
        runtimeAvailable: this.runtime !== undefined,
        filesystemMigrationReady: true,
      },
    };
  }

  refreshRuntime(force = false): Promise<void> {
    const prior = this.runtimeRefreshTask;
    const task = (async () => { await prior; await this.refreshRuntimeInternal(force); })();
    this.runtimeRefreshTask = task;
    void task.then(() => { if (this.runtimeRefreshTask === task) this.runtimeRefreshTask = undefined; },
      () => { if (this.runtimeRefreshTask === task) this.runtimeRefreshTask = undefined; });
    return task;
  }

  private async refreshRuntimeInternal(force: boolean): Promise<void> {
    if (!this.store.hasEnabledAdministrator()) { this.state = "ADMIN_REQUIRED"; return; }
    if (!this.runtimeProfiles.inspect().configured) { this.state = "RUNTIME_NOT_CONFIGURED"; return; }
    if (this.runtime !== undefined && !force && this.state !== "RUNTIME_UNAVAILABLE") { this.state = "READY"; return; }
    const previous = this.runtime;
    let runtime: WorkRuntimeAdapter = unavailableRuntime("runtime is not initialized");
    try {
      await this.options.dependencyCheck?.();
      runtime = this.options.runtimeFactory === undefined
        ? new DockerWorkRuntimeAdapter(this.paths, ensureInstallationId(this.paths), {}, this.options.agentGrpcAdvertise)
        : await this.options.runtimeFactory(this);
      if (runtime instanceof DockerWorkRuntimeAdapter) await runtime.verifyDependency();
      this.serviceRuntime = runtime instanceof DockerWorkRuntimeAdapter ? runtime.serviceRuntime() : undefined;
      this.runtime = runtime;
      this.state = "RECOVERING";
      if (!this.snapshotRecoveryDone) {
        await recoverSnapshotJobs({ store: this.store, contexts: this.workContexts, runtime: this.snapshotDocker(), snapshotsDirectory: this.paths.snapshotsDirectory });
        if (this.store.snapshots.listJobs(true).length === 0) this.workContexts.cleanupOrphans(new Set(
          this.store.listWorkContextSnapshots().map((snapshot) => `${snapshot.workId}\0${snapshot.snapshotId}`)));
        await collectSnapshotGarbage({ store: this.store, runtime: this.snapshotDocker(), snapshotsDirectory: this.paths.snapshotsDirectory });
        this.snapshotRecoveryDone = true;
      }
      if (!this.packageRecoveryDone) {
        await this.packages.worker.recover();
        await collectPiPackageUploadGarbage(this.store, this.paths.dataDirectory).catch(() => undefined);
        await collectPiPackageArtifactGarbage(this.store, this.paths.dataDirectory).catch(() => undefined);
        this.packageRecoveryDone = true;
      }
      if (!this.snapshotGcTimer) {
        this.snapshotGcTimer = setInterval(() => {
          if (this.snapshotGcRunning || this.closed) return;
          this.snapshotGcRunning = true;
          this.snapshotGcTask = (async () => {
            if (this.snapshotTasks.size === 0) await recoverSnapshotJobs({ store: this.store, contexts: this.workContexts,
              runtime: this.snapshotDocker(), snapshotsDirectory: this.paths.snapshotsDirectory, onlyCleanupPending: true });
            await collectSnapshotGarbage({ store: this.store, runtime: this.snapshotDocker(), snapshotsDirectory: this.paths.snapshotsDirectory });
            await collectPiPackageUploadGarbage(this.store, this.paths.dataDirectory);
          })().catch(() => undefined).finally(() => { this.snapshotGcRunning = false; this.snapshotGcTask = undefined; });
        }, 60_000);
        this.snapshotGcTimer.unref();
      }
      await this.lifecycle.recover();
      this.services.startReconciliation();
      if (previous !== undefined && previous !== runtime) previous.close?.();
      this.state = "READY";
    } catch (error) {
      if (runtime !== previous) (runtime as WorkRuntimeAdapter & { close?: () => void }).close?.();
      this.runtime = previous;
      this.state = "RUNTIME_UNAVAILABLE";
      process.stderr.write(`${JSON.stringify({ event: "core.runtime-unavailable", error: safeRuntimeFailure(error) })}\n`);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.state = "SHUTTING_DOWN";
    if (this.snapshotGcTimer) clearInterval(this.snapshotGcTimer);
    this.snapshotAbort.abort(new Error("CORE_SHUTDOWN"));
    this.services.closeAdmission();
    const failures: Array<{ stage: string; error: unknown }> = [];
    try {
      for (const [stage, close] of [
        ["http-listener", () => closeServer(this.server)],
        ["package-worker", () => this.packages.worker.shutdown()],
        ["snapshot-tasks", () => this.waitSnapshotTasks()],
        ["service-grpc", () => this.serviceGrpc?.close() ?? Promise.resolve()],
        ["work-runtime", () => this.lifecycle.shutdown(this.runtime !== undefined)],
        ["services", () => this.services.shutdown()],
      ] as const) {
        try { await close(); }
        catch (error) { failures.push({ stage, error }); }
      }
      try { this.runtime?.close?.(); }
      catch (error) { failures.push({ stage: "runtime-client", error }); }
      if (failures.length > 0) throw new AggregateError(failures.map((item) => item.error),
        `Core shutdown failed in: ${failures.map((item) => item.stage).join(", ")}`);
    } finally {
      this.store.close();
    }
  }

  private async buildWorkContext(
    workId: string,
    userId: string,
    configuration: WorkConfig,
    _runtimeProfileJson: string,
    preserveContextId?: string,
    reselectSkills = false,
    correlationId = `correlation-${cryptoRandomUUID()}`,
    packageOverride?: WorkContextPackageSource,
  ) {
    let leasedCoreArtifactIds: string[] = [];
    emitDiagnostic({ timestamp: new Date().toISOString(), level: "info", component: "core", stage: "context-copy", outcome: "started", correlationId, code: "CONTEXT_COPY_FAILED", message: "Work context copy started.", workId });
    try {
    const currentDesiredContextId = this.store.getWorkConfiguration(workId)?.desiredContextId;
    const retainedContextId = preserveContextId ?? currentDesiredContextId ?? undefined;
    const retained = retainedContextId === undefined ? undefined : this.workContexts.load(workId, retainedContextId);
    const preserveSkills = !reselectSkills && retained !== undefined
      && JSON.stringify(retained.configuration.skills) === JSON.stringify(configuration.skills);
    const sources = preserveSkills
      ? retained.metadata.skills.map((skill) => ({
          name: skill.name,
          identity: skill.identity,
          directory: join(retained.directory, "skills", skill.name),
        }))
      : configuration.skills.map((name) => {
          const record = this.store.getManagedSkill(name);
          if (record === undefined || !record.enabled) throw api(400, "SKILL_UNAVAILABLE", `Skill ${name} is unavailable`);
          const artifact = this.skillArtifacts.inspect(name, record.currentIdentity);
          return { name, identity: record.currentIdentity, directory: artifact.directory };
        });
    const coreNames = retained === undefined ? configuration.packages.filter(({ name }) => packageOverride?.name !== name).map(({ name }) => name) : [];
    const coreHeads = this.store.packages.leaseCatalogHeads(coreNames);
    leasedCoreArtifactIds = coreHeads.map(({ id }) => id);
    const coreByName = new Map(coreHeads.map((artifact) => [artifact.name, artifact]));
    const packageSources = configuration.packages.map(({ name }) => {
      if (packageOverride?.name === name) return packageOverride;
      const retainedBinding = retained?.metadata.packageBindings.find((binding) => binding.name === name);
      if (retainedBinding !== undefined) {
        return { name, metadata: retainedBinding.artifact,
          directory: join(retained!.directory, "packages", retainedBinding.nameKey) };
      }
      if (retained !== undefined) throw api(400, "PI_PACKAGE_NOT_INSTALLED", `Package ${name} is not installed in this Work`);
      const artifact = coreByName.get(name);
      if (artifact === undefined) throw api(400, "PI_PACKAGE_NOT_FOUND", `Package ${name} is unavailable`);
      return { name, metadata: JSON.parse(artifact.metadataJson) as import("@piwork/contracts").PiPackageArtifactMetadata,
        directory: artifact.storagePath };
    });
    const ownedImage = this.store.snapshots.getOwnedImage(workId, configuration.agentImage.catalogId);
    const preserveImage = retained !== undefined
      && retained.configuration.agentImage.catalogId === configuration.agentImage.catalogId;
    let imageIdentity: string;
    if (preserveImage) {
      imageIdentity = retained.metadata.imageIdentity;
    } else if (ownedImage !== undefined) {
      imageIdentity = ownedImage.imageIdentity;
    } else {
      const image = this.store.getCatalogEntry(configuration.agentImage.catalogId);
      if (image === undefined || image.kind !== "agent_image" || !image.enabled) throw api(400, "INVALID_CONFIGURATION", "Work agent image reference is unavailable");
      const reference = image.resolvedDigest ?? image.mutableReference;
      if (reference === null) throw api(400, "INVALID_CONFIGURATION", "Work agent image reference is unavailable");
      if (/^sha256:[a-f0-9]{64}$/.test(image.resolvedDigest ?? "")) imageIdentity = image.resolvedDigest!;
      else {
      const resolved = await this.runtime?.resolveImageIdentity?.(reference);
      if (resolved === undefined) throw api(503, "RUNTIME_UNAVAILABLE", "Work agent image identity could not be captured");
      imageIdentity = resolved;
      }
    }
    if (packageOverride === undefined) {
      const incompatible = await this.packages.incompatiblePackage(imageIdentity, packageSources.map((source, index) => ({
        name: source.name,
        enabled: configuration.packages[index]!.enabled,
        metadata: source.metadata,
      })));
      if (incompatible !== undefined) throw api(409, "PI_PACKAGE_ENVIRONMENT_MISMATCH",
        `Package ${incompatible} was prepared for a different agent environment; update it for this Work image before retrying.`);
    }
    const snapshot = this.workContexts.build({
      workId,
      configuration,
      imageIdentity,
      skills: sources,
      packages: packageSources,
      createdAt: new Date().toISOString(),
    });
    emitDiagnostic({ timestamp: new Date().toISOString(), level: "info", component: "core", stage: "context-copy", outcome: "succeeded", correlationId, code: "CONTEXT_COPY_FAILED", message: "Work context content was copied.", workId });
    emitDiagnostic({ timestamp: new Date().toISOString(), level: "info", component: "core", stage: "context-validate", outcome: "succeeded", correlationId, code: "SKILL_VALIDATION_FAILED", message: "Work context was validated.", workId });
    return snapshot;
    } catch (error) {
      emitDiagnostic({ timestamp: new Date().toISOString(), level: "error", component: "core", stage: "context-copy", outcome: "failed", correlationId, code: "CONTEXT_COPY_FAILED", message: "The selected Work context could not be copied.", workId });
      throw error;
    } finally {
      this.store.packages.releaseArtifactLeases(leasedCoreArtifactIds);
    }
  }

  private async publishWorkPackage(job: PiPackageJobRecord, metadata: PiPackageArtifactMetadata, artifactDirectory: string): Promise<void> {
    if (!job.workId) throw new Error("Work package job has no Work identity");
    const workId = job.workId;
    for (let attempt = 0; attempt < 8; attempt++) {
      const state = this.store.getWorkConfiguration(workId);
      if (!state || !state.desiredContextId) throw new PiPackageStoreError("PI_PACKAGE_STALE_JOB", "Work no longer exists");
      const current = JSON.parse(state.desiredConfigJson) as WorkConfig;
      const existing = current.packages.find((item) => item.name === metadata.name);
      if (job.kind === "install" && existing) throw new PiPackageStoreError("PI_PACKAGE_ALREADY_INSTALLED", "Package is already installed in this Work");
      if (job.kind === "update" && !existing) throw new PiPackageStoreError("PI_PACKAGE_NOT_FOUND", "Package is no longer installed in this Work");
      const configuration: WorkConfig = { ...current, packages: sortPiPackageSelection(job.kind === "install"
        ? [...current.packages, { name: metadata.name, enabled: true }] : current.packages) };
      const resolved = resolveRuntimeProfileFromWorkConfig(this.store, configuration, workId);
      const snapshot = await this.buildWorkContext(workId, job.actorId, configuration, JSON.stringify(resolved.profile),
        state.desiredContextId, false, `correlation-${cryptoRandomUUID()}`,
        { name: metadata.name, metadata, directory: artifactDirectory });
      try {
        const createdAt = new Date().toISOString();
        this.store.packages.publishWork({ operationId: job.operationId, workerEpoch: job.workerEpoch,
          expectedRevision: state.desiredRevision, configJson: JSON.stringify(configuration),
          runtimeProfileJson: JSON.stringify(resolved.profile), sourceRuntimeRevision: resolved.sourceRuntimeRevision,
          snapshot: persistedSnapshot(snapshot, job.actorId),
          artifact: { id: `${workId}:${snapshot.snapshotId}:${metadata.contentDigest}`, scopeKind: "work", workId,
            name: metadata.name, contentDigest: metadata.contentDigest, metadataJson: JSON.stringify(metadata),
            storagePath: join(snapshot.directory, "packages", packageNameKey(metadata.name)), createdAt },
          now: createdAt, resultJson: JSON.stringify({ name: metadata.name, version: metadata.version,
            resourceCounts: metadata.resourceCounts, scope: "work", pendingApply: true }) });
        return;
      } catch (error) {
        this.workContexts.remove(workId, snapshot.snapshotId);
        if (error instanceof PiPackageStoreError && error.code === "PI_PACKAGE_REVISION_CONFLICT") continue;
        throw error;
      }
    }
    throw new PiPackageStoreError("PI_PACKAGE_REVISION_CONFLICT", "Work changed too frequently during package publication");
  }

  private async workConfigurationView(principal: UserPrincipal, workId: string) {
    const value = this.workConfigurations.get(principal, workId);
    const work = this.lifecycle.show(principal, workId);
    const runtime = this.runtime as Partial<RuntimeSkillStateGateway> | undefined;
    const observation: RuntimeSkillState = work.observedState === "failed"
      ? { state: "failed", checkedAt: null, skills: [] }
      : work.observedState === "starting" || work.observedState === "provisioning"
        ? { state: "initializing", checkedAt: null, skills: [] }
        : !["ready", "degraded"].includes(work.observedState) || runtime?.runtimeSkillState === undefined
          ? { state: "unavailable", checkedAt: null, skills: [] }
          : await runtime.runtimeSkillState(workId);
    return { ...value, runtime: observation };
  }

  private async workPackageList(principal: UserPrincipal, workId: string): Promise<PiPackageWorkEntry[]> {
    const work = this.lifecycle.show(principal, workId);
    const state = this.store.getWorkConfiguration(workId);
    if (!state || !state.desiredContextId) throw api(404, "NOT_FOUND", "Work context was not found");
    const desired = this.workContexts.load(workId, state.desiredContextId);
    const active = state.activeContextId === null ? null : this.workContexts.load(workId, state.activeContextId);
    const runtime = this.runtime as Partial<RuntimeSkillStateGateway> | undefined;
    const runtimeObservation = ["ready", "degraded"].includes(work.observedState) && runtime?.runtimeSkillState !== undefined
      ? await runtime.runtimeSkillState(workId) : { state: "unavailable" as const, packages: [] };
    const names = new Set<string>();
    for (const snapshot of this.store.listWorkContextSnapshots(workId)) {
      for (const binding of this.workContexts.load(workId, snapshot.snapshotId).metadata.packageBindings) names.add(binding.name);
    }
    const entry = (context: WorkContextSnapshot | null, name: string) => {
      const selected = context?.configuration.packages.find((item) => item.name === name);
      const binding = context?.metadata.packageBindings.find((item) => item.name === name);
      return selected && binding ? { version: binding.artifact.version, enabled: selected.enabled, digest: binding.artifact.contentDigest } : null;
    };
    return [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map((name) => {
      const desiredEntry = entry(desired, name), activeEntry = entry(active, name);
      const observed = runtimeObservation.packages?.find((item) => item.name === name);
      return { name,
        desired: desiredEntry === null ? null : { version: desiredEntry.version, enabled: desiredEntry.enabled },
        active: activeEntry === null ? null : { version: activeEntry.version, enabled: activeEntry.enabled },
        pendingApply: desiredEntry?.digest !== activeEntry?.digest || desiredEntry?.enabled !== activeEntry?.enabled,
        runtime: { availability: runtimeObservation.state === "ready" ? "available" : "unavailable",
          loaded: runtimeObservation.state === "ready" ? observed?.loaded ?? false : null,
          diagnostics: observed?.diagnostics ?? [] },
      };
    });
  }

  private async editWorkPackageSelection(principal: UserPrincipal, workId: string, name: string,
    action: "enable" | "disable" | "remove"): Promise<PiPackageWorkEntry | null> {
    if (!Check(PiPackageNameSchema, name)) throw api(400, "INVALID_REQUEST", "invalid package name");
    const current = (await this.workPackageList(principal, workId)).find((item) => item.name === name);
    if (!current || current.desired === null) throw api(404, "PI_PACKAGE_NOT_FOUND", "Package is not installed in this Work");
    if (this.store.packages.listJobs(true).some((job) => job.workId === workId)) throw api(409, "PI_PACKAGE_BUSY", "Work package operation is active");
    if (action !== "remove" && current.desired.enabled === (action === "enable")) return current;
    await this.workConfigurations.updateMerged(principal, workId, (configuration) => ({ ...configuration,
      packages: action === "remove" ? configuration.packages.filter((item) => item.name !== name)
        : configuration.packages.map((item) => item.name === name ? { ...item, enabled: action === "enable" } : item),
    }), async (configuration) => {
      const resolved = resolveRuntimeProfileFromWorkConfig(this.store, configuration, workId);
      const snapshot = await this.buildWorkContext(workId, principal.userId, configuration, JSON.stringify(resolved.profile));
      return { runtimeProfileJson: JSON.stringify(resolved.profile), sourceRuntimeRevision: resolved.sourceRuntimeRevision,
        snapshot: persistedSnapshot(snapshot, principal.userId) };
    });
    return (await this.workPackageList(principal, workId)).find((item) => item.name === name) ?? null;
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const correlationId = `correlation-${cryptoRandomUUID()}`;
    try {
      const url = new URL(request.url ?? "/", "http://core.invalid");
      if (request.method === "GET" && url.pathname === "/healthz") return send(response, 200, { status: "healthy" });
      if (request.method === "GET" && url.pathname === "/readyz") {
        const ready = this.state === "READY";
        return send(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", reason: this.state, ...this.status() });
      }
      if (request.method === "GET" && url.pathname === "/control/status") {
        if (this.state === "RUNTIME_UNAVAILABLE") await this.refreshRuntime();
        return send(response, 200, this.status());
      }
      if (url.pathname.startsWith("/control/")) {
        requireOperator(request, this.store);
        const control = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const actor = { userId: "operator", role: "admin" as const };
        if (request.method === "POST" && url.pathname === "/control/admin/bootstrap") {
          const body = await readJson<{ account?: unknown; password?: unknown }>(request);
          if (typeof body.account !== "string" || typeof body.password !== "string") throw api(400, "INVALID_REQUEST", "account and password are required");
          const created = await bootstrapAdministrator({ store: this.store, account: body.account, password: body.password });
          await this.refreshRuntime();
          return send(response, 201, created);
        }
        if (request.method === "GET" && url.pathname === "/control/users") return send(response, 200, { users: this.users.listUsers(actor) });
        if (request.method === "POST" && url.pathname === "/control/users") {
          const body = await readJson<{ account?: unknown; password?: unknown; role?: unknown }>(request);
          if (typeof body.account !== "string" || typeof body.password !== "string" || (body.role !== undefined && body.role !== "admin" && body.role !== "user")) throw api(400, "INVALID_REQUEST", "account and password are required");
          return send(response, 201, await this.users.createUser(actor, { account: body.account, password: body.password, ...(body.role === undefined ? {} : { role: body.role }) }));
        }
        if (control[0] === "control" && control[1] === "users" && control.length === 4 && request.method === "POST") {
          const userId = control[2]!;
          if (control[3] === "enable") { this.users.setEnabled(actor, userId, true); return send(response, 200, { userId, enabled: true }); }
          if (control[3] === "disable") { this.users.setEnabled(actor, userId, false); return send(response, 200, { userId, enabled: false }); }
          if (control[3] === "reset-credential") {
            const body = await readJson<{ password?: unknown }>(request);
            if (typeof body.password !== "string") throw api(400, "INVALID_REQUEST", "password is required");
            await this.users.resetPassword(actor, userId, body.password);
            return send(response, 200, { userId, credentialReset: true });
          }
        }
        if (request.method === "GET" && url.pathname === "/control/runtime") return send(response, 200, this.runtimeProfiles.inspect());
        if (request.method === "GET" && url.pathname === "/control/packages") return send(response, 200, { packages: this.packages.list(true) });
        if (request.method === "POST" && url.pathname === "/control/package-uploads") {
          return send(response, 201, await receivePiPackageUpload({ request, store: this.store, dataDirectory: this.paths.dataDirectory,
            actorId: "operator", scope: { kind: "core" } }));
        }
        if (request.method === "POST" && url.pathname === "/control/packages") {
          const body = await readJson<unknown>(request);
          if (!Check(PiPackageInstallRequestSchema, body)) throw api(400, "INVALID_REQUEST", "package install request is invalid");
          return send(response, 202, await this.packages.install(body.source, body.addToDefaults ?? false, body.idempotencyKey, "operator"));
        }
        if (control[0] === "control" && control[1] === "packages" && control.length === 3) {
          const name = control[2]!;
          if (request.method === "GET") return send(response, 200, this.packages.show(name, true));
          if (request.method === "DELETE") { this.packages.remove(name); response.writeHead(204); response.end(); return; }
        }
        if (control[0] === "control" && control[1] === "packages" && control.length === 4 && request.method === "POST") {
          const name = control[2]!;
          if (control[3] === "enable") return send(response, 200, this.packages.setEnabled(name, true));
          if (control[3] === "disable") return send(response, 200, this.packages.setEnabled(name, false));
          if (control[3] === "update") {
            const body = await readJson<unknown>(request);
            if (!Check(PiPackageUpdateRequestSchema, body)) throw api(400, "INVALID_REQUEST", "package update request is invalid");
            return send(response, 202, await this.packages.update(name, body.source, body.idempotencyKey, "operator"));
          }
        }
        if (control[0] === "control" && control[1] === "operations" && control.length === 3 && request.method === "GET") {
          return send(response, 200, this.packages.operation(control[2]!));
        }
        if (request.method === "GET" && url.pathname === "/control/skills") return send(response, 200, { skills: this.skills.listForOperator(actor) });
        if (request.method === "POST" && url.pathname === "/control/skills") {
          const body = await readJson<{ path?: unknown }>(request);
          if (typeof body.path !== "string") throw api(400, "INVALID_REQUEST", "path is required");
          return send(response, 201, this.skills.add(actor, body.path));
        }
        if (control[0] === "control" && control[1] === "skills" && control.length === 3 && request.method === "GET") {
          return send(response, 200, this.skills.showForOperator(actor, control[2]!));
        }
        if (control[0] === "control" && control[1] === "skills" && control.length === 3 && request.method === "DELETE") {
          this.skills.remove(actor, control[2]!); response.writeHead(204); response.end(); return;
        }
        if (control[0] === "control" && control[1] === "skills" && control.length === 4 && request.method === "POST") {
          if (control[3] === "enable") return send(response, 200, this.skills.enable(actor, control[2]!));
          if (control[3] === "disable") return send(response, 200, this.skills.disable(actor, control[2]!));
        }
        if (control[0] === "control" && control[1] === "skills" && control.length === 3 && request.method === "PUT") {
          const body = await readJson<{ path?: unknown }>(request);
          if (typeof body.path !== "string") throw api(400, "INVALID_REQUEST", "path is required");
          return send(response, 200, this.skills.update(actor, control[2]!, body.path));
        }
        if (request.method === "PUT" && url.pathname === "/control/runtime") {
          const body = await readJson<{ agentImage?: unknown; provider?: unknown; model?: unknown; baseUrl?: unknown; credential?: unknown }>(request);
          if (typeof body.agentImage !== "string" || typeof body.provider !== "string" || typeof body.model !== "string" || typeof body.credential !== "string" || (body.baseUrl !== undefined && typeof body.baseUrl !== "string")) throw api(400, "INVALID_REQUEST", "agentImage, provider, model, and credential are required");
          validateRuntimeProfileInput({ agentImage: body.agentImage, provider: body.provider, model: body.model, credential: body.credential, ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }) });
          return send(response, 200, await this.runConfigurationMutation(async () => {
            const configured = await this.saveRuntime({ agentImage: body.agentImage!, provider: body.provider!, model: body.model!, credential: body.credential!,
              ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }) } as { agentImage: string; provider: string; model: string; baseUrl?: string; credential: string });
            if (this.state !== "READY") throw api(503, "RUNTIME_UNAVAILABLE", "the configured runtime is unavailable");
            return configured;
          }));
        }
        if (request.method === "GET" && url.pathname === "/control/default-work") {
          const profile = this.runtimeProfiles.inspect().configured ? this.runtimeProfiles.load() : undefined;
          const envelope = this.store.getDefaultWorkConfiguration();
          const resolved = envelope?.configuration === null && profile !== undefined
            ? ensureDefaultWorkConfiguration(this.store, profile)
            : envelope;
          if (resolved === undefined || resolved.configuration === null) return send(response, 200, { configuration: null });
          return send(response, 200, { configuration: publicWorkConfig(resolved.configuration as WorkConfig) });
        }
        if (request.method === "PUT" && url.pathname === "/control/default-work") {
          const body = await readJson<{ expectedRevision?: unknown; configuration?: unknown; patch?: unknown; baseImage?: unknown }>(request);
          if (body.expectedRevision !== undefined) throw api(400, "INVALID_REQUEST", "expectedRevision is obsolete");
          if (body.patch !== undefined) {
            if (body.configuration !== undefined || body.baseImage !== undefined || body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch)) {
              throw api(400, "INVALID_REQUEST", "patch must be an object and cannot accompany configuration");
            }
            const patch = body.patch as Record<string, unknown>;
            if (Object.keys(patch).some((key) => !["baseImage", "agentImage", "skills", "packages", "agentsMd", "modelRef", "mcpServers", "resources", "tools"].includes(key))) {
              throw api(400, "INVALID_REQUEST", "patch contains an unknown Work configuration field");
            }
            if (patch.baseImage !== undefined && (typeof patch.baseImage !== "string" || patch.agentImage !== undefined)) {
              throw api(400, "INVALID_REQUEST", "baseImage must be a string and cannot accompany agentImage");
            }
            const { baseImage, ...fields } = patch;
            const now = new Date().toISOString();
            const result = this.store.updateDefaultWorkConfiguration(fields, now, (candidate) => {
              let next = candidate;
              if (typeof baseImage === "string") {
                if (baseImage.trim() === "" || baseImage.length > 4096) throw api(400, "INVALID_REQUEST", "baseImage is invalid");
                const id = `image-${createHash("sha256").update(baseImage).digest("hex").slice(0, 24)}`;
                if (this.store.getCatalogEntry(id) === undefined) this.store.createCatalogEntry({ id, kind: "agent_image", name: baseImage,
                  mutableReference: baseImage, resolvedDigest: null, metadataJson: JSON.stringify({ version: 1, source: "default-work" }),
                  enabled: true, createdAt: now, updatedAt: now });
                next = { ...candidate, agentImage: { catalogId: id } };
              }
              return new WorkConfigurationValidator(this.store).validate({ workOwnerUserId: "operator", configuration: next });
            });
            return send(response, 200, { configuration: publicWorkConfig(result.configuration as WorkConfig) });
          }
          if (body.configuration === null || typeof body.configuration !== "object" || Array.isArray(body.configuration)) throw api(400, "INVALID_REQUEST", "configuration is required");
          let candidate = body.configuration as Record<string, unknown>;
          if (typeof body.baseImage === "string") {
            const id = `image-${createHash("sha256").update(body.baseImage).digest("hex").slice(0, 24)}`;
            if (this.store.getCatalogEntry(id) === undefined) this.store.createCatalogEntry({ id, kind: "agent_image", name: body.baseImage, mutableReference: body.baseImage, resolvedDigest: null, metadataJson: JSON.stringify({ version: 1, source: "default-work" }), enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            candidate = { ...candidate, agentImage: { catalogId: id } };
          }
          const configuration = new WorkConfigurationValidator(this.store).validate({ workOwnerUserId: "operator", configuration: candidate });
          const result = this.store.updateDefaultWorkConfiguration(configuration as unknown as Record<string, unknown>, new Date().toISOString());
          return send(response, 200, { configuration: publicWorkConfig(result.configuration as WorkConfig) });
        }
        throw api(404, "NOT_FOUND", "route not found");
      }
      if (request.method === "POST" && url.pathname === "/api/v1/login") {
        const body = await readJson<{ account?: unknown; password?: unknown }>(request);
        if (typeof body.account !== "string" || typeof body.password !== "string") throw api(400, "INVALID_REQUEST", "account and password are required");
        return send(response, 200, await this.identity.login(body.account, body.password, request.socket.remoteAddress ?? "unknown"));
      }
      if (url.pathname === "/api/v1/admin" || url.pathname.startsWith("/api/v1/admin/")) {
        await this.routeAdmin(request, response, url, correlationId);
        return;
      }
      if (!url.pathname.startsWith("/api/v1/")) throw api(404, "NOT_FOUND", "route not found");
      const token = bearer(request);
      const session = this.identity.authenticate(token);
      const principal: UserPrincipal = { userId: session.user.id, role: session.user.role };
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      if (await this.snapshotRoute(request, response, principal, parts)) return;
      if (request.method === "GET" && url.pathname === "/api/v1/me") return send(response, 200, { ...session.user, expiresAt: session.expiresAt });
      if (request.method === "GET" && url.pathname === "/api/v1/packages") return send(response, 200, { packages: this.packages.list(false) });
      if (request.method === "GET" && parts.length === 4 && parts[2] === "packages") return send(response, 200, this.packages.show(parts[3]!, false));
      if (request.method === "GET" && url.pathname === "/api/v1/skills") return send(response, 200, { skills: this.skills.listForUser(principal) });
      if (request.method === "GET" && parts.length === 4 && parts[2] === "skills") return send(response, 200, this.skills.showForUser(principal, parts[3]!));
      if (request.method === "POST" && url.pathname === "/api/v1/logout") { this.identity.logout(token); response.writeHead(204); response.end(); return; }
      if (parts[2] === "works" && parts.length === 3 && request.method === "GET") return send(response, 200, { works: this.lifecycle.list(principal) });
      if (parts[2] === "works" && parts.length === 3 && request.method === "POST") {
        requireRuntime(this.state);
        const body = await readJson<{ name?: unknown; configuration?: unknown; baseImage?: unknown; skills?: unknown; packages?: unknown; agentsMd?: unknown; idempotencyKey?: unknown }>(request);
        if (typeof body.name !== "string" || typeof body.idempotencyKey !== "string" || (body.configuration !== undefined && (body.configuration === null || typeof body.configuration !== "object"))) throw api(400, "INVALID_REQUEST", "name and idempotencyKey are required");
        const profile = this.runtimeProfiles.load();
        const envelope = this.store.getDefaultWorkConfiguration();
        let configuration = body.configuration === undefined
          ? (envelope?.configuration === null || envelope?.configuration === undefined ? defaultWorkConfiguration(profile) : envelope.configuration as WorkConfig)
          : body.configuration as WorkConfig;
        if (body.baseImage !== undefined || body.skills !== undefined || body.packages !== undefined || body.agentsMd !== undefined) {
          if (body.baseImage !== undefined && typeof body.baseImage !== "string") throw api(400, "INVALID_REQUEST", "baseImage must be a string");
          if (body.skills !== undefined && !Array.isArray(body.skills)) throw api(400, "INVALID_REQUEST", "skills must be an array");
          if (body.packages !== undefined && !Array.isArray(body.packages)) throw api(400, "INVALID_REQUEST", "packages must be an array");
          if (body.agentsMd !== undefined && typeof body.agentsMd !== "string") throw api(400, "INVALID_REQUEST", "agentsMd must be a string");
          configuration = { ...configuration, ...(body.baseImage === undefined ? {} : { agentImage: { catalogId: body.baseImage } }), ...(body.skills === undefined ? {} : { skills: body.skills }), ...(body.packages === undefined ? {} : { packages: body.packages }), ...(body.agentsMd === undefined ? {} : { agentsMd: body.agentsMd }) } as WorkConfig;
        }
        configuration = new WorkConfigurationValidator(this.store).validate({ workOwnerUserId: principal.userId, configuration });
        const workId = `work-${cryptoRandomUUID()}`;
        const snapshot = await this.buildWorkContext(workId, principal.userId, configuration, JSON.stringify(profile), undefined, false, correlationId);
        return send(response, 202, this.lifecycle.create(principal, {
          name: body.name,
          configuration,
          idempotencyKey: body.idempotencyKey,
          workId,
          snapshot: persistedSnapshot(snapshot, principal.userId),
          runtimeProfileJson: JSON.stringify(profile),
          sourceRuntimeRevision: profile.revision,
          correlationId,
        }));
      }
      if (parts[2] === "works" && parts.length === 4 && request.method === "GET") return send(response, 200, this.lifecycle.show(principal, parts[3]!));
      if (parts[2] === "works" && parts.length === 5 && parts[4] === "package-uploads" && request.method === "POST") {
        const workId = parts[3]!;
        this.lifecycle.show(principal, workId);
        this.store.snapshots.assertWorkMutable(workId);
        return send(response, 201, await receivePiPackageUpload({ request, store: this.store, dataDirectory: this.paths.dataDirectory,
          actorId: principal.userId, scope: { kind: "work", workId } }));
      }
      if (parts[2] === "works" && parts[4] === "packages") {
        const workId = parts[3]!;
        if (parts.length === 5 && request.method === "GET") return send(response, 200, { packages: await this.workPackageList(principal, workId) });
        if ((parts.length === 5 && request.method === "POST")
          || (parts.length === 7 && parts[6] === "update" && request.method === "POST")) {
          this.lifecycle.show(principal, workId);
          const kind = parts.length === 5 ? "install" : "update";
          const name = kind === "update" ? parts[5]! : null;
          if (name !== null && !(await this.workPackageList(principal, workId)).some((item) => item.name === name && item.desired !== null)) {
            throw api(404, "PI_PACKAGE_NOT_FOUND", "Package is not installed in this Work");
          }
          const body = await readJson(request);
          if (!Check(PiPackageUpdateRequestSchema, body)) throw api(400, "INVALID_REQUEST", "package source and idempotency key are required");
          const state = this.store.getWorkConfiguration(workId);
          if (!state?.desiredContextId) throw api(404, "NOT_FOUND", "Work context was not found");
          const imageIdentity = this.workContexts.load(workId, state.desiredContextId).metadata.imageIdentity;
          return send(response, 202, await this.packages.acceptWork({ actorId: principal.userId, workId, imageIdentity,
            kind, name, source: body.source, idempotencyKey: body.idempotencyKey }));
        }
        if (parts.length === 6 && request.method === "GET") {
          if (!Check(PiPackageNameSchema, parts[5])) throw api(400, "INVALID_REQUEST", "invalid package name");
          const item = (await this.workPackageList(principal, workId)).find((entry) => entry.name === parts[5]);
          if (!item) throw api(404, "PI_PACKAGE_NOT_FOUND", "Package was not found");
          return send(response, 200, item);
        }
        if (parts.length === 7 && request.method === "POST" && ["enable", "disable"].includes(parts[6]!)) {
          return send(response, 200, await this.editWorkPackageSelection(principal, workId, parts[5]!, parts[6] as "enable" | "disable"));
        }
        if (parts.length === 6 && request.method === "DELETE") {
          await this.editWorkPackageSelection(principal, workId, parts[5]!, "remove");
          return send(response, 200, { name: parts[5], removed: true });
        }
      }
      if (parts[2] === "works" && parts.length === 5 && parts[4] === "import-provenance" && request.method === "GET") {
        return send(response, 200, importProvenance(this.store, principal, parts[3]!));
      }
      if (parts[2] === "works" && parts.length === 5 && parts[4] === "configuration" && request.method === "GET") {
        return send(response, 200, await this.workConfigurationView(principal, parts[3]!));
      }
      if (parts[2] === "works" && parts.length === 5 && parts[4] === "configuration" && request.method === "PUT") {
        const body = await readJson<{ configuration?: unknown; expectedRevision?: unknown }>(request);
        if (body.expectedRevision !== undefined || Object.keys(body).some((key) => key !== "configuration")
          || body.configuration === null || typeof body.configuration !== "object") {
          throw api(400, "INVALID_REQUEST", "configuration is required and revision fields are obsolete");
        }
        const work = this.lifecycle.show(principal, parts[3]!);
        const configuration = new WorkConfigurationValidator(this.store).validate({
          workOwnerUserId: work.ownerUserId,
          workId: work.id,
          configuration: body.configuration,
          availableServiceIds: new Set(this.store.listServices(work.id).map((service) => service.serviceId)),
        });
        const resolved = resolveRuntimeProfileFromWorkConfig(this.store, configuration, work.id);
        const result = this.workConfigurations.update(principal, parts[3]!, configuration, undefined, {
          runtimeProfileJson: JSON.stringify(resolved.profile),
          sourceRuntimeRevision: resolved.sourceRuntimeRevision,
          snapshot: persistedSnapshot(await this.buildWorkContext(parts[3]!, principal.userId, configuration, JSON.stringify(resolved.profile), undefined, false, correlationId), principal.userId),
        });
        return send(response, 200, result);
      }
      if (parts[2] === "works" && parts.length === 6 && parts[4] === "configuration" && parts[5] === "skills" && request.method === "GET") {
        const state = await this.workConfigurationView(principal, parts[3]!); return send(response, 200, { skills: state.desired.skills, active: state.active?.skills ?? [], pendingApply: state.pendingApply, runtime: state.runtime });
      }
      if (parts[2] === "works" && parts.length === 6 && parts[4] === "configuration" && parts[5] === "packages" && request.method === "GET") {
        const state = await this.workConfigurationView(principal, parts[3]!);
        return send(response, 200, { packages: state.desired.packages, active: state.active?.packages ?? [], pendingApply: state.pendingApply });
      }
      if (parts[2] === "works" && parts.length === 6 && parts[4] === "configuration" && parts[5] === "packages" && request.method === "PUT") {
        const body = await readJson<{ packages?: unknown }>(request);
        if (!Array.isArray(body.packages)) throw api(400, "INVALID_REQUEST", "packages are required");
        return send(response, 200, await this.workConfigurations.updateMerged(principal, parts[3]!, (current) =>
          new WorkConfigurationValidator(this.store).validate({ workOwnerUserId: principal.userId, workId: parts[3]!,
            configuration: { ...current, packages: body.packages } }), async (configuration) => {
          const resolved = resolveRuntimeProfileFromWorkConfig(this.store, configuration, parts[3]!);
          const snapshot = await this.buildWorkContext(parts[3]!, principal.userId, configuration, JSON.stringify(resolved.profile), undefined, true, correlationId);
          return { runtimeProfileJson: JSON.stringify(resolved.profile), sourceRuntimeRevision: resolved.sourceRuntimeRevision,
            snapshot: persistedSnapshot(snapshot, principal.userId) };
        }));
      }
      if (parts[2] === "works" && parts.length === 6 && parts[4] === "configuration" && parts[5] === "skills" && request.method === "PUT") {
        const body = await readJson<{ skills?: unknown }>(request);
        if (!Array.isArray(body.skills)) throw api(400, "INVALID_REQUEST", "skills are required");
        return send(response, 200, await this.workConfigurations.updateMerged(principal, parts[3]!, (current) => {
          const configuration = new WorkConfigurationValidator(this.store).validate({ workOwnerUserId: principal.userId, workId: parts[3]!, reselectSkills: true, configuration: { ...current, skills: body.skills } });
          return configuration;
        }, async (configuration) => {
          const resolved = resolveRuntimeProfileFromWorkConfig(this.store, configuration, parts[3]!);
          const snapshot = await this.buildWorkContext(parts[3]!, principal.userId, configuration, JSON.stringify(resolved.profile), undefined, true, correlationId);
          return { runtimeProfileJson: JSON.stringify(resolved.profile), sourceRuntimeRevision: resolved.sourceRuntimeRevision, snapshot: persistedSnapshot(snapshot, principal.userId) };
        }));
      }
      if (parts[2] === "works" && parts.length === 6 && parts[4] === "configuration" && parts[5] === "agents") {
        const state = this.workConfigurations.get(principal, parts[3]!); const current = state.desired;
        if (request.method === "GET") return send(response, 200, { agentsMd: current.agentsMd });
        const body = await readJson<{ agentsMd?: unknown }>(request);
        if (typeof body.agentsMd !== "string") throw api(400, "INVALID_REQUEST", "agentsMd is required");
        const agentsMd = body.agentsMd;
        return send(response, 200, await this.workConfigurations.updateMerged(principal, parts[3]!, (configuration) => ({ ...configuration, agentsMd }), async (configuration) => {
          const resolved = resolveRuntimeProfileFromWorkConfig(this.store, configuration, parts[3]!);
          const desiredContextId = this.store.getWorkConfiguration(parts[3]!)?.desiredContextId ?? undefined;
          const snapshot = await this.buildWorkContext(parts[3]!, principal.userId, configuration, JSON.stringify(resolved.profile), desiredContextId, false, correlationId);
          return { runtimeProfileJson: JSON.stringify(resolved.profile), sourceRuntimeRevision: resolved.sourceRuntimeRevision, snapshot: persistedSnapshot(snapshot, principal.userId) };
        }));
      }
      if (parts[2] === "works" && parts.length === 6 && parts[4] === "configuration" && parts[5] === "apply" && request.method === "POST") {
        requireRuntime(this.state);
        const body = await readJson<{ idempotencyKey?: unknown }>(request);
        if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length === 0) throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
        const internal = this.store.getWorkConfiguration(parts[3]!);
        if (internal === undefined) throw api(404, "NOT_FOUND", "resource was not found");
        return send(response, 202, this.lifecycle.applyConfiguration(principal, parts[3]!, body.idempotencyKey, internal.desiredRevision, correlationId));
      }
      if (parts[2] === "works" && parts.length === 5 && request.method === "POST" && ["start", "stop", "retry", "delete"].includes(parts[4]!)) {
        requireRuntime(this.state);
        const body = await readJson<{ idempotencyKey?: unknown }>(request);
        if (typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
        const result = parts[4] === "start" ? this.lifecycle.start(principal, parts[3]!, body.idempotencyKey)
          : parts[4] === "stop" ? this.lifecycle.stop(principal, parts[3]!, body.idempotencyKey)
          : parts[4] === "retry" ? this.lifecycle.retry(principal, parts[3]!, body.idempotencyKey)
          : parts[4] === "delete" ? this.lifecycle.delete(principal, parts[3]!, body.idempotencyKey) : undefined;
        if (result === undefined) throw api(404, "NOT_FOUND", "route not found");
        return send(response, 202, result);
      }
      if (parts[2] === "works" && parts[4] === "services") {
        const workId = parts[3]!;
        if (parts.length === 5 && request.method === "GET") return send(response, 200, { services: this.services.list(principal, workId) });
        if (parts.length === 5 && request.method === "POST") {
          const body = await readJson<{ definition?: unknown; idempotencyKey?: unknown }>(request);
          if (body.definition === undefined || typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "definition and idempotencyKey are required");
          return send(response, 202, this.services.create(principal, workId, { definition: body.definition as any, idempotencyKey: body.idempotencyKey }));
        }
        const serviceId = parts[5];
        if (serviceId !== undefined && parts.length === 6 && request.method === "GET") return send(response, 200, this.services.show(principal, workId, serviceId));
        if (serviceId !== undefined && parts.length === 6 && request.method === "PUT") {
          const body = await readJson<{ definition?: unknown; expectedRevision?: unknown; idempotencyKey?: unknown }>(request);
          if (body.definition === undefined || !Number.isSafeInteger(body.expectedRevision) || typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "definition, expectedRevision, and idempotencyKey are required");
          return send(response, 202, this.services.update(principal, workId, serviceId, Number(body.expectedRevision), body.definition as any, body.idempotencyKey));
        }
        if (serviceId !== undefined && parts.length === 7 && parts[6] === "revisions" && request.method === "GET") return send(response, 200, { revisions: this.services.revisions(principal, workId, serviceId) });
        if (serviceId !== undefined && parts.length === 7 && parts[6] === "logs" && request.method === "GET") {
          const work = this.lifecycle.show(principal, workId);
          if (work.ownerUserId !== principal.userId) throw api(403, "PERMISSION_DENIED", "application log content is available only to the Work owner");
          const tailLines = Number(url.searchParams.get("tailLines") ?? "100");
          if (!Number.isSafeInteger(tailLines) || tailLines < 1 || tailLines > 200) throw api(400, "INVALID_REQUEST", "tailLines must be from 1 through 200");
          return send(response, 200, await this.services.logs(principal, workId, serviceId, tailLines));
        }
        if (serviceId !== undefined && parts.length === 7 && request.method === "POST") {
          const body = await readJson<{ idempotencyKey?: unknown }>(request);
          if (typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
          const result = parts[6] === "restart" ? this.services.restart(principal, workId, serviceId, body.idempotencyKey)
            : parts[6] === "enable" ? this.services.enable(principal, workId, serviceId, body.idempotencyKey)
            : parts[6] === "disable" ? this.services.disable(principal, workId, serviceId, body.idempotencyKey)
            : parts[6] === "remove" ? this.services.remove(principal, workId, serviceId, body.idempotencyKey)
            : parts[6] === "retry" ? this.services.retry(principal, workId, serviceId, body.idempotencyKey) : undefined;
          if (result !== undefined) return send(response, 202, result);
        }
      }
      if (parts[2] === "operations" && parts.length === 4 && request.method === "GET") return send(response, 200, this.lifecycle.operation(principal, parts[3]!));
      if (parts[2] === "works" && parts.length >= 5) {
        const workId = parts[3]!;
        this.requireConversation(principal, workId);
        const gateway = this.runtime as ConversationGateway;
        if (parts[4] === "sessions" && parts.length === 5 && request.method === "POST") {
          const body = await readJson<{ idempotencyKey?: unknown }>(request);
          if (typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
          const release = this.store.snapshots.beginTransientMutation(workId);
          try { return send(response, 201, await gateway.createSession(workId, body.idempotencyKey)); }
          finally { release(); }
        }
        if (parts[4] === "sessions" && parts.length === 5 && request.method === "GET") return send(response, 200, { sessions: await gateway.listSessions(workId) });
        if (parts[4] === "sessions" && parts.length === 6 && request.method === "GET") return send(response, 200, await gateway.readSession(workId, parts[5]!));
        if (parts[4] === "runs" && parts.length === 5 && request.method === "POST") {
          const body = await readJson<{ sessionId?: unknown; submissionKey?: unknown; prompt?: unknown }>(request);
          if (typeof body.sessionId !== "string" || typeof body.submissionKey !== "string" || typeof body.prompt !== "string") throw api(400, "INVALID_REQUEST", "sessionId, submissionKey, and prompt are required");
          const release = this.store.snapshots.beginTransientMutation(workId);
          try { return send(response, 202, await gateway.submitRun(workId, body.sessionId, body.submissionKey, body.prompt)); }
          finally { release(); }
        }
        if (parts[4] === "runs" && parts.length === 6 && request.method === "GET") return send(response, 200, await gateway.getRun(workId, parts[5]!));
        if (parts[4] === "runs" && parts.length === 7 && parts[6] === "cancel" && request.method === "POST") {
          const body = await readJson<{ idempotencyKey?: unknown }>(request);
          if (typeof body.idempotencyKey !== "string") throw api(400, "INVALID_REQUEST", "idempotencyKey is required");
          const release = this.store.snapshots.beginTransientMutation(workId);
          try { return send(response, 200, await gateway.cancelRun(workId, parts[5]!, body.idempotencyKey)); }
          finally { release(); }
        }
        if (parts[4] === "runs" && parts.length === 7 && parts[6] === "events" && request.method === "GET") {
          const after = Number(url.searchParams.get("after") ?? "0");
          if (!Number.isSafeInteger(after) || after < 0) throw api(400, "INVALID_CURSOR", "after must be a non-negative integer");
          response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
          await gateway.watchRun(workId, parts[5]!, after, async (event) => {
            if (!response.write(`${safeJson(event)}\n`)) await onceDrain(response);
          });
          response.end();
          return;
        }
      }
      throw api(404, "NOT_FOUND", "route not found");
    } catch (error) {
      if (response.headersSent) { if (!response.writableEnded) response.destroy(); return; }
      const mapped = mapError(error);
      const field = (error as { field?: unknown }).field;
      send(response, mapped.status, { code: mapped.code, message: mapped.message, correlationId,
        ...(request.url?.startsWith("/api/v1/admin/") && typeof field === "string" ? { field } : {}),
        ...(mapped.retryAfterMs === undefined ? {} : { retryAfterMs: mapped.retryAfterMs }) });
    }
  }

  private requireAdminSession(token: string): { userId: string; role: "admin" } {
    const session = this.identity.authenticate(token);
    if (session.user.role !== "admin") throw api(403, "PERMISSION_DENIED", "administrator permission is required");
    return { userId: session.user.id, role: "admin" };
  }

  private runConfigurationMutation<T>(effect: () => Promise<T>): Promise<T> {
    const current = this.configurationMutationTask.then(effect, effect);
    this.configurationMutationTask = current.catch(() => undefined);
    return current;
  }

  private async saveRuntime(input: { agentImage: string; provider: string; model: string; baseUrl?: string; credential: string }) {
    const configured = this.runtimeProfiles.configure(input);
    const profile = this.runtimeProfiles.load();
    registerRuntimeProfileCatalog(this.store, profile);
    ensureBundledDeploymentSkill(this.store, this.paths);
    syncDefaultRuntimeFields(this.store, profile);
    await this.refreshRuntime(true);
    return configured;
  }

  private adminRuntimeView() {
    const view = this.runtimeProfiles.inspect();
    if (!view.configured) return view;
    return { configured: true as const, agentImage: view.agentImage, model: view.model, updatedAt: view.updatedAt };
  }

  private adminDefaultWorkView() {
    const profile = this.runtimeProfiles.inspect().configured ? this.runtimeProfiles.load() : undefined;
    const envelope = this.store.getDefaultWorkConfiguration();
    const resolved = envelope?.configuration === null && profile !== undefined
      ? ensureDefaultWorkConfiguration(this.store, profile) : envelope;
    if (resolved === undefined || resolved.configuration === null) return { configuration: null, baseImage: null };
    const configuration = publicWorkConfig(resolved.configuration as WorkConfig);
    const entry = this.store.getCatalogEntry(configuration.agentImage.catalogId);
    return { configuration, baseImage: entry?.kind === "agent_image" ? entry.mutableReference ?? entry.resolvedDigest : null };
  }

  private async adminSkillUpload(request: IncomingMessage, token: string, actor: { userId: string; role: "admin" },
    response: ServerResponse, correlationId: string, expectedName?: string) {
    if (this.skillUploadsActive >= 2) throw Object.assign(api(429, "SKILL_UPLOAD_BUSY", "Skill upload capacity is full"), { retryAfterMs: 1000 });
    this.skillUploadsActive += 1;
    try {
      return await receiveSkillUpload({ request, stagingRoot: join(this.paths.dataDirectory, "skill-uploads"), expectedName,
        beforeCommit: () => this.requireAdminSession(token),
        onTimeout: (error) => { if (response.headersSent) { request.destroy(error); return; }
          response.once("finish", () => request.destroy(error));
          response.setHeader("connection", "close");
          send(response, 408, { code: "SKILL_UPLOAD_TIMEOUT", message: "Skill upload timed out", correlationId }); },
        publish: (directory) => expectedName === undefined ? this.skills.add(actor, directory) : this.skills.update(actor, expectedName, directory) });
    } finally { this.skillUploadsActive -= 1; }
  }

  private applyAdminDefaultWorkPatch(patch: { baseImage?: string; skills?: string[]; packages?: string[]; agentsMd?: string }) {
    if (this.store.getDefaultWorkConfiguration()?.configuration == null) throw api(409, "DEFAULT_WORK_NOT_CONFIGURED", "default Work is not configured");
    const fields: Record<string, unknown> = {
      ...(patch.skills === undefined ? {} : { skills: patch.skills }),
      ...(patch.packages === undefined ? {} : { packages: patch.packages.map((name) => ({ name, enabled: true })) }),
      ...(patch.agentsMd === undefined ? {} : { agentsMd: patch.agentsMd }),
    };
    const now = new Date().toISOString();
    this.store.updateDefaultWorkConfiguration(fields, now, (candidate) => {
      let next = candidate;
      if (patch.baseImage !== undefined) {
        if (patch.baseImage.trim() === "") throw Object.assign(api(400, "INVALID_REQUEST", "baseImage is invalid"), { field: "baseImage" });
        const id = `image-${createHash("sha256").update(patch.baseImage).digest("hex").slice(0, 24)}`;
        if (this.store.getCatalogEntry(id) === undefined) this.store.createCatalogEntry({ id, kind: "agent_image", name: patch.baseImage,
          mutableReference: patch.baseImage, resolvedDigest: null, metadataJson: JSON.stringify({ version: 1, source: "default-work" }),
          enabled: true, createdAt: now, updatedAt: now });
        next = { ...candidate, agentImage: { catalogId: id } };
      }
      return new WorkConfigurationValidator(this.store).validate({ workOwnerUserId: "operator", configuration: next });
    });
    return this.adminDefaultWorkView();
  }

  private async routeAdmin(request: IncomingMessage, response: ServerResponse, url: URL, correlationId: string): Promise<void> {
    const token = bearer(request);
    const actor = this.requireAdminSession(token);
    const raw = url.pathname.slice("/api/v1/admin".length).split("/").slice(1);
    let parts: string[];
    try {
      parts = raw.map((segment) => decodeURIComponent(segment));
    } catch { throw api(400, "INVALID_REQUEST", "invalid path encoding"); }
    if (parts.some((segment) => segment.includes("%") || segment === "." || segment === ".." || segment.includes("\\"))) {
      throw api(400, "INVALID_REQUEST", "invalid resource path");
    }
    const at = (...expected: string[]) => parts.length === expected.length && parts.every((part, index) => part === expected[index]);
    if (request.method === "GET" && at("status")) {
      if (this.state === "RUNTIME_UNAVAILABLE") await this.refreshRuntime();
      return send(response, 200, { adminApiVersion: 1, ...this.status() });
    }
    if (request.method === "GET" && at("runtime")) return send(response, 200, this.adminRuntimeView());
    if (request.method === "PUT" && at("runtime")) {
      const body = await readAdminJson(request, AdminRuntimeInputSchema);
      validateRuntimeProfileInput(body);
      return send(response, 200, await this.runConfigurationMutation(async () => {
        this.requireAdminSession(token);
        await this.saveRuntime(body);
        return { runtime: this.adminRuntimeView(), status: { adminApiVersion: 1, ...this.status() } };
      }));
    }
    if (request.method === "GET" && at("default-work")) return send(response, 200, this.adminDefaultWorkView());
    if (request.method === "PATCH" && at("default-work")) {
      const body = await readAdminJson(request, AdminDefaultWorkPatchSchema);
      if (body.agentsMd !== undefined) {
        try { normalizeAgentsMd(body.agentsMd); }
        catch { throw Object.assign(api(400, "INVALID_REQUEST", "agentsMd exceeds the byte limit"), { field: "agentsMd" }); }
      }
      return send(response, 200, await this.runConfigurationMutation(async () => {
        this.requireAdminSession(token);
        return this.applyAdminDefaultWorkPatch(body);
      }));
    }
    if (request.method === "GET" && at("packages")) return send(response, 200, { packages: this.packages.list(true) });
    if (request.method === "GET" && at("skills")) return send(response, 200, { skills: this.skills.listForOperator(actor) });
    if (request.method === "POST" && at("skills")) return send(response, 201, await this.adminSkillUpload(request, token, actor, response, correlationId));
    if (parts[0] === "skills" && parts.length === 2) {
      const name = parts[1]!;
      if (request.method === "GET") return send(response, 200, this.skills.showForOperator(actor, name));
      if (request.method === "PUT") return send(response, 200, await this.adminSkillUpload(request, token, actor, response, correlationId, name));
      if (request.method === "DELETE") { this.skills.remove(actor, name); response.writeHead(204); response.end(); return; }
    }
    if (parts[0] === "skills" && parts.length === 3 && request.method === "POST" &&
      (parts[2] === "enable" || parts[2] === "disable")) {
      await readAdminOptionalEmptyJson(request);
      this.requireAdminSession(token);
      return send(response, 200, parts[2] === "enable" ? this.skills.enable(actor, parts[1]!) : this.skills.disable(actor, parts[1]!));
    }
    if (request.method === "POST" && at("package-uploads")) {
      return send(response, 201, await receivePiPackageUpload({ request, store: this.store, dataDirectory: this.paths.dataDirectory,
        actorId: actor.userId, scope: { kind: "core" }, beforeCommit: () => this.requireAdminSession(token) }));
    }
    if (request.method === "POST" && at("packages")) {
      const body = await readAdminJson(request, AdminPackageInstallRequestSchema);
      requireRuntime(this.state);
      return send(response, 202, await this.packages.install(body.source, body.addToDefaults ?? false,
        body.idempotencyKey, actor.userId, () => this.requireAdminSession(token)));
    }
    if (parts[0] === "packages" && parts.length === 2) {
      const name = parts[1]!;
      if (request.method === "GET") return send(response, 200, this.packages.show(name, true));
      if (request.method === "DELETE") {
        this.requireAdminSession(token);
        this.packages.remove(name);
        response.writeHead(204); response.end(); return;
      }
    }
    if (parts[0] === "packages" && parts.length === 3) {
      const name = parts[1]!;
      if (request.method === "POST" && parts[2] === "update") {
        const body = await readAdminJson(request, AdminPackageUpdateRequestSchema);
        requireRuntime(this.state);
        return send(response, 202, await this.packages.update(name, body.source, body.idempotencyKey,
          actor.userId, () => this.requireAdminSession(token)));
      }
      if (request.method === "POST" && (parts[2] === "enable" || parts[2] === "disable")) {
        await readAdminOptionalEmptyJson(request);
        this.requireAdminSession(token);
        return send(response, 200, this.packages.setEnabled(name, parts[2] === "enable"));
      }
    }
    if (request.method === "GET" && parts[0] === "operations" && parts.length === 2) {
      return send(response, 200, this.packages.operation(parts[1]!));
    }
    if (request.method === "GET" && at("users")) return send(response, 200, { users: this.users.listUsers(actor) });
    if (request.method === "POST" && at("users")) {
      const body = await readAdminJson(request, AdminCreateUserRequestSchema);
      return send(response, 201, await this.users.createUser(actor, body, () => this.requireAdminSession(token)));
    }
    if (parts.length === 3 && parts[0] === "users") {
      const userId = parts[1]!;
      if (request.method === "POST" && (parts[2] === "enable" || parts[2] === "disable")) {
        await readAdminOptionalEmptyJson(request);
        this.requireAdminSession(token);
        const enabled = parts[2] === "enable";
        this.users.setEnabled(actor, userId, enabled);
        return send(response, 200, { userId, enabled });
      }
      if (request.method === "POST" && parts[2] === "reset-credential") {
        const body = await readAdminJson(request, AdminResetCredentialRequestSchema);
        await this.users.resetPassword(actor, userId, body.password, () => this.requireAdminSession(token));
        return send(response, 200, { userId, credentialReset: true });
      }
    }
    if (["users", "status", "runtime", "default-work", "skills", "packages", "package-uploads", "operations"].includes(parts[0] ?? "")) {
      if (parts.length === 1 || parts.length === 3 && parts[0] === "users") throw api(405, "METHOD_NOT_ALLOWED", "method is not allowed");
    }
    throw api(404, "NOT_FOUND", "route not found");
  }

  private snapshotDocker(): DockerRuntime {
    const installationId = ensureInstallationId(this.paths);
    return this.options.snapshotDockerFactory?.(installationId) ?? new DockerRuntime(installationId);
  }

  private startSnapshotTask(task: Promise<unknown>): void {
    this.snapshotTasks.add(task);
    void task.catch(() => undefined).finally(() => this.snapshotTasks.delete(task));
  }

  private async waitSnapshotTasks(): Promise<void> {
    if (this.snapshotTasks.size === 0 && !this.snapshotGcTask) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      const completed = await Promise.race([Promise.allSettled([...this.snapshotTasks, ...(this.snapshotGcTask ? [this.snapshotGcTask] : [])]).then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 45_000); })]);
      if (!completed) {
        for (const job of this.store.snapshots.listJobs(true)) {
          if (job.phase !== "cleanup-pending") this.store.snapshots.fenceWorker(job.operationId, new Date().toISOString());
        }
      }
    }
    finally { if (timer) clearTimeout(timer); }
  }

  private async snapshotRoute(request: IncomingMessage, response: ServerResponse, principal: UserPrincipal, parts: string[]): Promise<boolean> {
    if (parts[2] === "works" && parts.length === 5 && parts[4] === "exports" && request.method === "POST") {
      requireRuntime(this.state);
      requireSnapshotJson(request);
      const imageId = this.snapshotHelper.requireImage(), runtime = this.snapshotDocker(), installationId = ensureInstallationId(this.paths);
      const body = await readSnapshotJson<{ idempotencyKey: string }>(request);
      const accepted = await this.snapshotAdmission.export(principal, parts[3]!, body,
        async () => { await preflightWorkSnapshot({ store: this.store, contexts: this.workContexts, runtime, installationId, workId: parts[3]! }); });
      if (!accepted.reused) this.startSnapshotTask(executeExportSnapshot({ store: this.store, contexts: this.workContexts, runtime,
        installationId, helperImageId: imageId, snapshotsDirectory: this.paths.snapshotsDirectory,
        operationId: accepted.operationId, epoch: 1, signal: this.snapshotAbort.signal }));
      send(response, 202, accepted); return true;
    }
    if (parts[2] === "work-snapshots" && parts.length >= 4 && parts.length <= 5 && request.method === "GET") {
      const job = this.store.snapshots.getJobBySnapshot(parts[3]!);
      authorizeSnapshotOwner(principal, job?.ownerUserId, parts[3]!);
      if (!job || !job.snapshotId || !job.packageId || !job.sourceWorkId) throw api(404, "NOT_FOUND", "resource was not found");
      const packageRecord = this.store.snapshots.getPackage(job.packageId);
      const operation = this.store.getOperation(job.operationId);
      if (!packageRecord || !operation) throw api(404, "NOT_FOUND", "resource was not found");
      if (parts.length === 4) {
        send(response, 200, { workId: job.sourceWorkId, snapshotId: job.snapshotId, operationId: job.operationId, state: operation.state,
          digest: packageRecord.state === "ready" ? packageRecord.digest : null, size: packageRecord.state === "ready" ? packageRecord.size : null,
          expiresAt: packageRecord.state === "ready" ? packageRecord.expiresAt : null,
          error: operation.state === "failed" ? { code: "SNAPSHOT_EXPORT_FAILED", message: "Work export failed" } : null }); return true;
      }
      if (parts[4] !== "content") return false;
      if (singleHeader(request, "range") !== undefined) throw api(416, "RANGE_NOT_SUPPORTED", "Work package downloads do not support Range");
      if (packageRecord.state === "expired" || (packageRecord.expiresAt !== null && packageRecord.expiresAt <= new Date().toISOString())) throw api(410, "PACKAGE_EXPIRED", "package has expired");
      if (packageRecord.state !== "ready" || !packageRecord.digest) throw api(409, "PACKAGE_NOT_READY", "package is not ready");
      await this.downloadSnapshotPackage(request, response, principal, job.packageId, job.snapshotId, packageRecord.digest, packageRecord.size);
      return true;
    }
    if (parts[2] === "work-packages" && parts.length === 3 && request.method === "POST") {
      requireRuntime(this.state);
      const imageId = this.snapshotHelper.requireImage();
      await this.uploadSnapshotPackage(request, response, principal, this.snapshotDocker(), imageId);
      return true;
    }
    if (parts[2] === "work-imports" && parts.length === 3 && request.method === "POST") {
      requireRuntime(this.state);
      requireSnapshotJson(request);
      const imageId = this.snapshotHelper.requireImage(), runtime = this.snapshotDocker();
      const body = await readSnapshotJson<ImportWorkRequest>(request);
      const packageRecord = this.store.snapshots.getPackage(body.packageId);
      authorizeSnapshotOwner(principal, packageRecord?.ownerUserId, body.packageId);
      if (!packageRecord || !packageRecord.digest) throw api(404, "NOT_FOUND", "resource was not found");
      // Replay is resolved before package expiry or physical bytes are required.
      let verified;
      if (packageRecord.state === "ready") {
        const packagePath = join(this.paths.snapshotsDirectory, "packages", `${safeSnapshotSegment(body.packageId)}.work`);
        try { verified = await readWorkPackage(createReadStream(packagePath, { highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes })); }
        catch { /* admission may still resolve an old idempotent replay */ }
      }
      const accepted = this.snapshotAdmission.import(principal, body, verified);
      if (!accepted.reused) this.startSnapshotTask(executeImportSnapshot({ store: this.store, contexts: this.workContexts,
        profiles: this.runtimeProfiles, runtime, installationId: ensureInstallationId(this.paths), helperImageId: imageId,
        snapshotsDirectory: this.paths.snapshotsDirectory, operationId: accepted.operationId, epoch: 1, signal: this.snapshotAbort.signal }));
      send(response, 202, accepted); return true;
    }
    return false;
  }

  private async downloadSnapshotPackage(_request: IncomingMessage, response: ServerResponse, principal: UserPrincipal,
    packageId: string, snapshotId: string, digest: string, size: number): Promise<void> {
    const now = new Date().toISOString(), transferId = `transfer-${cryptoRandomUUID()}`;
    this.store.snapshots.acceptTransfer({ id: transferId, ownerUserId: principal.userId, packageId, snapshotId, kind: "download",
      phase: "streaming", deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(), lastProgressAt: now, helperId: null, createdAt: now });
    const deadline = setTimeout(() => response.destroy(new Error("SNAPSHOT_TRANSFER_TIMEOUT")), 30 * 60_000);
    try {
      const path = join(this.paths.snapshotsDirectory, "packages", `${safeSnapshotSegment(packageId)}.work`);
      if ((await stat(path)).size !== size) throw api(503, "PACKAGE_UNAVAILABLE", "package storage is unavailable");
      response.setTimeout(60_000, () => response.destroy(new Error("SNAPSHOT_TRANSFER_IDLE")));
      response.writeHead(200, { "content-type": WORK_PACKAGE_MIME, "content-length": size, "x-piwork-sha256": digest,
        "content-disposition": 'attachment; filename="snapshot.work"', "cache-control": "no-store" });
      await pipeline(createReadStream(path, { highWaterMark: WORK_PACKAGE_LIMITS.streamChunkBytes }), response);
    } finally { clearTimeout(deadline); this.store.snapshots.finishTransfer(transferId); }
  }

  private async uploadSnapshotPackage(request: IncomingMessage, response: ServerResponse, principal: UserPrincipal,
    runtime: DockerRuntime, helperImageId: string): Promise<void> {
    if (singleHeader(request, "content-type") !== WORK_PACKAGE_MIME) throw api(415, "UNSUPPORTED_MEDIA_TYPE", "expected Work package content type");
    const lengthText = singleHeader(request, "content-length"), expectedDigest = singleHeader(request, "x-piwork-sha256");
    const expectedLength = Number(lengthText);
    if (!/^(?:[1-9][0-9]*)$/.test(lengthText ?? "") || !Number.isSafeInteger(expectedLength)) throw api(400, "CONTENT_LENGTH_REQUIRED", "valid Content-Length is required");
    if (expectedLength > WORK_PACKAGE_LIMITS.packageBytes) throw api(413, "PACKAGE_LIMIT_EXCEEDED", "package is too large");
    if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? "")) throw api(400, "INVALID_DIGEST", "X-Piwork-SHA256 is required");
    const transferId = `transfer-${cryptoRandomUUID()}`, packageId = `package-${cryptoRandomUUID()}`, now = new Date().toISOString();
    const transferDirectory = join(this.paths.snapshotsDirectory, "transfers", transferId), packagesDirectory = join(this.paths.snapshotsDirectory, "packages");
    this.store.snapshots.acceptTransfer({ id: transferId, ownerUserId: principal.userId, packageId, snapshotId: null, kind: "upload",
      phase: "accepted", deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(), lastProgressAt: now, helperId: null, createdAt: now },
    { id: packageId, ownerUserId: principal.userId, digest: null, size: 0, state: "staging", jobId: null, createdAt: now, readyAt: null, expiresAt: null });
    try { await mkdir(transferDirectory, { recursive: true, mode: 0o700 }); await mkdir(packagesDirectory, { recursive: true, mode: 0o700 }); }
    catch (error) {
      this.store.snapshots.finishTransfer(transferId);
      this.store.exec(`UPDATE snapshot_packages SET state = 'expired' WHERE id = '${packageId}' AND state = 'staging'`);
      await rm(transferDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const uploadPath = join(transferDirectory, "package.work"), readyPath = join(packagesDirectory, `${packageId}.work`);
    const helperName = `snapshot-upload-${transferId}`;
    let helperCreated = false, linked = false, sealed = false;
    const deadline = setTimeout(() => request.destroy(new Error("SNAPSHOT_TRANSFER_TIMEOUT")), 30 * 60_000);
    try {
      const file = await open(uploadPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      const hash = createHash("sha256"); let size = 0;
      request.setTimeout(60_000, () => request.destroy(new Error("SNAPSHOT_UPLOAD_IDLE")));
      try {
        for await (const raw of request) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.length;
          if (size > expectedLength || size > WORK_PACKAGE_LIMITS.packageBytes) throw api(413, "PACKAGE_LIMIT_EXCEEDED", "package is too large");
          hash.update(chunk);
          for (let offset = 0; offset < chunk.length;) { const written = await file.write(chunk, offset); if (!written.bytesWritten) throw new Error("SNAPSHOT_WRITE_FAILED"); offset += written.bytesWritten; }
          this.store.snapshots.updateTransfer(transferId, "streaming", new Date().toISOString(), null);
        }
        await file.sync();
      } finally { await file.close(); }
      if (size !== expectedLength || hash.digest("hex") !== expectedDigest) throw api(400, "PACKAGE_INVALID", "package digest or length mismatch");
      const uid = process.getuid?.(), gid = process.getgid?.();
      if (uid === undefined || gid === undefined) throw api(503, "SNAPSHOT_HELPER_UNAVAILABLE", "upload verification is unavailable");
      this.store.snapshots.updateTransfer(transferId, "verifying", new Date().toISOString(), helperName);
      helperCreated = true;
      await runtime.createSnapshotHelper({ installationId: ensureInstallationId(this.paths), jobId: transferId, name: helperName,
        imageId: helperImageId, spoolDirectory: transferDirectory, action: "verify-package", spoolUser: `${uid}:${gid}` });
      let verified: { digest?: unknown; size?: unknown; bindingRequirements?: unknown } | null;
      try { verified = await runtime.startSnapshotHelper(helperName, transferId) as typeof verified; }
      catch (error) {
        const inspection = await runtime.inspectSnapshotHelper(helperName, transferId).catch(() => undefined);
        if (inspection && !inspection.running && inspection.exitCode !== undefined && inspection.exitCode !== 0)
          throw api(400, "PACKAGE_INVALID", "package verification failed");
        throw error;
      }
      await runtime.removeSnapshotHelper(helperName, transferId); helperCreated = false;
      if (!verified || verified.digest !== expectedDigest || verified.size !== expectedLength || !verified.bindingRequirements) throw api(400, "PACKAGE_INVALID", "package verification failed");
      await link(uploadPath, readyPath); linked = true; await syncSnapshotDirectory(packagesDirectory);
      const readyAt = new Date().toISOString(), expiresAt = new Date(Date.parse(readyAt) + 24 * 60 * 60_000).toISOString();
      const selected = this.store.snapshots.sealOrReusePackage(packageId, principal.userId, expectedDigest!, expectedLength, readyAt, expiresAt); sealed = true;
      if (selected.id !== packageId) { await unlink(readyPath); linked = false; }
      this.store.snapshots.finishTransfer(transferId);
      await rm(transferDirectory, { recursive: true, force: true }).catch(() => undefined);
      send(response, 201, { packageId: selected.id, digest: expectedDigest, size: expectedLength, expiresAt: selected.expiresAt,
        bindingRequirements: verified.bindingRequirements });
    } catch (error) {
      if (helperCreated) {
        try { await runtime.removeSnapshotHelper(helperName, transferId); helperCreated = false; }
        catch { this.store.snapshots.updateTransfer(transferId, "cleanup-pending", new Date().toISOString(), helperName); throw error; }
      }
      if (!sealed) {
        if (linked) await unlink(readyPath).catch(() => undefined);
        this.store.exec(`UPDATE snapshot_packages SET state = 'expired' WHERE id = '${packageId}' AND state = 'staging'`);
      }
      this.store.snapshots.finishTransfer(transferId);
      await rm(transferDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally { clearTimeout(deadline); }
  }

  private requireConversation(principal: UserPrincipal, workId: string): void {
    const work = this.lifecycle.show(principal, workId);
    if (work.ownerUserId !== principal.userId) throw api(403, "PERMISSION_DENIED", "conversation content is available only to the Work owner");
    if (work.observedState !== "ready" && work.observedState !== "degraded") throw api(503, "WORK_UNAVAILABLE", "Work is not ready");
    if (this.runtime?.createSession === undefined) throw api(503, "RUNTIME_UNAVAILABLE", "conversation gateway is unavailable");
  }
}

function safeRuntimeFailure(error: unknown): string {
  void error;
  return "runtime dependency is unavailable";
}

function proxyRuntime(current: () => WorkRuntimeAdapter): WorkRuntimeAdapter {
  return {
    resolveImageIdentity: (reference) => current().resolveImageIdentity?.(reference)
      ?? Promise.reject(new Error("runtime cannot resolve an immutable image identity")),
    prepare: (work, configuration) => current().prepare(work, configuration), start: (work, generation, configuration) => current().start(work, generation, configuration),
    inspect: (workId) => current().inspect(workId), drain: (workId, timeout) => current().drain(workId, timeout),
    prepareConfigurationChange: (workId) => current().prepareConfigurationChange?.(workId)
      ?? Promise.reject(new Error("runtime cannot prepare configuration replacement")),
    stop: (workId, timeout) => current().stop(workId, timeout), remove: (workId, options) => current().remove(workId, options),
    listManagedInstances: () => current().listManagedInstances?.() ?? Promise.resolve([]),
  };
}
function proxyServiceRuntime(current: () => ServiceRuntimeAdapter | undefined): ServiceRuntimeAdapter {
  const runtime = () => {
    const value = current();
    if (value === undefined) throw new Error("service runtime is unavailable");
    return value;
  };
  return {
    resolveImage: (workId, definition) => runtime().resolveImage?.(workId, definition) ?? Promise.reject(new Error("service image resolution is unavailable")),
    start: (workId, definition, imageIdentity) => runtime().start(workId, definition, imageIdentity),
    waitReady: (workId, definition, timeoutMs) => runtime().waitReady?.(workId, definition, timeoutMs) ?? Promise.resolve(true),
    stop: (workId, definition) => runtime().stop?.(workId, definition) ?? Promise.resolve(),
    remove: (workId, definition) => runtime().remove?.(workId, definition) ?? Promise.resolve(),
    logs: (workId, serviceId, tailLines) => runtime().logs?.(workId, serviceId, tailLines) ?? Promise.reject(new Error("service logs are unavailable")),
    inspect: (workId, serviceId) => runtime().inspect?.(workId, serviceId) ?? Promise.reject(new Error("service inspection is unavailable")),
  };
}
function unavailableRuntime(message: string): WorkRuntimeAdapter { const fail = async (): Promise<never> => { throw new Error(message); }; return { prepare: fail, start: fail, inspect: fail, drain: fail, stop: fail, remove: fail }; }
function requireRuntime(state: ReadinessReason): void {
  if (state === "READY") return;
  if (state === "ADMIN_REQUIRED") throw api(503, "ADMIN_REQUIRED", "an administrator must be bootstrapped first");
  if (state === "RUNTIME_NOT_CONFIGURED") throw api(503, "RUNTIME_NOT_CONFIGURED", "the global runtime default is not configured");
  throw api(503, "RUNTIME_UNAVAILABLE", `Core runtime is not ready: ${state}`);
}
function bearer(request: IncomingMessage): string { const value = request.headers.authorization; if (value === undefined || !value.startsWith("Bearer ") || value.length <= 7) throw api(401, "AUTHENTICATION_REQUIRED", "authentication is required"); return value.slice(7); }
function requireOperator(request: IncomingMessage, store: CoreStore): void {
  const value = request.headers.authorization;
  if (value === undefined || !value.startsWith("Operator ") || !verifyOperatorCredential(store, value.slice(9))) {
    throw api(401, "OPERATOR_AUTHENTICATION_REQUIRED", "operator authentication is required");
  }
}
async function readJson<T>(request: IncomingMessage): Promise<T> { const chunks: Buffer[] = []; let length = 0; for await (const chunk of request) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += value.length; if (length > 1_048_576) throw api(413, "REQUEST_TOO_LARGE", "request body is too large"); chunks.push(value); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; } catch { throw api(400, "INVALID_JSON", "request body must be valid JSON"); } }
export async function readAdminRequestBody(request: IncomingMessage, timeoutMs = 120_000): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  const timeoutError = api(408, "REQUEST_TIMEOUT", "request body timed out");
  const timer = setTimeout(() => request.destroy(timeoutError), timeoutMs);
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > ADMIN_JSON_MAX_BYTES) throw api(413, "REQUEST_TOO_LARGE", "request body is too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); }
}
async function readAdminJson<T extends TSchema>(request: IncomingMessage, schema: T): Promise<Static<T>> {
  if (singleHeader(request, "content-type") !== "application/json") throw api(415, "UNSUPPORTED_MEDIA_TYPE", "expected application/json");
  const body = await readAdminRequestBody(request);
  let value: unknown;
  try { value = parseWorkJson(body); }
  catch { throw api(400, "INVALID_REQUEST", "request body must be valid JSON"); }
  if (!Check(schema, value)) throw api(400, "INVALID_REQUEST", "request fields are invalid");
  return value as Static<T>;
}
async function readAdminOptionalEmptyJson(request: IncomingMessage): Promise<void> {
  if (request.headers["content-length"] === "0" || request.headers["content-type"] === undefined) {
    if ((await readAdminRequestBody(request)).length > 0) throw api(400, "INVALID_REQUEST", "expected an empty body");
    return;
  }
  await readAdminJson(request, AdminEmptyActionSchema);
}
async function readSnapshotJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.length;
    if (size > 1_048_576) throw api(413, "REQUEST_TOO_LARGE", "request body is too large");
    chunks.push(chunk);
  }
  try { return parseWorkJson(Buffer.concat(chunks, size)) as T; }
  catch { throw api(400, "INVALID_JSON", "request body must be strict JSON without duplicate keys"); }
}
function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index]!.toLowerCase() === name) values.push(request.rawHeaders[index + 1]!);
  if (values.length > 1) throw api(400, "DUPLICATE_HEADER", `duplicate ${name} header`);
  return values[0];
}
function requireSnapshotJson(request: IncomingMessage): void {
  if (singleHeader(request, "content-type") !== "application/json") throw api(415, "UNSUPPORTED_MEDIA_TYPE", "expected application/json");
}
function safeSnapshotSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(value)) throw api(400, "INVALID_REQUEST", "invalid snapshot identifier");
  return value;
}
async function syncSnapshotDirectory(path: string): Promise<void> {
  const descriptor = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await descriptor.sync(); } finally { await descriptor.close(); }
}
function safeJson(value: unknown): string { return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item); }
function send(response: ServerResponse, status: number, value: unknown): void { if (response.headersSent) return; const body = safeJson(value); response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store" }); response.end(body); }
function api(status: number, code: string, message: string): Error { return Object.assign(new Error(message), { status, code }); }
export function mapError(error: unknown): { status: number; code: string; message: string; retryAfterMs?: number } {
  const item = error as { status?: number; code?: number | string; message?: string; retryAfterMs?: number; name?: string };
  if (error instanceof PiPackageStoreError) return { status: error.code === "PI_PACKAGE_NOT_FOUND" ? 404 : 409,
    code: error.code, message: error.code === "PI_PACKAGE_NOT_FOUND" ? "Package was not found" : error.message };
  if (error instanceof PiPackageInputError) return { status: error.code === "PI_PACKAGE_LIMIT_EXCEEDED" ? 413
    : error.code === "PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE" ? 415 : 400, code: error.code, message: error.message };
  if (error instanceof TypeError && /^invalid (?:Core )?package/.test(error.message)) return { status: 400, code: "INVALID_REQUEST", message: error.message };
  if (item.name === "SnapshotAdmissionError") {
    const code = String(item.code);
    const hints: Record<string, string> = {
      PACKAGE_INVALID: "The Work package or import request is invalid; validate the file and request fields.",
      PACKAGE_EXPIRED: "The uploaded Work package expired; upload the file again.",
      PACKAGE_NOT_READY: "The Work package is not ready; upload and validate it before importing.",
      QUOTA_EXCEEDED: "The target Core lacks capacity for this Work; free capacity or adjust its quota.",
      SNAPSHOT_REQUIRES_STOPPED: "Stop the Work and its services before exporting.",
      WORK_BUSY: "Wait for the current Work operation to finish and retry.",
    };
    return { status: code === "PACKAGE_EXPIRED" ? 410 : code === "PACKAGE_INVALID" ? 400
      : code === "QUOTA_EXCEEDED" || code === "PACKAGE_NOT_READY" || code === "WORK_BUSY" || code === "SNAPSHOT_REQUIRES_STOPPED" ? 409 : 503,
    code, message: hints[code] ?? "Check the Work snapshot prerequisites and retry." };
  }
  if (item.name === "SnapshotPreflightError") return { status: item.code === "SNAPSHOT_RUNTIME_UNAVAILABLE" ? 503 : 409,
    code: String(item.code), message: "Work snapshot preflight failed" };
  if (item.name === "SnapshotHelperUnavailableError") return { status: 503, code: "SNAPSHOT_HELPER_UNAVAILABLE", message: "snapshot helper is unavailable" };
  if (item.name === "WorkBindingError") {
    const code = String(item.code);
    return { status: 400, code, message: code === "TARGET_MODEL_UNAVAILABLE"
      ? "Configure an enabled matching model with a readable credential on the target Core, then import again."
      : code === "EXTERNAL_MCP_SECRET_UNAVAILABLE"
        ? "This version cannot migrate platform secrets for custom external MCP servers; remove that dependency before exporting."
        : "The target Work model is unavailable or incompatible." };
  }
  if (item.name === "WorkPackageValidationError") return { status: item.code === "PACKAGE_LIMIT_EXCEEDED" ? 413 : 400,
    code: String(item.code), message: "Work package is invalid" };
  if (item.name === "SnapshotStoreError") return { status: item.code === "SNAPSHOT_TRANSFER_BUSY" ? 503 : 409, code: String(item.code), message:
    item.code === "WORK_NAME_CONFLICT" ? "That Work name is already in use; choose another name or omit --name for automatic naming."
      : "Work snapshot state conflicts with this request" };
  if (typeof item.code === "string" && (item.code.startsWith("SKILL_") || item.code === "AGENTS_INVALID")) {
    const unavailable = item.code === "SKILL_UNAVAILABLE" || item.code === "SKILL_NOT_FOUND";
    return { status: typeof item.status === "number" && [408, 413, 415, 429].includes(item.status) ? item.status
      : item.code === "SKILL_ALREADY_EXISTS" ? 409 : unavailable ? 404 : 400,
      code: unavailable ? "SKILL_UNAVAILABLE" : item.code, message: unavailable ? "Skill is unavailable" : item.message ?? "Skill operation failed",
      ...(typeof item.retryAfterMs === "number" ? { retryAfterMs: item.retryAfterMs } : {}) };
  }
  if (item.name === "AuthenticationFailedError" || item.name === "InvalidLoginSessionError") return { status: 401, code: "AUTHENTICATION_FAILED", message: "authentication failed" };
  if (item.name === "LoginRateLimitedError") return { status: 429, code: "RATE_LIMITED", message: "rate limited", retryAfterMs: item.retryAfterMs };
  if (item.name === "InvisibleResourceError" || item.name === "WorkNotFoundError") return { status: 404, code: "NOT_FOUND", message: "resource was not found" };
  if (item.name === "ConversationAccessDeniedError") return { status: 403, code: "PERMISSION_DENIED", message: "permission denied" };
  if (item.name === "WorkBusyError") return { status: 409, code: "WORK_BUSY", message: "Work is busy" };
  if (item.name === "CursorExpiredError" || item.name === "WatchCursorExpiredError") return { status: 416, code: "CURSOR_EXPIRED", message: "Run cursor has expired; query durable Run status or Session history" };
  if (item.name === "DockerDependencyError") return { status: 503, code: "RUNTIME_UNAVAILABLE", message: "runtime dependency is unavailable" };
  if (item.name === "ServiceDefinitionValidationError") return { status: 400, code: "INVALID_SERVICE_DEFINITION", message: item.message ?? "service definition is invalid" };
  if (item.name === "ServiceQuotaExceededError" || item.name === "WorkResourceQuotaError" || item.name === "WorkConfigurationAllocationError") return { status: 429, code: "QUOTA_EXCEEDED", message: item.message ?? "resource quota is exceeded" };
  if (item.name === "ServicePreconditionError") return { status: 409, code: "FAILED_PRECONDITION", message: item.message ?? "service precondition failed" };
  if (item.name === "IdempotencyConflictError" || item.name === "RevisionConflictError" || item.name === "ServiceNameConflictError" || item.name === "ServiceRevisionConflictError") return { status: 409, code: "CONFLICT", message: "request conflicts with current state" };
  if (item.name === "ConfigurationRevisionConflictError" || item.name === "InitialAdministratorExistsError" || item.name === "DuplicateAccountError") return { status: 409, code: "CONFLICT", message: "request conflicts with current state" };
  if (item.name === "AdministrationPermissionError") return { status: 403, code: "PERMISSION_DENIED", message: "permission denied" };
  if (item.name === "LastEnabledAdministratorError") return { status: 409, code: "LAST_ADMINISTRATOR", message: "cannot disable the last enabled administrator" };
  if (item.name === "UserNotFoundError") return { status: 404, code: "NOT_FOUND", message: "resource was not found" };
  if (item.name === "InputValidationError" || item.name === "InvalidWorkConfigurationError") return { status: 400, code: "INVALID_REQUEST", message: item.message ?? "request input is invalid" };
  if (item.name === "ConfigurationValidationError") return { status: 400, code: "INVALID_CONFIGURATION", message: item.message ?? "Work configuration is invalid" };
  if (typeof item.status === "number") return { status: item.status, code: typeof item.code === "string" ? item.code : "REQUEST_FAILED", message: item.message ?? "request failed" };
  if (typeof item.code === "number") {
    const mapped = mapGrpcStatus(item.code);
    return mapped;
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "internal server error" };
}

function defaultWorkConfiguration(profile: RuntimeProfile): WorkConfig {
  return {
    agentImage: { catalogId: runtimeImageCatalogId(profile.revision) },
    skills: ["deploy-work-service"],
    packages: [],
    agentsMd: "",
    modelRef: runtimeModelCatalogId(profile.revision),
    mcpServers: [{
      serverId: "work-services",
      transport: "stdio",
      required: true,
      command: "/usr/local/bin/piwork-service-mcp",
      args: [],
      timeoutMs: 30_000,
    }],
    resources: {
      cpuMillis: 2_000,
      memoryBytes: 1_536 * 1_024 * 1_024,
      agentCpuMillis: 1_000,
      agentMemoryBytes: 768 * 1_024 * 1_024,
      maxServices: 4,
      maxRetainedVolumes: 2,
    },
    tools: { allowed: [], denied: [] },
  };
}

function ensureBundledDeploymentSkill(store: CoreStore, paths: CorePaths): void {
  const marker = "bundled_skill.deploy-work-service.v1";
  if (store.getControlMetadata(marker) !== undefined) return;
  const artifacts = new SkillArtifactStore(paths.skillsDirectory);
  if (store.getManagedSkill("deploy-work-service") === undefined) {
    const source = fileURLToPath(new URL("../../assets/skills/deploy-work-service", import.meta.url));
    const artifact = artifacts.import(source, "deploy-work-service");
    store.addManagedSkill({
      name: artifact.name,
      identity: artifact.identity,
      fileCount: artifact.fileCount,
      totalBytes: artifact.totalBytes,
      now: new Date().toISOString(),
    });
  }
  store.putControlMetadataIfAbsent(marker, { seeded: true }, new Date().toISOString());
}

function publicWorkConfig(configuration: WorkConfig & { revision?: unknown }): WorkConfig {
  const { revision: _internalRevision, ...value } = configuration;
  return value;
}

function persistedSnapshot(snapshot: WorkContextSnapshot, userId: string): WorkContextSnapshotInput {
  return {
    snapshotId: snapshot.snapshotId,
    configurationJson: JSON.stringify(snapshot.configuration),
    imageIdentity: snapshot.metadata.imageIdentity,
    createdByUserId: userId,
    createdAt: snapshot.metadata.createdAt,
  };
}

function ensureDefaultWorkConfiguration(store: CoreStore, profile: RuntimeProfile): Record<string, unknown> {
  const current = store.getDefaultWorkConfiguration();
  if (current?.configuration !== null && current?.configuration !== undefined) return current as unknown as Record<string, unknown>;
  const configuration = defaultWorkConfiguration(profile);
  return store.compareAndSwapDefaultWorkConfiguration(current?.revision ?? 0, configuration, new Date().toISOString()) as unknown as Record<string, unknown>;
}

function syncDefaultRuntimeFields(store: CoreStore, profile: RuntimeProfile): void {
  const current = store.getDefaultWorkConfiguration();
  if (current?.configuration === null || current?.configuration === undefined) {
    ensureDefaultWorkConfiguration(store, profile);
    return;
  }
  const configuration = current.configuration as WorkConfig;
  const next = { ...configuration, agentImage: { catalogId: runtimeImageCatalogId(profile.revision) }, modelRef: runtimeModelCatalogId(profile.revision) };
  store.compareAndSwapDefaultWorkConfiguration(current.revision, next, new Date().toISOString());
}

function mapGrpcStatus(code: number): { status: number; code: string; message: string } {
  switch (code) {
    case grpcStatus.UNAUTHENTICATED: return { status: 401, code: "AUTHENTICATION_FAILED", message: "agent authentication failed" };
    case grpcStatus.PERMISSION_DENIED: return { status: 403, code: "PERMISSION_DENIED", message: "permission denied" };
    case grpcStatus.NOT_FOUND: return { status: 404, code: "NOT_FOUND", message: "resource was not found" };
    case grpcStatus.ALREADY_EXISTS:
    case grpcStatus.ABORTED: return { status: 409, code: "CONFLICT", message: "request conflicts with current state" };
    case grpcStatus.RESOURCE_EXHAUSTED: return { status: 429, code: "RATE_LIMITED", message: "runtime is busy" };
    case grpcStatus.OUT_OF_RANGE: return { status: 416, code: "CURSOR_EXPIRED", message: "Run cursor has expired; query durable Run status or Session history" };
    case grpcStatus.DEADLINE_EXCEEDED: return { status: 504, code: "TIMEOUT", message: "runtime request timed out" };
    case grpcStatus.UNAVAILABLE: return { status: 503, code: "RUNTIME_UNAVAILABLE", message: "runtime dependency is unavailable" };
    default: return { status: 500, code: "INTERNAL_ERROR", message: "internal server error" };
  }
}
async function closeServer(server?: Server): Promise<void> { if (server === undefined || !server.listening) return; await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
async function onceDrain(response: ServerResponse): Promise<void> { await new Promise<void>((resolve) => response.once("drain", resolve)); }
