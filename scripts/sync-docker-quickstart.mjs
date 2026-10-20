import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { quickStart, coreDemo, terminalOperations, singleHostReadme, nativeQuickStart } from './docker-quickstart-content.mjs';
import { renderCompose, root } from './build-docker-release.mjs';

const input = resolve(process.argv[2] || 'dist/docker/inputs/metadata.json');
const metadata = JSON.parse(readFileSync(input, 'utf8'));
metadata.state ||= 'candidate';
if (metadata.state === 'published' && (metadata.controlPlanePort !== 17891 || metadata.corePort !== 17871)) throw new Error('Build current candidate materials; the published image retains its original ports.');
metadata.images = Object.fromEntries(Object.entries(metadata.images).map(([role, image]) => [role, typeof image === 'string' ? image : image.reference]));
writeFileSync(join(root, metadata.state === 'published' ? 'deploy/docker/release.json' : 'deploy/docker/candidate.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(join(root, 'deploy/docker/docker-compose.yml'), renderCompose(metadata));
mkdirSync(join(root, 'examples/single-host'), { recursive: true });
writeFileSync(join(root, 'examples/single-host/docker-compose.yml'), renderCompose(metadata, root, { singleHost: true }));
for (const [language, name] of [['en', 'README.md'], ['zh', 'README.zh-CN.md']]) writeFileSync(join(root, 'examples/single-host', name), singleHostReadme(metadata, language));

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
  const intro = zh ? '一个 Linux 应用提供 Core、完整网页工作台、管理和首次设置；CLI 为独立可选工具。' : 'One Linux application serves Core, the full web workbench, administration and first-time setup. CLI remains an independent optional tool.';
  const resources = zh
    ? '本版应用 Service 不设置 Piwork 内存上限或 Service 内存预留；CPU、服务/卷数量及 Agent/helper 内存政策仍有效。旧 Service memoryBytes 仅保留为兼容历史，memoryLimitMode / serviceMemoryPolicy 明确为 unlimited，零不表示零字节额度。正常关闭并启动新版 Core 后，受管恢复替换旧受限 Service 容器并保留 workspace。详见[资源与升级说明](../../openspec/specs/core-service-startup/spec.md)和 [Web base 手册](../images/web-base/README.zh-CN.md)。'
    : 'This release runs application Services without a Piwork memory cap or Service memory reservation. CPU, service/volume counts and Agent/helper memory policy still apply. Legacy Service memoryBytes values remain compatibility history; memoryLimitMode / serviceMemoryPolicy explicitly report unlimited, and zero is not a zero-byte allowance. A normal Core upgrade replaces older capped Service containers through managed recovery and retains workspace data. See [resource and upgrade details](../../openspec/specs/core-service-startup/spec.md) and the [Web base guide](../images/web-base/README.md).';
  const block = (marker, body) => `<!-- ${marker}:start -->\n\n${body}\n<!-- ${marker}:end -->`;
  const trial = quickStart(metadata, language, { composeLink: 'docker-compose.yml', exampleLink: `../../examples/single-host/README${zh ? '.zh-CN' : ''}.md`, operationsLink: '#terminal-operations' });
  const native = nativeQuickStart(language, { buildLink: '../../AGENTS.md#构建与验证' });
  const contents = [title, languages, intro, resources, '## Docker Quick Start', block('docker-quickstart', trial), '## Native Linux application', block('native-quickstart', native), '## Core Compose Demo', block('core-compose-demo', coreDemo(metadata, language)), '## Terminal operations', block('terminal-operations', terminalOperations(metadata, language)), legacy].join('\n\n');
  writeFileSync(path, contents);
}
process.stdout.write('Updated bilingual deployment manuals, Core-only Compose and the single-host example.\n');
