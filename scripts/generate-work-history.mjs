import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const root = new URL("../", import.meta.url);
for (const [source, sqlOutput, objectOutput, constant, objectConstant, goOutput] of [
  ["schema.sql", "brain-schema.ts", "schema-objects.ts", "WORK_SCHEMA_SQL", "WORK_SCHEMA_OBJECTS", "schema-objects.json"],
  ["schema-v4.sql", "legacy-schema.ts", "legacy-schema-objects.ts", "LEGACY_SCHEMA_SQL", "LEGACY_SCHEMA_OBJECTS", "schema-v4-objects.json"],
  ["memory-schema.sql", "memory-schema.ts", "memory-schema-objects.ts", "MEMORY_SCHEMA_SQL", "MEMORY_SCHEMA_OBJECTS", "memory-schema-objects.json"],
]) {
  const path = `internal/workhistory/${source}`;
  const sql = readFileSync(new URL(path, root), "utf8");
  const header = `// Generated from ${path}. Do not edit.\n`;
  writeFileSync(new URL(`packages/work-store/src/${sqlOutput}`, root), `${header}export const ${constant} = ${JSON.stringify(sql)};\n`);
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(sql);
    const objects = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    writeFileSync(new URL(`internal/workhistory/${goOutput}`, root), JSON.stringify(objects, null, 2) + "\n");
    writeFileSync(new URL(`packages/work-store/src/${objectOutput}`, root), `${header}export const ${objectConstant} = ${JSON.stringify(objects, null, 2)} as const;\n`);
  } finally { database.close(); }
}
