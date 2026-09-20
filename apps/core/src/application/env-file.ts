import { readFileSync } from "node:fs";

export type EnvironmentValues = Readonly<Record<string, string>>;

export function parseEnvironmentFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [offset, original] of contents.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) throw new Error(`invalid environment file syntax on line ${offset + 1}`);
    const key = match[1]!;
    if (Object.hasOwn(result, key)) throw new Error(`duplicate environment key ${key} on line ${offset + 1}`);
    result[key] = parseValue(match[2]!, offset + 1);
  }
  return result;
}

export function readEnvironmentFile(path: string): Record<string, string> {
  return parseEnvironmentFile(readFileSync(path, "utf8"));
}

export function resolveEnvironment(
  file: EnvironmentValues,
  processEnvironment: NodeJS.ProcessEnv,
  explicit: EnvironmentValues = {},
): Record<string, string> {
  const values: Record<string, string> = { ...file };
  for (const [key, value] of Object.entries(processEnvironment)) if (value !== undefined) values[key] = value;
  return { ...values, ...explicit };
}

function parseValue(value: string, line: number): string {
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error(`unterminated single quote on line ${line}`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error(`unterminated double quote on line ${line}`);
    return value.slice(1, -1).replace(/\\([\\"nrt])/g, (_match, character: string) => ({ n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"' })[character]!);
  }
  const comment = value.search(/\s+#/);
  const plain = (comment < 0 ? value : value.slice(0, comment)).trim();
  if (/^["']/.test(plain) || /[`$][({]?/.test(plain)) throw new Error(`unsupported environment expression on line ${line}`);
  return plain;
}
