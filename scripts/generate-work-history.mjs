import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const sql = readFileSync(new URL("internal/workhistory/schema.sql", root), "utf8");
writeFileSync(new URL("packages/work-store/src/brain-schema.ts", root), `// Generated from internal/workhistory/schema.sql. Do not edit.\nexport const WORK_SCHEMA_SQL = ${JSON.stringify(sql)};\n`);
const database = new DatabaseSync(":memory:");
try {
  database.exec(sql);
  const objects = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  const encoded = JSON.stringify(objects, null, 2) + "\n";
  writeFileSync(new URL("internal/workhistory/schema-objects.json", root), encoded);
  writeFileSync(new URL("packages/work-store/src/schema-objects.ts", root), `// Generated from internal/workhistory/schema.sql. Do not edit.\nexport const WORK_SCHEMA_OBJECTS = ${JSON.stringify(objects, null, 2)} as const;\n`);
} finally { database.close(); }
