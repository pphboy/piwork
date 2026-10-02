import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const [source, target] of [
  ["apps/console-webui/dist/browser/app.js", "internal/consoleassets/static/browser/app.js"],
  ["apps/console-webui/dist/public/index.html", "internal/consoleassets/static/public/index.html"],
  ["apps/console-webui/dist/public/style.css", "internal/consoleassets/static/public/style.css"],
]) {
  mkdirSync(dirname(join(root, target)), { recursive: true });
  copyFileSync(join(root, source), join(root, target));
}
