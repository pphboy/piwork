# control-cli 规格变更

## ADDED Requirements

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

```sh
piwork-cli --core http://core.example:7171 status
piwork-cli --core http://core.example:7171 proxy  # 先在这个 origin 登录
PIWORK_CORE_URL=http://core.example:7171 piwork-cli
```

```powershell
$env:PIWORK_CORE_URL = 'http://core.example:7171'
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
