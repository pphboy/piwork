import { FileCredentialStore, PiworkApiError, PiworkClient, safeErrorMessage, type CredentialRecord, type PublicIdentity } from "@piwork/client-sdk";
import { validateProxyCoreUrl } from "../service-proxy.js";

export type IdentityState = "signed-out" | "authenticated" | "offline";
export type Revocation = { reason: "login" | "logout" | "switch" | "session"; hadContent: boolean };
export interface IdentityView {
  readonly coreUrl: string;
  readonly state: IdentityState;
  readonly generation: number;
  readonly user?: PublicIdentity;
  readonly expiresAt?: string;
  readonly error?: string;
  readonly lastKnownUser?: PublicIdentity;
  readonly lastConfirmedAt?: string;
}

function sameCore(a: string, b: string): boolean {
  try {
    const first = new URL(a), second = new URL(b);
    return first.protocol === second.protocol && first.host === second.host
      && first.pathname.replace(/\/+$/, "") === second.pathname.replace(/\/+$/, "")
      && first.search === second.search && first.hash === second.hash;
  } catch { return false; }
}

export class DesktopIdentity {
  private credential?: CredentialRecord;
  private generation = 0;
  private checked = false;
  private offline = false;
  private error?: string;
  private lastKnownUser?: PublicIdentity;
  private lastConfirmedAt?: string;
  private readonly revocationListeners = new Set<(event: Revocation) => void>();

  constructor(private coreUrl: string, private readonly store: FileCredentialStore, saved?: CredentialRecord) {
    validateProxyCoreUrl(coreUrl);
    if (saved && sameCore(saved.coreUrl, coreUrl)) this.credential = saved;
  }

  get currentCoreUrl(): string { return this.coreUrl; }
  get currentGeneration(): number { return this.generation; }
  get hasContentAuthorization(): boolean { return this.credential !== undefined && this.checked; }

  onRevoked(listener: (event: Revocation) => void): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  client(): PiworkClient {
    if (!this.credential || !this.checked) throw new PiworkApiError(401, "AUTH_REQUIRED", "Sign in to Core");
    return new PiworkClient({ coreUrl: this.coreUrl, token: this.credential.token });
  }

  async view(): Promise<IdentityView> {
    if (this.credential) await this.verify();
    return { coreUrl: this.coreUrl, generation: this.generation,
      state: this.offline ? "offline" : this.credential && this.checked ? "authenticated" : "signed-out",
      ...(this.credential && this.checked ? { user: this.credential.user, expiresAt: this.credential.expiresAt } : {}),
      ...(this.offline && this.lastKnownUser ? { lastKnownUser: this.lastKnownUser, lastConfirmedAt: this.lastConfirmedAt } : {}),
      ...(this.error ? { error: this.error } : {}) };
  }

  async verify(): Promise<void> {
    const credential = this.credential;
    if (!credential) return;
    try {
      const me = await new PiworkClient({ coreUrl: this.coreUrl, token: credential.token }).me();
      if (this.credential !== credential) return;
      if (me.id !== credential.user.id) throw new PiworkApiError(401, "IDENTITY_CHANGED", "Core identity changed");
      this.checked = true;
      this.offline = false;
      this.error = undefined;
      this.lastKnownUser = credential.user;
      this.lastConfirmedAt = new Date().toISOString();
    } catch (error) {
      if (this.credential !== credential) return;
      if (error instanceof PiworkApiError && (error.status === 401 || error.status === 403)) {
        this.revokeContent();
        await this.clearStoredIfMatches(credential);
      } else {
        this.checked = false;
        this.offline = true;
        this.error = safeErrorMessage(error);
      }
    }
  }

  async login(account: string, password: string): Promise<IdentityView> {
    if (!account.trim() || !password) throw new PiworkApiError(400, "INVALID_LOGIN", "Account and password are required");
    this.revokeContent("login");
    const coreUrl = this.coreUrl, generation = this.generation;
    const client = new PiworkClient({ coreUrl });
    const result = await client.login(account, password);
    if (generation !== this.generation) {
      await new PiworkClient({ coreUrl, token: result.token }).logout().catch(() => undefined);
      throw new PiworkApiError(409, "CONNECTION_CHANGED", "Connection changed during sign in");
    }
    const record: CredentialRecord = { version: 1, coreUrl, token: result.token,
      expiresAt: result.expiresAt, user: result.user };
    try { await this.store.save(record); }
    catch (error) {
      await new PiworkClient({ coreUrl, token: result.token }).logout().catch(() => undefined);
      throw error;
    }
    this.credential = record;
    this.checked = true;
    this.offline = false;
    this.error = undefined;
    this.lastKnownUser = result.user;
    this.lastConfirmedAt = new Date().toISOString();
    return this.view();
  }

  async logout(): Promise<{ remoteRevocationConfirmed: boolean; view: IdentityView }> {
    const credential = this.credential, coreUrl = this.coreUrl;
    this.revokeContent("logout");
    let remoteRevocationConfirmed = false;
    if (credential) {
      try { await new PiworkClient({ coreUrl, token: credential.token }).logout(); remoteRevocationConfirmed = true; }
      catch { /* local revocation is immediate; caller sees the unconfirmed remote state */ }
      await this.clearStoredIfMatches(credential);
    } else remoteRevocationConfirmed = true;
    return { remoteRevocationConfirmed, view: await this.view() };
  }

  async switchCore(raw: string): Promise<IdentityView> {
    validateProxyCoreUrl(raw);
    this.revokeContent("switch");
    this.coreUrl = raw;
    this.lastKnownUser = undefined;
    this.lastConfirmedAt = undefined;
    const saved = await this.store.load();
    if (saved && sameCore(saved.coreUrl, raw)) this.credential = saved;
    return this.view();
  }

  revokeContent(reason: Revocation["reason"] = "session"): void {
    const hadContent = this.credential !== undefined || this.checked || this.offline;
    this.credential = undefined;
    this.checked = false;
    this.offline = false;
    this.error = undefined;
    this.lastKnownUser = undefined;
    this.lastConfirmedAt = undefined;
    this.generation++;
    for (const listener of this.revocationListeners) listener({ reason, hadContent });
  }

  private async clearStoredIfMatches(record: CredentialRecord): Promise<void> {
    const saved = await this.store.load();
    if (saved && sameCore(saved.coreUrl, record.coreUrl) && saved.user.id === record.user.id && saved.token === record.token) await this.store.clear();
  }
}
