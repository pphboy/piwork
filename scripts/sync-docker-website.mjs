import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { quickStart, coreDemo, terminalOperations, cliRun, cliFileRun } from './docker-quickstart-content.mjs';
import { renderCompose, root } from './build-docker-release.mjs';
import { fileURLToPath } from 'node:url';

export function syncWebsite(website, metadata, base = root) {
const download = `/piwork/install/${metadata.releaseId}/docker-compose.yml`;
const write = (name, contents) => writeFileSync(join(website, name), contents);
const read = name => readFileSync(join(website, name), 'utf8');
const block = (marker, body) => `<!-- ${marker}:start -->\n\n${body}\n<!-- ${marker}:end -->`;

for (const [prefix, language, readme] of [['', 'en', 'README.md'], ['zh/', 'zh', 'README.zh-CN.md']]) {
  const zh = language === 'zh';
  const upstream = readFileSync(join(base, readme), 'utf8');
  const nativeDetails = upstream.match(/<details>\n<summary>[\s\S]*?<!-- native-quickstart:end -->\n\n<\/details>/)?.[0];
  const native = nativeDetails?.replaceAll('](docs/', '](https://github.com/pphboy/piwork/blob/main/docs/');
  const trial = quickStart(metadata, language, { composeLink: download, exampleLink: `https://github.com/pphboy/piwork/blob/main/examples/single-host/README${zh ? '.zh-CN' : ''}.md`, operationsLink: `/${prefix}guide/installation.html#terminal-operations` });
  write(`docs/${prefix}guide/quick-start.md`, '# Quick Start\n\n## ' + (zh ? '使用 Docker 试用 Core 和 CLI' : 'Try Core and CLI with Docker') + '\n\n' + block('docker-quickstart', trial) + '\n\n' + native + '\n');
  const installation = [zh ? '# 安装与部署' : '# Installation and Deployment', zh
    ? `默认试用见 [Quick Start](/zh/guide/quick-start.html)。Core、CLI 独立运行；Core 可下载 [docker-compose.yml](${download})；初始化来自已有宿主环境，不需要安装包、配置文件编辑或 Desktop。当前状态：${metadata.state}。`
    : `Use [Quick Start](/guide/quick-start.html) for the default trial. Run Core and CLI independently; for Core-only Compose download [docker-compose.yml](${download}); initialization comes from the existing host environment. No installer, configuration file editing or Desktop is required. Current state: ${metadata.state}.`,
    zh ? '## 平台与持久化' : '## Platforms and persistence', zh
    ? 'Core 部署在 Linux x86-64、rootful Docker Engine 28+，使用同机 Unix socket、host 网络及 7171/7172。CLI 可用 Linux 或 Windows Docker Desktop 的 Linux 容器连接 Linux Core。Core Compose 和单机部署示例要求 2.24+；直接 Docker run 不要求 Compose。Core 同绝对路径 bind 与 CLI 用户状态卷保持分离，模型端点须从 Work 网络可达。'
    : 'Core runs on Linux x86-64 with rootful Docker Engine 28+, its local Unix socket, host networking and ports 7171/7172. CLI runs on Linux or Windows Docker Desktop Linux containers and connects to Linux Core. Core Compose and the single-host example require Compose 2.24+; direct Docker run does not. Core same-path binds and CLI credential storage remain separate, and model endpoints must be reachable from Work networks.',
    zh ? '合并运行 Core 和 CLI 见 [单机部署示例](https://github.com/pphboy/piwork/blob/main/examples/single-host/README.zh-CN.md)。可单独下载 [示例 Compose](' + download.replace('docker-compose.yml', 'single-host-compose.yml') + ')。' : 'For combined Core and CLI usage, see [Single-host deployment](https://github.com/pphboy/piwork/blob/main/examples/single-host/README.md) and its [example Compose](' + download.replace('docker-compose.yml', 'single-host-compose.yml') + ').',
    '## Core Compose Demo', block('core-compose-demo', coreDemo(metadata, language)), '## Terminal operations', block('terminal-operations', terminalOperations(metadata, language)),
    zh ? '## 高级与旧版本入口' : '## Advanced and older-version entry points', zh
    ? '源码与原生构建见 [源码安装](/zh/guide/source-installation.html)。旧 0.0.1 安装包、release.env、模板及 Desktop 说明保留在 [对应版本的上游手册](https://github.com/pphboy/piwork/blob/main/deploy/docker/README.zh-CN.md#legacy-001-installer)。本网站原有 install/0.0.1 与 install/0.1.0 地址保持旧版归属，不代表新镜像包含旧配置。'
    : 'For source/native builds, see [Build from Source](/guide/source-installation.html). The older 0.0.1 installer, release.env, templates and Desktop operations remain in the [versioned upstream guide](https://github.com/pphboy/piwork/blob/main/deploy/docker/README.md#legacy-001-installer). Existing install/0.0.1 and install/0.1.0 links retain their older provenance.',
  ].join('\n\n') + '\n';
  write(`docs/${prefix}guide/installation.md`, installation);
  let home = read(`docs/${prefix}index.md`);
  const start = zh ? '## 开始使用' : '## Get started';
  const at = home.indexOf(start);
  if (at < 0) throw new Error('Homepage startup slot is missing.');
  home = home.slice(0, at) + start + '\n\n' + (zh
    ? `[在终端试用 Core 和 CLI](/zh/guide/quick-start.html)：使用已有初始化环境，Core 和 CLI 各一条 Docker 命令，Core 也可单独下载 [docker-compose.yml](${download})。登录、创建 Work 后即可收到首条回复。当前镜像状态为 ${metadata.state}，公开使用在发行核对后启用。\n\n原生 CLI 保留为 Quick Start 的折叠替代入口。高级 Core-only Demo 见 [安装说明](/zh/guide/installation.html#core-compose-demo)。\n`
    : `[Try Core and CLI in the terminal](/guide/quick-start.html): use the existing initialization environment, one Docker command per entry, or deploy Core alone using [docker-compose.yml](${download}). Log in, create a Work and receive the first reply. Image state is ${metadata.state}; public use becomes available after release verification.\n\nNative CLI remains a folded Quick Start alternative. See [Installation](/guide/installation.html#core-compose-demo) for the advanced Core-only Demo.\n`);
  write(`docs/${prefix}index.md`, home);

  let first = read(`docs/${prefix}guide/first-work.md`);
  const imageBlock = /```sh\nPIWORK_CLI_IMAGE=\$\([\s\S]*?```\n\n/;
  first = first.replace(imageBlock, '');
  first = first.replaceAll('read the fixed CLI image in the host installation directory, and ', '').replaceAll('读取固定 CLI 镜像引用，', '');
  first = first.replace(/```sh\n(?:docker run[\s\S]*?)```/, '```sh\n' + cliFileRun(metadata.images.cli) + '\n```');
  write(`docs/${prefix}guide/first-work.md`, first);
  const sourcePath = `docs/${prefix}guide/source-installation.md`;
  let source = read(sourcePath);
  const notice = zh
    ? '默认试用请使用 [Quick Start](/zh/guide/quick-start.html) 的独立 Core/CLI 镜像；Core 可单独使用 Compose。下面仅为开发者的原生源码构建；Docker 发行构建见 [发行维护](https://github.com/pphboy/piwork/blob/main/docs/docker-release.md)，宿主不必安装 Go/Node。'
    : 'For the default trial, use the independent Core/CLI images (Core also supports Core-only Compose) in [Quick Start](/guide/quick-start.html). The following is a native source build for developers. [Docker release builds](https://github.com/pphboy/piwork/blob/main/docs/docker-release.md) compile inside Docker and need no host Go/Node.';
  const marker = '<!-- docker-source-route -->';
  if (source.includes(marker)) source = source.replace(new RegExp(marker + '[\\s\\S]*?' + marker), marker + '\n' + notice + '\n' + marker);
  else source = source.replace(/^(# [^\n]+)\n/, '$1\n\n' + marker + '\n' + notice + '\n' + marker + '\n');
  write(sourcePath, source);
  for (const file of ['guide/index.md', 'spec/index.md']) {
    const path = `docs/${prefix}${file}`;
    let contents = read(path);
    const marker = '<!-- docker-trial-route -->';
    const route = zh ? '[终端 Quick Start](/zh/guide/quick-start.html) 使用独立 Core/CLI 镜像，Core 可单独采用 Compose；合并方式见单机部署示例，原生构建与管理员操作见独立导航。' : '[Terminal Quick Start](/guide/quick-start.html) uses independent Core/CLI images; Core also supports Core-only Compose, with combined usage in the single-host example; native builds and administrator operations have separate navigation.';
    if (contents.includes(marker)) contents = contents.replace(new RegExp(marker + '[\\s\\S]*?' + marker), marker + '\n' + route + '\n' + marker);
    else contents += '\n' + marker + '\n' + route + '\n' + marker + '\n';
    write(path, contents);
  }
}

const output = join(website, 'docs/public/install', metadata.releaseId);
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'docker-compose.yml'), renderCompose(metadata, base));
writeFileSync(join(output, 'single-host-compose.yml'), renderCompose(metadata, base, { singleHost: true }));
writeFileSync(join(output, 'release-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
writeFileSync(join(output, 'README.txt'), `Piwork ${metadata.releaseId}\nState: ${metadata.state}\nSource: ${metadata.sourceCommit}\nInput SHA256: ${metadata.sourceInputHash}\nLocal documentation material; public image/download availability requires release verification.\n`);
const files = ['README.txt', 'docker-compose.yml', 'single-host-compose.yml', 'release-metadata.json'];
writeFileSync(join(output, 'SHA256SUMS'), files.map(name => `${createHash('sha256').update(readFileSync(join(output, name))).digest('hex')}  ${name}\n`).join(''));
const siteReadme = read('README.md');
const from = siteReadme.indexOf('## Content maintenance');
const to = siteReadme.indexOf('## Build and deployment');
write('README.md', siteReadme.slice(0, from) + `## Content maintenance\n\nDocker Quick Start runs Core and CLI independently. Core supports Core-only Compose. The optional combined example lives in examples/single-host/ and has its own data and credentials. Inputs come from the existing host environment; CLI startup waits for complete readiness and opens a terminal. Native CLI is a folded alternative. The advanced Core-only Demo uses a separate data directory.\n\nKeep both locales aligned with upstream commands and image defaults. Source: ${metadata.sourceCommit}; input SHA256: ${metadata.sourceInputHash}; state: ${metadata.state}. Candidate image/download availability is not public until release verification. Existing install/0.0.1 and install/0.1.0 files retain their provenance.\n\nRun upstream check-docker-quickstart.mjs with --website-root pointing at this directory after synchronizing. No real credentials or initialization env belongs in static files. Website synchronization does not push images or publish pages.\n\n` + siteReadme.slice(to));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncWebsite(resolve(process.argv[2] || '/home/p/Projects/pphboy.github.io/piwork'), JSON.parse(readFileSync(join(root, 'deploy/docker/release.json'), 'utf8')));
  process.stdout.write('Synchronized both website locales and versioned Core/example Compose materials.\n');
}
