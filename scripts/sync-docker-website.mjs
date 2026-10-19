import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { quickStart, coreDemo, terminalOperations, cliRun, cliFileRun } from './docker-quickstart-content.mjs';
import { renderCompose, root, currentRelease } from './build-docker-release.mjs';
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
  const native = nativeDetails?.replaceAll('](openspec/', '](https://github.com/pphboy/piwork/blob/main/openspec/');
  const trial = quickStart(metadata, language, { composeLink: download, exampleLink: `https://github.com/pphboy/piwork/blob/main/examples/single-host/README${zh ? '.zh-CN' : ''}.md`, operationsLink: `/${prefix}guide/installation.html#terminal-operations` });
  write(`docs/${prefix}guide/quick-start.md`, '# Quick Start\n\n## ' + (zh ? '一键启动 Piwork' : 'Start Piwork with one command') + '\n\n' + block('docker-quickstart', trial) + '\n\n' + native + '\n');
  const installation = [zh ? '# 安装与部署' : '# Installation and Deployment', zh
    ? `默认试用见 [Quick Start](/zh/guide/quick-start.html)。统一应用直接提供网页、管理和首次引导；可下载 [docker-compose.yml](${download})；默认不需要业务环境变量，浏览器完成管理员与模型配置。当前状态：${metadata.state}。`
    : `Use [Quick Start](/guide/quick-start.html) for the default trial. The unified application serves the workbench, administration and setup; optionally download [docker-compose.yml](${download}); initialize the administrator and model in the browser without business environment variables. Current state: ${metadata.state}.`,
    zh ? '## 平台与持久化' : '## Platforms and persistence', zh
    ? 'Core 部署在 Linux x86-64、rootful Docker Engine 28+，使用同机 Unix socket 和 host 网络。主站 7171，Service 入口 17891–17954 须从客户端可达；7172 仅内部 Agent RPC。Linux/Windows 浏览器直接连接 Linux 服务端，CLI 是可选高级工具。Core Compose 和单机部署示例要求 2.24+；直接 Docker run 不要求 Compose。Core 同绝对路径 bind 与 CLI 用户状态卷保持分离，模型端点须从 Work 网络可达。'
    : 'Core runs on Linux x86-64 with rootful Docker Engine 28+, its local Unix socket and host networking. Client-accessible ports are 7171 and the Service range 17891–17954; 7172 is internal Agent RPC. Linux/Windows browsers connect directly to the Linux server; CLI is optional. Core Compose and the single-host example require Compose 2.24+; direct Docker run does not. Core same-path binds and CLI credential storage remain separate, and model endpoints must be reachable from Work networks.',
    zh ? '可选 CLI 单机示例见 [单机部署示例](https://github.com/pphboy/piwork/blob/main/examples/single-host/README.zh-CN.md)。可单独下载 [示例 Compose](' + download.replace('docker-compose.yml', 'single-host-compose.yml') + ')。' : 'For an optional CLI setup, see [Single-host deployment](https://github.com/pphboy/piwork/blob/main/examples/single-host/README.md) and its [example Compose](' + download.replace('docker-compose.yml', 'single-host-compose.yml') + ').',
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
    ? `[一键启动 Piwork](/zh/guide/quick-start.html)：一个 Docker 容器，打开服务器 IP 的网页完成管理员、模型与 CoreRuntime 配置，直接使用完整工作台。无需 CLI、域名或初始化环境。可选 [docker-compose.yml](${download})。当前状态 ${metadata.state}；候选镜像尚未公开发布。\n`
    : `[Start Piwork with one command](/guide/quick-start.html): one Docker container, then open the server IP to configure the administrator, model and CoreRuntime and use the full workbench. No CLI, domain or initialization environment is required. Optional [docker-compose.yml](${download}). State: ${metadata.state}; candidate images have not been published.\n`);
  write(`docs/${prefix}index.md`, home);

  write(`docs/${prefix}guide/first-work.md`, (zh
    ? '# 第一个 Work\n\n先按 [Quick Start](/zh/guide/quick-start.html) 启动并完成网页引导。点击 **Open workbench**，选择 **New Work**，创建后在 Chat 发送消息。Files 管理工作区，Settings 保存并显式 Apply 配置，Service 可预览或独立打开。关闭网页不停止 Work。\n\nService 响应 Cookie 保存在服务端分区；依赖脚本读取/写入 Cookie 的应用不保证透明兼容。脚本写入的浏览器 Cookie 可能在同 IP 的 Service 间串用，不会被代理采用。详情见安装说明。\n'
    : '# Your first Work\n\nFollow [Quick Start](/guide/quick-start.html) and complete browser setup. Click **Open workbench**, choose **New Work**, then send a message in Chat. Use Files for the workspace, Settings to save and explicitly Apply configuration, and Service to preview or open an application tab. Closing the browser does not stop a Work.\n\nService response Cookies stay in server-side partitions. Apps relying on script-read/written Cookies are outside transparent support. Script-written browser Cookies may be shared across Services on the same IP and are never adopted by the proxy. See Installation for details.\n'));
  const sourcePath = `docs/${prefix}guide/source-installation.md`;
  const source = (zh ? '# 源码构建\n\n默认使用 [Quick Start](/zh/guide/quick-start.html) 的统一应用镜像和网页引导。以下仅供开发者，构建需要 Go 1.25.5、Node 24、npm、Git、Make 与 Bash，服务端运行需要 Linux 和本机 Docker Engine。CLI 是可选客户端。\n' : '# Build from Source\n\nUse the unified application image and browser onboarding in [Quick Start](/guide/quick-start.html) by default. Developers need Go 1.25.5, Node 24, npm, Git, Make and Bash to build. The server runs on Linux with a local Docker Engine. CLI is optional.\n') + '\n```sh\nnpm ci\nmake build\n./dist/go/piwork --no-open\n```\n\n' + (zh ? '打开打印的实际 IP 地址及私有首次设置链接，网页配置管理员、模型和 CoreRuntime。Agent 镜像随服务端版本内置并自动使用，不提供手填或高级覆盖。`--data-dir` 指定持久目录，`--public-origin` 指定远程公开来源；主站和 Service 端口须同时可达。参数见 `./dist/go/piwork --help`。宿主运行不依赖 Node、Go 或 Docker CLI。\n' : 'Open the printed IP address and private first-time setup link. Configure the administrator, model and CoreRuntime in the browser. The release Agent image is embedded and supplied automatically, without an image input or advanced override. Use `--data-dir` for persistence and `--public-origin` for an explicit public origin; expose both the main site and Service port range. See `./dist/go/piwork --help`. Running the built server needs no Node, Go or Docker CLI.\n') + '\n[Docker release builds](https://github.com/pphboy/piwork/blob/main/openspec/specs/docker-delivery/spec.md)\n';
  write(sourcePath, source);
  for (const file of ['guide/index.md', 'spec/index.md']) {
    const path = `docs/${prefix}${file}`;
    let contents = read(path);
    const marker = '<!-- docker-trial-route -->';
    const route = zh ? '[Quick Start](/zh/guide/quick-start.html) 使用统一应用与网页引导，CLI 可选；原生构建与管理员操作见独立导航。' : '[Quick Start](/guide/quick-start.html) uses the unified application and browser onboarding. CLI is optional; native builds and administrator operations have separate navigation.';
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
write('README.md', siteReadme.slice(0, from) + `## Content maintenance\n\nDocker Quick Start starts one unified Linux application with browser onboarding and the full workbench. Default startup requires no business environment variables; only an optional paired ADMIN test bootstrap remains. CLI is optional. Service ports and script Cookie limitations are documented alongside the main entry. The single-host example has separate data. Published provenance is preserved.\n\nKeep both locales aligned with upstream commands and image defaults. Source: ${metadata.sourceCommit}; input SHA256: ${metadata.sourceInputHash}; state: ${metadata.state}. Candidate image/download availability is not public until release verification. Existing install/0.0.1 and install/0.1.0 files retain their provenance.\n\nRun upstream check-docker-quickstart.mjs with --website-root pointing at this directory after synchronizing. No real credentials or initialization env belongs in static files. Website synchronization does not push images or publish pages.\n\n` + siteReadme.slice(to));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: sync-docker-website.mjs REVIEW_OUTPUT_DIRECTORY');
  syncWebsite(resolve(process.argv[2]), currentRelease());
  process.stdout.write('Synchronized both website locales and versioned Core/example Compose materials.\n');
}
