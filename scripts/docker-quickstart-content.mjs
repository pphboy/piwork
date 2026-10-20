export function coreRun(reference) {
  return [
    'docker run --detach --init \\',
    '    --name piwork-core-quickstart \\',
    '    --network host \\',
    '    --restart unless-stopped \\',
    '    --stop-timeout 60 \\',
    '    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \\',
    '    --volume /var/lib/piwork/quickstart/core:/var/lib/piwork/quickstart/core \\',
    `    ${reference}`,
  ].join('\n');
}

export function cliRun(reference) {
  return [
    'docker run --rm --init --interactive --tty \\',
    '    --add-host host.docker.internal:host-gateway \\',
    '    --env PIWORK_CORE_URL=http://host.docker.internal:7171 \\',
    '    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client \\',
    `    ${reference}`,
  ].join('\n');
}

export function cliFileRun(reference) {
  return cliRun(reference)
    .replace('    --add-host', ['    --name piwork-cli-files \\', '    --add-host'].join('\n'))
    .replace('    ' + reference, ['    --mount type=volume,src=piwork-quickstart-client-exchange,dst=/exchange \\', '    ' + reference].join('\n'));
}

const code = (text, language = 'sh') => '```' + language + '\n' + text + '\n```';
const preparationNote = (zh) => zh
  ? 'Core 就绪包括当前默认 Work 运行环境的准备和恢复。升级发行 Agent 或修改包选择后，创建 Work 前再次确认就绪；配置保存成功不表示后台准备已经结束。首次准备与普通创建的等待时间分别计算。'
  : 'Core readiness includes preparation and recovery of the current default Work runtime. After upgrading the release Agent or changing package selection, confirm readiness again before creating a Work; saving configuration does not wait for background preparation. Initial preparation and ordinary creation have separate wait times.';
export const composeCommands = 'docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core';
export const singleHostCommands = composeCommands + '\ndocker compose -f docker-compose.yml run --rm --no-deps cli';
export const firstWorkCommands = "piwork-cli login --account ACCOUNT\npiwork-cli work create --name 'My Work' --wait";
export const firstChatCommand = "piwork-cli chat WORK_ID --message 'Hello, Piwork!'";

function publishedFlowNote(metadata, zh) {
  if (metadata.state !== 'published') return '';
  const manual = `https://github.com/pphboy/piwork/blob/${metadata.sourceCommit}/deploy/docker/README${zh ? '.zh-CN' : ''}.md`;
  const sourceBuild = 'https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证';
  return zh
    ? `当前源码的直接访问流程适用于本次重建程序和后续发行。固定镜像保留发布时的初始化行为，更新源码不会更新镜像；该镜像请查阅[对应版本手册](${manual})。测试新流程请先[构建当前源码](${sourceBuild})。`
    : `The direct-entry flow in this checkout applies to newly built programs and subsequent releases. Pinned images retain their released initialization behavior; updating source does not update an image. See the [matching release manual](${manual}) for that image, or [build the current source](${sourceBuild}) to test this flow.`;
}

