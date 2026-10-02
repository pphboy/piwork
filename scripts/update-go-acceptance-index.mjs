import { readFile, writeFile } from "node:fs/promises";
const matrixURL = new URL("../openspec/changes/go-core-cli-migration/verification-matrix.md",import.meta.url);
const recordsURL = new URL("../docs/go-migration-scenarios.json",import.meta.url);
const docURL = new URL("../docs/go-migration-acceptance.md",import.meta.url);
const matrix = await readFile(matrixURL,"utf8");
const old = await readFile(recordsURL,"utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return []; throw error; });
const previous = new Map(old.map(entry => [entry.id,entry]));
const records = [];
let capability, tasks, level;
const requirements = new Set();
for (const line of matrix.split("\n")) {
  if (line.startsWith("### ")) { capability = line.slice(4).trim(); tasks = undefined; level = undefined; }
  const metadata = /^负责任务：(.+?)。验证层级：(.+?)。$/.exec(line);
  if (metadata) { tasks = metadata[1]; level = metadata[2]; }
  const row = /^\| (R\d+) \| (.+?) \| (.+) \|$/.exec(line);
  if (!row) continue;
  if (!capability || !tasks || !level) throw new Error("Incomplete matrix metadata");
  requirements.add(`${capability}/${row[1]}`);
  const title = /\[([^\]]+)\]\(([^)]+)\)/.exec(row[2]);
  if (!title) throw new Error(`Missing requirement source: ${line}`);
  for (const item of row[3].split("<br>")) {
    const scenario = /^(R\d+\/S\d+)：(.+)$/.exec(item.trim());
    if (!scenario) throw new Error(`Unrecognized scenario: ${item}`);
    const id = `${capability}/${scenario[1]}`;
    const existing = previous.get(id);
    if (existing && existing.scenario !== scenario[2]) throw new Error(`Scenario changed without evidence review: ${id}`);
    records.push({ id, capability, requirement: title[1], source: title[2], scenario: scenario[2], tasks, level,
      status:existing?.status ?? "未验证", tests:existing?.tests ?? [], commands:existing?.commands ?? [], results:existing?.results ?? [] });
  }
}
if (new Set(records.map(x => x.id)).size !== records.length) throw new Error("Duplicate scenario ids");
if (records.length !== 970 || requirements.size !== 260 || new Set(records.map(x => x.capability)).size !== 36) throw new Error("Effective matrix count changed; review before refreshing evidence");
for (const entry of old) if (!records.some(x => x.id === entry.id)) throw new Error(`Existing evidence lost: ${entry.id}`);
for (const record of records) {
  if (record.status === "通过" && (!record.tests.length || !record.commands.length || !record.results.length)) throw new Error(`No evidence for passed scenario: ${record.id}`);
}
await writeFile(recordsURL,`${JSON.stringify(records,null,2)}\n`);
const start = "<!-- GO_SCENARIO_INDEX_START -->", end = "<!-- GO_SCENARIO_INDEX_END -->";
let doc = await readFile(docURL,"utf8");
const section = `${start}\n## 全量场景证据索引\n\n来源：[验证矩阵](../openspec/changes/go-core-cli-migration/verification-matrix.md)。逐项记录：[go-migration-scenarios.json](go-migration-scenarios.json)。共 36 个 capability、260 个 Requirement、970 个 Scenario。基础任务完成不自动把产品场景标记通过。\n\n| 场景 | 状态 | 测试 / 命令 / 结果 |\n| --- | --- | --- |\n${records.map(entry => `| \`${entry.id}\`：${entry.scenario.replaceAll("|","\\|")} | ${entry.status} | ${entry.tests.length ? [...entry.tests,...entry.commands,...entry.results].join("；").replaceAll("|","\\|") : "尚未记录"} |`).join("\n")}\n${end}`;
if (doc.includes(start)) {
  if (!doc.includes(end)) throw new Error("Incomplete evidence index markers");
  doc = doc.slice(0,doc.indexOf(start))+section+doc.slice(doc.indexOf(end)+end.length);
} else { doc += `\n${section}\n`; }
await writeFile(docURL,doc);
console.log(`Evidence index reconciled: ${records.length} scenarios; ${records.filter(x => x.status === "通过").length} passed.`);
