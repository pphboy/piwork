# 核验报告：allow-http-core-connections

日期：2026-10-05。使用 `openspec-verify-change`，schema 为 `spec-driven`。本次核验读取 proposal、design、tasks 和全部两份 delta specs，并检查实现、测试、候选与现存原生记录。本报告为独立核验，不修改实现、任务勾选或主规格，不归档。

## 结论与评分

**发现 1 项 CRITICAL、0 项 WARNING、1 项 SUGGESTION。HTTP 支持的实现与四项需求意图一致；任务 4.2 尚未完成，不能宣称变更已全部核验或可归档。**

| 维度 | 检查结果 |
| --- | --- |
| 完整性 | Task Completion：9/10，任务 4.2 未完成。Spec Coverage：4/4 项 ADDED/MODIFIED 需求找到实现；无 REMOVED/RENAMED。 |
| 正确性 | Requirement Implementation Mapping：4/4 项找到对应实现，未发现本次协议变更的意图偏离。Scenario Coverage：30 个场景均审查并找到代码/测试映射，但整体 **Not verified（部分核验）**：两平台 HTTP 空根命令的实际候选执行未验证，入口表测试不能代替它。 |
| 一致性 | Design Adherence：五项决定与实现及如实保留的验收缺口一致。Code Pattern Consistency：遵循共享 parser、原存储/API/状态模式及资源生成流程，未发现显著偏离。 |

适用检查未完全核验的是 **Scenario Coverage**，原因见 C1。其余检查已执行；没有 Not applicable 项。需求实现存在和代码意图匹配不等于所有实际产物场景已通过。

## 按优先级列出的问题

### CRITICAL

**C1：任务 4.2 的两平台 HTTP 空根命令验收仍未完成。**

- 位置：`openspec/changes/allow-http-core-connections/tasks.md:26`。
- 证据：`verification/native-linux.json:21`、`verification/native-windows.json:21` 的 `http-default-root` 均为 `unverified`，诊断均为默认端口 17891 绑定失败。当前候选的真实 HTTP status、显式 Desktop、匿名状态、默认地址持久化、重启及 open 有通过记录，但不能替代实际执行 `candidate --core <HTTP origin>` 与保存后执行 `candidate`。
- 影响：CLI-CORE-PROTOCOL-001 的“远程 HTTP 地址适用于所有客户端入口”、CLI-DESKTOP-001 的默认启动相关场景，只有入口表/合同测试覆盖了空根命令分支，缺少任务指定的实际候选验收。
- 建议：在 Windows、Linux 各安排默认端口可用的独立验收环境，以独立配置、非源码目录运行上述两种根入口，确认本地授权、选定 HTTP origin、默认地址重启、open 与退出行为；记录候选 SHA 和内嵌 app/adapter 摘要。若候选重建，须将证据绑定新文件。全部通过后再完成任务 4.2，不能只修改勾选或把显式 Desktop 结果改名。核验本身不结束现有用户进程。

### WARNING

无。未发现本次变更的新增实现缺陷、遗漏的协议拦截或明显设计偏离。

### SUGGESTION

**S1：补全复制烟测工具时的期望资源清单。**

- 位置：`docs/cli-platforms.md:181` 只说明提供 `internal/desktopassets/static/browser/app.js`。
- 实际工具：`scripts/clinative/smoke.go:151` 还读取同目录下 `adapter.js`，缺失时会拒绝烟测。
- 建议：文档同时列出当前 `app.js` 和 `adapter.js`，保留对应目录结构及同一次同步构建的约束，避免按文档复制文件时漏掉本次协议实现所在的 adapter。此项是验收文档完善建议，本轮不修改它。

## 需求到实现的映射

