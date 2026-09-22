import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import type { ServiceDefinition } from "@piwork/contracts";
import { DockerRuntime } from "@piwork/runtime-docker";
import { DockerServiceRuntimeAdapter } from "./docker-service-runtime.js";

test("real Docker service shares the Work network/workspace and restores captured image and data", async () => {
  const installation = process.env.PIWORK_TEST_INSTALLATION_ID ?? `service-it-${randomUUID()}`;
  const workId = `work-${randomUUID()}`;
  const serviceId = `service-${randomUUID()}`;
  const imageTag = `piwork-service-it:${randomUUID()}`;
  const docker = new DockerRuntime(installation);
  const runtime = new DockerServiceRuntimeAdapter(docker);
  const definition: ServiceDefinition = {
    serviceId, revision: 1, name: "demo", image: { reference: imageTag }, command: "python3",
    args: ["/var/data/workspace/apps/demo/server.py"], environment: {}, secretRefs: [],
    workingDirectory: "/var/data/workspace",
    mounts: [{ source: "workspace", target: "/var/data/workspace", readOnly: false }],
    ports: [{ name: "http", containerPort: 8000, protocol: "tcp" }],
    cpuMillis: 100, memoryBytes: 64 * 1_024 * 1_024, enabled: true, required: false,
    readiness: { kind: "exec", command: ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=1).read()"], deadlineMs: 15_000, timeoutMs: 2_000 },
    restartPolicy: "bounded",
  };
  try {
    dockerCommand(["tag", "python:3.13-slim", imageTag]);
    const network = await docker.ensureWorkNetwork(workId);
    const workspace = await docker.ensureManagedVolume(workId, "work-workspace");
    await docker.initializeManagedVolume(workId, "work-workspace", "python:3.13-slim");
    writeApplication(workspace.volumeName);
    const captured = await runtime.resolveImage(workId, definition);
    await runtime.start(workId, definition, captured);
    assert.equal(await runtime.waitReady(workId, definition, 15_000), true);
    const first = requestCounter(network.name);
    assert.equal(first, 1);
    const inspected = (await docker.listManagedContainers("service")).find((item) => item.containerId !== undefined)!;
    assert.equal(inspected.image, captured);
    assert.equal(inspected.mounts?.some((mount) => mount.destination === "/var/data/workspace"), true);
    assert.equal(inspected.mounts?.some((mount) => mount.destination === "/var/data"), false);

    await runtime.stop(workId, definition);
    await runtime.remove(workId, definition);
    dockerCommand(["tag", "node:24-bookworm-slim", imageTag]);
    await runtime.start(workId, definition, captured);
    assert.equal(await runtime.waitReady(workId, definition, 15_000), true);
    assert.equal(requestCounter(network.name), 2);
    assert.equal((await runtime.inspect(workId, serviceId)).exists, true);
  } finally {
    await runtime.stop(workId, definition).catch(() => undefined);
    await runtime.remove(workId, definition).catch(() => undefined);
    await docker.deleteWorkNetwork(workId).catch(() => undefined);
    await docker.deleteManagedVolume(workId, "work-workspace").catch(() => undefined);
    dockerCommand(["image", "rm", "-f", imageTag], true);
  }
});

function writeApplication(volume: string): void {
  const source = `from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json, os
DATA=Path('/var/data/workspace/data/demo/counter.json')
class H(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path == '/health': body=b'ok'
  else:
   DATA.parent.mkdir(parents=True,exist_ok=True)
   try: count=json.loads(DATA.read_text())['count']
   except (FileNotFoundError,KeyError,ValueError): count=0
   count+=1; tmp=DATA.with_suffix('.tmp'); tmp.write_text(json.dumps({'count':count})); os.replace(tmp,DATA); body=json.dumps({'count':count}).encode()
  self.send_response(200); self.end_headers(); self.wfile.write(body)
 def log_message(self,*args): pass
ThreadingHTTPServer(('0.0.0.0',8000),H).serve_forever()
`;
  dockerCommand(["run", "--rm", "--user", "0:0", "--mount", `type=volume,src=${volume},dst=/workspace`,
    "python:3.13-slim", "python3", "-c",
    "import base64,pathlib,sys; p=pathlib.Path('/workspace/apps/demo/server.py'); p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(base64.b64decode(sys.argv[1])); p.chmod(0o644)",
    Buffer.from(source).toString("base64")]);
}

function requestCounter(network: string): number {
  const output = dockerCommand(["run", "--rm", "--network", network, "node:24-bookworm-slim", "node", "-e",
    "fetch('http://svc-demo:8000/').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))"]);
  return (JSON.parse(output) as { count: number }).count;
}

function dockerCommand(args: readonly string[], ignoreFailure = false): string {
  try { return execFileSync("docker", [...args], { encoding: "utf8", timeout: 30_000 }); }
  catch (error) { if (ignoreFailure) return ""; throw error; }
}
