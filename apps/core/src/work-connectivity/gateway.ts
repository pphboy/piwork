import { createHash, createHmac, randomBytes } from "node:crypto";

export interface RuntimeCertificateIdentity {
  readonly subject: string;
  readonly workId: string;
  readonly generation: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly fingerprint: string;
  readonly signature: string;
}

export class RuntimeIdentityAuthority {
  constructor(private readonly secret: Buffer, private readonly now: () => Date = () => new Date()) {}

  issue(workId: string, generation: number, ttlMs = 24 * 60 * 60 * 1_000): RuntimeCertificateIdentity {
    const issuedAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    const subject = `spiffe://piwork/work/${workId}/generation/${generation}`;
    const fingerprint = createHash("sha256").update(`${subject}\0${issuedAt}\0${expiresAt}`).digest("hex");
    return { subject, workId, generation, issuedAt, expiresAt, fingerprint, signature: this.sign(subject, generation, expiresAt, fingerprint) };
  }

  verify(identity: RuntimeCertificateIdentity, expectedWorkId: string, expectedGeneration: number): void {
    if (identity.workId !== expectedWorkId || identity.generation !== expectedGeneration) throw new Error("runtime identity does not match Work generation");
    if (Date.parse(identity.expiresAt) <= this.now().getTime()) throw new Error("runtime identity has expired");
    if (!timingSafeEqual(this.sign(identity.subject, identity.generation, identity.expiresAt, identity.fingerprint), identity.signature)) throw new Error("runtime identity signature is invalid");
  }

  private sign(subject: string, generation: number, expiresAt: string, fingerprint: string): string {
    return createHmac("sha256", this.secret).update(`${subject}\0${generation}\0${expiresAt}\0${fingerprint}`).digest("base64url");
  }
}

export interface WorkDiscoveryRecord { readonly workId: string; readonly address: string; readonly generation: number; readonly ready: boolean; }

export class WorkDiscovery {
  private readonly records = new Map<string, WorkDiscoveryRecord>();
  publish(record: WorkDiscoveryRecord): void { this.records.set(record.workId, record); }
  remove(workId: string): void { this.records.delete(workId); }
  locate(workId: string): WorkDiscoveryRecord {
    const record = this.records.get(workId);
    if (record === undefined || !record.ready) throw new Error(`Work ${workId} is not ready`);
    return record;
  }
}

export class ConnectionRevocationRegistry {
  private readonly revoked = new Set<string>();
  revoke(sessionId: string): void { this.revoked.add(sessionId); }
  isRevoked(sessionId: string): boolean { return this.revoked.has(sessionId); }
  clear(sessionId: string): void { this.revoked.delete(sessionId); }
}

export interface WatchEvent { readonly sequence: number; readonly payload: Uint8Array; }
export class WatchCursorExpiredError extends Error { readonly code = "CURSOR_EXPIRED"; }
export class BoundedWatchBuffer {
  private readonly events: WatchEvent[] = [];
  constructor(private readonly maxBytes = 1_048_576) {}
  append(event: WatchEvent): void {
    this.events.push(event);
    let bytes = this.events.reduce((sum, item) => sum + item.payload.byteLength, 0);
    while (bytes > this.maxBytes && this.events.length > 1) bytes -= this.events.shift()!.payload.byteLength;
  }
  read(afterSequence: number): WatchEvent[] {
    const first = this.events[0];
    if (first !== undefined && afterSequence < first.sequence - 1) throw new WatchCursorExpiredError("watch cursor has expired");
    return this.events.filter((event) => event.sequence > afterSequence);
  }
}

export function issueGatewaySecret(): Buffer { return randomBytes(32); }
function timingSafeEqual(left: string, right: string): boolean { return left.length === right.length && createHash("sha256").update(left).digest("hex") === createHash("sha256").update(right).digest("hex"); }
