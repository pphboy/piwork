export class FileHelperUnavailableError extends Error {
  readonly code = "FILE_HELPER_UNAVAILABLE";
  readonly status = 503;
  constructor() { super("File helper is unavailable"); this.name = "FileHelperUnavailableError"; }
}

/** Image identity is captured once at Core startup; requests cannot choose a helper. */
export class FileHelperAvailability {
  private constructor(readonly configured: boolean, private readonly capturedImageId?: string) {}

  static async resolve(reference: string | undefined, resolveImage: (reference: string) => Promise<string>): Promise<FileHelperAvailability> {
    if (reference === undefined || reference.trim() === "") return new FileHelperAvailability(false);
    try {
      const imageId = await resolveImage(reference);
      if (/^sha256:[a-f0-9]{64}$/.test(imageId)) return new FileHelperAvailability(true, imageId);
    } catch { /* A missing/incompatible helper affects file access only. */ }
    return new FileHelperAvailability(true);
  }

  status(): { readonly configured: boolean; readonly available: boolean } {
    return { configured: this.configured, available: this.capturedImageId !== undefined };
  }

  requireImage(): string {
    if (this.capturedImageId === undefined) throw new FileHelperUnavailableError();
    return this.capturedImageId;
  }
}
