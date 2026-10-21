# Spec Delta

## MODIFIED Requirements

### Requirement: Resolve one Core endpoint consistently

系统 SHALL 提供独立的 operator 控制面和登录用户客户端命令；既有规范中的 `piwork-serve` operator 职责及配置保持，`piwork-cli` 用于用户客户端。业务 CLI SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存凭证中的 Core、默认 `http://127.0.0.1:17871` 的顺序解析。operator SHALL 按显式 `--core`、`--env-file` 中的控制面地址和文档化默认值解析，并使用 operator credential。

默认或显式 Desktop 启动 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、Desktop 默认 Core 配置、保存凭证中的 Core、相同 loopback 默认值的顺序解析。参数和环境变量 SHALL 仅影响本次启动，不自动保存。业务 CLI SHALL 不读取 Desktop 偏好；`desktop open/logout` SHALL 继续只选择既有本机实例，不重新解析 Core。

Desktop 默认配置不存在 SHALL 回退到原凭证/默认值，不要求迁移旧凭证。需要读取的配置损坏、版本不支持、地址字段非法、超过大小限制或无法安全访问 SHALL 返回 exit 1 和安全恢复方向，保留原文件，不静默改连其他 Core；已由参数或环境选定地址时 SHALL 不读取无须使用的 Desktop 偏好。通过参数、环境或旧凭证选定的地址无效 SHALL 返回 exit 2，不继续尝试低优先级地址。凭证仅 SHALL 用于与其 Core origin 相同的请求。

用户 CLI、operator 和独立 Desktop 后端 SHALL 直接访问 Core HTTP 服务，不能要求先启动或经由 ControlPlane 17891。默认端口变化不得迁移已有凭据 origin、改写显式地址、试探旧端口或把连接失败转成浏览器登录；选定旧地址不可达时提供显式配置当前 Core 后重新登录的方向。远程 Core 的可达性由部署监听决定，不由客户端自动修改服务器。

#### Scenario: Use the user client endpoint
- **WHEN** 用户运行业务 CLI 且未提供显式地址
- **THEN** 使用 `PIWORK_CORE_URL`、保存凭证中的地址或 loopback 默认值；Desktop 默认配置不影响该选择

#### Scenario: Override the Core URL explicitly
- **WHEN** 用户提供 `--core <url>`，另有环境、Desktop 配置或保存凭证地址
- **THEN** 业务 CLI 或 Desktop 使用显式地址；Desktop 启动不覆盖持久配置，不把另一 Core 的 token 发给该地址

#### Scenario: Reuse the saved endpoint
- **WHEN** 没有显式或环境地址，业务 CLI 有保存凭证，或 Desktop 没有默认配置但有保存凭证
- **THEN** 使用该凭证的 Core 地址，不重写或迁移凭证

#### Scenario: Use the operator endpoint
- **WHEN** 操作者运行既有 operator 管理或配置入口
- **THEN** 使用 operator 配置和凭证，不读取 `piwork-cli` 用户 token 或 Desktop 偏好

#### Scenario: Desktop 默认地址和旧凭证并存
- **WHEN** Desktop 配置 Core B，凭证属于 Core A，且没有参数或环境覆盖
- **THEN** Desktop 连接 B 并呈现未登录状态，不发送 A 的 token；业务 CLI 仍解析为 A

#### Scenario: 退出登录后保留 Desktop 默认配置
- **WHEN** 用户保存 Desktop 默认 Core 后清理当前登录，随后重新启动
- **THEN** 仍选择保存的 Core，不因凭证删除回到 loopback，不恢复已清理的 token

#### Scenario: 缺失、损坏和被覆盖的配置
- **WHEN** 默认配置不存在、需要读取的配置损坏，或参数/环境已经覆盖损坏配置
- **THEN** 分别使用原有回退、返回 exit 1 且不监听、或按覆盖地址正常启动；损坏文件均不被自动删除

#### Scenario: 无效高优先级地址
- **WHEN** 参数、环境或保存配置给出不合法 Core origin
- **THEN** 拒绝选定地址，不悄悄使用凭证或 loopback，不泄漏 token

