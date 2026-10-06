# CLI 平台适配与交付

`piwork-cli` 面向 Windows 与 Linux，保留业务命令、Core 协议、JSON 和退出码契约。Windows 使用 `.exe`，Linux 使用可执行文件；可以从任意目录执行，不要求双击。具体构建目标和测试机器是交付配置与验证事实，不构成产品最低 OS、发行版或 CPU 名单。

本次实现已生成两平台候选客户端。正式验收和归档尚未完成；实际通过、失败及缺失 fixture 见本变更的 [实施验证进度](../openspec/changes/support-cross-platform-cli-and-default-desktop/verification-progress.md)。

## 入口与原使用习惯

```sh
piwork-cli                          # 默认启动 Desktop
piwork-cli --core http://<core-host>:7171  # HTTP 默认入口
piwork-cli --core http://core.example:7171 desktop --no-open
piwork-cli --core https://core.example
piwork-cli --help                   # 显式查看原业务命令
piwork-cli help
piwork-cli --json                   # 只输出帮助，不启动 Desktop
piwork-cli desktop --port 17901 --no-open
piwork-cli desktop open --port 17901 --no-open
piwork-cli desktop logout --port 17901
```

Windows PowerShell 对应使用 `./piwork-cli.exe`；Linux 使用 `./piwork-cli` 或 PATH 中的命令。不带子命令原来显示帮助，现在默认启动 Desktop，这是本次入口变化。所有显式业务命令保留；显式 Desktop 的 `--port`、`--no-open` 保留，它们不是新增根级参数。指定端口被占用时以退出码 6 失败，不自动改端口或接管其他进程。

Desktop 以前台进程运行。浏览器关闭不终止客户端；Ctrl+C 退出 Desktop/proxy。Operation 等待中断只停止本地观察，保留原 Operation ID；Chat 中断请求取消已经接受的原 Run，不重发消息。Windows Ctrl+Break 也走中断路径。强制结束可能留下陈旧资源；只有确认原进程已退出时才允许清理，不能承诺系统强杀会执行回调。打开浏览器失败会打印可手动访问的地址，`--no-open` 可明确选择此方式。

`desktop open/logout` 从本机实例位置恢复，与当前工作目录、凭证路径或 Core 环境变量无关；这两个恢复命令不接受 `--core`。普通 `logout` 清理登录会话，默认 Core 偏好仍保留。

## 两套 Core 地址优先级

| 调用 | 地址优先级（从高到低） |
| --- | --- |
| 默认入口与显式 `desktop` | `--core` → `PIWORK_CORE_URL` → Desktop 偏好 → 凭证 Core → `http://127.0.0.1:7171` |
| 原业务 CLI | `--core` → `PIWORK_CORE_URL` → 凭证 Core → `http://127.0.0.1:7171` |

参数与环境只覆盖本次调用。登录/连接和切换 Core 界面的 “Save as default” 保存下一次启动默认值；“Restore automatic selection” 清除该值，恢复上述自动选择。保存/清除不切换当前连接、不修改凭证，也不清理本地 Inspect。业务 CLI 不读取 Desktop 偏好。

Core 地址只能是完整 HTTP(S) origin，不能包含用户名、密码、路径、query 或 fragment。HTTP/HTTPS 均可用于 IP、域名、loopback 和远程地址，参数、环境、已保存配置及不同宿主平台采用相同规则。HTTP 使用明文传输；HTTPS 继续校验系统信任链、有效期和主机名。两种协议属于不同 origin，即使 host/port 相同也不复用登录凭证，不自动改写协议或失败回退。缺失偏好是正常状态，损坏偏好会明确报错而不是悄悄回退。可以用显式 `--core` 打开 Desktop 后安全清除损坏的格式；遇到宽泛 ACL、链接或其他不安全存储，应修复存储位置，客户端不自动放宽权限或替换危险目标。

例如，通过参数或环境指定 HTTP Core：

```sh
piwork-cli --core http://core.example:7171 status
piwork-cli --core http://core.example:7171 proxy  # 先在这个 origin 登录
PIWORK_CORE_URL=http://core.example:7171 piwork-cli
```

```powershell
$env:PIWORK_CORE_URL = 'http://core.example:7171'
.\piwork-cli.exe
```

在 Desktop 的 Core 输入框填写 `http://core.example:7171` 后选择 “Save as default”，清除参数和环境覆盖再启动即可使用该值。保存时不要求 Core 在线，也不触发登录或切换；偏好仅参与 Desktop 选择，不影响 `status` 或 `proxy`。

修改期间仅锁定偏好的保存/清除按钮。响应丢失或提交后未确认时，只能先读取实际保存值确认结果；不自动重发修改。其他业务操作及后续输入保持可用。

