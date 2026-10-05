# Design

## Context

动机见 [proposal.md](proposal.md)。本设计依据当前源码，而非把旧迁移的 Linux 验收结论当作 Windows 证据。

- `cmd/piwork-cli/main.go` 调用 `internal/cli.Entry`。同一个包还包含 Console；`console.go`、客户端文件操作和 `pipackage` 的公共文件引用 `x/sys/unix`，所以只设置 `GOOS=windows` 不能得到完整客户端。
- `internal/cli/user.go` 目前对空命令输出帮助；帮助、版本、语法校验、可信 Desktop 恢复及离线 Inspect 先于凭证读取。业务地址解析位于 `internal/client/http.go`，优先级为参数、环境、凭证、loopback。
- `user_desktop.go` 已有前台本地入口、内嵌资源、默认端口、浏览器打开失败回退和 Windows 浏览器打开分支。`user_desktop_control_linux.go` 通过私有目录、flock、Unix socket、peer UID 和 inode 校验提供 open/logout，不能直接用于 Windows。
- 登录成功保存 `client.Credential`；切换 Core 只更新运行中身份。退出删除凭证后，没有独立的默认地址可以复用。WebUI 的登录和 Core 切换入口在 `apps/desktop-webui/src/app.ts`、`adapter.ts`。
- `credentials_linux.go` 已有父目录固定、不跟随链接、私有权限、单硬链接、原子替换与条件退出。Operation 记录、Desktop 传输和快照仍有公共文件中的 Unix 调用；本地 Pi 包解析目前不认识 Windows 盘符/反斜杠路径。
- `scripts/build-go.sh` 构建全部 `cmd`；`package-go-release.sh` 验证 Linux ELF 并发布全组件。Desktop 的 TypeScript 构建和静态同步可以独立执行，用户运行时无须 Node。
- 主规格部分 operator 名称仍是历史 `piwork-serve` 表述；已完成但未归档的 `go-core-cli-migration` 描述了当前 Go 入口。此次 delta 保留 operator 职责，不把这些历史名称当成需要新增或迁移的入口，不修改旧 change。

## Goals / Non-Goals

**Goals:**

- 同一业务实现配合有限的平台后端；让客户端依赖图完整可编译、运行和验收。
- 默认路由只改变空命令入口；把 Desktop 默认 Core 与共享认证状态分开，保护现有 AI/脚本地址解析。
- 为私有存储、实例恢复及文件传输提供可证明的原生隔离和完整提交语义。
- 独立客户端构建可以产出相应目标，不牵连 Linux 服务端发布；原生验收覆盖安全和失败路径。

**Non-Goals:**

- 不把 Console/Core/Agent/helper 加入 Windows 支持，不迁移它们的运行环境；只处理阻塞客户端编译的依赖边界。
- 不引入默认实例复用、自动选端口、后台进程或新的 CLI 全局参数；不做双击检测、特殊留窗和安装器。
- 不在 Windows 解压执行 `.work` 或模拟 Linux 容器文件系统，不改变 Core 协议、包摘要规则及运行环境判断。
- 不设产品层的 Windows 版本、Linux 发行版或 CPU 架构名单；具体发布目标和测试环境只记录在配置与验证证据中。

## Decisions

### 1. 默认入口复用既有 Desktop 分派

在 `runUser` 完成全局参数解析后，仅对 `args` 为空且 `json=false` 的调用补入 `desktop`，之后继续经过原语法校验及 Desktop 路径。帮助、版本、无子命令的 `--json` 保持原来的提前返回；未知 flag/命令不能触发默认界面。不把 `--port`、`--no-open` 提升到全局参数。

| 调用 | 结果 |
| --- | --- |
| `piwork-cli` | 默认前台 Desktop，端口 17891 |
| `piwork-cli --core URL` | 同上，仅覆盖本次 Core |
| `piwork-cli --core URL desktop --port N --no-open` | 原显式 Desktop 行为 |
| `piwork-cli help` / `--help` / `-h` | 帮助，exit 0，无状态/网络副作用 |
| `piwork-cli --json` / `--core URL --json` | 原帮助行为，exit 0 |
| `piwork-cli --json work list` | 原业务命令，单值 JSON |
| `piwork-cli desktop open/logout ...` | 原可信恢复，不重新选择 Core |
| 重复启动且端口已占用 | exit 6，原实例不变 |

选择直接复用，是因为已有 Desktop 的授权、端口错误和恢复契约已经闭环。自动复用需要额外定义 Core 冲突和重开授权，会扩大空命令变化；本轮不采用。