#### Scenario: 无历史配置直接使用新 Core
- **WHEN** 同机客户端没有显式地址、环境覆盖、相关偏好或保存凭据
- **THEN** 连接 127.0.0.1:17871，使用原用户或 operator 身份，不访问 17891

#### Scenario: 已保存旧端口
- **WHEN** 保存凭据或 Desktop 偏好仍指向已停止的 7171
- **THEN** 报告所选地址不可达，不把旧 token 转发到 17871 或其他发现的服务；用户可显式选择新 Core 并正常登录

### Requirement: 启动本地 Desktop WebUI

**Identifier:** CLI-DESKTOP-001

`piwork-cli [--core <url>] desktop [--port <1..65535>] [--no-open]` 及全局参数解析成功、无子命令且没有 `--json` 时的默认 Desktop 入口 SHALL 在原生模式前台启动仅监听 `127.0.0.1` 的本地 WebUI，默认端口 17891；原生模式默认打开系统浏览器，`--no-open` 仅输出本地打开地址。显式容器模式 SHALL 按 CLI-CONTAINER-001 提供宿主本机入口，并按 CLI-CONTAINER-DESKTOP-001 输出可直接打开的普通地址。地址 SHALL 使用受验证的 localhost 主机名；原生模式本机无需 Docker，容器交付使用已安装的 Docker；两种模式的本地 WebUI 均无需代理/PAC、hosts 编辑或安装本地站点证书。Desktop Core 地址 SHALL 按显式 `--core`、`PIWORK_CORE_URL`、保存的 Desktop 默认地址、凭证 Core、`http://127.0.0.1:17871` 的优先级选择；参数与环境仅覆盖本次调用，普通业务命令仍按原地址优先级且不读取 Desktop 偏好；Core 可以使用合法 HTTP 或 HTTPS origin，不按目标位置限制 HTTP，遵守 CLI-CORE-PROTOCOL-001。普通地址 SHALL 不含浏览器入口 ticket 或其他授权片段；来源合法的浏览器自动建立必要会话，复用同 Core 的有效共享 CLI 凭据或进入正常登录。无登录或 Core 暂不可达 SHALL 仍可打开登录/连接页面和本地包 Inspect，不能借用其他 Core 的 token，不要求终端重新授权。

启动前 SHALL 校验参数；未知参数、重复或非法端口、显式 Desktop 的 `--json` 返回 exit 2；端口占用返回 exit 6，资源缺失或监听失败返回 exit 5，不自动换端口或遗留半启动监听器。浏览器打开失败 SHALL 保持服务并打印手动打开地址；`--help` 不读取凭证或偏好、不启动监听、不访问网络。Ctrl+C SHALL 关闭本地连接、清理本次临时资源并退出 130，不停止 Work、不取消已经接受的 Core Operation/Run。平台会话失效 SHALL 回到登录状态而不退出 WebUI。既有 `proxy` 默认 17890、PAC、临时 WebDAV 密码及退出语义 SHALL 不变；Desktop 不要求先启动 proxy。

#### Scenario: 无登录的一键启动
- **WHEN** 原生用户首次运行默认入口或显式 desktop 且没有保存凭证
- **THEN** 浏览器打开登录/连接页面，可以配置默认 Core 和本地 Inspect；输入有效用户凭据后进入自己的 Work List

#### Scenario: 打开浏览器失败
- **WHEN** 本地监听已成功但系统没有可用的打开浏览器命令
- **THEN** 命令持续运行并显示手动地址，不谎报启动失败或自动关闭

#### Scenario: 非法端口与端口占用
- **WHEN** 用户指定非法端口或已被占用的合法端口
- **THEN** 分别返回 exit 2 或 6，不自动监听其他端口，不启动后台副本

#### Scenario: 关闭窗口和退出 CLI
- **WHEN** 用户关闭浏览器窗口，随后终止 Desktop 进程
- **THEN** 关闭浏览器不停止监听；进程退出只终止本地入口，Core 上已接受的工作继续，可在下次登录后查询

#### Scenario: 两种访问命令并存
- **WHEN** 用户同时运行默认 Desktop 与 proxy
- **THEN** 二者使用独立端口与本地凭据，WebUI 的启动和浏览器 Files 不依赖 proxy

