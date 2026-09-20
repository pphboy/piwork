import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export class CoreAlreadyRunningError extends Error {
  constructor(readonly lockPath: string, options?: ErrorOptions) {
    super(`another piwork Core owns ${lockPath}`, options);
    this.name = "CoreAlreadyRunningError";
  }
}

export class StoreLock {
  private released = false;

  private constructor(
    private readonly descriptor: number,
    readonly path: string,
  ) {}

  static acquire(path: string): StoreLock {
    let descriptor: number;
    try {
      descriptor = openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        if (reclaimStaleLock(path)) return StoreLock.acquire(path);
        throw new CoreAlreadyRunningError(path, { cause: error });
      }
      throw error;
    }

    try {
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
      return new StoreLock(descriptor, path);
    } catch (error) {
      closeSync(descriptor);
      unlinkSync(path);
      throw error;
    }
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    closeSync(this.descriptor);
    try {
      unlinkSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function reclaimStaleLock(path: string): boolean {
  let pid: number;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown };
    if (!Number.isSafeInteger(value.pid) || Number(value.pid) < 1) return false;
    pid = Number(value.pid);
  } catch { return false; }
  try { process.kill(pid, 0); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
    try { unlinkSync(path); return true; } catch { return false; }
  }
}
