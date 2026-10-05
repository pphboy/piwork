# 2026-10-06 补验完成

当前任务 **10/10**，任务 4.2 的两平台实际空根命令均已补齐。烟测文档已补全 app.js 与 adapter.js 的复制要求。

- Linux 当前候选在 `unshare -Urn` 的独立用户/网络 namespace 中实际执行 `candidate --core http://127.0.0.1:7171`，保存偏好后以无参数 `candidate` 重启；本地授权、匿名状态、默认地址、open 及真实 interrupt→130 全部通过。Desktop 实际监听 127.0.0.1:17891，未改产品端口或参数。
- 隔离 namespace 的 HTTP 7171 经临时私有 Unix socket / 原始 TCP relay 连接宿主已有 Core 127.0.0.1:7171，不模拟响应、不部署 Core、不改变协议。临时通道与测试进程已退出。该隔离环境不作为跨平台变更另一用户或权限门禁的通过证据。
- Windows 第一轮原生 smoke、真实 LAN HTTP Core status 与显式 Desktop/偏好重启通过，固定 17891 仍绑定失败；该轮保存为 verification/native-windows.explicit.2026-10-06.json。
- 用户随后明确授权“允许临时退出并重新启动现有 Desktop”。保存原可执行文件后以 SIGINT 退出 PID 5052，原生 Windows 第二轮实际运行 `candidate --core http://192.168.14.134:7171`，保存 HTTP 默认值、退出后执行无参数 `candidate`；两次均在默认 17891 完成本地授权、匿名 Core 状态、open 和 interrupt→130。http-default-root 为 pass。Core 服务未停止或修改。
- 两平台没有重建候选，摘要与原报告相同；本轮实际 app.js/adapter.js 字节均匹配。Linux 本轮补默认根入口，显式 deployed-Core 流程仍由同一候选 2026-10-05 记录支持；Windows 本轮显式与默认入口有分别执行记录，不能将 helper 的概括命令当成一次执行所有分支。
- 当前完整结果见 verification/native-linux.json、native-windows.json；2026-10-05 端口缺口保留于 native-*.2026-10-05.json，旧核验报告另存 verification-report.2026-10-05.md。Linux 隔离 wrapper 执行源码保存为 verification/linux-netns-fixture.2026-10-06.py，记录本次实际临时路径与拓扑。
- 本轮重点 Go 回归（偏好、默认入口、HTTP、TLS、proxy、Desktop）、Desktop 类型检查、两个变更严格 validate 和 git diff --check 全部通过。没有重新声称运行整仓、完整浏览器或正式发布验收。

实际 Linux 命令：先 `go build -mod=readonly -o /tmp/piwork-http-native-check-20261006 scripts/check-cli-native.go`，再 `python3 /tmp/piwork-http-netns-20261006.py`；wrapper 源码见上述记录。Windows 在原生临时目录执行 `native-check.exe --build .\candidate --root .\expected-ui --http-core http://192.168.14.134:7171`。

Windows 测试结束后，第一次恢复因共享端口 TIME_WAIT 返回端口不可用；等待释放后已恢复原 Desktop（PID 265662），使用保存的原二进制、原工作目录及 Core/启动参数。环境取自原登录 shell，未写入报告；该 shell 没有 PIWORK/XDG_CONFIG_HOME 覆盖。监听 17891 与当前候选 desktop open 已复验成功，Core PID 5034 保持运行。恢复的 Desktop 当前在后台运行，输出保存在私有日志；原浏览器本地会话需重新打开。恢复事实见 verification/desktop-restoration.2026-10-06.json，不含票据或凭据。

## 以下为 2026-10-05 历史记录

# HTTP Core 实施验证进度

日期：2026-10-05。基线 commit：`590f86d35331201d7471763d2a9821c92a9d3032`；工作区尚未提交。本文记录本次候选的实际结果，不是完整跨平台发布证据。当前任务完成 **9/10**；4.2 的实际空根命令因两平台默认端口不可用而保留未完成，其余已完成。

## 实现范围

