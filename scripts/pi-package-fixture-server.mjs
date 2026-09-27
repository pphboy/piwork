import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const [directory, portText, advertisedHost] = process.argv.slice(2);
if (!directory || !portText || !advertisedHost) throw new Error("fixture server arguments missing");
const config = JSON.parse(await readFile(join(directory, "registry.json"), "utf8"));
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://fixture.invalid").pathname);
    if (pathname === "/@piwork/fixture-tools") {
      const name = "@piwork/fixture-tools";
      const versions = Object.fromEntries(["1.0.0", "2.0.0", "9.9.9"].map((version) => [version, {
        name, version, dependencies: { "fixture-dependency": "file:vendor/fixture-dependency" },
        dist: { tarball: `http://${advertisedHost}:${portText}/tarballs/${version}.tgz`, shasum: config.sha1[version] },
      }]));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ name, "dist-tags": { latest: "2.0.0" }, versions }));
      return;
    }
    const relative = pathname.startsWith("/git/repo.git/") ? pathname.slice(1) :
      /^\/tarballs\/(?:1\.0\.0|2\.0\.0|9\.9\.9)\.tgz$/.test(pathname) ? pathname.slice(1) : null;
    if (relative === null) { response.writeHead(404).end(); return; }
    const target = resolve(directory, relative);
    if (!target.startsWith(`${resolve(directory)}${sep}`) || !(await stat(target)).isFile()) {
      response.writeHead(404).end(); return;
    }
    response.setHeader("content-type", relative.endsWith(".tgz") ? "application/octet-stream" : "text/plain");
    response.end(await readFile(target));
  } catch { response.writeHead(404).end(); }
});
server.listen(Number(portText), "0.0.0.0", () => process.stdout.write("ready\n"));
