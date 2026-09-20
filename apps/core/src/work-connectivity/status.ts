export type TransportStatus = "UNAUTHENTICATED" | "PERMISSION_DENIED" | "NOT_FOUND" | "CONFLICT" | "RESOURCE_EXHAUSTED" | "UNAVAILABLE" | "INTERNAL";

export function mapError(error: unknown): { readonly http: number; readonly grpc: TransportStatus; readonly code: string; readonly message: string } {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "INTERNAL";
  const message = error instanceof Error ? error.message : String(error);
  const mapped = code === "NOT_FOUND" ? [404, "NOT_FOUND"] : code === "PERMISSION_DENIED" ? [403, "PERMISSION_DENIED"] : code === "CONFLICT" || code === "REVISION_CONFLICT" ? [409, "CONFLICT"] : code === "QUOTA_EXCEEDED" ? [429, "RESOURCE_EXHAUSTED"] : code === "UNAVAILABLE" ? [503, "UNAVAILABLE"] : [500, "INTERNAL"];
  return { http: mapped[0] as number, grpc: mapped[1] as TransportStatus, code, message };
}

export function businessResultAfterTransportFailure<T>(result: T | undefined, transportError: unknown): { readonly result?: T; readonly transportError: string } {
  return { ...(result === undefined ? {} : { result }), transportError: transportError instanceof Error ? transportError.message : String(transportError) };
}