export function quickStart(metadata, language, { composeLink, operationsLink, exampleLink }) {
  const zh = language === 'zh';
  const core = typeof metadata.images.core === 'string' ? metadata.images.core : metadata.images.core.reference;
  return [
    metadata.state === 'published' ? '' : (zh ? '**本地候选：镜像尚未推送。** 以下命令对应待验证候选，不能用旧版镜像代替统一入口。' : '**Local candidate: images have not been pushed.** These commands describe the pending candidate; older images do not contain the unified entry.'),
    zh ? 'Linux x86-64、rootful Docker Engine 28+。运行一个容器即可提供工作台、管理和首次设置，无需环境变量或客户端 CLI：' : 'Use Linux x86-64 and rootful Docker Engine 28+. One container serves the workbench, administration and first-time setup, with no environment variables or client CLI required:',
    publishedFlowNote(metadata, zh),
    code(coreRun(core)),
    zh ? '在本机或另一台电脑直接打开 `http://服务器IP:7171`，使用服务器实际 IP。空安装会显示创建管理员；已有账号时正常登录，无需终端授权链接。' : 'On this computer or another computer, open `http://SERVER_IP:7171` using the server’s actual IP. An empty installation shows Create administrator; an initialized installation shows normal sign-in. No terminal authorization link is required.',
    zh ? '浏览器创建管理员时输入密码及确认密码，随后正常登录进入 Admin 的 **Quick setup**（`/admin/setup`）。按两步引导填写模型 ID、API 类型、Base URL 和 API Key，或选择已保存模型，点击 **Save and continue**，顺序保存模型并绑定 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。Agent 镜像随服务端版本内置并自动使用，无需也不能手填、选择或高级覆盖。模型 Test 是显式可选操作；保存不自动调用模型。打开工作台创建 Work，然后聊天、管理文件或打开 Service。后续从 Admin **Overview → Quick setup** 返回配置；顶栏 **Workbench** 可随时返回工作台，准备区的完成按钮仍需等待全部 Ready。已保存的账号、模型和 Work 在重启后保留。' : 'Create the administrator with a password and matching confirmation, then sign in to **Quick setup** in Admin (`/admin/setup`). Follow the two-step guide: enter the model ID, API type, Base URL and API Key, or choose a saved model, then select **Save and continue**. This saves the model and binds CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. The Agent image is embedded with the server release and supplied automatically; it has no input, selector or advanced override. Model Test is explicit and optional; saving does not call the model. Open the workbench to create a Work, chat, manage files or open Services. Return through Admin **Overview → Quick setup** to change configuration. The topbar **Workbench** link remains available while preparation finishes; the completion action waits for all components. Saved accounts, models and Works survive restart.',
    serviceNetworkNote(zh), serviceCompatibilityNote(zh),
    zh ? `可选 [Compose](${composeLink})（2.24+）和 [单机示例](${exampleLink}) 同样直接进入网页；CLI 是高级可选工具。运行与恢复见 [安装手册](${operationsLink})。` : `Optional [Compose](${composeLink}) (2.24+) and the [single-host example](${exampleLink}) open the same web application. CLI is an optional advanced tool. See the [operations guide](${operationsLink}) for recovery.`,
  ].filter(Boolean).join('\n\n')+'\n';
}

export function nativeQuickStart(language, { buildLink = 'https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证' } = {}) {
  const zh = language === 'zh';
  return [
    zh
      ? `Docker 镜像已包含统一入口。如需原生运行，先[构建当前源码](${buildLink})，再从仓库根目录启动 Linux 程序；构建后的可执行文件也可在源码目录外使用：`
      : `The Docker images already include the unified entry. To run it natively, [build the current source](${buildLink}), then start the Linux program from the repository root; the built executable also works outside the checkout:`,
    code('./dist/go/piwork --no-open'),
    zh
      ? '默认数据目录为用户配置目录下 `piwork/server`，监听 `0.0.0.0:7171`；使用终端给出的实际 IP 链接。`--data-dir`、`--listen`、`--public-origin`、`--service-ports` 和 TLS 参数见 `--help`。'
      : 'Data defaults to `piwork/server` in the user configuration directory and the listener to `0.0.0.0:7171`; use the actual IP link printed in the terminal. See `--help` for `--data-dir`, `--listen`, `--public-origin`, `--service-ports` and TLS options.',
    zh
      ? '直接打开实际 IP 地址创建管理员并正常登录，无需额外链接校验。Agent 镜像随服务端版本内置并自动使用，不提供手填或覆盖；网页创建管理员后配置模型。'
      : 'Open the actual IP address to create the administrator and sign in, with no extra link check. The Agent image is embedded with the server release and used automatically, with no image input or override; create the administrator and configure the model in the browser.',
    zh
      ? '使用自定义数据目录时保留相同的 `--data-dir`。退出主程序会按 Core 关闭契约停止受管 Work；关闭网页不会。'
      : 'Retain the same `--data-dir` when using a custom data directory. Exiting this program stops managed Works under the Core shutdown contract; closing a browser does not.',
    zh
      ? '当前源码构建的独立客户端使用 `piwork-cli desktop --no-open` 启动，在本机浏览器打开 `http://desktop.localhost:17891/`（自定义端口以输出为准）。普通浏览器会话自动建立；已有 CLI 登录会直接复用，否则正常登录。`piwork-cli desktop open --no-open` 仅是可选的地址查询，不签发授权；刷新、新浏览器或清 Cookie 均可直接使用相同地址。CLI 容器须发布本机回环端口并保留状态卷，在宿主机浏览器打开输出的地址，无需 `docker exec ... desktop open`。Desktop 与 CLI 共享 Core 凭据；退出登录会清理共享登录，关闭网页不停止 Work。'
      : 'For an independent client built from this source, run `piwork-cli desktop --no-open` and open `http://desktop.localhost:17891/` in a browser on this computer (use the printed port if customized). The ordinary browser session is established automatically; a saved CLI login is reused, otherwise sign in normally. `piwork-cli desktop open --no-open` is an optional address lookup that issues no authorization. Refresh, a new browser and cleared Cookies all use the same address. A CLI container must publish the local loopback port and retain its state volume; open the printed address in the host browser, without requiring `docker exec ... desktop open`. Desktop and CLI share Core credentials; signing out clears that shared login, while closing the browser does not stop Works.',
    zh
      ? '`piwork-cli` 保留独立 Windows/Linux 命令行与本机 Desktop；`piwork-console` 是独立管理入口，不属于默认启动依赖。历史 [0.0.7 Linux 发布包](https://github.com/pphboy/piwork/releases/download/v0.0.7/piwork-linux-amd64-0.0.7.tar.gz) 与 [实验性 Windows CLI 0.0.5](https://github.com/pphboy/piwork/releases/download/v0.0.5/piwork-cli-windows-amd64-0.0.5.exe) 不包含统一服务端入口。'
      : '`piwork-cli` retains its independent Windows/Linux terminal and local Desktop modes; `piwork-console` is a standalone administrator entry and is not required for default startup. The historical [0.0.7 Linux bundle](https://github.com/pphboy/piwork/releases/download/v0.0.7/piwork-linux-amd64-0.0.7.tar.gz) and [experimental Windows CLI 0.0.5](https://github.com/pphboy/piwork/releases/download/v0.0.5/piwork-cli-windows-amd64-0.0.5.exe) do not contain the unified server entry.',
  ].join('\n\n') + '\n';
}

