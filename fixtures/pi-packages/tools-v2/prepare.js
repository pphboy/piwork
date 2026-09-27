import { writeFileSync } from "node:fs";
writeFileSync(new URL("prepared.txt", import.meta.url), "prepared-v2\n");
