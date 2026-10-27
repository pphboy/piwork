export declare class ReadTimeout extends Error {}
export declare function readWithDeadline<T>(run: (signal: AbortSignal) => Promise<T>, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T>;
