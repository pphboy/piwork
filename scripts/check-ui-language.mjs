#!/usr/bin/env node
// 中英文界面资源检查：词条完整性、占位符一致性、共享术语以及未迁移的硬编码文案。
// 词条文件是纯 JS 模块，直接 import；源码扫描使用轻量词法分析，避免依赖编译器。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const LOCALES = ['en', 'zh-CN'];

export const APP_DIRS = {
  desktop: 'apps/desktop-webui',
  console: 'apps/console-webui',
};

/**
 * 已确认的技术值例外。仅收录无法通过通用规则区分、且确实不是产品文案的文本。
 * 条目按“文件 + 精确文本片段 + 原因”维护，避免整文件豁免。
 */
export const EXEMPT = [
  {
    file: 'apps/console-webui/src/adapter.ts',
    text: 'Local directory',
    reason: 'sourceKind 协议值，显示标签在渲染时映射',
  },
  {
    file: 'apps/console-webui/src/app.ts',
    text: 'Local directory',
    reason: 'sourceKind 协议值，仅用于比较和映射',
  },
  {
    file: 'apps/console-webui/src/models.ts',
    text: 'Local directory',
    reason: 'sourceKind 类型联合中的协议值',
  },
  {
    file: 'apps/desktop-webui/src/app.ts',
    text: 'Core copy',
    reason: 'Pi Package source 协议值，不是显示文案',
  },
  {
    file: 'apps/desktop-webui/src/app.ts',
    text: 'Current Core copy',
    reason: 'Pi Package source 协议值，不是显示文案',
  },
  {
    file: 'apps/console-webui/src/app.ts',
    text: 'Package pending Core identity',
    reason: '未识别上传包时的内部占位名称，不作为界面文案',
  },
  {
    file: 'apps/console-webui/src/model-form.ts',
    text: 'Reply with OK.',
    reason: '模型连通性测试的固定请求内容，不是界面文案',
  },
  {
    file: 'apps/console-webui/src/model-management.ts',
    text: 'OpenAI Responses',
    reason: 'API 协议名称，按原文显示',
  },
  {
    file: 'apps/console-webui/src/model-management.ts',
    text: 'Anthropic Messages',
    reason: 'API 协议名称，按原文显示',
  },
];

/** 加载两端的合并词条以及共享术语定义。 */
export async function loadCatalogs(base = root) {
  const loadCatalog = async (app) => {
    const path = join(base, APP_DIRS[app], 'src/i18n/catalog.js');
    const module = await import(pathToFileURL(path).href);
    return module.catalog;
  };
  const shared = await import(pathToFileURL(join(base, 'apps/ui-shared/i18n.js')).href);
  return {
    desktop: await loadCatalog('desktop'),
    console: await loadCatalog('console'),
    sharedTerms: shared.SHARED_TERMS,
    locales: shared.LOCALES,
  };
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((match) => match[1]);
}

function describeList(values) {
  return values.length ? values.join(', ') : '(无)';
}

function samePlaceholders(left, right) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