### 2. 拆开客户端与 Console/服务端文件依赖

将 `console.go`、`console_api.go`、`console_upload.go` 及所属测试移到 `internal/consoleapp`，由 `cmd/piwork-console` 调用独立 Entry，删除 `cli.Entry` 的 Console 分派依赖。仅把共同使用的纯浏览器资源、JSON/名称校验和随机密钥辅助提取到 `internal/localweb`；原 CLI 可以保留薄包装以减少无关调用改写，Console 不反向依赖用户 CLI。

`pipackage` 的扫描、manifest/ZIP 验证、归档读取及客户端 `PackArchive` 保持公共层；把 `CopyTreeAt`、NPM tar 解包、ZIP 解包/安装发布等服务端操作放进 Linux 文件。`tree.go`、ZIP 打开及归档输出的宿主文件访问改用平台后端。Linux Core 保留原函数、摘要、模式及安装行为；只调整编译边界。

新增 `internal/clientfs`，提供固定目录句柄、不跟随链接的普通文件打开、私有创建、排他锁、原子替换、不覆盖发布、文件身份、磁盘可用量及进程存活判断。公共业务代码不接收 Unix fd 或 Windows handle；OS 类型限制在 `*_linux.go`、`*_windows.go`。不以 Windows stub 或“unsupported”替代现有客户端命令。

选择独立 Console 包，而不是为 Windows 加空 Console 实现，可以使客户端依赖图只包含用户功能。选择有限文件原语而不是泛化跨平台容器/文件系统，可保留服务端专有逻辑。

### 3. Desktop 偏好与凭证独立，惰性参与地址解析

凭证路径保持 `PIWORK_CONFIG_PATH` 优先，其次显式 `XDG_CONFIG_HOME/piwork/client.json`。Linux 继续回退到 `HOME/.config/piwork/client.json`，保持现有缺失 HOME 时的错误；Windows 回退到 `os.UserConfigDir()/piwork/client.json`。相对的显式路径在命令实际需要状态时转换并固定；帮助和离线 Inspect 不因此新增状态访问。

新增偏好路径：`<credential-parent>/desktop/preferences.json`。目录私有，文件内容为：

```json
{"version":1,"coreUrl":"https://core.example"}
```

只允许这两个字段，`version` 必须为 1，地址规范化规则与现有 Core origin 相同，统一允许合法 HTTP 与 HTTPS origin，遵守 `allow-http-core-connections` 的协议策略；不容许重复字段、额外字段、尾随 JSON 或超过 64 KiB。未设置通过文件缺失表达，不写入空 URL，也不写入凭据。Operation 和传输仍使用现有 `desktop-operations-go`、`desktop-transfers-go` 位置与已有格式。

业务命令继续使用 `client.ResolveCoreURL`。新增 Desktop 专用 resolver：先验证选定的参数/环境值；未覆盖才读取偏好；偏好缺失才使用旧凭证地址和 loopback。凭证读取与 Core 绑定的安全检查保持，覆盖偏好不等于跳过不安全凭证校验。配置读取不创建目录、不迁移旧文件。

配置格式/版本/安全读取错误为启动 exit 1；参数/环境/旧凭证选定的地址错误为 exit 2；合法远程 HTTP 不属于地址错误。损坏偏好可用显式 `--core` 启动并经配置入口清除，安全校验失败的目标不能强删。没有偏好的旧安装完全按原地址回退，旧凭证无需转换。

选择单独保存偏好，能让 logout 清理认证而保留地址；将偏好写入凭证或改变全体 CLI 的优先级会改变现有业务调用的目标，故不采用。

### 4. 本地配置 API 和界面形成独立读写闭环

新增 `/_desktop/api/preferences`，经过现有精确 Host/Origin、本地 Cookie、CSRF 校验及 `guardAccess(..., identityBound=false)`。它与 session/connection 同属本地授权路由，不落入需平台账号的 `guardContent`，也不受当前 Core 是否可达影响。不新增 Core API。

| 方法 | 请求 | 成功响应与语义 |
| --- | --- | --- |
| GET | 无 body | 200 `{coreUrl: string或null}`；缺失返回 null，不创建文件 |
| PUT | `application/json`，仅 `{coreUrl: string}`，上限 64 KiB | 200 `{coreUrl: 规范origin}`；显式保存下次启动值 |
| DELETE | 无 body | 200 `{coreUrl:null}`；缺失也成功，显式恢复自动选择 |