| 需求 | 关键实现与核验 |
| --- | --- |
| CLI-CORE-PROTOCOL-001（新增） | `internal/client/http.go:48` 保留既有 HTTP(S) origin parser；`internal/client/desktop_preferences.go:29` 复用 parser，不再判断 host 位置；`internal/cli/user.go:174` 保留不同入口 resolver，`internal/client/credentials.go:136` 的身份比较包含 scheme/host/port。Desktop、proxy 均无远程 HTTP 拦截。`internal/client/http.go:66` 保留正常 transport、禁用环境代理/重定向；`internal/cli/user_proxy_connect.go:132` 保留 HTTP/TLS 分支及正常 TLS 握手。 |
| CLI-DESKTOP-001（修改） | `internal/cli/user_desktop.go:108` 启动流程直接进入原参数、资源、本地监听与授权逻辑；`internal/cli/user_desktop_api.go:401` 切换复用规范 origin，撤销旧身份后仅加载匹配凭证；原本地监听、默认端口、浏览器失败与中断契约仍有测试。HTTP 默认根入口真实执行缺口见 C1。 |
| CLI-SERVICE-PROXY-001（修改） | `internal/cli/user_proxy.go:105` 从原参数检查进入 Core capability 检查；真实非 loopback HTTP fixture 驱动原 HTTP/WebSocket/CONNECT/PAC/WebDAV 测试。Service 目标白名单、文件分支、临时凭据、能力降级和失败退出行为保留。 |
| DWUI-001（修改） | `apps/desktop-webui/src/adapter.ts:125` 偏好输入只检查 HTTP(S) origin 格式；`internal/cli/user_desktop_preferences.go:24` 保留独立偏好接口；`internal/cli/user_desktop_api.go:270` 保留 Origin/授权/CSRF 入口。偏好只影响下次启动，加载、未知结果只读核对、晚响应及 Inspect 保留均有测试。生成 adapter 包含当前逻辑。 |

工作区含先前跨平台变更，不能将相对 HEAD 的全部修改算成本次 HTTP 改动。核验重点是五处准入修改及其回归；原 parser 的既有规范化行为没有被本次重写。

## 30 个规格场景的覆盖

下表的“覆盖”指找到处理代码和对应测试；实际候选与真实部署覆盖范围另列。部分端到端证据缺失时不计为全场景核验通过。

