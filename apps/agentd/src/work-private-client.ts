import { readFileSync } from "node:fs";
import { ChannelCredentials, Metadata, type ServiceError } from "@grpc/grpc-js";
import { WorkServicesClient, type RpcWorkPrivateResponse, type RpcRunModelResolution, type RpcDeploymentContext, type RunModelSnapshot } from "@piwork/contracts";
import type { AgentRuntimeConfig } from "./application.js";

/** The current runtime's existing mTLS control identity; never exposed to a Service. */
export class WorkPrivateClient {
  private readonly client: WorkServicesClient;
  constructor(config: NonNullable<AgentRuntimeConfig["serviceControl"]>) {
    this.client = new WorkServicesClient(config.endpoint, ChannelCredentials.createSsl(readFileSync(config.caCertificatePath),
      readFileSync(config.clientPrivateKeyPath), readFileSync(config.clientCertificatePath)), {
      "grpc.ssl_target_name_override": config.serverName, "grpc.default_authority": config.serverName,
      "grpc.enable_http_proxy": 0,
    });
  }
  close(): void { this.client.close(); }
  async models(): Promise<{ models: RunModelSnapshot[]; defaultModel: RunModelSnapshot; defaultUnavailable?: boolean; checkedAt: string }> {
    const result = await this.call<RpcWorkPrivateResponse>((metadata, options, done) => this.client.listRunModels({ modelProviderContractVersion: 1 }, metadata, options, done));
    return JSON.parse(result.valueJson) as { models: RunModelSnapshot[]; defaultModel: RunModelSnapshot; defaultUnavailable?: boolean; checkedAt: string };
  }
  async resolveModel(modelRef: string | null, expected?: RunModelSnapshot): Promise<{ model: RunModelSnapshot; credential: string }> {
    const result = await this.call<RpcRunModelResolution>((metadata, options, done) => this.client.resolveRunModel({ inputJson: JSON.stringify({ modelProviderContractVersion: 1, modelRef, ...(expected ? { expected } : {}) }) }, metadata, options, done));
    return { model: JSON.parse(result.modelJson) as RunModelSnapshot, credential: result.credential };
  }
  async bindings(): Promise<unknown> { return this.content("getServiceInteractionBindings", {}); }
  async prepareBrain(input: unknown): Promise<unknown> { return this.content("prepareBrainCandidate", input); }
  async brainState(input: unknown): Promise<unknown> { return this.content("getBrainCandidateState", input); }
  async authorizeHistoryMigration(input: unknown): Promise<unknown> { return this.content("authorizeHistoryMigration", input); }
  async temporaryServicesSupported(): Promise<boolean> {
    const result = await this.call<RpcDeploymentContext>((metadata, options, done) => this.client.getDeploymentContext({}, metadata, options, done));
    return result.runTemporaryServiceContractVersion === 1;
  }
  async openTemporaryRunLease(runId: string): Promise<string> {
    const result = await this.call<{ leaseId: string }>((metadata, options, done) => this.client.openTemporaryRunLease({ runId }, metadata, options, done));
    if (!result.leaseId || result.leaseId.length > 256) throw new Error("temporary Run lease is unavailable");
    return result.leaseId;
  }
  async closeTemporaryRunLease(runId: string): Promise<void> {
    await this.call((metadata, options, done) => this.client.closeTemporaryRunLease({ runId }, metadata, options, done));
  }
  private async content(method: "getServiceInteractionBindings" | "prepareBrainCandidate" | "getBrainCandidateState" | "authorizeHistoryMigration", input: unknown): Promise<unknown> {
    const result = await this.call<RpcWorkPrivateResponse>((metadata, options, done) => method==='getServiceInteractionBindings'
      ? this.client.getServiceInteractionBindings({},metadata,options,done)
      : this.client[method]({ inputJson: JSON.stringify(input) }, metadata, options, done), method === "prepareBrainCandidate" ? 60_000 : 10_000);
    return JSON.parse(result.valueJson);
  }
  private call<R>(invoke: (metadata: Metadata, options: { deadline: Date }, done: (error: ServiceError | null, response: R) => void) => unknown, timeoutMs = 10_000): Promise<R> {
    return new Promise((resolve, reject) => invoke(new Metadata({ waitForReady: true }), { deadline: new Date(Date.now() + timeoutMs) }, (error, response) => error === null ? resolve(response) : reject(error)));
  }
}
