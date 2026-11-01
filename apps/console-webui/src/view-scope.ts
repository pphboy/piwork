/** Immutable admission facts only; this module never reads or changes application state. */
export interface ViewStamp {
  readonly path: string;
  readonly load: number;
  readonly identity: number;
  readonly dialog: object | null;
}
export interface ViewGuardOptions {
  readonly includeDialog?: boolean;
  readonly allowIdentityChange?: boolean;
}
/** Capture the original owner. The caller alone chooses whether to apply a result. */
export function captureViewGuard(read: () => ViewStamp, options: ViewGuardOptions = {}): () => boolean {
  const original = { ...read() };
  return () => {
    const current = read();
    return original.path === current.path
      && original.load === current.load
      && (options.includeDialog === false || original.dialog === current.dialog)
      && (options.allowIdentityChange === true || original.identity === current.identity);
  };
}
