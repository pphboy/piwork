export function coreRun(reference) {
  return [
    'docker run --detach --init \\',
    '    --name piwork-core-quickstart \\',
    '    --network host \\',
    '    --restart unless-stopped \\',
    '    --stop-timeout 60 \\',
    '    --env PIWORK_ADMIN_ACCOUNT \\',
    '    --env PIWORK_ADMIN_PASSWORD \\',
    '    --env PIWORK_MODEL_PROVIDER \\',
    '    --env PIWORK_MODEL \\',
    '    --env PIWORK_API_KEY \\',
    '    --env PIWORK_MODEL_BASE_URL \\',
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
export const composeCommands = 'docker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core';
export const singleHostCommands = composeCommands + '\ndocker compose -f docker-compose.yml run --rm --no-deps cli';
export const firstWorkCommands = "piwork-cli login --account ACCOUNT\npiwork-cli work create --name 'My Work' --wait";
export const firstChatCommand = "piwork-cli chat WORK_ID --message 'Hello, Piwork!'";

export function quickStart(metadata, language, { composeLink, operationsLink, exampleLink }) {
  const zh = language === 'zh';
  const refs = Object.fromEntries(Object.entries(metadata.images).map(([role, image]) => [role, typeof image === 'string' ? image : image.reference]));
  const candidate = metadata.state !== 'published';
  const notice = candidate ? (zh
    ? '**本地候选：镜像尚未推送。** 以下命令和 Compose 文件对应本次候选，公开使用入口将在发行核对完成后启用。\n\n'
    : '**Local candidate: images have not been pushed.** These commands and the Compose file match this candidate; the public entry becomes available after release verification.\n\n') : '';
  const prerequisite = zh
    ? '使用 Linux x86-64 和 Docker Engine 28+。宿主环境中应已有 `PIWORK_ADMIN_ACCOUNT`、`PIWORK_ADMIN_PASSWORD`（至少 12 位）、`PIWORK_MODEL_PROVIDER`、`PIWORK_MODEL`、`PIWORK_API_KEY`。可选 `PIWORK_MODEL_BASE_URL` 使用 Work 可达的 HTTPS 地址；不用时保持未设置。'
    : 'Use Linux x86-64 with Docker Engine 28+. The host environment must already contain `PIWORK_ADMIN_ACCOUNT`, `PIWORK_ADMIN_PASSWORD` (at least 12 characters), `PIWORK_MODEL_PROVIDER`, `PIWORK_MODEL`, and `PIWORK_API_KEY`. Optional `PIWORK_MODEL_BASE_URL` uses HTTPS reachable from Work containers; leave it unset when unused.';
  const core = zh ? '在宿主终端运行 Core。镜像自带发行默认值，并自动准备 Agent 和 helper：' : 'Run Core in the host terminal. The image includes release defaults and automatically prepares the Agent and helpers:';
  const cli = zh ? 'CLI 独立运行，只需已有且可达的 Core，不需要 Core 初始化变量。下面连接同机 Core；连接其他 Core 时替换 `PIWORK_CORE_URL`。它等待完整就绪后进入终端：' : 'Run CLI independently against an existing Core; no Core initialization variables are needed. This command connects to Core on the same host; replace `PIWORK_CORE_URL` for another Core. It waits for full readiness and opens a terminal:';
  const compose = zh
    ? `Core 也可用 [Core-only docker-compose.yml](${composeLink}) 单独部署（Compose 2.24+），CLI 仍使用自己的 Docker 命令。切换 Core 部署方式前先停止原容器，保留同一数据目录。Core 与 CLI 合并的可选方式见 [单机部署示例](${exampleLink})。`
    : `Core can also be deployed alone with [Core-only docker-compose.yml](${composeLink}) (Compose 2.24+); CLI keeps its independent Docker command. Stop the previous Core before switching deployment methods, retaining the same data directory. For an optional combined setup, see [Single-host deployment](${exampleLink}).`;
  const login = zh ? '下面的命令在 **CLI 容器内**执行。将 `ACCOUNT` 替换为你的账号；登录时隐藏密码输入。创建 Work 会自动启动它：' : 'Run the following **inside the CLI container**. Replace `ACCOUNT` with your account; login prompts for a hidden password. Creating a Work starts it automatically:';
  const chat = zh ? '使用创建结果中的实际 `workId` 替换 `WORK_ID`，发送第一条消息：' : 'Replace `WORK_ID` with the actual `workId` returned by creation, then send your first message:';
  const finish = zh
    ? `回复直接显示在终端。用 \`exit\` 离开；同样的 CLI 启动命令会复用凭证，Work 不因 CLI 退出而停止。等待失败或观察中断时，按 [终端操作说明](${operationsLink}) 查询状态或恢复原 Operation/Run，不重复提交。`
    : `The reply appears in the terminal. Use \`exit\` to leave; the same CLI startup command reuses credentials and exiting the CLI does not stop Work. For failed readiness or interrupted observation, use the [terminal operations guide](${operationsLink}) to inspect status or recover the original Operation/Run without resubmitting.`;
  return notice + ['### Core', prerequisite, core, code(coreRun(refs.core)), compose, '### CLI', cli, code(cliRun(refs.cli)), login, code(firstWorkCommands), chat, code(firstChatCommand), finish].join('\n\n') + '\n';
}

export function coreDemo(metadata, language) {
  const zh = language === 'zh';
  const core = typeof metadata.images.core === 'string' ? metadata.images.core : metadata.images.core.reference;
  const cli = typeof metadata.images.cli === 'string' ? metadata.images.cli : metadata.images.cli.reference;
  const explanation = zh
    ? '这是可选的高级 Core-only Demo，使用独立的 `/var/lib/piwork/core`，CLI 仍用同版 Docker 终端。与默认示例共用 7171/7172 端口，切换前先正常停止原 Core。宿主仍使用上面的初始化环境；新空目录由挂载和安全初始化创建，已有目录保留原所有者和权限。'
    : 'This optional advanced Core-only Demo uses a separate `/var/lib/piwork/core` installation and the same Docker terminal CLI. It shares ports 7171/7172 with the default examples; stop the previous Core normally before switching. Use the existing initialization environment above. Mounting and safe initialization create a new empty directory; retain existing ownership and permissions.';
  const startup = [`PIWORK_CORE_IMAGE=${core} \\`, '    docker compose -f compose.core.yaml up --detach --wait --wait-timeout 600 core'].join('\n');
  const continueText = zh
    ? '在同一宿主运行下列 CLI 命令，然后在容器内按 Quick Start 登录这个 Demo 的账号、创建 Work 并聊天。就绪等待在镜像入口内完成：'
    : 'Run this CLI command on the same host, then follow Quick Start inside the container to log in to this Demo, create a Work and chat. Readiness waiting is built into the image entrypoint:';
  return [explanation, code(startup), continueText, code(cliRun(cli))].join('\n\n') + '\n';
}

export function terminalOperations(metadata, language) {
  const zh = language === 'zh';
  const cli = typeof metadata.images.cli === 'string' ? metadata.images.cli : metadata.images.cli.reference;
  const intro = zh ? '宿主终端中检查默认 Docker run Core。完整就绪不同于进程健康；修正环境、socket、镜像或端口问题后重试 CLI：' : 'Inspect the default Docker run Core in the host terminal. Full readiness is different from process health; fix environment, socket, image or port failures before retrying the CLI:';
  const status = 'docker exec piwork-core-quickstart piwork-serve --json status\ndocker logs --tail 100 piwork-core-quickstart';
  const composeStatus = 'docker compose -f docker-compose.yml exec -T core piwork-serve --json status\ndocker compose -f docker-compose.yml logs --tail 100 core';
  const recovering = zh ? 'Core 使用单独的 Compose 部署时改用：' : 'For Core-only Compose, use:';
  const observe = zh ? '下面在 CLI 容器内使用原返回值，恢复已经接受的 Operation/Run，不重复创建或发送消息：' : 'Inside the CLI container, use the original returned IDs to recover an accepted Operation/Run without creating or sending again:';
  const observeCode = 'piwork-cli operation show OPERATION_ID\npiwork-cli run watch WORK_ID RUN_ID --after SEQUENCE';
  const bounds = zh ? '`--wait` 观察预算为 120 秒。聊天的 Ctrl+C 按既有规则请求取消；继续会话使用原 `SESSION_ID`。登录凭证保存在独立卷，`exit` 和重建 CLI 不停止 Work；同样的 CLI 启动命令可以重新进入。合法初始化值变化不覆盖已保存的管理员或模型，修改使用既有 operator 命令。' : '`--wait` observes for up to 120 seconds. Ctrl+C during chat requests cancellation under the existing contract; continue a conversation using its original `SESSION_ID`. Credentials live in the separate volume. Exiting or rebuilding the CLI does not stop Work; repeat its startup command to return. Changed valid initialization values do not replace saved administrator/model settings; use existing operator commands for changes.';
  const stop = zh ? '正常停止默认 Core，并核对退出成功。受管 Work 停止，原 ID、历史、卷和运行意图保留；失败时保留日志，不宣称已确认关闭：' : 'Stop the default Core normally and verify successful exit. Managed Works stop while IDs, history, volumes and desired state remain. Retain logs on failure; do not report confirmed shutdown:';
  const stopCode = 'docker stop --time 60 piwork-core-quickstart\ntest "$(docker inspect --format \'{{.State.ExitCode}}\' piwork-core-quickstart)" = 0';
  const restart = zh ? '复用数据重新启动：' : 'Restart with the retained data:';
  const composeStop = 'docker compose -f docker-compose.yml stop core\ndocker compose -f docker-compose.yml up --detach --wait --wait-timeout 600 core';
  const preserve = zh ? 'Compose 的停止/重启使用下面命令。常规操作不使用 `down -v` 或全局 prune。备份包括一致的 Core 目录和匹配的 Work 卷；只备份 SQLite 或镜像不能恢复完整 Work。升级/回退固定发行引用，保留旧 Compose 与清单，并先核对格式兼容。文件交换与自定义 CA 是可选高级步骤，首次聊天不需要交换卷。' : 'Use the following for Compose stop/restart. Normal operation does not use `down -v` or global prune. Back up the consistent Core directory and matching Work volumes; SQLite or an image alone cannot recover a complete Work. Pin release references for upgrade/rollback, retain the old Compose and manifest, and check format compatibility first. File exchange and custom CAs are optional advanced steps; the first chat needs no exchange volume.';
  const windowsIntro = zh ? 'Windows Docker Desktop 使用 Linux 容器，终端 CLI 连接可达的 Linux Core。PowerShell 中 `CORE_URL` 替换为实际地址；密码仍在容器内隐藏输入：' : 'Windows Docker Desktop uses Linux containers; the terminal CLI connects to a reachable Linux Core. Replace `CORE_URL` with the actual address in PowerShell; login still prompts for a hidden password inside the container:';
  const windows = ['docker run --rm --init --interactive --tty `', '    --env PIWORK_CORE_URL=CORE_URL `', '    --mount type=volume,src=piwork-quickstart-client-state,dst=/var/lib/piwork/client `', `    ${cli}`, "if ($LASTEXITCODE -ne 0) { throw 'CLI container failed' }"].join('\n');
  const remote = zh ? '远端 Linux 客户端同样替换 Core URL。HTTPS 保持证书验证；模型/MCP 地址须从 Core 的 Work 网络可达，CLI 的宿主别名不能替代它。' : 'Remote Linux clients likewise replace the Core URL. HTTPS retains certificate verification. Model/MCP endpoints must be reachable from Core Work networks; the client host alias does not replace them.';
  return [intro, code(status), recovering, code(composeStatus), observe, code(observeCode), bounds, stop, code(stopCode), restart, code('docker start piwork-core-quickstart'), preserve, code(composeStop), windowsIntro, code(windows, 'powershell'), remote].join('\n\n') + '\n';
}

export function singleHostReadme(metadata, language) {
  const zh = language === 'zh';
  return [zh ? '# 单机部署示例' : '# Single-host deployment',
    zh ? '[English](README.md) | **简体中文**' : '**English** | [简体中文](README.zh-CN.md)',
    metadata.state === 'published' ? '' : (zh ? '**本地候选：镜像尚未推送。**' : '**Local candidate: images have not been pushed.**'),
    zh ? '在一台 Linux 主机上用 Compose 运行 Core 和 CLI 两个独立容器。默认独立使用见 [Quick Start](../../README.zh-CN.md#quick-start)。Core 是后台服务；CLI 是终端客户端，退出或重新打开 CLI 都不影响 Core 和任务。' : 'Run Core and CLI as two separate containers on one Linux host with Compose. See [Quick Start](../../README.md#quick-start) for independent usage. Core is the background service; CLI is the terminal client. Exiting or reopening CLI leaves Core and its tasks running.',
    zh ? '要求 Linux x86-64、rootful Docker Engine 28+、Compose 2.24+。宿主已导出 `PIWORK_ADMIN_ACCOUNT`、`PIWORK_ADMIN_PASSWORD`（至少 12 位）、`PIWORK_MODEL_PROVIDER`、`PIWORK_MODEL`、`PIWORK_API_KEY`；可选 `PIWORK_MODEL_BASE_URL` 不用时保持未设置。初始化变量只传给 Core。' : 'Requires Linux x86-64, rootful Docker Engine 28+ and Compose 2.24+. Exported host inputs: `PIWORK_ADMIN_ACCOUNT`, `PIWORK_ADMIN_PASSWORD` (at least 12 characters), `PIWORK_MODEL_PROVIDER`, `PIWORK_MODEL`, `PIWORK_API_KEY`; leave optional `PIWORK_MODEL_BASE_URL` unset when unused. Initialization inputs go only to Core.',
    zh ? '示例使用独立的 `/var/lib/piwork/examples/single-host/core` 和 `piwork-single-host-client-state` 卷，保留原有权限检查。7171/7172 不能与其他 Core 同时占用；运行前正常停止冲突服务，不删除其数据。本示例不会自动停止其他安装。' : 'Uses a separate `/var/lib/piwork/examples/single-host/core` directory and `piwork-single-host-client-state` volume, retaining permission checks. Ports 7171/7172 cannot be shared with another Core: stop conflicting services normally first, retaining their data. This example does not stop another installation automatically.',
    zh ? '取得本目录的 `docker-compose.yml`，在文件所在目录运行；无需 clone、环境文件或第二份 YAML。先启动 Core：' : 'Obtain this directory’s `docker-compose.yml` and run from its directory. No clone, environment file or second YAML is needed. Start Core first:',
    code(composeCommands),
    zh ? '打开 CLI；以后重新进入只需这一条命令，无需初始化变量。Core 不存在或未就绪时，CLI 等待至多 600 秒后安全失败，不自动启动 Core：' : 'Open CLI; repeat only this command to return, without initialization inputs. If Core is absent or unready, CLI waits up to 600 seconds and fails safely without starting Core:',
    code('docker compose -f docker-compose.yml run --rm --no-deps cli'),
    zh ? '在 CLI 容器内执行；ACCOUNT 为账号，登录隐藏输入密码，WORK_ID 来自创建结果：' : 'Inside CLI, replace ACCOUNT with your account; login prompts for a hidden password. WORK_ID comes from creation:',
    code(firstWorkCommands), code(firstChatCommand),
    zh ? '用 `exit` 退出；凭证保留，Work 继续运行。查看状态、日志和停止/重启 Core（正常停止会停止受管 Work，重启按原意图恢复）：' : 'Use `exit` to leave; credentials persist and Work continues. Inspect status/logs and stop/restart Core (normal shutdown stops managed Works; restart restores their desired state):',
    code('docker compose -f docker-compose.yml exec -T core piwork-serve --json status\ndocker compose -f docker-compose.yml logs --tail 100 core\ndocker compose -f docker-compose.yml stop core\n' + composeCommands),
    zh ? '核对 Core 正常退出成功，保留数据目录、客户端卷和 Work 卷；不使用 `down -v` 或全局 prune。观察中断按原 Operation/Run ID 恢复，不重复提交。更多操作见 [Docker 手册](../../deploy/docker/README.zh-CN.md#terminal-operations)。' : 'Verify successful Core exit and retain its data, client volume and Work volumes; do not use `down -v` or global prune. Recover interrupted observation using original Operation/Run IDs without resubmitting. See the [Docker guide](../../deploy/docker/README.md#terminal-operations).',
    zh ? '维护：镜像版本、环境、网络、存储或就绪/关闭规则变更时，同步模板、双语说明及引用文档，并执行 Docker Quick Start 检查。' : 'Maintenance: update the template, both language guides and referring documentation when images, environment, network, storage or readiness/shutdown rules change; run the Docker Quick Start checks.',
  ].filter(Boolean).join('\n\n') + '\n';
}