| 需求 / 场景 | 对应测试或实际记录 | 核验结果 |
| --- | --- | --- |
| PROTOCOL：远程 HTTP 地址适用于所有客户端入口 | `TestDefaultDesktopDispatchAndOriginBoundToken`、非 loopback proxy 测试、两个 native JSON | 合同覆盖；真实 status/显式 Desktop 通过，根入口 Not verified（C1） |
| PROTOCOL：地址来源不影响 HTTP 准入 | `TestDesktopResolverPriorityAndBusinessResolverIndependence`、默认入口表 | 覆盖参数、环境、偏好、凭证及业务 resolver 独立性 |
| PROTOCOL：非法地址仍被拒绝 | `TestDesktopPreferenceInputAndOriginValidation`、`TestDesktopHTTPConnectionAndSchemeBoundCredentials`、偏好浏览器非法路径 | 覆盖原错误码、不回退、保留输入 |
| PROTOCOL：HTTP 与 HTTPS 的凭证独立 | `core_protocol_test.go:57` 双向 scheme 切换、同 origin 的 `/me` 认证断言 | 覆盖，不向另一 scheme 发送旧 token |
| PROTOCOL：HTTPS 校验失败保持失败 | `TestCoreHTTPAndTLSValidationWithoutFallback`、现有 Windows HTTPS 负例记录 | 合同覆盖可信成功/不可信/过期/错名；产品无 HTTP 回退 |
| PROTOCOL：HTTP Core 不可达 | 非 loopback 离线 Desktop 进程、偏好离线 API、native-auth 离线恢复 | 覆盖，本地入口仍能启动 |
| DESKTOP：无登录的一键启动 | 默认入口表、`TestNativeDesktopEmbeddedBrowserAndLocalIdentity`、原生匿名 HTTP 记录 | 显式入口覆盖；实际空根入口 Not verified（C1） |
| DESKTOP：打开浏览器失败 | `TestNativeDesktopMissingBrowserOpenerPrintsManualAddress` | 覆盖持续服务与手动链接 |
| DESKTOP：非法端口与端口占用 | 原参数/进程测试及原生烟测 | 覆盖退出码、固定端口不回退 |
| DESKTOP：关闭窗口和退出 CLI | native-auth 重开、原生 interrupt、Desktop 生命周期实现 | 覆盖本地退出与恢复，不取消已接受的 Core 工作 |
| DESKTOP：两种访问命令并存 | Desktop/proxy 独立端口与进程测试 | 覆盖独立本地入口与凭据 |
| DESKTOP：使用远程 HTTP 启动及恢复 | 两个平台 `http-core-connection`、Desktop open 测试 | 显式 Desktop/open 覆盖；实际默认根入口 Not verified（C1） |
| PROXY：curl 使用默认域名 | `TestNativeProxyProcessLifecycleAndFixedPort`、目标转发测试 | 真实非 loopback Core TCP 覆盖 |
| PROXY：浏览器使用 PAC 和 WebSocket | `TestNativeProxyPACIsScoped`、`TestNativeProxyWebSocketAndRestrictedConnect` | PAC 判断及实际 WebSocket 通信覆盖 |
| PROXY：无法启动代理 | 端口/语法进程测试、`TestRemoteHTTPProxyCapabilityFailuresRemainAPIResults` | 覆盖对应退出码、无成功监听输出 |
| PROXY：拒绝开放 CONNECT | `TestNativeProxyWebSocketAndRestrictedConnect` | 覆盖非法字节/Host 拒绝和合法升级 |
| PROXY：同一监听器服务两种访问 | `TestNativeProxyTargetsAndLocalFileCredential`、WebDAV 测试 | 覆盖 service/files 分支及凭据隔离 |
| PROXY：HTTP Core 支持原代理网络路径 | 统一非 loopback fixture 的全 proxy 网络套件 | HTTP、ws、CONNECT、PAC、WebDAV 覆盖；真实部署账号 proxy 不在本次通过范围 |
| PROXY：HTTP 不能绕过鉴权及能力检查 | `core_protocol_test.go:104`、原文件降级测试 | 覆盖 401→3、缺失/不支持 capability→5 和文件单独降级 |
| DWUI：Core 可达但运行环境失败 | 完整 WebUI 状态/能力回归 | 覆盖，不把可达误报为所有功能 Ready |
| DWUI：过期后重新登录 | native-auth 已接受 Import 的会话恢复测试 | 覆盖原 Operation 查询、不再提交 |
| DWUI：切换 Core 或用户 | 原身份撤销、Inspect、会话 epoch 测试及双向 scheme 测试 | 覆盖旧内容/凭据隔离 |
| DWUI：本地授权有效而 Core 会话过期 | native-auth Core 撤销后登录恢复 | 覆盖本地控制会话仍可重新登录 |
| DWUI：本地未授权不能伪装成账号登录 | native-auth Cookie/reset/实际过期、本地安全负例 | 覆盖真实五分钟过期及授权恢复页面 |
| DWUI：登录页面连接远程 HTTP Core | `native-auth.test.ts:174`、当前连接浏览器测试 | 实际 Desktop API/浏览器覆盖 HTTP 切换、登录和离线结果 |
| DWUI：HTTP 默认地址保存并用于重启 | 两个平台 `http-core-connection`、偏好独立性 API/浏览器测试 | 实际保存→退出→无 core 覆盖新进程已通过；根命令形式见 C1 |
| DWUI：读取已有 HTTP 偏好及清除 | `TestDesktopPreferencesExistingHTTPV1IsReadWithoutMigration`、偏好 API/UI | 覆盖无迁移、无隐式重写、清除及 Inspect 保留 |
| DWUI：从 HTTPS 切换到同地址的 HTTP | `core_protocol_test.go:57`、原身份清空流程 | 覆盖 scheme 隔离与内容撤销 |
| DWUI：协议扩展不放宽本地授权 | preferences Host/Origin/CSRF/容量测试、native HTTP 浏览器 | 覆盖在连接/磁盘修改前拒绝 |
| DWUI：HTTP 输入的失败与未知结果 | 偏好锁/坏记录/提交未知测试、preferences 浏览器八项 | 覆盖失败保留输入、只读确认、无自动重发 |

PROTOCOL / DESKTOP / PROXY 分别代表 CLI-CORE-PROTOCOL-001、CLI-DESKTOP-001、CLI-SERVICE-PROXY-001。

## 设计与实现模式

