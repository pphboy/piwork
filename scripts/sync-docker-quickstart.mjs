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
  const title = zh ? '# Piwork Docker 安装与使用' : '# Piwork Docker setup';
  const languages = zh ? '[English](README.md) | **简体中文**' : '**English** | [简体中文](README.zh-CN.md)';
  const intro = zh ? '一个 Linux 应用提供 Core、完整网页工作台、管理和首次设置；CLI 为独立可选工具。' : 'One Linux application serves Core, the full web workbench, administration and first-time setup. CLI remains an independent optional tool.';
  const resources = zh
    ? '本版应用 Service 不设置 Piwork 内存上限或 Service 内存预留；CPU、服务/卷数量及 Agent/helper 内存政策仍有效。旧 Service memoryBytes 仅保留为兼容历史，memoryLimitMode / serviceMemoryPolicy 明确为 unlimited，零不表示零字节额度。正常关闭并启动新版 Core 后，受管恢复替换旧受限 Service 容器并保留 workspace。详见[资源与升级说明](https://github.com/pphboy/piwork/blob/main/openspec/specs/core-service-startup/spec.md)和 [Web base 手册](../images/web-base/README.zh-CN.md)。'
    : 'This release runs application Services without a Piwork memory cap or Service memory reservation. CPU, service/volume counts and Agent/helper memory policy still apply. Legacy Service memoryBytes values remain compatibility history; memoryLimitMode / serviceMemoryPolicy explicitly report unlimited, and zero is not a zero-byte allowance. A normal Core upgrade replaces older capped Service containers through managed recovery and retains workspace data. See [resource and upgrade details](https://github.com/pphboy/piwork/blob/main/openspec/specs/core-service-startup/spec.md) and the [Web base guide](../images/web-base/README.md).';
  const block = (marker, body) => `<!-- ${marker}:start -->\n\n${body}\n<!-- ${marker}:end -->`;
  const trial = quickStart(metadata, language, { composeLink: 'docker-compose.yml', exampleLink: `../../examples/single-host/README${zh ? '.zh-CN' : ''}.md`, operationsLink: '#terminal-operations' });
  const native = nativeQuickStart(language, { buildLink: 'https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证' });
  const contents = [title, languages, intro, resources, '## Docker Quick Start', block('docker-quickstart', trial), '## Native Linux application', block('native-quickstart', native), '## Core Compose Demo', block('core-compose-demo', coreDemo(metadata, language)), '## Terminal operations', block('terminal-operations', terminalOperations(metadata, language))].join('\n\n');
  writeFileSync(path, contents);
}
process.stdout.write('Updated bilingual deployment manuals, Core-only Compose and the single-host example.\n');