/** i18n 目录中词条 key 的真实位置，便于报告可执行的定位信息。 */
function locateKey(base, app, key) {
  const directory = join(base, APP_DIRS[app], 'src/i18n');
  const catalogPath = relative(base, join(directory, 'catalog.js'));
  if (!existsSync(directory)) return { file: catalogPath, line: 1 };
  const needle = new RegExp(`['"]${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.js'))
    .sort();
  for (const name of files) {
    const lines = readFileSync(join(directory, name), 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (needle.test(lines[index])) return { file: relative(base, join(directory, name)), line: index + 1 };
    }
  }
  return { file: catalogPath, line: 1 };
}

function fail(base, app, key, message) {
  const location = locateKey(base, app, key);
  return { file: location.file, line: location.line, key, message };
}

function validateSingleCatalog(base, app, catalog, sharedTerms) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object') {
    errors.push({ file: `${APP_DIRS[app]}/src/i18n/catalog.js`, line: 1, key: '', message: `${app} 词条不是对象` });
    return errors;
  }
  for (const locale of LOCALES) {
    if (!catalog[locale] || typeof catalog[locale] !== 'object') {
      errors.push({ file: `${APP_DIRS[app]}/src/i18n/catalog.js`, line: 1, key: '', message: `${app} 缺少 ${locale} 词条表` });
    }
  }
  if (errors.length) return errors;

  const en = catalog.en;
  const zh = catalog['zh-CN'];
  const enKeys = new Set(Object.keys(en));
  const zhKeys = new Set(Object.keys(zh));

  for (const key of [...enKeys].sort()) {
    if (!zhKeys.has(key)) errors.push(fail(base, app, key, `缺少 zh-CN 词条`));
  }
  for (const key of [...zhKeys].sort()) {
    if (!enKeys.has(key)) errors.push(fail(base, app, key, `zh-CN 多出词条（en 缺失）`));
  }
  for (const key of [...new Set([...enKeys, ...zhKeys])].sort()) {
    for (const locale of LOCALES) {
      const value = catalog[locale][key];
      if (typeof value !== 'string') {
        errors.push(fail(base, app, key, `${locale} 值不是字符串`));
      } else if (!value.trim()) {
        errors.push(fail(base, app, key, `${locale} 值为空`));
      }
    }
    if (typeof en[key] !== 'string' || typeof zh[key] !== 'string' || !en[key].trim() || !zh[key].trim()) continue;
    const enParams = placeholders(en[key]);
    const zhParams = placeholders(zh[key]);
    if (!samePlaceholders(enParams, zhParams)) {
      errors.push(fail(base, app, key, `占位符不一致：en=[${describeList(enParams)}]，zh-CN=[${describeList(zhParams)}]`));
    }
  }

  for (const [key, term] of Object.entries(sharedTerms || {})) {
    for (const locale of LOCALES) {
      const expected = term[locale];
      const actual = catalog[locale][key];
      if (typeof actual !== 'string') {
        errors.push(fail(base, app, key, `缺少共享术语（${locale}）`));
      } else if (actual !== expected) {
        errors.push(fail(base, app, key, `共享术语 ${locale} 值应为 ${JSON.stringify(expected)}，实际为 ${JSON.stringify(actual)}`));
      }
    }
  }
  return errors;
}

/**
 * 校验两端词条：key 集合、非空值、占位符以及共享术语。
 * 返回 [{file, line, key, message}]。
 */
export function validateCatalogPair({ desktop, console: consoleCatalog, sharedTerms, base = root }) {
  return [
    ...validateSingleCatalog(base, 'desktop', desktop, sharedTerms),
    ...validateSingleCatalog(base, 'console', consoleCatalog, sharedTerms),
  ];
}

const REGEX_ALLOWED_BEFORE = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n', '',
]);
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else',
  'yield', 'await', 'default',
]);

function skipQuoted(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) return { value: source.slice(start + 1, index), end: index + 1 };
    if (char === '\n') return { value: source.slice(start + 1, index), end: index + 1 };
    index += 1;
  }
  return { value: source.slice(start + 1), end: source.length };
}

function skipRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '\n') return start + 1;
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      index += 1;
      while (/[a-z]/i.test(source[index] || '')) index += 1;
      return index;
    }
    index += 1;
  }
  return source.length;
}

function skipTemplateExpression(source, start) {
  let index = start;
  let depth = 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "'" || char === '"') {
      index = skipQuoted(source, index).end;
      continue;
    }
    if (char === '`') {
      index = skipTemplate(source, index).end;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index);
      if (index < 0) return source.length;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function skipTemplate(source, start) {
  let index = start + 1;
  const parts = [];
  let segment = index;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '`') {
      parts.push(source.slice(segment, index));
      return { value: parts.join('${…}'), end: index + 1 };
    }
    if (char === '$' && source[index + 1] === '{') {
      parts.push(source.slice(segment, index));
      index = skipTemplateExpression(source, index + 2);
      segment = index;
      continue;
    }
    index += 1;
  }
  parts.push(source.slice(segment));
  return { value: parts.join('${…}'), end: source.length };
}

/** 收集源码中的字符串字面量与模板字面量（跳过注释与正则）。 */
export function scanLiterals(source) {
  const literals = [];
  let index = 0;
  const lineStarts = [0];
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\n') lineStarts.push(cursor + 1);
  }
  const lineOf = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  let lastSignificant = '';
  while (index < source.length) {
    const char = source[index];
    if (char === "'" || char === '"') {
      const result = skipQuoted(source, index);
      literals.push({ value: result.value, start: index, line: lineOf(index) });
      index = result.end;
      lastSignificant = char;
      continue;
    }
    if (char === '`') {
      const result = skipTemplate(source, index);
      literals.push({ value: result.value, start: index, line: lineOf(index) });
      index = result.end;
      lastSignificant = '`';
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === '/' && (REGEX_ALLOWED_BEFORE.has(lastSignificant) || REGEX_KEYWORDS.has(lastSignificant))) {
      index = skipRegex(source, index);
      lastSignificant = '/';
      continue;
    }
    if (!/\s/.test(char)) {
      if (/[A-Za-z_$]/.test(char)) {
        let end = index + 1;
        while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
        lastSignificant = source.slice(index, end);
        index = end;
        continue;
      }
      lastSignificant = char;
    }
    index += 1;
  }
  return literals;
}