未知方法返回 405。PUT 格式、大小或地址错误返回 400 `INVALID_DESKTOP_PREFERENCES`。非阻塞排他锁冲突返回 409 `DESKTOP_PREFERENCES_BUSY`。安全校验、损坏状态或提交前 I/O 失败返回 500 `DESKTOP_PREFERENCES_UNAVAILABLE`；不暴露绝对路径、密码或 token。提交已完成而最后持久化确认失败返回 500 `DESKTOP_PREFERENCES_OUTCOME_UNKNOWN`，不能声称旧值一定保留。既有 401/403 本地授权错误及 503 本地访问容量限制不改。

PUT/DELETE 共用偏好目录 `.lock` 和进程内互斥，获得锁后重新检查目标；PUT 需要既有内容格式合法，损坏内容不能被静默覆盖。DELETE 只需验证安全目标，不需要配置内容合法，因此能显式修复格式损坏。临时文件私有且同目录，完整写入/同步后原子替换；清除使用相同锁与安全删除。缺失读取及成功清除不保留默认值的缓存。发布前检查请求取消及本地授权仍有效；已提交结果不因响应断开回滚或重复提交。

WebUI 在原 Core 地址字段附近增加“Save as default”、已保存默认值及“Restore automatic selection”；当前连接单独显示，不把保存按钮当成 Switch Core。进入配置入口读取偏好，提供显式重新读取。默认配置的加载/错误不会禁用登录、连接和 Inspect。

保存/清除捕获本次输入，锁定两个偏好修改按钮，等待时就地显示 Saving/Clearing，十秒未完成仍说明等待。输入和独立业务操作保持可用；响应以请求代次关联，不覆盖后续输入。成功短提示只在已确认提交后出现。网络响应丢失或 `OUTCOME_UNKNOWN` 进入 `unconfirmed`，只读 GET 确认实际值/缺失后解除保护；读取失败保持该状态，导航或刷新只能重新读取，不重发 PUT/DELETE。旧读回不得回退更新的确认状态。

保存既不调用 `switchCore`、`login`，也不撤销传输或更新身份 generation。继续保持同 Core 首次登录保留匿名 Inspect 的既有规则；用户显式切换 Core 才执行原撤销流程。选择独立配置接口而非在连接/登录中自动保存，可避免把认证与存储失败混成一次不可解释的动作。

### 5. 平台私有存储保持等价安全，不依赖 chmod 模拟

Linux 凭证保留现有 `credentialDirectory` 实现与目录 flock；其他私有状态复用同等级的固定目录、不跟随链接和原子发布原语。Operation 继续锁定原 `.lock` 文件，避免新旧 Linux 进程并发时使用不同锁。偏好使用新目录自己的 `.lock`，立即报告竞争而不无限等待。

Windows 的 `credentialDirectory` 适配现有 Load/Save/Clear/ClearSession 接口。通过当前进程 token 获取 SID；新私有目录/文件创建时设置受保护 DACL，仅授权当前 SID 与 LocalSystem，阻止宽泛继承。既有目标检查 owner、DACL、普通类型、重解析属性、文件 ID 和硬链接数量；不安全既有 ACL 不自动修正，无法证明隔离的文件系统安全拒绝。

Windows 文件后端使用现有 `x/sys/windows` 的 `NtCreateFile`，逐级固定目录 handle，结合不跟随重解析点的打开选项和最终类型/身份检查；发布用 `NtSetInformationFile(FileRenameInformationEx)` 在固定父目录内完成。私有替换设置 REPLACE_IF_EXISTS 与 POSIX_SEMANTICS，让既有读者继续访问旧文件；下载发布不设置覆盖标志，“不覆盖”必须由最终原子操作保证。扩展信息类是原生并发读写验证后确认的 API 细节，不改变既定原子替换/不覆盖契约。文件身份采用 volume/file ID、大小与写入时间，检查不以路径字符串比较代替。[扩展重命名官方语义](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)。

私有文件写入使用 write-through/`FlushFileBuffers`，Windows 在发布后同步已重命名的文件 handle 并确认固定父目录仍安全，不模拟 POSIX 目录 fsync；Linux 则保留文件与父目录 fsync。发布后同步或最终安全确认错误按未确认结果处理。保证正常并发及中断时可见内容完整，不扩大为所有存储设备突然断电的保证。Windows 排他锁使用 `LockFileEx`，凭证立即报告占用，条件清理在同一把锁下读回并比较 Core/token；锁随着 handle 关闭或进程结束释放。[write-through 官方语义](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea)、[LockFileEx 官方语义](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)。