统一允许合法 HTTP/HTTPS Core origin，包括远程 IP、域名和 IPv6，覆盖业务命令、默认/显式 Desktop、当前连接切换、偏好输入与 v1 文件读回、proxy。没有新增许可开关或平台例外。变更涉及：

- `internal/client/desktop_preferences.go` 的 `DesktopCoreURL` 只复用既有 `ParseCoreURL`，保留错误类型及规范化结果。
- `internal/cli/user_desktop.go`、`user_desktop_api.go`、`user_proxy.go` 删除远程 HTTP 拦截；连接切换复用同一校验结果，删除无人使用的本地 host 辅助。
- `apps/desktop-webui/src/adapter.ts` 删除偏好 HTTP loopback 条件，格式错误只说明合法 origin；用既有构建入口同步内嵌资源。
- 客户端/CLI/浏览器回归加入远程 HTTP、旧 HTTP v1、同 host/port 协议凭证隔离、网络 proxy 和 TLS 正反例；原生烟测增加 adapter 字节核对，`--http-core` 专项验收已部署 Core、偏好与重启。
- CLI 平台、用户 CLI、Desktop 说明和并行跨平台变更统一协议条款。主规格没有提前同步，两变更没有归档。

优先级、命令、JSON/退出码、默认端口、本地监听/Host/Origin/CSRF/Cookie、凭证/偏好文件格式、私有存储及发布门禁保持。HTTP 使用明文传输；HTTPS 仍按系统信任验证证书，不改系统根、不跳过验证、不自动回退。

## 当前候选身份

两候选均为 `0.1.0`、`modified: true`、Go `1.25.5`、CGO=0，使用同一 Desktop 输入摘要 `31c57ca3104012c29dfb886e025903a4f73cc03884317c6817603630d0a7989b`。

| 原生目标 | 文件 | 字节数 | SHA-256 |
| --- | --- | --- | --- |
| linux/amd64 | `dist/cli/linux-amd64/piwork-cli` | 13433115 | `973e0e28d564ecd1ace16f1068dfe11300967fb9181771fee27a5ef769c0fa79` |
| windows/amd64 | `dist/cli/windows-amd64/piwork-cli.exe` | 13855744 | `5c62047572bb9afb3bcb2f3ac0de086e7a273020bf1af5cc453aa135f802c750` |

从两个实际二进制读取并与同步资源逐字节核对：`app.js` 为 `e4a18292ac33e074408fab5bf779a270d3c4b6b7360fc5ea46f427cb8eb237d4`，`adapter.js` 为 `9b1eb1c1ddeffd65a1e9db07bd0a2370d50edcd5240581a1eb463ce70ad198d6`。app 未改动；协议校验位于 adapter，不能仅凭 app 摘要确认本次修改。

原生专项结果保存在 [Linux](verification/native-linux.json) 与 [Windows](verification/native-windows.json)。旧候选的通过结果不绑定到这些新文件。

## 已执行回归

首次并行 Linux 浏览器执行为 199 pass、2 fail、0 skip：新增 HTTP 场景的测试步骤在连接切换后保留了编辑的离线地址，随后的登录误用该草稿，已修正测试输入；已有 R1 文件编辑用例遇到异步保存时序失败，原用例单独复测通过，没有改动文件编辑产品逻辑。首次 Windows 原生专项为 8 pass、1 fail、0 skip，对应同一新增测试输入问题；真实五分钟过期已通过。Windows 同候选串行专项复验最终为 9 pass、0 fail、0 skip；Linux 首次串行复验为 200 pass、1 fail、0 skip，只有同一 R1 用例仍失败。该用例原步骤只等待 PUT 被记录，没有等待保存后的确认 GET 完成；现补充等待既有动作状态结束再编辑/刷新下一版，保留原断言，未改产品代码。修正等待后的 R1 单项已通过；最终其余八个测试文件复验为 **195 pass、0 fail、0 skip**（不包含已全通过的 native-auth 文件）。一次筛选表达式误匹配父组而再次进入五分钟等待，该重复测试组已停止并清理自建资源，不将中止结果计为通过；此前 native-auth 六项（含实际五分钟过期）保持真实通过证据，不以 skip 代替。首次失败保留，不计为通过。

