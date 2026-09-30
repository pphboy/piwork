import { cpSync, mkdirSync } from "node:fs";

mkdirSync(new URL("../dist/desktop/public/", import.meta.url), { recursive: true });
cpSync(new URL("../public/desktop/", import.meta.url), new URL("../dist/desktop/public/", import.meta.url), { recursive: true });
