# Design

## Context

动机见 [proposal.md](proposal.md)。当前业务客户端 `ParseCoreURL` / `Client` 已支持 HTTP(S)，HTTP transport 禁止环境代理与自动重定向；proxy 的 `dialCore` 已按 Core scheme 选择普通 TCP 或 TLS，HTTP、WebSocket 和 WebDAV 不需要新增后端。

实际拦截分散在五处：`DesktopCoreURL` 拒绝非 loopback HTTP，`runUserDesktop` 重复拒绝，`switchCore` 重复拒绝，`runUserProxy` 拒绝，以及 adapter 偏好输入校验/文案拒绝。偏好的输入、磁盘读回和启动 resolver 都经过 `DesktopCoreURL`，所以仅删除启动检查不能闭环。

当前工作区已经包含 `support-cross-platform-cli-and-default-desktop` 的未提交实现。它的 control-cli delta、desktop-webui delta、design 和文档仍规定远程 HTTPS；本变更明确替代这条策略，保留该变更的默认路由、地址优先级和偏好语义。主规格的 CLI-DESKTOP-001 与 CLI-SERVICE-PROXY-001 同样需要修改。

## Goals / Non-Goals

**Goals:**

- 用户给出合法 HTTP(S) origin 后，所有客户端入口采用一致的协议准入，配置来源及宿主平台不改变准入结果。
- 用已有 HTTP/TLS 传输完成启动、连接、偏好持久化和代理流程，保持原身份与失败语义。
- 同步冲突条款，重新构建并记录新候选身份，避免旧规格或旧验收证据恢复限制。

**Non-Goals:**

- 不改变 Core API/部署、Console、系统证书信任、服务端证书或内部 TLS。
- 不引入 allow-http/insecure 开关、协议自动探测、HTTP/HTTPS 自动跳转或自动失败回退。
- 不修改 Service 目标 URL 的 http/ws 白名单、CONNECT 限制、本地监听、Host/Origin/CSRF、Cookie、凭证 ACL/锁及平台发布安全门禁。
- 不修复既有 Agent Ready 超时，也不将原跨平台变更未完成的另一 SID、真实 symlink 或正式发布验收计为完成。

## Decisions

### 1. 删除协议位置约束，复用已有 origin 语法

`DesktopCoreURL` 保留原输入错误类型及规范 origin 输出，只使用既有 `ParseCoreURL` 的语法校验，不再用 `IsLocalCoreHost` 判断 Core 协议。Desktop 当前连接切换使用相同校验结果；启动和 proxy 删除重复的远程 HTTP 拦截。

保留 generic resolver 与 Desktop resolver 的区别：它们的优先级和偏好参与范围没有变化。相对优先级仍由已有实现决定，而不是为了统一协议把所有命令改为读取 Desktop 偏好。帮助/版本/空 JSON 的提前返回也保持。

采用现有 parser 是因为此次变化只是允许已支持的协议用于更多入口。只放行 192.168 网段、增加 OS 特例或增加 opt-in flag 都会制造额外准入规则；重写 URL parser 会扩大格式与规范化兼容范围，均不采用。

### 2. 默认配置沿用 v1，不迁移或联动当前连接

偏好文件仍为 `<credential-parent>/desktop/preferences.json` 的 `{version:1,coreUrl:...}`，维持 64 KiB、严格字段、非阻塞锁及原子发布。安全的已有 HTTP v1 记录现在可以读取，文件缺失/格式损坏/宽泛 ACL 的行为仍沿原规则处理，不自动重写旧文件。

UI 删除 HTTP loopback 判断，并将格式错误提示改为只说明合法 HTTP(S) origin。配置输入规则仍拒绝其他协议、userinfo、路径、query 与 fragment，服务器为最终校验者。修改生成资源须走既有 Desktop 编译/同步脚本，不直接修补嵌入 JS。

状态过程保持：合法输入进入 saving/clearing，成功后确认保存值；只修改下次默认值。提交前拒绝保留旧值；响应丢失/提交后未确认进入 unconfirmed，GET 核对后才恢复，不重复 PUT/DELETE。读回和晚响应不覆盖后续编辑。未设置/损坏恢复、退出保留及匿名 Inspect 行为保持。

### 3. 连接与凭证按完整 origin 隔离，TLS 仍按 URL 执行

`SameCoreOrigin` 与原 Core/user key 继续含 scheme 和 host/port。HTTP、HTTPS 即使使用相同 IP/port 也不是同一 origin；切换仍撤销旧身份派生的内容、传输与观察，复用仅限新 origin 的匹配凭证。保存偏好不触发该切换。

`Client`、二进制下载、流和 proxy TLS handshake 不添加 `InsecureSkipVerify`、定制信任根或 HTTP fallback。选 HTTP 走原 HTTP/TCP，选 HTTPS 继续校验证书。凭证不能经未确认重定向、环境代理或旧 Core 内容流进入另一目标。

