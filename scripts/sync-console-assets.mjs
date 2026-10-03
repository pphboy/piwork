import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const app = "console-webui";
for (const kind of ["browser", "public"]) {
  const target = join(root, "internal/consoleassets/static", kind);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(join(root, "apps", app, "dist", kind), target, { recursive: true,
    filter: (path) => !/\.(?:map|ts)$/.test(path) });
}