## 客户端与服务端边界

客户端入口是 `cmd/piwork-cli` → `internal/cli`，连接已部署的 Core，内嵌 `internal/desktopassets`。业务使用 `internal/client`；Pi 包扫描、manifest/ZIP 验证和客户端打包使用 `internal/pipackage` 的真实公共实现。

Console 入口是 `cmd/piwork-console` → `internal/consoleapp`，内嵌 `internal/consoleassets`。CLI 依赖图不包含 Console 实现或资源。两个界面只共享 `internal/localweb` 中的无状态浏览器辅助。

Pi 包 `CopyTreeAt`、NPM tar 解包、ZIP 解包及安装发布位于 Linux 文件，用于原 Core/Agent/helper；客户端公共接口没有用 stub 替换。本次不把 Core、Console、Agent、helper 或容器运行环境迁到 Windows，也不改变服务端包格式、执行位、摘要或安装行为。

用户运行客户端不需要源码、相邻 WebUI 文件、Go、Node、Python 或 Docker。Desktop 使用浏览器，业务使用现有 Core。Go、Node/npm、Playwright 以及下述测试 helper 都属于构建/验收工具；Linux 全组件集成所用 Docker 也是开发者的服务端测试依赖。

## 配置路径与私有存储

凭证路径依次采用：

1. `PIWORK_CONFIG_PATH`；
2. 显式 `XDG_CONFIG_HOME/piwork/client.json`；
3. Linux 的 `$HOME/.config/piwork/client.json`，或 Windows `os.UserConfigDir()/piwork/client.json`。

显式相对配置路径在命令实际需要状态时固定为绝对位置；帮助、版本、语法错误和离线 Inspect 不因此创建状态。偏好位于 `<credential-parent>/desktop/preferences.json`，采用独立 v1 文件和锁，最多 64 KiB；不与凭证合并。

`internal/clientfs` 提供固定目录、普通文件安全打开、私有创建、文件锁、原子替换、不覆盖发布、文件身份、容量及进程查询。Linux 凭证继续沿用原实现和目录 flock；Operation、传输及恢复的原锁位置与格式保持。

Windows 私有文件在创建时设置当前 SID 与 LocalSystem 的受保护 DACL，验证 owner、ACL、普通文件、重解析点和硬链接；拒绝危险既有目标，不自动修复宽泛 ACL。逐级固定目录 handle 并不跟随重解析点，发布只在固定父目录进行。原子替换保留旧读者，不覆盖发布在最终原生操作拒绝已存在目标。提交后同步或最终确认失败报告结果未确认。正常并发只可读取旧或新完整内容，不扩大为所有存储设备突然断电的保证。

Windows 验证/上传的读者排除并发写入。文件身份包含原生 volume/file ID、元数据，并在可用时使用原生变更序号；没有该序号时核对内容摘要，不把同大小且时间戳不变的输入当成未修改。这个安全回退可能增加大文件读取成本。网络来源同样必须能证明固定根和稳定文件身份；未知身份、容量或进程存活不授权上传/清理。

Windows Desktop 控制使用 KnownFolder LocalAppData 下的 `piwork/desktop-control` 和当前 SID 绑定的私有 named pipe；校验进程 SID、PID、创建时间、随机实例及有界消息。Linux 保留原 `/tmp/piwork-desktop-<UID>`、Unix socket、peer UID 和协议。确认陈旧前不删除原实例；旧实例不能删掉新实例的元数据。

包上传、快照及 Desktop 传输使用原生私有临时文件；正常退出按所属固定目录清理，强杀后仅清理确认已结束的私有实例，保留活跃或身份未知实例。原传输限额、TTL 与同时任务数保持。

## 本地来源与协议模式

Windows 本地来源支持 `./`、`.\\`、`../`、`..\\`、盘符绝对路径和 UNC，以及中文/空格。拒绝盘符相对路径、设备命名空间、ADS、危险组件、junction 和不安全文件。Linux 的来源语法以及远端 npm/git 规则保持。

```powershell
.\piwork-cli.exe work packages install <workId> '.\本地 包' --wait
.\piwork-cli.exe work packages install <workId> 'C:\Packages\package.zip' --wait
.\piwork-cli.exe work packages install <workId> '\\server\share\package.zip' --wait
```

普通 Windows 目录中的文件/目录按协议 0644/0755 处理，不能从扩展名猜测执行位。需要执行位时使用符合原协议的 ZIP，ZIP 元数据与字节保持。安全真实 symlink 的目标转换为协议 `/` 后校验；junction 不作为 symlink 放行。`.work` Inspect 只检查协议数据，不在 Windows 解压执行，也不因其 Linux 内容而按宿主平台拒绝。