原生测试确认同大小改写可能保留原 Windows 写入/变更时间戳，因此不能只用时间戳证明稳定性。Windows 普通输入与私有传输的读者排除并发写入，仍共享 DELETE 以允许原子替换保留旧读者；文件身份在 volume/file ID、大小与时间之外补充原生文件变更序号。文件系统不提供可靠序号时核对内容摘要，不强加 USN journal 或 NTFS 产品要求；代价是该回退增加大文件读取。私有原子发布后的短暂 flush handle 占用可有界等待，不能通过允许写入共享绕过稳定性。[原生文件变更序号](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ni-ntifs-fsctl_read_file_usn_data)。

选择原生访问控制与 handle 操作，而非 `os.Chmod(0600)` 或路径检查后普通覆盖，是因为后者不能提供 Windows 的当前用户隔离及替换竞态保证。Linux 凭证后端不因新抽象被整体重写。

### 6. Windows 使用受保护 named pipe，保留本机恢复协议语义

将参数解析、请求/回复结构、严格 JSON、动作执行、链接校验与退出码映射从 Linux 文件提取到公共文件。Linux 仍使用原 `/tmp/piwork-desktop-<uid>`、元数据 v1、flock、Unix socket、peer UID、inode 和 JSON/EOF framing，保留与旧 Linux 实例互操作。

