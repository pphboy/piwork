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

const code = (text, language = 'sh') => '```' + language + '\n' + text + '\n```';
const preparationNote = (zh) => zh
  ? 'Core 就绪包括当前默认 Work 运行环境的准备和恢复。升级发行 Agent 或修改包选择后，创建 Work 前再次确认就绪；配置保存成功不表示后台准备已经结束。首次准备与普通创建的等待时间分别计算。'
  : 'Core readiness includes preparation and recovery of the current default Work runtime. After upgrading the release Agent or changing package selection, confirm readiness again before creating a Work; saving configuration does not wait for background preparation. Initial preparation and ordinary creation have separate wait times.';
export const composeCommands = 'docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core';
export const singleHostCommands = composeCommands;
export const firstWorkCommands = "piwork-cli login --account ACCOUNT\npiwork-cli work create --name 'My Work' --wait";
export const firstChatCommand = "piwork-cli chat WORK_ID --message 'Hello, Piwork!'";

function publishedFlowNote(metadata, zh) {
  if (metadata.state !== 'published') return '';
  if (metadata.controlPlanePort === 17891 && metadata.corePort === 17871) {
    return zh ? '本版固定镜像包含直接访问与网页配置流程。' : 'This published image includes direct browser entry and web setup.';
  }
  const manual = `https://github.com/pphboy/piwork/blob/${metadata.sourceCommit}/deploy/docker/README${zh ? '.zh-CN' : ''}.md`;
  const sourceBuild = 'https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证';
  return zh
    ? `当前源码的直接访问流程适用于本次重建程序和后续发行。固定镜像保留发布时的初始化行为，更新源码不会更新镜像；该镜像请查阅[对应版本手册](${manual})。测试新流程请先[构建当前源码](${sourceBuild})。`
    : `The direct-entry flow in this checkout applies to newly built programs and subsequent releases. Pinned images retain their released initialization behavior; updating source does not update an image. See the [matching release manual](${manual}) for that image, or [build the current source](${sourceBuild}) to test this flow.`;
}

export function quickStart(metadata, language, { composeLink, operationsLink, exampleLink }) {
  const zh = language === 'zh';
  const core = typeof metadata.images.core === 'string' ? metadata.images.core : metadata.images.core.reference;
  if (metadata.state === 'published' && (metadata.controlPlanePort !== 17891 || metadata.corePort !== 17871)) return publishedFlowNote(metadata, zh) + '\n';
  return [
    metadata.state === 'published' ? '' : (zh ? '**本地候选：镜像尚未推送。** 以下命令对应待验证候选，不能用旧版镜像代替统一入口。' : '**Local candidate: images have not been pushed.** These commands describe the pending candidate; older images do not contain the unified entry.'),
    zh ? 'Linux x86-64、rootful Docker Engine 28+。运行一个容器即可提供工作台、管理和首次设置，无需环境变量或客户端 CLI：' : 'Use Linux x86-64 and rootful Docker Engine 28+. One container serves the workbench, administration and first-time setup, with no environment variables or client CLI required:',
    publishedFlowNote(metadata, zh),
    code(coreRun(core)),
    zh ? '在本机或另一台电脑直接打开 `http://服务器IP:17891`，使用服务器实际 IP。空安装会显示创建管理员；已有账号时正常登录，无需终端授权链接。' : 'On this computer or another computer, open `http://SERVER_IP:17891` using the server’s actual IP. An empty installation shows Create administrator; an initialized installation shows normal sign-in. No terminal authorization link is required.',
    zh ? '浏览器创建管理员时输入密码及确认密码，随后正常登录进入 Admin 的 **Quick setup**（`/admin/setup`）。按两步引导填写模型 ID、API 类型、Base URL 和 API Key，或选择已保存模型，点击 **Save and continue**，顺序保存模型并绑定 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。Agent 镜像随服务端版本内置并自动使用，无需也不能手填、选择或高级覆盖。模型 Test 是显式可选操作；保存不自动调用模型。打开工作台创建 Work，然后聊天、管理文件或打开 Service。后续从 Admin **Overview → Quick setup** 返回配置；顶栏 **Workbench** 可随时返回工作台，准备区的完成按钮仍需等待全部 Ready。已保存的账号、模型和 Work 在重启后保留。' : 'Create the administrator with a password and matching confirmation, then sign in to **Quick setup** in Admin (`/admin/setup`). Follow the two-step guide: enter the model ID, API type, Base URL and API Key, or choose a saved model, then select **Save and continue**. This saves the model and binds CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. The Agent image is embedded with the server release and supplied automatically; it has no input, selector or advanced override. Model Test is explicit and optional; saving does not call the model. Open the workbench to create a Work, chat, manage files or open Services. Return through Admin **Overview → Quick setup** to change configuration. The topbar **Workbench** link remains available while preparation finishes; the completion action waits for all components. Saved accounts, models and Works survive restart.',
    serviceNetworkNote(zh), serviceCompatibilityNote(zh),
    zh ? `可选 [Compose](${composeLink})（2.24+）和 [单机示例](${exampleLink}) 同样直接进入网页；CLI 是高级可选工具。运行与恢复见 [安装手册](${operationsLink})。` : `Optional [Compose](${composeLink}) (2.24+) and the [single-host example](${exampleLink}) open the same web application. CLI is an optional advanced tool. See the [operations guide](${operationsLink}) for recovery.`,
  ].filter(Boolean).join('\n\n')+'\n';
}