| 验证 | 结果 |
| --- | --- |
| `go test -mod=readonly ./...` | 通过，包含 Core/Console/Pi、客户端和发布工具；不包含 `integration` tag。工具及最终测试修改后再次通过。 |
| `make build` | 通过，旧全组件 Linux 构建入口保留。 |
| `npm run build:cli` | 通过，仅重建 Desktop 与两平台 CLI；实际内嵌身份匹配。 |
| Desktop 类型检查 | 通过。 |
| Node 构建/协调器测试 | 8 通过，无 skip。 |
| Windows 原生 `client.test.exe`、`cli.test.exe` | 两包整套通过，无 skip；Go 1.25.5 编译后在 Windows 原生执行，CLI 进程测试指向当前 exe。 |
| 偏好浏览器专项 | Linux Chromium 与 Windows Edge 各 8 通过，无 skip；含 HTTP 保存/读回/清除、慢响应/短提示、未确认 GET 核对、晚响应、Inspect、当前连接 HTTP 切换。 |
| Linux Desktop 全浏览器及 Windows 原生授权专项 | Windows 原生专项 9/9 通过；Linux 分组覆盖全部 201 项：native-auth 六项实际通过（含五分钟过期及 HTTP），修正等待后其余八文件 195/195 通过。均无必需 skip；不将首次失败算通过。 |
| 两平台原生烟测与真实 HTTP Core | 通过，详见下一节；空根命令实际场景未验证。 |
| 新 Windows exe 对 `https://192.168.14.134:8443` | 仍返回 `NETWORK_ERROR: Core request failed`，exit 5；未关闭 TLS 校验，也未自动改连 HTTP。先前证书诊断为自签名且原生系统不信任，此次没有修改证书或系统信任。 |

测试进程 TLS fixture 使用专用 CA 和 `x509.SetFallbackRoots` / `GODEBUG=x509usefallbackroots=1`，仅作用于隔离子进程，不安装证书、不增加产品参数。Windows/Linux 同一套实际网络断言覆盖 HTTP、可信 HTTPS 成功，以及不受信任、过期、错名的拒绝；同时测试标准 Core HTTP 请求与 proxy 的 TLS socket，负例没有应用层请求或 HTTP 回退。这些合同测试不代替正式发布要求的原生系统信任真实 HTTPS Core fixture。

## 真实 HTTP Core 与未完成原生验收

Windows 在实际 Host 上执行当前 PE，连接用户提供的 `http://192.168.14.134:7171`。Linux 在 WSL2 原生执行当前 ELF，连接已部署的 `http://127.0.0.1:7171`。两者分别完成：

1. `--core <HTTP origin> --json status` 返回 healthy、ready，exit 0。
2. 从非源码临时目录、无开发工具 PATH、独立私有配置启动 `desktop --port <空闲端口> --no-open`；未本地授权 session 为 401。
3. Bootstrap 后匿名 Core status 的 health/readiness 可用；当前 Core 和 signed-out 状态正确。
4. HTTP 偏好保存/读回不改当前 session，不写凭证；同用户 `desktop open` 恢复同一实例。
5. 真实 native interrupt 以 130 退出；用相同配置启动新进程且不指定 `--core`，确认采用保存的 HTTP 默认值，然后清除偏好并退出。

命令：

```sh
go run -mod=readonly scripts/check-cli-native.go --build dist/cli/linux-amd64 --root . --http-core http://127.0.0.1:7171
```

```powershell
# 在原生 Windows 临时目录执行 Go 1.25.5 编译的 native-check.exe；candidate 含 exe/build.json。
.\native-check.exe --build .\candidate --root .\expected-ui --http-core http://192.168.14.134:7171
```

Windows 的工具/测试/浏览器文件复制到 `C:\Users\p\AppData\Local\Temp\piwork-cli-platform-tests`，以当前普通用户运行；浏览器使用 Edge。Linux Go/Node 为 1.25.5/24.20.0，Windows Node 为 24.14.1。具体环境事实沿用 [跨平台报告](../../support-cross-platform-cli-and-default-desktop/verification-progress.md)，不构成产品平台要求。