Windows 后端使用已有 `github.com/Microsoft/go-winio v0.6.2` 的 byte-mode named pipe，提升为直接依赖；设置显式受保护 SDDL，仅允许当前 SID 与 LocalSystem。该后端拒绝远程 pipe 客户端并独占创建首实例；不用默认 pipe ACL。[官方库实现](https://github.com/microsoft/go-winio/blob/v0.6.2/pipe.go)、[Windows named pipe 安全说明](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)。

实例目录采用 Windows KnownFolder LocalAppData 下的 `piwork/desktop-control`，通过原生目录 API解析，不由 cwd、Core 或凭证路径决定。端口 `.lock` 用 LockFileEx；元数据包含 v1、port、随机 instanceId、pipeName、server PID 和原生进程创建时间。pipeName 由当前 SID 的 SHA-256、port 和随机 instanceId 组成，必须是本机 `\\.\pipe\` 下的期望名称，不接受元数据提供的任意路径。

客户端验证安全元数据后连接，利用 pipe handle 的 `GetNamedPipeServerProcessId` 校验 PID、创建时间和 server token SID；服务端用 `GetNamedPipeClientProcessId` 和 client token SID 做对称校验。无法查询身份即拒绝；只凭可猜测管道名或 port 不足以授权。新实例只在持有端口锁时移除经过安全检查的陈旧元数据；正常退出按记录 file ID/instanceId 清理，避免旧进程删除新实例状态。

Windows transport 使用四字节大端长度加严格 JSON 和换行，单帧至多 16 KiB，单连接只处理一次请求/回复。客户端完整收到回复后发确认字节 `0x01`，服务端在确认、断开或十秒期限后关闭，以避免未读回复被提前丢弃；该确认不触发第二个动作。请求、回复、确认和连接均有期限/取消，最多 16 个处理槽。不用阻塞 Flush/CloseWrite 作为协议结束条件；业务动作仍使用同一 v1 字段及 open/logout 语义，logout 继续采用既有有界远端尝试和条件磁盘清理。

选择 named pipe 而非把可信动作暴露给 localhost HTTP，可在原生 OS 上验证对端系统身份；选择 Windows 专用 framing 保留 Linux 旧协议，同时避免 named pipe 的 EOF/flush 语义破坏超时契约。

### 7. 本地来源、传输和中断保留协议与宿主边界

| 位置 | 改动和保持的契约 |
| --- | --- |
| `user_packages.go` / `user_package_source.go` | 语法校验和实际上传共用 `internal/client/package_source.go` 的客户端来源解析；远端 npm/git 优先使用原规则，Windows 再识别显式本地相对、盘符绝对和 UNC 路径；拒绝盘符相对、用户设备命名空间和 ADS。服务端的 ParseSource 不引入 Windows 本地上传路径 |
| `pipackage/tree.go` / ZIP 读取、打包 | 固定根和普通文件 handle；按原 manifest、排序和摘要规则处理。Windows 目录 0755、文件 0644；允许安全真实 symlink 条目，目标转换为协议 `/` 并校验，拒绝 junction/其他重解析点。Linux 模式和已有 ZIP 元数据保留 |
| `user_snapshot.go` | 普通文件安全打开、检查前后稳定身份、同目录私有暂存、完整 `.work`/大小/摘要验证后原子不覆盖发布；不改请求、幂等键、原 ID 观察或结果 envelope |
| `user_desktop_records.go` | 固定私有目录、原 `.lock` 与记录格式、Core/user key；Windows 原生锁与 ACL，不把记录失败误判成远端未接受 |
| `user_desktop_transfers.go` | 私有实例目录、原配额/预留/TTL、身份与本地会话绑定；空间查询分别用 Statfs/GetDiskFreeSpaceEx；进程存活查询分别用 kill(pid,0)/OpenProcess+退出状态，未知即不清理 |
| `.work` Inspect / 镜像静态解析 | 仅作为协议数据，不解压到 Windows、不使用 runtime.GOOS 拒绝 Linux 内容；保持原离线和安全校验 |

Windows 普通本地目录没有可靠 POSIX 执行位，不通过扩展名制造执行位；需要此元数据时使用原协议 ZIP。UNC 输入仍须满足普通文件/稳定身份/固定根保证；不能证明安全时明确拒绝，私有配置位置同样不因网络存储而放宽 ACL。

将 OS 中断测试辅助分为 Linux signal 和 Windows console-control 后端。Windows Ctrl+C/Ctrl+Break 进入原 interrupt 路径；Desktop 本地清理保持 exit 130，Linux 已有 SIGTERM 清理保持 exit 143。Windows console close/logoff/shutdown 的 SIGTERM 只做有界最佳努力，不承诺拦截 OS 强制终止。Chat 中断仍请求取消原 Run，其他等待不新增远端取消。[Go 1.25.5 的 Windows signal 语义](https://pkg.go.dev/os/signal@go1.25.5#hdr-Windows)。

浏览器打开使用既有原生分支，不通过 shell 拼接 URL；Windows 保留系统浏览器打开方式，不设置 GUI subsystem 或隐藏终端。启动来源与业务生命周期相互独立。

### 8. 客户端构建、发布和原生验收独立于服务端

新增 `scripts/build-cli.mjs`：显式、可重复的 `--target <goos>/<goarch>` 优先于 `config/cli-release-targets.json`；未给参数且目标文件不存在时默认当前 Go 目标，已有配置格式错误或目标列表为空则拒绝，不静默回退。校验仓库已固定的 Go 1.25.5 与 Node 24 构建工具。通过 Node 直接调用本地 TypeScript 编译入口、现有 copy-static 与 sync-desktop-assets，清理 Desktop 的旧构建输出并只重建其资源；不调用全 workspace 或 Console 构建。资源准备一次后按目标构建 `./cmd/piwork-cli`，`CGO_ENABLED=0`、readonly module、trimpath 与现有 VCS stamp 保持。

输出为 `dist/cli/<goos>-<goarch>/piwork-cli[.exe]`，目标输出相互隔离。配置是实际交付目标清单，不在规范列出版本/架构最低要求；不把交叉编译成功等同原生验证。新增 Make/npm 快捷入口只是调用该脚本，原 build/release 依赖链保持。

新增仅用于构建环境的 `scripts/package-cli-release.go`（排除在普通 package 扫描之外），用 Go 标准库打包并校验目标 header、Go build metadata 和 SHA-256。Windows 使用 ZIP，Linux 使用 tar.gz；发布物只含客户端、manifest 和客户端使用说明，Linux 可执行模式 0755。命名包含目标、版本和 commit。manifest v1 包含程序、版本、commit、dirty、Go 工具链、目标、二进制路径/大小/摘要、内嵌 UI 构建输入摘要和关联验收记录摘要；不含任何测试密码/token。

新增 `scripts/check-cli-platform.mjs` 和客户端 Go 原生进程验收入口，发现目标客户端的本模块依赖包并执行其公共/平台测试；原生 runner 用独立用户 fixture、临时私有目录和已部署 Linux Core 验证 CLI。真实跨机器 Core 可以使用 HTTP 或 HTTPS；HTTP 场景与有效 HTTPS/TLS 失败场景分别验证，不关闭证书校验，也不以 HTTP 成功豁免 TLS 验收。浏览器套件保持原 Host/Origin，分别覆盖 Desktop、Service 隔离和配置读写；proxy 的 HTTP/WebSocket/PAC/WebDAV 通过真实本地连接验证。

平台证据记录二进制 SHA-256、目标/OS 环境、commit、工具链、执行命令、场景结果及安全诊断。发布打包必须关联相同二进制的合格原生记录；缺失目标、失败、跳过必需安全测试或记录摘要不匹配即阻止正式发布。记录和报告可以存储到指定工作目录，不能把旧 Go 迁移验收矩阵的 Linux 通过数当成本次证明。

选择 Node 构建协调与 Go 标准库打包可复用现有工具链，又不会引入用户运行依赖或外部 zip/tar/readelf 要求。原生验收工具使用构建/测试环境工具；发布二进制的独立运行烟测使用仅系统工具的 PATH 和非源码工作目录，证明 runtime 不依赖开发工具。

### 9. 验证层次与完成判据

| 验证层 | 覆盖内容 | 完成依据 |
| --- | --- | --- |
| 公共 CLI 契约 | 显式命令、JSON 单值、流式输出、原 ID、帮助/语法提前拒绝、token 绑定及默认分派 | 同一契约测试在两平台原生运行 |
| 原生文件/身份 | Linux 原安全测试；Windows ACL、其他 SID、重解析/硬链接/目录替换、条件退出、下载目标竞争、锁与崩溃 | 实际 OS 后端通过，必要 fixture 缺失算未验证 |
| Desktop 配置/API | 地址优先级、缺失/损坏/覆盖、离线配置、保存/清除、并发、响应丢失和跨源拒绝 | API 测试和浏览器动作/状态转换测试 |
| 真实客户端进程 | 默认/显式 Desktop、open/logout、proxy、普通业务、上传/快照、Ctrl+C、浏览器打开失败 | 发布二进制在对应系统运行，原生控制事件和网络证据 |
| Linux 既有边界 | Console 迁出、Pi 解包/安装、全组件构建、Core/浏览器既有集成 | 受影响单测及既有集成通过，无协议变化 |
| 发布独立性 | 无镜像构建、匹配的 PE/ELF、内嵌 UI、版本/摘要、无开发工具运行 | 每个发布目标有匹配记录，缺失时拒绝正式打包 |

具体机器、OS build、GOARCH 是验收环境事实，记录到报告；不转写成产品限制。跨平台测试拆分只移动 OS 专属测试，不能将原通用安全/业务测试整体加 Linux tag 或通过 skip 伪装成 Windows 覆盖。

## Risks / Trade-offs

- [Windows ACL/文件系统语义与 POSIX 不同] → 原生 handle/DACL 验证与竞态负例；不支持可靠保证的位置安全失败，不使用 chmod 替代。
- [空命令曾被脚本当作帮助] → 明确标记 BREAKING、更新帮助与文档；显式帮助、版本及空 `--json` 保持。
- [Desktop 默认值与 CLI 凭证 Core 不同] → 两种地址解析分别测试，界面标注当前/默认，token 严格绑定 origin，不自动同步。
- [并发修改、磁盘失败或回复丢失] → 同锁原子发布，区分提交前失败与结果未确认，GET 核对后才解除修改保护。
- [Console/服务端文件代码迁出带来 Linux 回归] → 只调整依赖边界，保留 API/格式/锁位置，运行原 Console 和 Pi 安装相关测试。
- [旧实例与新客户端同时存在] → Linux 恢复协议、元数据和锁位置不改；Windows 首次提供专用协议，没有旧 Windows 实例兼容负担。
- [原生 Windows runner 或其他用户 fixture 暂时缺失] → 对应验收明确未验证，保留可执行步骤，不用交叉编译代替，不宣称实施完成。

## Migration Plan

1. 先隔离依赖并实现平台后端，运行 Linux 受影响回归，保持现有构建入口可用。
2. 再增加默认路由、Desktop resolver、偏好 API/UI 和客户端独立交付。默认配置缺失的旧安装不迁移、不重写凭证。
3. 在两平台用实际产物完成公共/原生/浏览器验收，并将二进制摘要与证据绑定；发布说明明确空命令变化和显式帮助替代。
4. 回滚时可恢复旧客户端二进制；旧版本会忽略独立 `desktop/preferences.json`，Linux 凭证、Operation 格式和本机恢复位置保持可用。Windows 首次引入的私有状态不传给 Linux 部署；不得回滚到削弱存储安全的替代实现。

没有阻塞实施的产品或架构待定项。实际发布目标和原生测试环境在配置/证据中填入，不改变以上行为和完成判据。