## 独立客户端构建

构建环境固定 Go 1.25.5、Node 24，并在仓库先安装 `npm ci`。客户端构建不调用全 workspace、Console、镜像或 Docker 构建。

```sh
npm ci
npm run build:cli
# 或 make build-cli
node scripts/build-cli.mjs --target windows/amd64 --target linux/amd64
```

显式 `--target` 优先；否则读取 `config/cli-release-targets.json`，配置不存在时使用构建机目标。配置格式为 `{"version":1,"targets":["windows/amd64","linux/amd64"]}`；错误/空目标拒绝，不静默回退。该配置列出本次交付目标，不是产品平台限制。

构建先清理并重新编译一份 Desktop 资源，再用 CGO=0 编译各目标。输出：

```text
dist/cli/linux-amd64/piwork-cli
dist/cli/linux-amd64/build.json
dist/cli/windows-amd64/piwork-cli.exe
dist/cli/windows-amd64/build.json
```

`build.json` 和内嵌 release stamp 记录版本、commit、dirty、Go 工具链、目标、二进制大小/摘要和 Desktop 构建输入摘要。`make build`、`make build-go` 和旧 Linux 全组件发布入口继续保留。

## 原生安全及进程测试

在对应系统，使用固定 Go 工具链执行：

```sh
go test -mod=readonly ./internal/clientfs ./internal/client ./internal/cli ./internal/pipackage
go list -deps ./cmd/piwork-cli
```

Linux 另外可以运行 `go test -mod=readonly -race ./internal/clientfs ./internal/client`。`go list` 不应包含 `internal/consoleapp` 或 `internal/consoleassets`。

构建机也能准备 Windows 测试程序，复制到 Windows 原生目录实际运行；交叉编译本身不算 Windows 通过：

```sh
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o clientfs.test.exe ./internal/clientfs
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o client.test.exe ./internal/client
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o cli.test.exe ./internal/cli
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -mod=readonly -c -o pipackage.test.exe ./internal/pipackage
```

```powershell
.\clientfs.test.exe -test.v -test.timeout=90s
.\client.test.exe -test.v -test.timeout=90s
```

CLI/Pi 测试的相对数据来自 `internal/workpackage/testdata` 和 `internal/pipackage/testdata`，复制时保留这两个相邻目录并从对应包目录运行。`PIWORK_TEST_CLI_BINARY` 指向本次候选的绝对路径，防止测试 helper 使用其他版本。

真实 symlink 场景需要测试账号能创建 symlink；无法创建时测试明确报 `required native symlink fixture unavailable`，验收记录为未验证，不能 skip 后算通过。这是 fixture 能力，不是用户运行普通客户端必须拥有管理员权限。

另一用户 fixture 使用真正不同的普通 SID/UID；不能用管理员/SYSTEM 或伪造 SID 代替。测试 helper 不创建账号、不改变已有权限：

```sh
go build -mod=readonly -o storage-fixture scripts/check-cli-storage-fixture.go
./storage-fixture --create --directory <新的哨兵目录>
# 保存返回的 owner；以 owner 启动本次 Desktop，保持控制通道存活。
# 再以另一普通账号执行：
./storage-fixture --probe-other-user --directory <哨兵目录> --owner <owner> --control <活跃通道>
```

Windows helper 使用 `.exe`。控制通道由 owner 的 `piwork/desktop-control/<port>.json` 中 `pipeName` 给出；Linux 使用 owner 的 `/tmp/piwork-desktop-<UID>/<port>.sock`。只传测试通道名，不复制凭证。fixture 同时验证另一用户不能读写私有哨兵或连接活跃控制通道；同一用户、缺失通道或未取得原生拒绝都算未验证。owner 测试结束后检查哨兵原内容并清理自己创建的测试目录。

浏览器 fixture 使用 Node 24/Playwright，`PIWORK_TEST_NATIVE_CLI` 指向候选绝对路径，`PIWORK_TEST_BROWSER_BIN` 可指定测试浏览器。Windows 的假 Core 凭证也必须由原生 helper 创建：

```sh
go build -mod=readonly -o credential-fixture.exe scripts/check-cli-credential-fixture.go
# Windows 设置 PIWORK_TEST_CREDENTIAL_FIXTURE 为该 helper 的绝对路径。
npm run test:browser -w @piwork/desktop-webui
```

`PIWORK_TEST_TICKET_EXPIRY=1` 启用真实五分钟票据过期测试；未启用的 skip 不可作为完整浏览器发布证据。这些工具属于测试环境，交付归档不会携带它们。

## 候选验收与外部 Core fixture

```sh
node scripts/check-cli-platform.mjs --build dist/cli/linux-amd64 --report dist/cli/linux-amd64/native-evidence.json --fixtures <原生fixture配置.json>
```

