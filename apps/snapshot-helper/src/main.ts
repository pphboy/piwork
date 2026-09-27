import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const [action, treeDigest, contextKey, packageKey, ...extra] = process.argv.slice(2);
if (extra.length > 0 || !["capture", "restore", "restore-context", "restore-package", "verify-history", "restore-history", "verify-package"].includes(action ?? "")
  || (!["restore", "restore-context", "restore-package"].includes(action ?? "") && treeDigest !== undefined)
  || (["restore", "restore-context", "restore-package"].includes(action ?? "") && !/^[a-f0-9]{64}$/.test(treeDigest ?? ""))
  || (["restore-context", "restore-package"].includes(action ?? "") ? !/^[a-z][a-z0-9-]{0,63}$/.test(contextKey ?? "") : contextKey !== undefined)
  || (action === "restore-package" ? !/^[a-f0-9]{64}$/.test(packageKey ?? "") : packageKey !== undefined)) {
  process.stderr.write('{"code":"SNAPSHOT_HELPER_ARGUMENT"}\n'); process.exitCode = 2;
} else if (action === "capture" || action === "restore" || action === "restore-context" || action === "restore-package") {
  const worker = fileURLToPath(new URL("../filesystem.py", import.meta.url));
  const workerAction = action;
  const root = action === "restore-context" ? `/snapshot/spool/contexts/${contextKey}`
    : action === "restore-package" ? `/snapshot/spool/context-packages/${contextKey}/${packageKey}` : "/snapshot/volume";
  const spool = "/snapshot/spool";
  const child = spawn("python3", [worker, workerAction, root, spool, ...(treeDigest === undefined ? [] : [treeDigest])], {
    stdio: ["ignore", "inherit", "inherit"], env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
  });
  const stop = () => { child.kill("SIGTERM"); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  child.once("error", () => { process.stderr.write('{"code":"SNAPSHOT_HELPER_UNAVAILABLE"}\n'); process.exitCode = 1; });
  child.once("close", (code) => { process.off("SIGTERM", stop); process.off("SIGINT", stop); process.exitCode = code ?? 1; });
} else {
  const controller = new AbortController();
  const stop = () => controller.abort(); process.on("SIGTERM", stop); process.on("SIGINT", stop);
  try {
    const { verifyVolumeHistory, verifyUploadedPackage } = await import("./history.js");
    const result = action === "verify-package" ? await verifyUploadedPackage("/snapshot/spool", controller.signal)
      : await verifyVolumeHistory("/snapshot/volume", "/snapshot/spool", action === "restore-history");
    controller.signal.throwIfAborted(); process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    process.stderr.write(`${JSON.stringify({ code: typeof code === "string" && /^(?:SNAPSHOT_HISTORY|PACKAGE)_[A-Z_]+$/.test(code) ? code : "SNAPSHOT_HISTORY_INVALID" })}\n`);
    process.exitCode = 1;
  } finally { process.off("SIGTERM", stop); process.off("SIGINT", stop); }
}