#### Scenario: 使用远程 HTTP 启动及恢复
- **WHEN** 用户默认启动或显式 desktop 指定合法远程 HTTP Core，随后执行同用户 desktop open
- **THEN** Desktop 正常监听并输出/打开本地页面，页面报告实际 Core 状态；open 只恢复原实例，不改地址或创建第二实例

### Requirement: 原生用户 CLI 的操作和恢复入口

**Identifier:** CLI-USAGE-001

用户 CLI SHALL 与 operator 身份分离；单次 --json 在 stdout 输出一个 JSON 值，诊断/进度在 stderr。无子命令启动 Desktop，显式 help/--help 和空 --json 保持帮助，业务命令与退出码保持。业务 Core 选择为 --core、PIWORK_CORE_URL、凭证 Core、默认 loopback；Desktop 增加独立偏好，合法 HTTP(S) origin 按协议隔离 token。

登录状态 SHALL 采用私有固定路径；logout 仅在撤销确认或明确 401 AUTHENTICATION_FAILED 后清除，网络/取消/403/5xx/畸形未知响应保留原凭证。Work 生命周期和包安装接受后保留 Operation ID；等待中断只结束观察，原 ID 查询恢复，不新键重提。包 verbose 仅安全阶段/代码/心跳，不显示第三方输出；安装/配置 set 只改 desired，显式 apply 才生效，空 skills/packages 必须明确指定。

离线 inspect SHALL 不读凭据、不连接 Core，也不宣称目标兼容。导出先 Stop，导入保持 stopped 后显式 Start；下载中断用原 snapshot ID 从头重取，不重新 Export。手动 Chat、中断取消和 run watch/cancel SHALL 沿用有效 CLI-CHAT 与原 Run 身份。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli --core http://127.0.0.1:17871 status
printf '%s\n' "$PIWORK_USER_PASSWORD" | piwork-cli --core http://127.0.0.1:17871 login --account owner --password-stdin
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

```sh
piwork-cli work packages install <workId> npm:example-package@1.0.0 --wait --verbose
piwork-cli work packages install <workId> git+https://example.org/owner/repo.git#main --wait
piwork-cli work packages install <workId> ./local-package --wait
piwork-cli work packages install <workId> ./package.zip --wait
piwork-cli work packages install <workId> --from-core <catalogName> --wait
piwork-cli work packages list <workId>
piwork-cli work packages show <workId> <packageName>
```

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

```sh
piwork-cli work stop <workId> --wait
piwork-cli work export <workId> --output ./saved.work
piwork-cli work package inspect ./saved.work
piwork-cli work import ./saved.work --name 'Restored Work' --wait
piwork-cli work start <importedWorkId> --wait
```

### Requirement: 平台私有状态与独立客户端交付

**Identifier:** CLI-PLATFORM-001

客户端 SHALL 支持 Windows/Linux 原生入口和任意工作目录，不依赖源码、相邻 WebUI、Go/Node/Python/Docker。Desktop 默认与显式入口按 --core、PIWORK_CORE_URL、独立偏好、凭证 Core、默认地址选择；业务 CLI 不读偏好。偏好保存/清除只影响后续启动，不切换连接或清凭据，响应未知先读回，损坏不静默回退。

凭证路径 SHALL 按 PIWORK_CONFIG_PATH、显式 XDG_CONFIG_HOME、平台 UserConfigDir 选择；帮助/版本/离线 inspect 不创建状态。偏好为独立 v1 文件和锁，最大 64 KiB。Linux 保留 owner/0700/0600/flock；Windows 使用当前 SID/LocalSystem 受保护 DACL、固定目录 handle、拒绝 reparse/hardlink 和宽泛 ACL，不自动放宽权限。并发原子发布只读旧/新完整内容，不承诺所有设备物理断电；缺少变更序号时核对摘要，不以大小/mtime 不变证明同字节。未知容量、身份或进程存活不授权上传/清理。

