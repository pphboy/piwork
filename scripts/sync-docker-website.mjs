import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { quickStart, coreDemo, terminalOperations, nativeQuickStart, serviceNetworkNote } from './docker-quickstart-content.mjs';
import { renderCompose, root, currentRelease } from './build-docker-release.mjs';
import { fileURLToPath } from 'node:url';

export function syncWebsite(website, metadata, base = root) {
const published = metadata.state === 'published';
if (published && (metadata.controlPlanePort !== 17891 || metadata.corePort !== 17871)) throw new Error('The published image does not support the current port layout; prepare candidate materials.');
const download = `/piwork/install/${metadata.releaseId}/docker-compose.yml`;
const write = (name, contents) => writeFileSync(join(website, name), contents);
const read = name => readFileSync(join(website, name), 'utf8');
const block = (marker, body) => `<!-- ${marker}:start -->\n\n${body}\n<!-- ${marker}:end -->`;

for (const [prefix, language] of [['', 'en'], ['zh/', 'zh']]) {
  const zh = language === 'zh';
  const trial = quickStart(metadata, language, { composeLink: download, exampleLink: `https://github.com/pphboy/piwork/blob/main/examples/single-host/README${zh ? '.zh-CN' : ''}.md`, operationsLink: `/${prefix}guide/installation.html#terminal-operations` });
  const installation = [zh ? '# 安装与部署' : '# Installation and Deployment', zh
    ? `本页供 Linux 服务端维护者部署统一应用。桌面一键启动见 [快速开始](/zh/guide/quick-start.html)。以下服务端命令和 [docker-compose.yml](${download}) 对应当前 Core 发行；无需业务环境变量，浏览器完成首次配置。当前状态：${metadata.state}。`
    : `This page is for Linux server maintainers. For the desktop one-click launcher, use [Quick Start](/guide/quick-start.html). The server commands and [docker-compose.yml](${download}) below match the current Core release; initialize in the browser without business environment variables. Current state: ${metadata.state}.`,
    zh ? '## 启动 Linux 服务端' : '## Start the Linux server', block('docker-quickstart', trial),
    zh ? '## 平台与持久化' : '## Platforms and persistence', zh
    ? serviceNetworkNote(true)
    : serviceNetworkNote(false),
    zh ? '可选 CLI 单机示例见 [单机部署示例](https://github.com/pphboy/piwork/blob/main/examples/single-host/README.zh-CN.md)。可单独下载 [示例 Compose](' + download.replace('docker-compose.yml', 'single-host-compose.yml') + ')。' : 'For an optional CLI setup, see [Single-host deployment](https://github.com/pphboy/piwork/blob/main/examples/single-host/README.md) and its [example Compose](' + download.replace('docker-compose.yml', 'single-host-compose.yml') + ').',
    '## Core Compose Demo', block('core-compose-demo', coreDemo(metadata, language)), '## Terminal operations', block('terminal-operations', terminalOperations(metadata, language)),
    zh ? '## 高级与旧版本入口' : '## Advanced and older-version entry points', zh
    ? '源码与原生构建见 [源码安装](/zh/guide/source-installation.html)。旧 0.0.1 安装包、release.env、模板及 Desktop 说明保留在 [对应版本的上游手册](https://github.com/pphboy/piwork/releases)。本网站原有 install/0.0.1 与 install/0.1.0 地址保持旧版归属，不代表新镜像包含旧配置。'
    : 'For source/native builds, see [Build from Source](/guide/source-installation.html). The older 0.0.1 installer, release.env, templates and Desktop operations remain in the [versioned upstream guide](https://github.com/pphboy/piwork/releases). Existing install/0.0.1 and install/0.1.0 links retain their older provenance.',
  ].join('\n\n') + '\n';
  write(`docs/${prefix}guide/installation.md`, installation);
  const sourcePath = `docs/${prefix}guide/source-installation.md`;
  const source = (zh?'# 源码构建':'# Build from Source')+'\n\n```sh\nnpm ci\nmake build\n```\n\n'+block('native-quickstart', nativeQuickStart(language))+'\n'+serviceNetworkNote(zh)+'\n\n[Docker release builds](https://github.com/pphboy/piwork/blob/main/openspec/specs/docker-delivery/spec.md)\n';
  write(sourcePath, source);

}

const output = join(website, 'docs/public/install', metadata.releaseId);
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'docker-compose.yml'), renderCompose(metadata, base));
writeFileSync(join(output, 'single-host-compose.yml'), renderCompose(metadata, base, { singleHost: true }));
writeFileSync(join(output, 'release-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(join(output, 'README.txt'), `Piwork ${metadata.releaseId}\nState: ${metadata.state}\nSource: ${metadata.sourceCommit}\nInput SHA256: ${metadata.sourceInputHash}\n${published ? 'Registry identities and anonymous image readability verified.' : 'Local documentation material; public image/download availability requires release verification.'}\n`);
const files = ['README.txt', 'docker-compose.yml', 'single-host-compose.yml', 'release-metadata.json'];
writeFileSync(join(output, 'SHA256SUMS'), files.map(name => `${createHash('sha256').update(readFileSync(join(output, name))).digest('hex')}  ${name}\n`).join(''));
const siteReadme = read('README.md');
const start = '<!-- server-release:start -->';
const end = '<!-- server-release:end -->';
const from = siteReadme.indexOf(start);
const to = siteReadme.indexOf(end);
if (from >= 0 && to > from && siteReadme.indexOf(start, from + start.length) < 0 && siteReadme.indexOf(end, to + end.length) < 0) {
  const identity = `Core server materials: ${metadata.releaseId}; state: ${metadata.state}. Source: ${metadata.sourceCommit}; input SHA256: ${metadata.sourceInputHash}.`;
  write('README.md', siteReadme.slice(0, from) + block('server-release', identity) + siteReadme.slice(to + end.length));
}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: sync-docker-website.mjs REVIEW_OUTPUT_DIRECTORY');
  syncWebsite(resolve(process.argv[2]), currentRelease());
  process.stdout.write('Synchronized both website locales and versioned Core/example Compose materials.\n');
}