export function nativeQuickStart(language, { buildLink = 'https://github.com/pphboy/piwork/blob/main/AGENTS.md#构建与验证' } = {}) {
 const zh=language==='zh';
 return [
  zh?`先按[开发入口](${buildLink})构建当前源码，再从仓库根运行；发行程序也可离开源码目录使用。原生程序仅支持 Linux x86-64。`:`[Build the current source](${buildLink}), then run from the repository root. Released programs also work outside the checkout. Native programs support Linux x86-64 only.`,
  code('./dist/go/piwork-core'),
  zh?'Core 自带管理 UI、工作台和首次设置。只接受 `--ui-port`（17891）、`--core-port`（17871）、`--data-dir`（用户配置目录下 piwork/server）三项运行配置；`--help`、`--version` 仅查询信息。端口为 1–65535，必须不同且不能使用内部 RPC 7172。相对数据路径相对当前目录解析。':'Core includes administration, the workbench and first-time setup. Its only startup settings are `--ui-port` (17891), `--core-port` (17871), and `--data-dir` (piwork/server under the user configuration directory). `--help` and `--version` only display information. Ports must be distinct, within 1–65535 and different from internal RPC 7172. Relative data paths resolve from the working directory.',
  code('./dist/go/piwork-core --ui-port 17991 --core-port 17971 --data-dir /var/lib/piwork/custom/core'),
  zh?'使用其中一种启动方式。打开输出的 HTTP URL 创建管理员，登录 Admin 的 Quick setup 配置模型和运行环境。无图形环境可手工打开该地址。Ctrl+C 正常关闭会停止本安装受管 Work，保留数据、历史和运行意图；重启复用相同数据路径。':'Choose one startup command. Open the printed HTTP URL, create the administrator, then configure models and runtime in Admin Quick setup. On a headless server, open that address manually. Ctrl+C stops this installation’s managed Works while preserving data, history and desired state; restart with the same data path.',
  zh?'Linux 原生客户端默认启动 Desktop，连接已有 Core；同机 UI 已占用 17891 时显式使用另一 Desktop 端口。客户端无需 Docker，不启动或停止 Core。':'The Linux native client starts Desktop by default and connects to an existing Core. Select another Desktop port when the local Core UI already uses 17891. The client requires no Docker and does not start or stop Core.',
  code('./dist/go/piwork-cli --core http://127.0.0.1:17871 desktop --port 17901 --no-open'),
  zh?'在本机浏览器打开 `http://desktop.localhost:17901/`。Desktop 与用户命令共享凭据，Desktop 默认 Core 偏好独立；业务命令依次选择 --core、PIWORK_CORE_URL、已保存凭据、默认本机地址。关闭浏览器或 CLI 不停止 Work。Windows 浏览器也可直接连接 Linux Core UI。':'Open `http://desktop.localhost:17901/` locally. Desktop shares user credentials with terminal commands but has its own default Core preference. Business commands select --core, PIWORK_CORE_URL, saved credentials, then the local default. Closing the browser or CLI does not stop Works. Windows browsers can also access the Linux Core UI.',
 ].join('\n\n')+'\n';
}

