# Go 用户 CLI

`piwork-cli` 是用户端的 Go 程序。Core 地址可用 `--core` 指定；登录后凭证只用于该 Core。`--json` 使单次命令在 stdout 输出一个 JSON 值，进度和诊断写入 stderr。`piwork-serve` 的 operator 命令不在这里执行。

Windows 使用 `piwork-cli.exe`，Linux 使用 `piwork-cli`；可从任意工作目录启动。无子命令默认打开 Desktop，查看帮助改用 `--help` 或 `help`；空 `--json` 仍只显示帮助。既有业务命令、显式 `desktop [--port ...] [--no-open]` 和退出码保持。该行为不要求双击启动。

业务地址优先级为 `--core` → `PIWORK_CORE_URL` → 凭证 Core → `http://127.0.0.1:7171`。Desktop 在环境与凭证之间额外读取独立默认 Core；界面保存/清除只影响下次启动，不切换当前连接，logout 不删除偏好。参数与环境覆盖本次启动，不改写偏好。损坏偏好不会静默回退，可用显式 `--core` 打开 Desktop 后选择清除默认配置；不安全权限或链接必须修复存储位置。完整路径与恢复步骤见 [CLI 平台交付](cli-platforms.md)。

所有客户端入口都接受合法 HTTP/HTTPS Core origin，包括远程 IP 和域名，无需额外许可开关。HTTP 明文传输，HTTPS 保持证书校验；协议也是凭证绑定的一部分，同 host/port 的 HTTP 与 HTTPS 不共享 token。Desktop 保存 HTTP 默认值同样只影响下次启动，业务 CLI 可通过 `--core http://core.example:7171` 或 `PIWORK_CORE_URL` 选择它。

下例中的 `<workId>`、`<operationId>`、`<serviceId>` 和文件路径均取自实际命令结果。

## 登录与 Work

CLI 与 Desktop 共用同一份本地凭证：优先使用 `PIWORK_CONFIG_PATH`，否则为 `$XDG_CONFIG_HOME/piwork/client.json` 或 `$HOME/.config/piwork/client.json`。父目录必须属于当前用户且没有 group/other 权限（通常 `0700`），凭证必须为当前用户所有的普通 `0600` 文件；符号链接目录或文件、归属或权限不安全的现有路径会被拒绝，程序不会自动修改这些目录的权限。缺失目录在成功登录保存时以私有权限创建。

`logout` 在 Core 确认撤销，或返回明确的 `401 AUTHENTICATION_FAILED`（已过期、已撤销或账号已禁用）后清除本地凭证。清除成功才报告 `loggedOut=true`；网络故障、取消、403、5xx、未知或畸形响应保留凭证，便于重试。切换 Core 不会使用或删除另一 Core 的凭证。

```sh
piwork-cli --core http://127.0.0.1:7171 status
printf '%s\n' "$PIWORK_USER_PASSWORD" | piwork-cli --core http://127.0.0.1:7171 login --account owner --password-stdin
piwork-cli whoami
piwork-cli work create --name 'My Work' --wait
piwork-cli work list
piwork-cli work show <workId>
piwork-cli work stop <workId> --wait
piwork-cli work start <workId> --wait
piwork-cli work retry <workId> --wait
piwork-cli operation show <operationId>
piwork-cli logout
```

Work 操作接受后返回 Operation ID。`--wait` 只观察已接受的 Operation；连接中断时使用 `operation show` 查询原 ID，避免用新幂等键重复提交。删除 Work 使用 `work delete <workId> --wait`，应先确认不再需要其持久数据。

## 配置、Skill 与 Pi Package

```sh
piwork-cli skills list
piwork-cli skills show <skillName>
piwork-cli packages list
piwork-cli packages show <packageName>
piwork-cli work config show <workId>
piwork-cli work config set <workId> --config ./work-config.json
piwork-cli work config skills set <workId> --no-skills
piwork-cli work config packages set <workId> --no-packages
piwork-cli work config agents set <workId> --file ./AGENTS.md
piwork-cli work config apply <workId> --wait
```

`set` 保存 desired 配置；`apply` 才激活它。`work config show` 中的 pending/loaded 状态用于判断当前运行的 Agent 是否已加载新配置。选择空集合必须显式使用 `--no-skills` 或 `--no-packages`，不能靠省略参数表示清空。

