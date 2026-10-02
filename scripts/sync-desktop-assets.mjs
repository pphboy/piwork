import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const [source, target] of [
  ["apps/desktop-webui/dist/browser/app.js", "internal/desktopassets/static/browser/app.js"],
  ["apps/desktop-webui/dist/browser/files.js", "internal/desktopassets/static/browser/files.js"],
  ["apps/desktop-webui/dist/public/index.html", "internal/desktopassets/static/public/index.html"],
  ["apps/desktop-webui/dist/public/style.css", "internal/desktopassets/static/public/style.css"],
]) {
  mkdirSync(dirname(join(root, target)), { recursive: true });
  copyFileSync(join(root, source), join(root, target));
}