export function serviceNetworkNote(zh) {
 return zh
 ? '同一进程提供两个 HTTP 服务：UI 默认 `0.0.0.0:17891`，Core 默认 `0.0.0.0:17871`。浏览器只连接 UI，所有文件、事件及 `/services/<workId>/<serviceId>/<port>/` 使用同一入口；后端固定通过 loopback HTTP 连接 Core。外部 Linux CLI 直接连接服务器 Core 端口。仅使用 --ui-port/--core-port 改端口。UI 接受本机实际 IPv4、localhost、回环和主机名，校验 Host、Origin 与 CSRF，不信任 Forwarded；切换地址需独立登录。只提供 HTTP，不提供 HTTPS、域名或反向代理配置。内部 Agent 保留容器可达的 7172 mTLS 回连。用户 Service 不发布宿主端口，模型端点须从 Work 网络可达。'
 : 'One process serves two HTTP listeners: UI defaults to `0.0.0.0:17891`, Core to `0.0.0.0:17871`. Browsers use only UI, including files, events and `/services/<workId>/<serviceId>/<port>/`; the backend calls Core over fixed loopback HTTP. External Linux CLI connects directly to the server Core port. Change ports only with --ui-port/--core-port. UI accepts actual local IPv4 addresses, localhost, loopback and the machine hostname, validates Host, Origin and CSRF, and ignores Forwarded. Each address needs its own login. HTTP only; no HTTPS, custom domain or reverse proxy configuration. Internal Agent callbacks retain container-reachable mTLS on 7172. User Services publish no host ports. Model endpoints must be reachable from Work networks.';
}
export function serviceCompatibilityNote(zh) {
  return zh
    ? '托管 Service 与工作台同源，须视为可信应用；其脚本可使用当前用户的 UI 权限。应用须支持动态 Service URL 前缀；旧根路径应用不会自动改写源码、镜像或包。Service 支持响应 Cookie 的服务端登录、Basic/Bearer、HTTP、SSE 和 WebSocket。响应 Cookie 按浏览器会话及 Service 保存在服务器，HTTP 入口不转发 Secure Cookie。依赖 document.cookie/Cookie Store 读写（如脚本读取 CSRF Cookie）的应用不保证透明兼容；脚本写入浏览器 Cookie 也不保证同 IP 跨 Service 隔离，且不会转发上游。不支持硬编码 .work URL、跨站 SSO 或上游 HTTPS 的透明适配。应用 CSP/X-Frame-Options 保留；禁止嵌入时使用新标签页。'
    : 'Hosted Services share the workbench origin and must be trusted: scripts can use the current user’s UI permissions. Apps must support a dynamic Service URL prefix; old root-path apps, images and packages are not rewritten automatically. Services support server-side login using response Cookies, Basic/Bearer, HTTP, SSE and WebSocket. Response Cookies stay on the server, partitioned by browser session and Service; Secure Cookies are not forwarded through the HTTP entry. Apps that read/write document.cookie or Cookie Store (including script-read CSRF Cookies) are not guaranteed to work transparently. Script-written browser Cookies are not isolated across Services on the same IP and are never forwarded upstream. Hard-coded .work URLs, cross-site SSO and upstream HTTPS are outside transparent support. Application CSP/X-Frame-Options remain intact; open an application tab when embedding is denied.';
}
export function coreDemo(metadata, language) {
 const zh=language==='zh';const core=typeof metadata.images.core==='string'?metadata.images.core:metadata.images.core.reference;
 return [zh?'可选 Compose Demo 使用独立数据目录 `/var/lib/piwork/core`，正常停止占用相同端口的安装后再启动。模型和管理员仍在网页设置。':'The optional Compose demo uses its own `/var/lib/piwork/core` directory. Stop an installation using the same ports normally before starting. Set up the administrator and model in the browser.',
 code('PIWORK_CORE_IMAGE='+core+' \\\n    docker compose -f compose.core.yaml up --detach --wait --wait-timeout 600 core')].join('\n\n')+'\n';
}
export function terminalOperations(metadata, language) {
 const zh=language==='zh';
 return [
 zh?'进程健康与运行环境就绪分开：未完成网页初始化时 /healthz 可用，/readyz 尚未就绪。用户、模型、运行环境和依赖准备在内嵌 Admin 完成；operator 凭证和受保护管理 API 保留，用户 CLI 不读取 operator 凭证。':'Process health and runtime readiness are separate: /healthz is available before web setup finishes; /readyz remains unready. Manage users, models, runtime and dependency preparation in embedded Admin. Operator credentials and protected management APIs remain separate from user CLI credentials.',
 code('curl --fail http://127.0.0.1:17891/healthz\ndocker logs --tail 100 piwork-core-quickstart'),
 zh?'Core 还会在其数据目录的 `logs/core/` 下保存私有进程日志。每次启动新建 `core-<bootId>-<segment>.jsonl` 分片；分片达到 16 MiB 轮转，安装最多保留 256 MiB、7 天，文件约每秒同步，并在轮转、导出边界和正常关闭时额外同步。保持 Core 数据卷挂载即可在容器替换后保留这些分片。文件覆盖从取得安装目录锁后开始，包含受管诊断、性能事件、标准应用日志及启动/关闭记录；`--help`/`--version`、非法启动参数、取得锁之前的错误以及应用日志设施之外的原生运行时崩溃仍只出现在控制台/stderr，不构成完整原始 stderr 捕获。':'Core also keeps a private process log in `logs/core/` under its data directory. Each start writes a new `core-<bootId>-<segment>.jsonl` shard; shards rotate at 16 MiB, the installation retains at most 256 MiB for 7 days, and file writes sync about once per second plus on rotation, export boundaries and normal shutdown. Keep the Core data volume mounted to preserve these shards across container replacement. File coverage begins after the installation lock and includes managed diagnostics, performance events, standard application logs and startup/shutdown records. `--help`/`--version`, invalid startup, errors before that lock and native runtime crashes outside the application log writer remain console/stderr only; this is not a complete raw-stderr capture.',
 zh?'删除或替换 Agent/Service 实例前，Core 会把该精确实例保留的 stdout/stderr 归档到数据目录的 `logs/works/`。归档保留 7 天，每 Work 至多 512 MiB、每安装至多 2 GiB，优先清理最旧且无引用的归档。本版本之前已替换或删除的容器无法回填；已有容器继续按实际日志驱动读取，仅新建 Agent/Service 使用 16m × 4 的 json-file 有界策略。同样需保留数据卷。':'Before removing or replacing an Agent or Service instance, Core archives that exact instance\'s retained stdout/stderr under `logs/works/` in the data directory. Archives are kept for 7 days, up to 512 MiB per Work and 2 GiB per installation, removing the oldest unreferenced archives first. Containers replaced or removed before this release cannot be backfilled; existing containers keep their actual log driver and only new Agent/Service instances use the bounded 16m × 4 json-file policy. Keep the data volume mounted.',
 zh?'管理员可从 Linux CLI 或 Desktop 账户菜单的 **Export logs** 导出 Core 安全平台日志及自己全部 Work 日志，导出不会停止或 Apply Work。CLI：`piwork-cli --core http://SERVER_IP:17871 login --account admin`，`piwork-cli --core http://SERVER_IP:17871 logs export --output ./piwork-logs.zip`；用 `logs show EXPORT_ID` 与 `logs download EXPORT_ID --output FILE` 恢复原任务。结果包自就绪起保留 24 小时；部分结果保持 complete=false，并在 manifest.json 列出缺口。关闭 UI 面板或中断 CLI 不会取消已接受的 Core 任务。GUI 全流程无需运行命令；下载 ZIP 后由用户手工发给可信维护者，本功能不自动上传。':'Administrators can export Core safe platform logs plus all of their own Work logs from the Linux CLI or the Desktop account menu (**Export logs**). Export never stops or applies a Work. CLI: `piwork-cli --core http://SERVER_IP:17871 login --account admin`, then `piwork-cli --core http://SERVER_IP:17871 logs export --output ./piwork-logs.zip`; recover the original task with `logs show EXPORT_ID` and `logs download EXPORT_ID --output FILE`. Ready archives are kept for 24 hours; partial results keep complete=false and list gaps in manifest.json. Closing the UI panel or interrupting the CLI does not cancel an accepted Core task. The GUI flow requires no commands; download the ZIP and send it manually to a trusted maintainer. This feature does not upload it automatically.',
 serviceNetworkNote(zh),serviceCompatibilityNote(zh),
 zh?'可选测试初始化：仅 PIWORK_ADMIN_ACCOUNT 与 PIWORK_ADMIN_PASSWORD 成对有效时创建空安装首管理员；已有账号不被覆盖。默认安装无需业务环境变量，模型和镜像不从初始化 env 读取。':'Optional test bootstrap: paired PIWORK_ADMIN_ACCOUNT and PIWORK_ADMIN_PASSWORD initialize only the first administrator on an empty installation. Existing accounts are retained. Default setup needs no business environment variables; model and image settings are not read from initialization env.',
 zh?'在 Linux 客户端终端指定已有 Core 的地址，密码交互输入。ACCOUNT、WORK_ID 来自网页账号和创建结果：':'On the Linux client, select an existing Core address and enter the password interactively. ACCOUNT and WORK_ID come from your account and creation result:',
 code('export PIWORK_CORE_URL=http://SERVER_IP:17871\n'+firstWorkCommands+'\n'+firstChatCommand),
 zh?'未知修改先读回状态，用原 Operation/Run ID 恢复，不重复创建或发消息。文件和包直接使用客户端本地路径，无交换卷。':'Read back unknown writes and recover original Operation/Run IDs without resubmitting. Files and packages use local client paths, with no exchange volume.',
 code('piwork-cli operation show OPERATION_ID\npiwork-cli run watch WORK_ID RUN_ID --after SEQUENCE'),
 zh?'Core 正常关闭会停止本安装受管 Work，保留身份、历史、卷和运行意图。关闭网页或 CLI 不停止 Core 或 Work。':'Normal Core shutdown stops this installation’s managed Works and preserves identities, history, volumes and desired state. Closing a browser or CLI does not stop Core or Works.',
 code('docker stop --time 60 piwork-core-quickstart\ntest "$(docker inspect --format \'{{.State.ExitCode}}\' piwork-core-quickstart)" = 0\ndocker start piwork-core-quickstart'),
 code('docker compose -f docker-compose.yml stop core\n'+composeCommands),
 zh?'保留同一 Core 数据目录及匹配 Work 卷。升级先正常停止并备份一致数据；保留原镜像引用和清单，格式兼容时才可回退。不要使用 down -v 或全局 prune。Work 导出不是安装备份，导出前须 Stop，导入后显式 Start。':'Retain the same Core directory and matching Work volumes. Stop normally and take a consistent backup before upgrading. Keep prior image references and manifests; roll back only with compatible formats. Do not use down -v or global prune. Work exports are not installation backups: Stop before export and explicitly Start after import.'
 ].join('\n\n')+'\n';
}
export function singleHostReadme(metadata, language) {
 const zh=language==='zh';
 return [zh?'# 单机部署示例':'# Single-host deployment',zh?'[English](README.md) | **简体中文**':'**English** | [简体中文](README.zh-CN.md)',
 metadata.state==='published'?'':zh?'**本地候选：镜像尚未推送。**':'**Local candidate: images have not been pushed.**',
 zh?'Linux x86-64、rootful Docker Engine 28+、Compose 2.24+。默认只运行统一应用容器，网页完成初始化；无需业务环境变量。客户端使用 Linux 原生 CLI。':'Requires Linux x86-64, rootful Docker Engine 28+ and Compose 2.24+. The default starts only the unified application container; initialize in the browser without business environment variables. Use the Linux native CLI as the client.',
 zh?'使用独立目录 `/var/lib/piwork/examples/single-host/core`。先停止端口冲突的安装，不删除它的数据。':'Uses its own `/var/lib/piwork/examples/single-host/core` directory. Stop conflicting installations first, preserving their data.',
 publishedFlowNote(metadata,zh),code(composeCommands),
 zh?'直接打开 `http://服务器IP:17891`，创建管理员并确认密码、登录进入 Admin 的 **Quick setup**（`/admin/setup`）后填写或选择模型，点击 **Save and continue** 顺序保存模型及 CoreRuntime。准备页面会自动更新；全部依赖显示 Ready 后，点击 **Open workbench** 进入 Piwork。后续从 **Overview → Quick setup** 返回配置，顶栏 **Workbench** 可返回工作台。Agent 镜像随版本内置、自动使用，不提供手填或高级覆盖。无需额外授权链接。':'Open `http://SERVER_IP:17891` directly, create the administrator with password confirmation, sign in to Admin **Quick setup** (`/admin/setup`), enter or choose a model, then select **Save and continue** to save the model and CoreRuntime in sequence. The preparation page updates automatically; when all required components are Ready, select **Open workbench** to enter Piwork. Return through **Overview → Quick setup** to change configuration, or use the topbar **Workbench** link to return. The release supplies the Agent image automatically, with no image input or advanced override. No extra authorization link is required.',
 serviceNetworkNote(zh),serviceCompatibilityNote(zh),
 zh?'可选 Linux 原生客户端连接已有 Core，退出客户端不影响 Core 或 Work：':'An optional Linux native client connects to the existing Core. Exiting the client leaves Core and Works running:',
 code('piwork-cli --core http://SERVER_IP:17871 desktop --port 17901'),
 code('docker compose -f docker-compose.yml stop core\n'+composeCommands),
 zh?'Core 进程日志保存在数据目录的 `logs/core/`，按 16 MiB 分片，保留上限 256 MiB、7 天。保持数据卷挂载；覆盖范围边界见[安装指南](../../deploy/docker/README.zh-CN.md#terminal-operations)。':'Core process logs are stored under `logs/core/` in the Core data directory with 16 MiB shards, 256 MiB and 7-day retention. Keep the data volume mounted; see the [installation guide](../../deploy/docker/README.md#terminal-operations) for coverage boundaries.',
 zh?'管理员可从 Linux CLI 或 Desktop 账户菜单的 **Export logs** 导出 Core 安全平台日志及自己全部 Work 日志，导出不会停止或 Apply Work。CLI：`piwork-cli --core http://SERVER_IP:17871 login --account admin`，`piwork-cli --core http://SERVER_IP:17871 logs export --output ./piwork-logs.zip`；用 `logs show EXPORT_ID` 与 `logs download EXPORT_ID --output FILE` 恢复原任务。结果包自就绪起保留 24 小时；部分结果保持 complete=false，并在 manifest.json 列出缺口。关闭 UI 面板或中断 CLI 不会取消已接受的 Core 任务。GUI 全流程无需运行命令；下载 ZIP 后由用户手工发给可信维护者，本功能不自动上传。':'Administrators can export Core safe platform logs plus all of their own Work logs from the Linux CLI or the Desktop account menu (**Export logs**). Export never stops or applies a Work. CLI: `piwork-cli --core http://SERVER_IP:17871 login --account admin`, then `piwork-cli --core http://SERVER_IP:17871 logs export --output ./piwork-logs.zip`; recover the original task with `logs show EXPORT_ID` and `logs download EXPORT_ID --output FILE`. Ready archives are kept for 24 hours; partial results keep complete=false and list gaps in manifest.json. Closing the UI panel or interrupting the CLI does not cancel an accepted Core task. The GUI flow requires no commands; download the ZIP and send it manually to a trusted maintainer. This feature does not upload it automatically.',
 zh?'正常关闭保留用户、模型、Work ID、历史及卷。不要使用 down -v 或全局 prune。详见 [安装手册](../../deploy/docker/README.zh-CN.md#terminal-operations)。':'Normal shutdown preserves users, models, Work IDs, history and volumes. Do not use down -v or global prune. See the [installation guide](../../deploy/docker/README.md#terminal-operations).'
 ].filter(Boolean).join('\n\n')+'\n';
}
