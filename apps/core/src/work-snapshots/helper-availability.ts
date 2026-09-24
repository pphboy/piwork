export class SnapshotHelperUnavailableError extends Error {
  readonly code = "SNAPSHOT_HELPER_UNAVAILABLE";
  readonly status = 503;
  constructor() { super("Snapshot helper is not available"); this.name = "SnapshotHelperUnavailableError"; }
}

/** One startup resolution of operator configuration. A package can never select this image. */
export class SnapshotHelperAvailability {
  private constructor(readonly configured: boolean, private readonly capturedImageId?: string) {}
  static async resolve(reference: string | undefined, resolveImage: (reference: string) => Promise<string>): Promise<SnapshotHelperAvailability> {
    if (reference === undefined || reference.trim() === "") return new SnapshotHelperAvailability(false);
    try {
      const id = await resolveImage(reference);
      if (!/^sha256:[a-f0-9]{64}$/.test(id)) return new SnapshotHelperAvailability(true);
      return new SnapshotHelperAvailability(true, id);
    } catch { return new SnapshotHelperAvailability(true); }
  }
  status(): { readonly configured: boolean; readonly available: boolean } { return { configured: this.configured, available: this.capturedImageId !== undefined }; }
  requireImage(): string {
    if (this.capturedImageId === undefined) throw new SnapshotHelperUnavailableError();
    return this.capturedImageId;
  }
}
