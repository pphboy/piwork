import { lstatSync, readFileSync } from "node:fs";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { normalizeModelBaseUrl, publicRunModel, type RunModelList, type RunModelSnapshot } from "@piwork/contracts";
import type { AgentRuntimeConfig } from "./application.js";
import type { WorkPrivateClient } from "./work-private-client.js";
import { resolveProductionModel } from "./pi-sdk-executor.js";

export class RunModelError extends Error {
  constructor(readonly modelErrorCode: "MODEL_UNAVAILABLE" | "MODEL_NOT_SUPPORTED" | "MODEL_LIST_UNAVAILABLE" | "RUN_MODEL_SELECTION_UNSUPPORTED", message: string) {
    super(message); this.name = "RunModelError";
  }
}
export interface RunModelResolver {
  list(): Promise<RunModelList>;
  resolve(modelRef: string | null): Promise<RunModelSnapshot>;
  credential(model: RunModelSnapshot): Promise<string>;
}
export class AgentRunModels implements RunModelResolver {
  constructor(private readonly config: AgentRuntimeConfig["model"] & { deterministic: boolean },
    private readonly control?: Pick<WorkPrivateClient, "models" | "resolveModel">) {}

  async list(): Promise<RunModelList> {
    try {
      if (!this.control) {
        const model = await this.resolve(null);
        return { models: [], defaultModel: publicRunModel(model), checkedAt: new Date().toISOString(), availability: "available" };
      }
      const candidates = await this.control.models();
      const models: RunModelSnapshot[] = [];
      for (const candidate of candidates.models) { try { await this.assertSupported(candidate); models.push(candidate); } catch { /* Actual SDK rejects this candidate. */ } }
      await this.assertSupported(candidates.defaultModel);
      this.assertDefault(candidates.defaultModel);
      return { models: models.map(publicRunModel), defaultModel: publicRunModel(candidates.defaultModel), checkedAt: candidates.checkedAt, availability: "available" };
    } catch { throw new RunModelError("MODEL_LIST_UNAVAILABLE", "Available models could not be loaded. Retry when the Work is ready."); }
  }
  async resolve(modelRef: string | null): Promise<RunModelSnapshot> {
    let model: RunModelSnapshot;
    if (modelRef === null) {
      model = { modelRef: null, label: this.config.id, provider: this.config.provider, model: this.config.id,
        ...(this.config.baseUrl ? { baseUrl: normalizeModelBaseUrl(this.config.baseUrl) } : {}) };
      if (this.control) {
        try { model = (await this.control.resolveModel(null)).model; this.assertDefault(model); }
        catch { throw new RunModelError("MODEL_UNAVAILABLE", "Active Work model is unavailable."); }
      } else if (!this.config.deterministic) readModelCredential(this.config.credentialPath);
    } else {
      if (!this.control) throw new RunModelError("RUN_MODEL_SELECTION_UNSUPPORTED", "This Work has no model selection channel.");
      try { model = (await this.control.resolveModel(modelRef)).model; }
      catch { throw new RunModelError("MODEL_UNAVAILABLE", "Selected model is unavailable. Choose an available model."); }
      if (model.modelRef !== modelRef) throw new RunModelError("MODEL_UNAVAILABLE", "Selected model identity did not match.");
    }
    await this.assertSupported(model);
    return model;
  }
  async credential(model: RunModelSnapshot): Promise<string> {
    if (model.modelRef === null) {
      this.assertDefault(model);
      if (this.control) {
        try { const resolved = await this.control.resolveModel(null, model); if (!resolved.credential) throw new Error(); return resolved.credential; }
        catch { throw new RunModelError("MODEL_UNAVAILABLE", "Accepted Work model is no longer available."); }
      }
      return this.config.deterministic ? "fixture-key" : readModelCredential(this.config.credentialPath);
    }
    if (!this.control) throw new RunModelError("MODEL_UNAVAILABLE", "Model credentials are unavailable.");
    try {
      const resolved = await this.control.resolveModel(model.modelRef, model);
      if (!resolved.credential) throw new Error(); return resolved.credential;
    } catch { throw new RunModelError("MODEL_UNAVAILABLE", "Accepted model is no longer available. Its Run cannot fall back to another model."); }
  }
  private async assertSupported(model: RunModelSnapshot): Promise<void> {
    try {
      if (!model.provider || !model.model || !model.label || normalizeModelBaseUrl(model.baseUrl) !== model.baseUrl) throw new Error();
      if (this.config.deterministic && model.provider === "piwork-deterministic" && /^fixture-v[12]$/.test(model.model)) return;
      const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
      resolveProductionModel(runtime, { provider: model.provider, id: model.model, ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}) });
    } catch { throw new RunModelError("MODEL_NOT_SUPPORTED", "Selected model is unsupported by this Work's Pi SDK."); }
  }
  private assertDefault(model: RunModelSnapshot): void {
    if (model.provider !== this.config.provider || model.model !== this.config.id || model.baseUrl !== normalizeModelBaseUrl(this.config.baseUrl)) {
      throw new RunModelError("MODEL_UNAVAILABLE", "Accepted Work model no longer matches this context.");
    }
  }
}
export function readModelCredential(path?: string): string {
  try {
    if (!path) throw new Error(); const information = lstatSync(path);
    if (!information.isFile() || information.isSymbolicLink() || information.size < 1 || information.size > 64 * 1024) throw new Error();
    const credential = readFileSync(path, "utf8").replace(/[\r\n]+$/, ""); if (!credential || /\0/.test(credential)) throw new Error(); return credential;
  } catch { throw new RunModelError("MODEL_UNAVAILABLE", "Model credential is unavailable."); }
}
