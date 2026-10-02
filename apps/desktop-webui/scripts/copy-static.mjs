import { cpSync, mkdirSync } from "node:fs";

mkdirSync(new URL("../dist/public/", import.meta.url), { recursive: true });
cpSync(new URL("../public/", import.meta.url), new URL("../dist/public/", import.meta.url), { recursive: true });