Windows 在实际 Windows 上对 `dist/cli/windows-amd64` 执行相同命令。协调器要求 Node 24、Go 1.25.5、原生目标一致、候选 SHA-256 与当前 Desktop 输入匹配；自动发现并测试客户端本模块依赖，再从非源码目录、无开发工具 PATH 启动候选，校验内嵌资源、偏好、恢复及中断。不会自动部署本机 Core。

单独进程烟测可执行 `go run -mod=readonly scripts/check-cli-native.go --build <候选目录> --root <仓库>`；也能在构建机编译该测试工具后复制到原生系统。复制烟测时需提供 `--root` 下的当前 `internal/desktopassets/static/browser/app.js` 和 `internal/desktopassets/static/browser/adapter.js` 作为期望资源，保留目录结构，并使用同一次 Desktop 同步构建的两份文件。实际运行的工具和客户端必须属于所测原生目标。增加 `--http-core http://core.example:7171` 可额外测试已部署 HTTP Core 的 status、授权后匿名状态、HTTP 偏好保存/读回、退出重启与 open；采用独立配置，不自动部署 Core。空命令固定端口已占用时保留现有实例，并将该原生场景记为未验证，其余默认选择在独立端口验收。这个专项结果不能代替发布协调器的完整场景或独立 TLS fixture。

需要真实 Core 的场景通过外部 fixture 执行器连接已经部署的专用测试 Core。Core 须从两个目标环境可达；HTTP Core 可用于 HTTP 命令、Desktop、偏好与代理场景。HTTPS 成功及不受信任/过期/错名负例仍分别验收：成功 fixture 的证书须由对应原生系统信任，hostname 匹配，不能使用跳过校验、`curl -k` 或 Node 的忽略 TLS 选项替代客户端验收。测试账号、可用 Runtime/Agent/helper、可执行模型、Pi 包、快照、Service/WebDAV/WebSocket 和失败网络 fixture 应属于专用测试数据，不使用日常账号。密码/token 通过环境或 stdin 传递，勿写进命令参数、报告或 manifest。

fixture 配置只指定可执行程序及参数，不使用 shell：

```json
{
  "version": 1,
  "scenarios": {
    "core-command-families": { "command": "native-core-fixture", "args": ["--scenario", "core-command-families"] },
    "core-packages-snapshots": { "command": "native-core-fixture", "args": ["--scenario", "core-packages-snapshots"] }
  }
}
```

上面的执行器名是 fixture 接口示例，须替换为实际断言程序，不能据此生成通过报告。协调器向执行器提供 `PIWORK_TEST_CLI_BINARY` 和 `PIWORK_TEST_CLI_SHA256`。执行器必须运行此候选完成对应场景，stdout 仅返回：

```json
{"id":"core-command-families","status":"pass","sha256":"本次候选摘要","target":"linux/amd64","diagnostic":"已执行的非敏感断言说明"}
```

状态为 `pass`、`fail` 或 `unverified`。只有原生断言通过、身份匹配且退出码为 0 才能算 pass；缺少用户、symlink、Core 或网络 fixture 保持未验证，依赖测试中的失败或 skip 不能被外部结果覆盖。输出经敏感数据过滤。全部必需场景列在 `scripts/clirelease.RequiredScenarios`；仅单元测试、loopback 假 Core 或交叉编译不能替代真实 Core 命令族和 TLS 正反例。

## 独立打包与产物使用

```sh
go run -mod=readonly scripts/package-cli-release.go --build dist/cli/linux-amd64 --evidence dist/cli/linux-amd64/native-evidence.json --output dist/cli-release
# 在 Windows 原生验收后可在构建机打包其 PE：
go run -mod=readonly scripts/package-cli-release.go --build dist/cli/windows-amd64 --evidence <Windows原生报告.json> --output dist/cli-release
```

标准库工具检查 PE/ELF 类型、Go build metadata、内嵌 stamp/UI、大小/摘要，以及同一候选全部必需场景的原生证据。任一缺失、失败、skip、身份不符或重复/歧义字段都会拒绝发布，不执行异平台二进制来推测版本。

Windows ZIP/Linux tar.gz 按目标、版本和 commit 命名，附 `.sha256`；归档只包含客户端、manifest 和使用说明，Linux 执行位 0755。manifest 关联原生证据摘要，不含账号秘密。已有归档不会被覆盖，校验和发布失败不会留下此次不完整归档。

解包后核对摘要，再从任意目录运行 `piwork-cli[.exe] --version`、`--help`、默认入口或显式业务命令即可。缺少合格原生证据时只保留候选二进制，不能把它包装为已完成验收的正式发布。