Work Pi Package 可从四类来源安装：

```sh
piwork-cli work packages install <workId> npm:example-package@1.0.0 --wait --verbose
piwork-cli work packages install <workId> git+https://example.org/owner/repo.git#main --wait
piwork-cli work packages install <workId> ./local-package --wait
piwork-cli work packages install <workId> ./package.zip --wait
piwork-cli work packages install <workId> --from-core <catalogName> --wait
piwork-cli work packages list <workId>
piwork-cli work packages show <workId> <packageName>
```

本地目录和 ZIP 先上传原始内容，再由 Core 接受安装。`--wait` 没有 CLI 端总时限；临时观察失败只重试原 Operation。Ctrl+C 结束本地等待并保留服务端任务，stderr 会给出 `operation show` 恢复命令。`--verbose` 只显示安全阶段、代码和心跳，不显示第三方程序输出。安装完成仅更新 desired 包选择；要让运行中的 Agent 使用它，再执行 `work config apply <workId> --wait`。

## 对话、Service 与文件

```sh
piwork-cli session create <workId>
piwork-cli session list <workId>
piwork-cli session show <workId> <sessionId>
piwork-cli chat <workId> --session <sessionId> --message 'Summarize the data'
piwork-cli run show <workId> <runId>
piwork-cli run watch <workId> <runId> --after <sequence>
piwork-cli run cancel <workId> <runId>
piwork-cli work service list <workId>
piwork-cli work service show <workId> <serviceId>
piwork-cli work service logs <workId> <serviceId> --tail 100
piwork-cli work service restart <workId> <serviceId> --wait
piwork-cli proxy
piwork-cli desktop
```

`proxy` 在 `127.0.0.1:17890` 提供 `.work` Service 代理和 Work WebDAV；本地 WebDAV 密码每次启动随机生成。`desktop` 在浏览器打开本机界面，Service 预览和独立窗口无需浏览器代理配置。代理、WebDAV 和浏览器访问细节分别见 [Service 访问](service-access.md)、[Work 文件](work-files.md) 与 [Desktop](desktop-webui.md)。

## 导出、检查与导入

```sh
piwork-cli work stop <workId> --wait
piwork-cli work export <workId> --output ./saved.work
piwork-cli work package inspect ./saved.work
piwork-cli work import ./saved.work --name 'Restored Work' --wait
piwork-cli work start <importedWorkId> --wait
```

导出只接受已停止的 Work；离线 `inspect` 不读取登录凭证，不连接 Core，也不判断目标安装是否兼容。导入得到 stopped Work，必须显式 Start。若下载中断，保留原 `snapshotId`，用 `work snapshot download <snapshotId> --output ./saved.work` 从头重取；不会重新发起导出。完整数据边界和保留期见 [快照](work-snapshot.md)。


Chat JSON Run markers include only the accepted safe `actualModel` description, `source`, and `adoptedExperienceVersion`; existing chat arguments are unchanged. Credentials and private endpoints remain inside Go Core/Agent execution. The Desktop local API allowlists Work models, Session model preference PATCH and original request/evidence reads and cancel/retry, using the same current user, CSRF and credential-generation fence as the existing Work API. Query fields and pagination are strict; request details reject list-only filters. Cancellation and retry are runtime mutations and are rejected when the Work is stopped.

### Desktop 聊天控件

Desktop 控制 API 增加 Work 的 `chat-capabilities`、`chat-models`、`commands`，以及
Session `chat-options` 的 GET/PATCH。完整设置为 `{modelRef:null|catalogId,thinkingLevel}`。
创建 Session 可显式提供 `idempotencyKey`，提交 Run 可提供 `submissionKey` 和
`inputMode:text|command`；省略键仍由 CLI 生成。只读 `sessions/submissions/:key`、
`runs/submissions/:key` 用于核对原受理事实，not-found 不解锁未知提交，也不自动重发。
所有修改沿用原 Cookie、CSRF、Core/账户与 Work 所有权准入。
旧 Agent 继续使用原模型和聊天接口，新控件明确不可用，不自动更换镜像。
参见 [规范](../openspec/specs/agent-conversation/spec.md)。