**任务 4.2 保留未完成**：两系统的默认端口 17891 均无法用于本次验收，未接管或结束用户实例，所以空命令原生场景 `http-default-root` 如实记为 unverified。默认入口的 HTTP 路由及无 I/O 契约在两平台原生入口表测试通过，持久化默认 Core 在独立端口实际通过；这些不替代实际空命令验收。当前 exe 可显式指定独立端口连接 HTTP。

WSL 直接访问 `http://192.168.14.134:7171/healthz` 的无代理请求在 10 秒后超时；不能声称 Linux 直连该 LAN 地址成功，也不能声称两端在同一真实 Core 完成所有命令族验收。上述 Linux HTTP 验收使用本机已部署 Core，没有自动部署或改动服务端。没有真实账号的全命令族/包/快照及受原生系统信任的 HTTPS Core fixture，原跨平台验收缺口继续保留。

## 场景到实现与证据的映射

| 场景 | 实现/测试 | 本次结果与限制 |
| --- | --- | --- |
| CLI-CORE-PROTOCOL-001：远程 HTTP 全入口、来源不影响准入 | 共享 parser/resolver；`TestDesktopPreferenceInputAndOriginValidation`、`TestDesktopResolverPriorityAndBusinessResolverIndependence`、`TestDefaultDesktopDispatchAndOriginBoundToken`；原生 HTTP 专项及非 loopback proxy fixture | 合同通过；真实 status/显式 Desktop/默认值重启通过；空根命令实际场景未验证。 |
| CLI-CORE-PROTOCOL-001：非法地址 | 客户端严格输入/坏记录、`TestDesktopHTTPConnectionAndSchemeBoundCredentials`、偏好 API 和浏览器非法路径 | 通过；400 与 CLI 错误/不回退及保留输入不写入保持。 |
| CLI-CORE-PROTOCOL-001：HTTP/HTTPS 凭证独立 | 默认入口 token 表；HTTP 连接测试双向切换并断言服务器未收到另一 scheme 的 token；匹配 HTTP origin 的 me 认证 | 通过，两原生 CLI 套件执行。 |
| CLI-CORE-PROTOCOL-001：HTTPS 校验失败 | `TestCoreHTTPAndTLSValidationWithoutFallback` 的实际 client/socket 网络与进程隔离信任 fixture；当前 Windows exe HTTPS 负例 | 通过，标准信任验证保留；真实系统信任 HTTPS 成功未验证。 |
| CLI-CORE-PROTOCOL-001：HTTP 不可达 | 非 loopback 不可达 Desktop 进程；偏好 API 离线；native auth 离线/恢复；原网络错误测试 | 合同通过，合法 HTTP 未被 usage 拦截；WSL LAN 超时单独记录。 |
| CLI-DESKTOP-001：无登录启动、浏览器失败、非法端口/占用、关闭/中断 | `TestDefaultDesktopEarlyReturnsNeverLaunchOrCreateState`、`TestNativeDesktopMissingBrowserOpenerPrintsManualAddress`、`TestNativeDesktopEmbeddedProcessLoadsFromArbitraryDirectory`、原生烟测/匿名连接状态 | 通过；实际空根命令因既有监听未验证。 |
| CLI-DESKTOP-001：两种访问命令并存、远程 HTTP 启动/恢复 | 独立 17890/17891 解析、Desktop 与 proxy 进程测试、HTTP 专项 open/新进程 | 通过独立进程/端口和恢复合同，未接管已有默认实例。 |
| CLI-SERVICE-PROXY-001：curl/PAC/WebSocket、受限 CONNECT、两分支共存、HTTP 网络路径 | `TestNativeProxyProcessLifecycleAndFixedPort`、`TestNativeProxyTargetsAndLocalFileCredential`、`TestNativeProxyPACIsScoped`、`TestNativeProxyWebDAVUsesCoreBearerAndMapsHrefs`、`TestNativeProxyWebSocketAndRestrictedConnect` | 两原生 CLI 套件通过；测试 Core 使用真实非 loopback TCP，HTTP/ws/CONNECT/WebDAV 均实际通信。真实部署 Core 认证 proxy 无账号未验证。 |
| CLI-SERVICE-PROXY-001：无法启动、HTTP 不绕过鉴权/能力 | `TestRemoteHTTPProxyCapabilityFailuresRemainAPIResults`、占端口进程、非法参数、本地鉴权和文件降级/错误回归 | 通过；401→3，能力缺失/不支持→5，无半启动监听；目标白名单未扩大。 |
| DWUI-001：Core 可达运行环境失败、过期登录、本地授权独立于 Core 账号 | 原完整 WebUI 状态回归、native auth Core 过期/离线/重开/Import 原 ID、Cookie/票据隔离 | 当前候选浏览器用例通过；不声称既有 Agent Ready 集成失败已修复。 |
| DWUI-001：切换 Core/用户、HTTPS→HTTP、远程 HTTP 登录页面 | 当前连接 HTTP 浏览器/API 测试、非 loopback native auth 实际 exe 登录、双向 scheme token 测试、原身份 epoch/Inspect 撤销测试 | API/偏好浏览器及实际两平台 native HTTP 流程均通过；完整浏览器分组结果如上。 |
| DWUI-001：HTTP 默认保存重启、已有 HTTP 读取/清除 | `TestDesktopPreferencesExistingHTTPV1IsReadWithoutMigration`、存储/偏好 API、HTTP 专项真实两进程 | 通过；v1 无迁移或隐式改写，默认值不改当前身份/凭证/Inspect。 |
| DWUI-001：本地授权与失败/未知结果 | 偏好 Host/Origin/CSRF/401/403/容量/授权重置、400/锁/损坏/提交未知；偏好浏览器等待/GET 核对/短提示/晚响应；实际 native HTTP 浏览器 | Go、偏好浏览器及实际两平台 native 浏览器通过。没有自动重复修改。 |