const EXCLUDE_PATTERNS = [
  /^(?:https?|wss?|ftp|file|mailto|data|blob):/i,
  /:\/\//,
  /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//,
  /^Bearer\s/,
  /^(?:\.|#|\[)/,
  /^(?:npm|npx|node|go|git|docker|make|bash|sh|curl|wget|python3?|pip|tsc)\b/,
  /^[A-Z][A-Za-z-]+:\s+\S/,
  /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+(?:[;\s].*)?$/,
  /^[A-Za-z0-9_.-]+=[^=]*&/,
  /[?&][A-Za-z0-9_.-]+=/,
  /=>|\bconsole\.|\bdocument\.|\bwindow\.|addEventListener/,
  /^v?\d+\.\d+/,
];

function looksLikePath(value) {
  if (/^(?:\.{0,2}\/|\/)/.test(value)) return true;
  // 形如 apps/x/y.ts、dist/browser/app.js 的仓库内路径。
  if (/^[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+$/.test(value)) return true;
  return false;
}

/** 判定一个字符串字面量是否像未迁移的产品界面文案。 */
export function isProductText(value) {
  if (typeof value !== 'string') return false;
  if (!/\s/.test(value)) return false;
  if ((value.match(/[A-Za-z]/g) || []).length < 2) return false;
  if (!/^[A-Z一-鿿]/.test(value.trimStart())) return false;
  if (looksLikePath(value)) return false;
  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(value))) return false;
  // 全大写的状态/协议集合，如 "HTTP 500"。
  if (/^[A-Z0-9\s_.:/-]+$/.test(value) && !/[a-z]/.test(value)) return false;
  return true;
}

function lineHasExemption(source, line) {
  const lines = source.split('\n');
  const text = lines[line - 1] || '';
  return /\/\/\s*i18n-exempt\b/.test(text);
}

function fileHasExemption(source) {
  const head = source.split('\n', 10).slice(0, 10).join('\n');
  return /\/\/\s*i18n-file-exempt\b/.test(head);
}

/**
 * 扫描一段源码文本，返回疑似未迁移的产品文案。
 * options.file 用于报告与 EXEMPT 匹配；options.exempt 可覆盖例外列表。
 */