export function serviceNetworkNote(zh) {
  return zh
    ? '服务端默认监听 `0.0.0.0:7171`；本机或远程电脑通过实际非回环 IP 打开 `http://服务器IP:7171`。局域网即可使用，无需公网地址。主站放行 TCP 7171，Service 入口另需 TCP 17891–17954（可用 `--service-ports` 修改）；7172 是内部 Agent RPC，不向浏览器开放。端口由 Piwork 代理，不是用户容器直出。只开放主站时工作台仍可使用，Service 入口会不可达。无需域名、DNS 或本机代理。HTTP 不加密；不可信网络请显式配置 HTTPS，并同时放行/代理主站与全部 Service 端口。'
    : 'The server listens on `0.0.0.0:7171` by default. Local or remote computers open `http://SERVER_IP:7171` using its actual non-loopback IP. A local network is sufficient; no public IP is required. Allow TCP 7171 for the main site and TCP 17891–17954 for Service entries (override with `--service-ports`); 7172 is internal Agent RPC, not a browser port. Piwork proxies these ports; user containers are not published directly. Opening only the main port leaves the workbench usable but Services unreachable. No domain, DNS or local proxy is required. HTTP is unencrypted; configure HTTPS explicitly for untrusted networks and expose/proxy both the main site and every Service entry port.';
}
export function serviceCompatibilityNote(zh) {
  return zh
    ? 'Service 支持响应 Cookie 的服务端登录、Basic/Bearer、HTTP、SSE 和 WebSocket。响应 Cookie 按浏览器会话及 Service 保存在服务器，Secure Cookie 仅通过 HTTPS 入口发送。依赖 document.cookie/Cookie Store 读写（如脚本读取 CSRF Cookie）的应用不保证透明兼容；脚本写入浏览器 Cookie 也不保证同 IP 跨 Service 隔离，且不会转发上游。不支持硬编码 .work URL、跨站 SSO 或上游 HTTPS 的透明适配。应用 CSP/X-Frame-Options 保留；禁止嵌入时使用新标签页。'
    : 'Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are sent only through HTTPS entries. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.';
}
export function coreDemo(metadata, language) {
 const zh=language==='zh';const core=typeof metadata.images.core==='string'?metadata.images.core:metadata.images.core.reference;
 return [zh?'可选 Compose Demo 使用独立数据目录 `/var/lib/piwork/core`，正常停止占用相同端口的安装后再启动。模型和管理员仍在网页设置。':'The optional Compose demo uses its own `/var/lib/piwork/core` directory. Stop an installation using the same ports normally before starting. Set up the administrator and model in the browser.',
 code('PIWORK_CORE_IMAGE='+core+' \\\n    docker compose -f compose.core.yaml up --detach --wait --wait-timeout 600 core')].join('\n\n')+'\n';
}
export function terminalOperations(metadata, language) {
 const zh=language==='zh';const cli=typeof metadata.images.cli==='string'?metadata.images.cli:metadata.images.cli.reference;
 return [zh?'进程健康与运行环境就绪分开：未创建管理员或模型时网页和 /healthz 正常，/readyz 尚未就绪。':'Process health and runtime readiness are separate: the web pages and /healthz work before administrator/model setup, while /readyz remains unready.',
 code('docker exec piwork-core-quickstart piwork-serve --data-dir /var/lib/piwork/quickstart/core --json status'),
 zh?'CoreRuntime 的 Agent 镜像由目标 Core 的发行版本固定；旧脚本移除 `config set --agent-image`，其他模型和 Key 参数不变。在线使用目标 Core 版本，离线初始化使用本地服务端内嵌值。升级后读取或启动保留原 Runtime；显式再次保存才采用当前发行引用，仅影响后续新 Work，已有 Work 保持不变。':'CoreRuntime uses the target Core’s embedded release Agent image. Remove `--agent-image` from old `config set` scripts; other model and Key options stay the same. Online operations use the target Core version; offline initialization uses the local server release. Reading or starting after an upgrade preserves the saved Runtime. Explicitly saving adopts the current release for future Work; existing Work stays unchanged.',
 code('docker exec --interactive --tty piwork-core-quickstart piwork-serve --data-dir /var/lib/piwork/quickstart/core config set --model-provider PROVIDER --model MODEL'),
 serviceNetworkNote(zh), serviceCompatibilityNote(zh),
 zh?'端口与 Service 身份持久绑定，重启不把旧 origin 分配给另一个应用。入口池耗尽时维护者显式扩大范围并放行端口；旧授权不跨重启保留。':'Ports remain pinned to their Service identities across restart, so another application cannot inherit an old origin. If the pool is full, the operator must explicitly enlarge the range and allow those ports. Grants expire on restart.',
 zh?'高级部署：`--public-origin` 指定精确公开来源（忽略客户端 Forwarded 头），`--tls-cert` / `--tls-key` 为所有入口提供 TLS。Key 文件须为私有权限。受信反向代理必须完整转发主站和每个独立 Service 端口，HTTPS 各入口须证书可信；只代理主站不足以使用 Service。模型端点须从 Work 网络可达。':'Advanced deployment: `--public-origin` sets the exact public origin (client Forwarded headers are ignored); `--tls-cert` / `--tls-key` serve TLS on all entries. The key must be private. A trusted reverse proxy must forward the main site and every independent Service port. HTTPS certificates must be trusted on each entry; proxying only the main site is insufficient. Model endpoints must be reachable from Work networks.',
 zh?'可选测试初始化：仅 `PIWORK_ADMIN_ACCOUNT` 与 `PIWORK_ADMIN_PASSWORD` 成对有效时创建空安装的首管理员。示例合成值：`admin` / `synthetic-test-password`。已有账号不被覆盖；模型及 Agent/helper 的旧初始化环境变量已移除，持久模型继续使用。':'Optional test bootstrap: only the paired `PIWORK_ADMIN_ACCOUNT` and `PIWORK_ADMIN_PASSWORD` create the first administrator on an empty installation. Synthetic example values: `admin` / `synthetic-test-password`. Existing accounts are retained. Former model and Agent/helper initialization variables are removed; saved models remain usable.',
 zh?'可选 CLI 连接已经就绪的 Core，保留独立凭证卷；Windows/Linux 浏览器直接使用网页，无需 CLI。':'Optional CLI connects to a ready Core and retains its separate credential volume. Windows/Linux browsers use the web application directly without CLI.',
 code(cliRun(cli)),code(firstWorkCommands),code(firstChatCommand),
 zh?'未知修改先读回状态，使用原 Operation/Run ID 恢复，不重复创建或发消息：':'Read back an unknown write before retrying. Recover the original Operation/Run IDs without creating or sending again:',
 code('piwork-cli operation show OPERATION_ID\npiwork-cli run watch WORK_ID RUN_ID --after SEQUENCE'),
 zh?'正常停止会停止本安装受管 Work，保留 ID、历史、卷和运行意图；关闭网页或 CLI 不停止 Work。':'Normal shutdown stops this installation’s managed Works and retains IDs, history, volumes and desired state. Closing the browser or CLI does not stop Works.',
 code('docker stop --time 60 piwork-core-quickstart\ntest "$(docker inspect --format \'{{.State.ExitCode}}\' piwork-core-quickstart)" = 0\ndocker start piwork-core-quickstart'),
 code('docker compose -f docker-compose.yml stop core\n'+composeCommands),
 zh?'保留原数据目录及匹配 Work 卷，不使用 down -v 或全局 prune。升级前正常停止旧 Core，复用 `--data-dir`，用户和模型不要求重新输入。备份需要一致的 Core 数据及 Work 卷。':'Retain the data directory and matching Work volumes; do not use down -v or global prune. Stop the old Core normally before upgrading and reuse `--data-dir`; users and saved models do not need re-entry. Backups need a consistent Core directory and matching Work volumes.'
 ].join('\n\n')+'\n';
}
export function singleHostReadme(metadata, language) {
 const zh=language==='zh';
 return [zh?'# 单机部署示例':'# Single-host deployment',zh?'[English](README.md) | **简体中文**':'**English** | [简体中文](README.zh-CN.md)',
 metadata.state==='published'?'':zh?'**本地候选：镜像尚未推送。**':'**Local candidate: images have not been pushed.**',
 zh?'Linux x86-64、rootful Docker Engine 28+、Compose 2.24+。默认只运行统一应用容器，网页完成初始化；无需业务环境变量。CLI 使用显式可选 profile。':'Requires Linux x86-64, rootful Docker Engine 28+ and Compose 2.24+. The default starts only the unified application container; initialize in the browser without business environment variables. CLI uses an explicit optional profile.',
 zh?'使用独立目录 `/var/lib/piwork/examples/single-host/core`。先停止端口冲突的安装，不删除它的数据。':'Uses its own `/var/lib/piwork/examples/single-host/core` directory. Stop conflicting installations first, preserving their data.',
 publishedFlowNote(metadata,zh),code(composeCommands),
 zh?'直接打开 `http://服务器IP:7171`，创建管理员并确认密码、登录进入 Admin 的 **Quick setup**（`/admin/setup`）后填写或选择模型，点击 **Save and continue** 顺序保存模型及 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。后续从 **Overview → Quick setup** 返回配置，顶栏 **Workbench** 可返回工作台。Agent 镜像随版本内置、自动使用，不提供手填或高级覆盖。无需额外授权链接。':'Open `http://SERVER_IP:7171` directly, create the administrator with password confirmation, sign in to Admin **Quick setup** (`/admin/setup`), enter or choose a model, then select **Save and continue** to save the model and CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. Return through **Overview → Quick setup** to change configuration, or use the topbar **Workbench** link to return. The release supplies the Agent image automatically, with no image input or advanced override. No extra authorization link is required.',
 serviceNetworkNote(zh),serviceCompatibilityNote(zh),
 zh?'可选 CLI：待 Core 完整就绪后运行；其独立卷保留登录凭证。退出 CLI 不停止 Work。':'Optional CLI: run after Core is fully ready; its own volume retains credentials. Exiting CLI does not stop Works.',
 code('docker compose -f docker-compose.yml run --rm --no-deps cli'),code(firstWorkCommands),code(firstChatCommand),
 code('docker compose -f docker-compose.yml stop core\n'+composeCommands),
 zh?'正常关闭保留用户、模型、Work ID、历史及卷。不要使用 down -v 或全局 prune。详见 [安装手册](../../deploy/docker/README.zh-CN.md#terminal-operations)。':'Normal shutdown preserves users, models, Work IDs, history and volumes. Do not use down -v or global prune. See the [installation guide](../../deploy/docker/README.md#terminal-operations).'
 ].filter(Boolean).join('\n\n')+'\n';
}