## 发布门禁与并行变更

重新运行 Linux 原生协调器，当前候选匹配报告为 **12 pass、0 fail、6 unverified / 18 必需场景**，exit 1。新的 `dist/cli/linux-amd64/native-evidence.json` 绑定当前 SHA；旧报告保存在 `native-evidence.before-http.json`，不再作为当前候选证据。未验证项仍为另一用户、偏好浏览器外部 fixture、完整真实 Core 命令族、包/快照、浏览器隔离外部 fixture、真实 TLS fixture。另行实际通过的浏览器/合同测试没有被手工写成协调器外部结果。

用新报告实际调用打包工具再次被 exit 1 拒绝：`native evidence contains failed, skipped, missing or duplicate scenarios`。未生成正式归档。Windows 仍无固定 Go 工具链的完整原生协调器报告，手工执行不冒充它。

原跨平台变更受影响的八项（5.1–5.5、6.1、6.4、6.5）已依据本次对应复验恢复；另一普通 SID、真实 Windows symlink、UNC 共享、实际 Core/Agent `AGENT_READINESS_TIMEOUT` 及其基线复现、完整同一 Core 验收与正式发布任务继续保留。完整历史见其报告。HTTP 成功不豁免这些门禁，也不豁免 HTTPS 正反例。

两变更严格 validate 与 `git diff --check` 已通过，最终任务和报告收尾后再次核对。不改变主规格，不归档。

最终日志：Linux Go `/tmp/piwork-http-go-final.log`；Linux 浏览器首次/首次串行/最终其余文件分别为 `/tmp/piwork-http-linux-browser.log`、`/tmp/piwork-http-linux-browser-final.log`、`/tmp/piwork-http-linux-browser-final-remaining.log`。Windows 测试目录内的 `http-client-tests.log`、`http-cli-tests.log`、`http-preferences-browser.log`、`http-native-browser.log`、`http-native-browser-final.log` 保留相应结果。这些日志是本机调试记录，不是正式发布证据。
