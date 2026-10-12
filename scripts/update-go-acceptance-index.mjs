import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveChangeArtifact } from './resolve-change-artifact.mjs';

export const frozenEvidencePath = 'evidence/legacy-docs/go-migration-scenarios.json';
export const matrixPath = 'verification-matrix.md';
export const outputDirectory = 'dist/verification';
export function acceptanceInputPaths(root) {
  const locate = artifactPath => resolveChangeArtifact(root, { ownerChange: 'go-core-cli-migration', artifactPath });
  return { matrix: locate(matrixPath), frozen: locate(frozenEvidencePath) };
}

export function reconcileScenarioEvidence(matrix, old) {
  if (!Array.isArray(old)) throw new Error('Invalid historical evidence');
  if (new Set(old.map(entry => entry.id)).size !== old.length) throw new Error('Duplicate historical scenario ids');
  const previous = new Map(old.map(entry => [entry.id, entry]));
  const records = [];
  let capability, tasks, level;
  const requirements = new Set();
  for (const line of matrix.split('\n')) {
    if (line.startsWith('### ')) { capability = line.slice(4).trim(); tasks = undefined; level = undefined; }
    const metadata = /^负责任务：(.+?)。验证层级：(.+?)。$/.exec(line);
    if (metadata) { tasks = metadata[1]; level = metadata[2]; }
    const row = /^\| (R\d+) \| (.+?) \| (.+) \|$/.exec(line);
    if (!row) continue;
    if (!capability || !tasks || !level) throw new Error('Incomplete matrix metadata');
    requirements.add(`${capability}/${row[1]}`);
    const title = /\[([^\]]+)\]\(([^)]+)\)/.exec(row[2]);
    if (!title) throw new Error(`Missing requirement source: ${line}`);
    for (const item of row[3].split('<br>')) {
      const scenario = /^(R\d+\/S\d+)：(.+)$/.exec(item.trim());
      if (!scenario) throw new Error(`Unrecognized scenario: ${item}`);
      const id = `${capability}/${scenario[1]}`;
      const existing = previous.get(id);
      if (existing && existing.scenario !== scenario[2]) throw new Error(`Scenario changed without evidence review: ${id}`);
      records.push({ id, capability, requirement: title[1], source: title[2], scenario: scenario[2], tasks, level,
        status: existing?.status ?? '未验证', tests: existing?.tests ?? [], commands: existing?.commands ?? [], results: existing?.results ?? [] });
    }
  }
  if (new Set(records.map(entry => entry.id)).size !== records.length) throw new Error('Duplicate scenario ids');
  if (records.length !== 970 || requirements.size !== 260 || new Set(records.map(entry => entry.capability)).size !== 36) throw new Error('Effective matrix count changed; review before refreshing evidence');
  const ids = new Set(records.map(entry => entry.id));
  for (const entry of old) if (!ids.has(entry.id)) throw new Error(`Existing evidence lost: ${entry.id}`);
  for (const record of records) {
    if (record.status === '通过' && [record.tests, record.commands, record.results].some(values => !Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value.trim()))) throw new Error(`No evidence for passed scenario: ${record.id}`);
  }
  return records;
}

export async function updateAcceptanceIndex(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const inputs = acceptanceInputPaths(root);
  const [matrix, frozen] = await Promise.all([readFile(inputs.matrix, 'utf8'), readFile(inputs.frozen, 'utf8')]);
  const records = reconcileScenarioEvidence(matrix, JSON.parse(frozen));
  const output = join(root, outputDirectory);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'go-migration-scenarios.json'), `${JSON.stringify(records, null, 2)}\n`);
  const escape = value => value.replaceAll('|', '\\|');
  const report = '# Go 迁移场景证据索引\n\n重新生成的临时报告；原冻结验收事实保持不变。矩阵固定为 36 个 capability、260 个 Requirement、970 个 Scenario，报告生成不自动将场景标记通过。\n\n'
    + `来源：[验证矩阵](${relative(output, inputs.matrix).replaceAll('\\', '/')})；[冻结证据](${relative(output, inputs.frozen).replaceAll('\\', '/')})。\n\n`
    + '| 场景 | 状态 | 测试 / 命令 / 结果 |\n| --- | --- | --- |\n'
    + records.map(entry => `| ${entry.id}：${escape(entry.scenario)} | ${entry.status} | ${escape([...entry.tests, ...entry.commands, ...entry.results].join('；')) || '尚未记录'} |`).join('\n') + '\n';
  await writeFile(join(output, 'go-migration-acceptance.md'), report);
  return records;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const records = await updateAcceptanceIndex();
  console.log(`Evidence index reconciled in dist/verification: ${records.length} scenarios; ${records.filter(entry => entry.status === '通过').length} passed.`);
}
