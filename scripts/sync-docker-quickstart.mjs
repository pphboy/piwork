import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { quickStart, coreDemo, terminalOperations, singleHostReadme } from './docker-quickstart-content.mjs';
import { renderCompose, root } from './build-docker-release.mjs';

const input = resolve(process.argv[2] || 'dist/docker/inputs/metadata.json');
const metadata = JSON.parse(readFileSync(input, 'utf8'));
metadata.state ||= 'candidate';
metadata.images = Object.fromEntries(Object.entries(metadata.images).map(([role, image]) => [role, typeof image === 'string' ? image : image.reference]));
writeFileSync(join(root, 'deploy/docker/release.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(join(root, 'deploy/docker/docker-compose.yml'), renderCompose(metadata));
mkdirSync(join(root, 'examples/single-host'), { recursive: true });
writeFileSync(join(root, 'examples/single-host/docker-compose.yml'), renderCompose(metadata, root, { singleHost: true }));
for (const [language, name] of [['en', 'README.md'], ['zh', 'README.zh-CN.md']]) writeFileSync(join(root, 'examples/single-host', name), singleHostReadme(metadata, language));

for (const [name, language] of [['README.md', 'en'], ['README.zh-CN.md', 'zh']]) {
  const path = join(root, name);
  let contents = readFileSync(path, 'utf8');
  const pattern = /<!-- docker-quickstart:start -->[\s\S]*?<!-- docker-quickstart:end -->/;
  if (!pattern.test(contents)) throw new Error(`Missing Quick Start marker in ${name}`);
  const body = quickStart(metadata, language, { composeLink: 'deploy/docker/docker-compose.yml', exampleLink: `examples/single-host/README${language === 'zh' ? '.zh-CN' : ''}.md`, operationsLink: `deploy/docker/README${language === 'zh' ? '.zh-CN' : ''}.md#terminal-operations` });
  contents = contents.replace(pattern, '<!-- docker-quickstart:start -->\n\n' + body + '\n<!-- docker-quickstart:end -->');
  const architecture = contents.match(/^## Architecture[^\n]*\n[\s\S]*?(?=^## |$(?![\s\S]))/m)?.[0];
  if (!architecture) throw new Error(`Missing Architecture in ${name}`);
  contents = contents.replace(architecture, '');
  contents = contents.replace(/^## Problem/m, architecture.trimEnd() + '\n\n## Problem');
  const oldNavigation = language === 'en'
    ? /Prefer Compose for Core deployment\?[\s\S]*?(?=\n\n<details>)/
    : /(?:想使用|使用) Compose 部署 Core[\s\S]*?(?=\n\n<details>)/;
  const navigation = language === 'en'
    ? 'For Windows Docker clients, remote Linux Core addresses, or the advanced Core-only Demo, see the [Docker guide](deploy/docker/README.md#terminal-operations).'
    : 'Windows Docker 客户端、远端 Linux Core 地址和高级 Core-only Demo 见 [Docker 手册](deploy/docker/README.zh-CN.md#terminal-operations)。';
  contents = contents.replace(oldNavigation, navigation);
  contents = contents.replace('such as the Core started above.', 'compatible with your native CLI version.');
  contents = contents.replace('例如上面启动的 Core。', '并与原生 CLI 版本兼容的 Core。');
  contents = contents.replace('Compose 2.24+ is additionally needed for the Core Demo or advanced Compose setups.', 'Compose 2.24+ is needed when choosing the Core-only deployment, the single-host example or advanced Compose setups.');
  contents = contents.replace('Core Demo 或高级 Compose 部署另需 Compose 2.24+。', '选择 Core Compose、单机部署示例或高级 Compose 部署时另需 Compose 2.24+。');
  contents = contents.replace('single-file alternative or advanced Compose setups', 'Core-only deployment, the single-host example or advanced Compose setups').replace('选择单文件 Compose 或高级 Compose 部署', '选择 Core Compose、单机部署示例或高级 Compose 部署');
  writeFileSync(path, contents);
}

for (const [name, language] of [['README.md', 'en'], ['README.zh-CN.md', 'zh']]) {
  const path = join(root, 'deploy/docker', name);
  const old = readFileSync(path, 'utf8');
  const zh = language === 'zh';
  const legacyMarker = '<!-- legacy-docker-quickstart:start -->';
  let legacy;
  if (old.includes(legacyMarker)) {
    legacy = old.slice(old.indexOf('## Legacy 0.0.1 installer'));
  } else {
    const trial = old.match(/<!-- docker-quickstart:start -->[\s\S]*?<!-- docker-quickstart:end -->/)?.[0]
      .replaceAll('docker-quickstart:', 'legacy-docker-quickstart:');
    const advanced = old.slice(old.indexOf(zh ? '## 高级安装与 Desktop' : '## Advanced installation and Desktop'));
    legacy = '## Legacy 0.0.1 installer\n\n<details>\n<summary>' + (zh ? '旧版安装包与可选 Desktop 操作' : 'Older installer and optional Desktop operations') + '</summary>\n\n'
      + (zh ? '以下命令仅用于已校验的 0.0.1 旧包；使用它自己的 release.env 和 YAML，不替换为仓库中的新 Demo。这些步骤不属于新的默认 Quick Start。\n\n' : 'The following commands belong to the verified older 0.0.1 installer. Use its own release.env and YAML, not the new repository Demo. These steps are separate from the new default Quick Start.\n\n')
      + trial + '\n\n' + advanced + '\n\n</details>\n';
  }
  legacy = legacy.replaceAll('notepad .\\client.env', "$PIWORK_CORE_URL = Read-Host 'Reachable Linux Core origin'\n[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'client.env'), \"PIWORK_CORE_URL=$PIWORK_CORE_URL`n\", [System.Text.UTF8Encoding]::new($false))");
  const title = zh ? '# Piwork Docker 安装与使用' : '# Piwork Docker setup';
  const languages = zh ? '[English](README.md) | **简体中文**' : '**English** | [简体中文](README.zh-CN.md)';
  const intro = zh ? 'Core 和 CLI 分别启动；Agent、helper、Service 与 Work 存储由 Core 管理。原生 CLI 继续独立交付。' : 'Start Core and CLI separately; Core manages the Agent, helpers, Services and Work storage. Native CLI delivery remains independent.';
  const block = (marker, body) => `<!-- ${marker}:start -->\n\n${body}\n<!-- ${marker}:end -->`;
  const trial = quickStart(metadata, language, { composeLink: 'docker-compose.yml', exampleLink: `../../examples/single-host/README${zh ? '.zh-CN' : ''}.md`, operationsLink: '#terminal-operations' });
  const contents = [title, languages, intro, '## Terminal Docker Quick Start', block('docker-quickstart', trial), '## Core Compose Demo', block('core-compose-demo', coreDemo(metadata, language)), '## Terminal operations', block('terminal-operations', terminalOperations(metadata, language)), legacy].join('\n\n');
  writeFileSync(path, contents);
}
process.stdout.write('Updated paired README commands and Core-only Compose and the single-host example.\n');