1. **复用语法、移除位置限制**：检查共享 parser、偏好 helper、启动、切换、proxy 和 adapter；没有新增 opt-in、平台或网段特例。
2. **偏好 v1 与当前连接独立**：存储格式、严格读取、锁、原子写及失败语义保留；已有 HTTP v1 读回不改文件。UI 更新仍走既有编译/同步，未直接修改生成脚本绕过构建。
3. **origin 隔离与正常 TLS**：scheme 参与匹配，连接切换先撤销旧身份；普通 transport 与 proxy handshake 保留系统信任、主机名和证书有效性检查。专用 CA 只在测试子进程使用。
4. **并行 artifacts 协调**：跨平台 proposal/design/delta/tasks 已采用统一协议策略，未验证的另一 SID、真实链接、Core/Agent 超时与发布门禁保留；两个变更均未归档，主规格无工作区修改。
5. **合同与实际候选分开**：现有记录区分两平台原生实际执行、专用 TLS fixture 与真实部署环境；空根命令及原发布缺口如实为未验证，没有用 HTTP 成功替代 HTTPS 发布验收。

## 本轮验证与已有证据

本轮重新执行并通过：

```sh
go test -mod=readonly ./internal/client ./internal/cli -run 'Test(DesktopPreference|DesktopResolver|DefaultDesktop|DesktopHTTP|RemoteHTTPProxy|CoreHTTPAndTLS|NativeProxy|NativeDesktop)' -count=1
npm run typecheck --workspace @piwork/desktop-webui
openspec validate allow-http-core-connections --strict
openspec validate support-cross-platform-cli-and-default-desktop --strict
git diff --check
```

这些是重点回归，不冒充重新执行整仓、完整浏览器或实际部署验收。本轮另核对了当前 Desktop 输入 hash、候选文件 hash、build.json 和同步资源：

| 对象 | SHA-256 |
| --- | --- |
| Linux 候选 | `973e0e28d564ecd1ace16f1068dfe11300967fb9181771fee27a5ef769c0fa79` |
| Windows 候选 | `5c62047572bb9afb3bcb2f3ac0de086e7a273020bf1af5cc453aa135f802c750` |
| 当前 Desktop 构建输入 | `31c57ca3104012c29dfb886e025903a4f73cc03884317c6817603630d0a7989b` |
| 同步 app.js | `e4a18292ac33e074408fab5bf779a270d3c4b6b7360fc5ea46f427cb8eb237d4` |
| 同步 adapter.js | `9b1eb1c1ddeffd65a1e9db07bd0a2370d50edcd5240581a1eb463ce70ad198d6` |

以上匹配两个原生 JSON 的候选/UI 记录；本轮没有重建或重新启动候选冒充新一次原生证据。

已直接读取并复核实施阶段日志：Linux 整仓 Go 通过；Windows client/cli 原生整套日志均 PASS，无 SKIP；Windows 偏好八项通过、原生浏览器九项通过且无 skip。Linux 第一次串行全浏览器为 200 pass / 1 fail / 0 skip，其中 native-auth 六项全部通过；修正 R1 测试等待后其余八文件为 195 pass / 0 fail / 0 skip。因此当前测试分组覆盖 201 个不同 Linux 用例，**并非一次 201/201 全通过的执行**。两次早期失败及一次中止的重复测试不计为通过；R1 修改仅增加保存确认完成的等待，保留原断言。

日志路径与原生记录详见 [实施进度](verification-progress.md)，本轮核验读取 `/tmp/piwork-http-go-final.log`、`/tmp/piwork-http-linux-browser-final.log`、`/tmp/piwork-http-linux-browser-final-remaining.log` 及 Windows 临时测试目录的 client/cli/preferences/native-browser 最终日志。

## 实际环境限制与后续

Windows 实际 PE 使用 `http://192.168.14.134:7171`，Linux WSL 实际 ELF 使用已部署的 `http://127.0.0.1:7171`。已有 WSL 直连 LAN 地址的超时不能算通过。真实部署账号的全命令族/包/快照/proxy 和受原生系统信任的 HTTPS 成功 fixture 缺口仍属于并行跨平台验收，专用 TLS 合同测试不替代它们。

原跨平台变更为 23/32；其另一用户、真实 symlink、Core/Agent 基线失败、完整协调器与正式打包门禁未被本次改动豁免。本核验没有把它们新增为本 HTTP 变更的重复任务。

**最终评估：1 项关键未完成任务须在归档前完成；Scenario Coverage 部分 Not verified，具体为 Windows/Linux 当前候选 HTTP 空根命令执行缺失；另有 1 项烟测资源文档建议。没有发现新的代码缺陷，但本次不能给出“全部通过、可归档”的结论。**