export function scanSourceText(source, options = {}) {
  const file = options.file || '<source>';
  const exempt = options.exempt || EXEMPT;
  if (fileHasExemption(source)) return [];
  const findings = [];
  for (const literal of scanLiterals(source)) {
    const prefix = source.slice(Math.max(0, literal.start - 160), literal.start);
    const uiContext = /\b(?:const|let|var)\s+(?:label|title|placeholder|[A-Za-z_$][\w$]*(?:Label|Text|Caption|Title|Placeholder|Button))\s*=\s*$/i.test(prefix)
      || /\b(?:aria-label|placeholder|title)\s*[:=]\s*$/i.test(prefix)
      || /\b(?:btn|Button|Feedback)\s*\(\s*$/.test(prefix);
    const htmlLabels = [...literal.value.matchAll(/<(?:button|label|h[1-6]|p|span|option|summary)\b[^>]*>\s*([A-Za-z][^<]*)<\//gi)]
      .map(match => match[1].trim());
    const htmlAttributes = [...literal.value.matchAll(/\b(?:aria-label|placeholder|title)\s*=\s*["']([^"'$]+)["']/gi)]
      .map(match => match[1].trim());
    const htmlText = htmlLabels.some(label => !/^(?:Desktop|Piwork|CoreSetup|Agent|piwork-core)$/i.test(label))
      || htmlAttributes.some(value => /^[A-Za-z]+(?:[ ,.!?]+[A-Za-z]+)*[.!?]?$/.test(value));
    const uiLiteral = uiContext && /^[A-Za-z][A-Za-z\s!?.,'-]*$/.test(literal.value)
      && !EXCLUDE_PATTERNS.some(pattern => pattern.test(literal.value));
    if (!isProductText(literal.value) && !uiLiteral && !htmlText) continue;
    if (lineHasExemption(source, literal.line)) continue;
    const exempted = exempt.some((entry) => {
      if (entry.file && entry.file !== file) return false;
      return literal.value === entry.text;
    });
    if (exempted) continue;
    findings.push({
      file,
      line: literal.line,
      text: literal.value,
      message: `疑似未迁移的英文界面文案（如属技术值请加 // i18n-exempt 或维护 EXEMPT）`,
    });
  }
  return findings;
}

function listSourceFiles(base, app) {
  const directory = join(base, APP_DIRS[app], 'src');
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.d.ts')) files.push(path);
    }
  };
  if (existsSync(directory)) visit(directory);
  return files;
}

/**
 * 收集源码中显式引用的词条 key。动态拼接（如 'setup.component.' + name）
 * 单独返回，调用方只校验前缀确有对应词条。
 */
export function extractUsedKeys(source) {
  const used = [];
  const dynamic = [];
  const pattern = /\b(?:t|LocalizedMessage)\s*\(\s*(['"])([^'"]*)\1/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[2];
    const line = source.slice(0, match.index).split('\n').length;
    const rest = source.slice(match.index + match[0].length);
    if (/^\s*\+/.test(rest)) dynamic.push({ key: value, line });
    else used.push({ key: value, line });
  }
  return { used, dynamic };
}

/** 校验源码使用的 key 都存在于该应用的词条表中。 */
export function validateUsedKeys(base = root) {
  const results = [];
  for (const app of Object.keys(APP_DIRS)) {
    const directory = join(base, APP_DIRS[app], 'src');
    if (!existsSync(directory)) continue;
    const files = listSourceFiles(base, app);
    for (const path of files) {
      const file = relative(base, path).split(sep).join('/');
      const source = readFileSync(path, 'utf8');
      const { used, dynamic } = extractUsedKeys(source);
      results.push({ app, file, used, dynamic, path });
    }
  }
  return results;
}

/** 校验一段源码使用的 key 都在给定 key 集合中；动态前缀要求至少匹配一条。 */
export function validateSourceKeys(source, keys, file = '<source>') {
  const errors = [];
  const { used, dynamic } = extractUsedKeys(source);
  for (const item of used) {
    if (!keys.has(item.key)) errors.push({ file, line: item.line, key: item.key, message: '使用的词条 key 不存在' });
  }
  for (const part of dynamic) {
    if (![...keys].some((key) => key.startsWith(part.key))) {
      errors.push({ file, line: part.line, key: part.key, message: '动态词条前缀没有匹配的词条' });
    }
  }
  return errors;
}

function validateUsedKeysAgainst(catalogs, base) {
  const errors = [];
  const keysByApp = {
    desktop: new Set(Object.keys(catalogs.desktop?.en || {})),
    console: new Set(Object.keys(catalogs.console?.en || {})),
  };
  for (const entry of validateUsedKeys(base)) {
    const source = readFileSync(entry.path, 'utf8');
    errors.push(...validateSourceKeys(source, keysByApp[entry.app], entry.file));
  }
  return errors;
}

/** 扫描两端源码中的硬编码文案。 */
export function scanAppSources(base = root, options = {}) {
  const findings = [];
  for (const app of Object.keys(APP_DIRS)) {
    for (const path of listSourceFiles(base, app)) {
      const file = relative(base, path).split(sep).join('/');
      const source = readFileSync(path, 'utf8');
      findings.push(...scanSourceText(source, { ...options, file }));
    }
  }
  return findings;
}

function formatError(error) {
  return `${error.file}:${error.line}: ${error.message}${error.key ? ` [${error.key}]` : ''}${error.text ? ` ${JSON.stringify(error.text)}` : ''}`;
}

/** 完整检查：词条 + 硬编码扫描。 */
export async function validateLanguageResources(base = root) {
  const catalogs = await loadCatalogs(base);
  const errors = [
    ...validateCatalogPair({ ...catalogs, base }),
    ...validateUsedKeysAgainst(catalogs, base),
  ];
  const findings = scanAppSources(base);
  return { errors, findings, catalogs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { errors, findings } = await validateLanguageResources(process.env.PIWORK_UI_LANGUAGE_ROOT || root);
    const problems = [...errors, ...findings];
    for (const problem of problems) process.stdout.write(formatError(problem) + '\n');
    if (problems.length) {
      process.stderr.write(`ui-language: ${problems.length} problem(s)\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('ui-language: ok\n');
    }
  } catch (error) {
    process.stderr.write(`ui-language: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