错误契约保持：非法调用/CLI 地址 exit 2，损坏已存偏好启动 exit 1；连接输入 400 `INVALID_CORE_URL`，偏好输入 400 `INVALID_DESKTOP_PREFERENCES`。合法 HTTP 后发生网络错误仍按所属命令现有 network/API error 和退出码处理；Desktop 可离线启动，不预先要求健康/登录成功。此变更不扩展通用网络错误的诊断格式。

### 4. 先协调并行 artifacts，再应用本变更

实施的首项任务修改当前跨平台变更中相关的 proposal/design/control-cli delta/desktop-webui delta/tasks：移除远程 HTTP 属于无效地址的条件，声明本变更的统一协议策略，保留原需求全文及无关验收。相关验证报告保留旧结果作为历史事实，新增结果绑定新的候选摘要；受代码变化影响的已勾选项须重新验证后才能继续算完成。

本次 propose 只创建本 change 的 artifacts，不提前改其他变更或主规格。实施后的两个 delta 应能按原跨平台变更先、本变更后的顺序同步主规格；两者重叠的 Desktop 条款必须一致，不能让后续归档回写旧限制。主规格同步/归档仍属于对应后续工作流，不在 apply 中擅自归档。

### 5. 使用合同测试与候选进程结果分别验证

| 层次 | 必需覆盖 |
| --- | --- |
| Go 地址与存储 | HTTP IP/域名/IPv6、HTTPS、格式负例，参数/环境/偏好/凭证选择；已有 HTTP v1 读回、保存/清除及 scheme 不同不复用 token |
| Desktop API/UI | HTTP 切换、离线保存/读回、不改变当前连接/Inspect、非法地址/本地授权拒绝；原 loading/等待/未知结果/晚响应状态保持 |
| proxy 网络 | HTTP Core service capability、应用 HTTP、WebSocket（含 CONNECT）、PAC、WebDAV；原目标白名单/鉴权/文件降级保持；HTTPS handshake 正反例不回退 |
| 原生候选 | 重建实际 Linux/Windows 二进制并验证内嵌 UI；使用真实 HTTP Core执行 status、本地 Desktop 授权与匿名连接状态、保存后重启使用 HTTP 默认值 |
| 已有回归 | `go test -mod=readonly ./...`、Desktop 类型检查及受影响浏览器/进程测试，相关构建与验收工具测试、两个变更的严格校验 |

真实 HTTP Core 可用地址为本次用户提供的 `http://<core-host>:7171`，属于验收 fixture 而非产品默认值。采用独立配置路径及新空闲端口，避免改用户已有登录/偏好与 Desktop 进程。该地址已从 Windows 原生 exe 查询成功，尚不代表 Linux 或新二进制已经验收。

HTTPS 测试需分别保留有效链/主机名成功与不受信任/过期/错名拒绝的断言。测试进程可使用专用信任 fixture 验证传输，不改变产品的系统信任行为；真实候选仍须使用原生系统信任。缺少真实账号、可达性或可信证书 fixture 时如实记未验证，不能借 HTTP 成功宣称原跨平台发布已合格。

## Risks / Trade-offs

- [只改一处检查会在切换或下次启动时再次拒绝] → 五处统一调整，验证保存→读回→退出→新进程启动和完整 proxy 网络路径。
- [同 host/port 的协议切换借用旧凭证] → scheme 参与 origin 比较的正反例及服务器收到的 Authorization 断言，维持原身份撤销规则。
- [修改偏好校验顺带关闭 HTTPS 验证或扩大代理目标] → 不改传输策略，单独执行 TLS 负例和非许可 Service/CONNECT 拒绝测试。
- [并行 delta 与旧产物证据不一致] → 实施首项协调条款；构建新候选、更新摘要与结果，不复用旧 hash 的通过记录，不放宽打包证据检查。
- [HTTP 是用户明确选择的传输] → 按输入执行 HTTP，文档如实说明该协议的传输属性，不新增启动确认或客户端网络位置判断。

## Migration Plan

1. 协调两变更相关条款，实施 parser、入口、API 和 WebUI 的协议准入调整。
2. 更新测试与说明，重新构建两平台候选并取得与摘要匹配的实际结果；原发布门禁继续生效。
3. 旧凭证与偏好无需迁移；现有 HTTPS 用户的地址、认证和传输不变。新 HTTP 默认值正常参与原优先级。
4. 回滚二进制会重新恢复旧版远程 HTTP 限制；已保存 HTTP 偏好可能被旧版拒绝，但不应被删除。用户可显式使用合法 HTTPS/loopback 地址覆盖并恢复自动选择。

没有需要推迟到实施阶段决定的产品或架构问题；环境可用性只影响实际验收结果，不改变以上范围。