可信 desktop open/logout SHALL 使用私有实例控制并与 cwd、Core 环境及凭证路径无关，不接受 --core；Linux peer UID/Unix socket 和 Windows SID/PID/创建时间/named pipe 隔离保持。端口占用 exit 6，不自动换端口；关闭浏览器不退出，Ctrl+C/Ctrl+Break 有界收尾，强杀不保证回调。

Windows 来源 SHALL 支持相对、盘符绝对、UNC、中文/空格，拒绝盘符相对、设备名、ADS、junction 与危险组件。普通目录模式为协议 0644/0755，不按扩展名猜执行位；需要执行位使用原协议 ZIP；离线 .work 不解压执行。客户端构建 SHALL 固定 Go 1.25.5/Node 24/CGO=0，独立编译 Desktop 和各目标，真实 build.json 记录 commit/dirty/目标/摘要；候选与 Windows 实机正式通过分别记录。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli                          # 默认启动 Desktop
piwork-cli --core http://<core-host>:17871  # HTTP 默认入口
piwork-cli --core http://core.example:17871 desktop --no-open
piwork-cli --core https://core.example
piwork-cli --help                   # 显式查看原业务命令
piwork-cli help
piwork-cli --json                   # 只输出帮助，不启动 Desktop
piwork-cli desktop --port 17901 --no-open
piwork-cli desktop open --port 17901 --no-open
piwork-cli desktop logout --port 17901
```

```sh
piwork-cli --core http://core.example:17871 status
piwork-cli --core http://core.example:17871 proxy  # 先在这个 origin 登录
PIWORK_CORE_URL=http://core.example:17871 piwork-cli
```

```powershell
$env:PIWORK_CORE_URL = 'http://core.example:17871'
.\piwork-cli.exe
```

```powershell
.\piwork-cli.exe work packages install <workId> '.\本地 包' --wait
.\piwork-cli.exe work packages install <workId> 'C:\Packages\package.zip' --wait
.\piwork-cli.exe work packages install <workId> '\\server\share\package.zip' --wait
```

```sh
npm ci
npm run build:cli
# 或 make build-cli
node scripts/build-cli.mjs --target windows/amd64 --target linux/amd64
```

```text
dist/cli/linux-amd64/piwork-cli
dist/cli/linux-amd64/build.json
dist/cli/windows-amd64/piwork-cli.exe
dist/cli/windows-amd64/build.json
```

```sh
go test -mod=readonly ./internal/clientfs ./internal/client ./internal/cli ./internal/pipackage
go list -deps ./cmd/piwork-cli
```

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

```sh
go build -mod=readonly -o storage-fixture scripts/check-cli-storage-fixture.go
./storage-fixture --create --directory <新的哨兵目录>
# 保存返回的 owner；以 owner 启动本次 Desktop，保持控制通道存活。
# 再以另一普通账号执行：
./storage-fixture --probe-other-user --directory <哨兵目录> --owner <owner> --control <活跃通道>
```

```sh
go build -mod=readonly -o credential-fixture.exe scripts/check-cli-credential-fixture.go
# Windows 设置 PIWORK_TEST_CREDENTIAL_FIXTURE 为该 helper 的绝对路径。
npm run test:browser -w @piwork/desktop-webui
```

```sh
node scripts/check-cli-platform.mjs --build dist/cli/linux-amd64 --report dist/cli/linux-amd64/native-evidence.json --fixtures <原生fixture配置.json>
```

```json
{
  "version": 1,
  "scenarios": {
    "core-command-families": { "command": "native-core-fixture", "args": ["--scenario", "core-command-families"] },
    "core-packages-snapshots": { "command": "native-core-fixture", "args": ["--scenario", "core-packages-snapshots"] }
  }
}
```

```json
{"id":"core-command-families","status":"pass","sha256":"本次候选摘要","target":"linux/amd64","diagnostic":"已执行的非敏感断言说明"}
```

```sh
go run -mod=readonly scripts/package-cli-release.go --build dist/cli/linux-amd64 --evidence dist/cli/linux-amd64/native-evidence.json --output dist/cli-release
# 在 Windows 原生验收后可在构建机打包其 PE：
go run -mod=readonly scripts/package-cli-release.go --build dist/cli/windows-amd64 --evidence <Windows原生报告.json> --output dist/cli-release
```
