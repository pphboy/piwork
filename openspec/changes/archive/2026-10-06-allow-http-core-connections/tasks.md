# Tasks

当前完成 **10/10**。2026-10-06 已补齐 Linux 与 Windows 的实际 HTTP 空根命令启动、偏好保存后无参数重启；候选摘要及内嵌资源匹配，详见 [验证报告](verification-progress.md)。

按依赖顺序实施。每项只在实现和所属验证都完成后勾选；原生指对应系统实际执行，交叉编译不能代替。当前跨平台变更已有的未验证项和发布门禁继续保留。

## 1. 协调当前变更的协议条款

- [x] 1.1 更新 `support-cross-platform-cli-and-default-desktop` 的 proposal/design、control-cli 与 desktop-webui delta、tasks 中相关协议条款，统一引用本变更的 HTTP(S) 准入；删除远程 HTTP 属于无效地址的条件，保留原优先级/偏好语义及完整需求和无关验收。验证：两变更相关条款一致，分别严格 validate 通过；受影响的旧勾选项先标为待复验，不删除另一 SID、真实链接或正式发布的未完成记录。（CLI-CORE-PROTOCOL-001、CLI-DESKTOP-001、DWUI-001）

## 2. Go 客户端统一协议准入

- [x] 2.1 调整 `DesktopCoreURL` 只复用既有 Core origin 语法，移除 HTTP 的 host 位置约束和不再使用的 import；同步 resolver、偏好输入/存储测试。验证：HTTP IP/域名/IPv6 与 HTTPS 正例、非法 origin 负例、参数/环境/偏好/凭证优先级、安全已有 HTTP v1 读回及保存/清除测试通过，损坏/锁/权限/未知提交等原失败语义保持。（CLI-CORE-PROTOCOL-001、DWUI-001）
- [x] 2.2 移除 Desktop 启动及 `switchCore` 的重复远程 HTTP 拦截，连接输入统一使用协议准入结果，保留 API 错误码和本地授权。验证：默认/显式 HTTP 启动、HTTP 连接切换、不可达时离线界面、HTTP/HTTPS 同 host/port token 不复用、同 origin 复用、错误 Host/Origin/CSRF 及 400 拒绝测试通过；保存偏好不改变当前身份/Inspect，帮助/版本/空 JSON 不新增 I/O。（CLI-CORE-PROTOCOL-001、CLI-DESKTOP-001、DWUI-001）
- [x] 2.3 移除 `runUserProxy` 的远程 HTTP 拦截，复用原 HTTP/TLS transport，并补齐协议相关网络回归。验证：已认证 HTTP Core 的 capability、HTTP、WebSocket（包括受限 CONNECT）、PAC、WebDAV 实际网络测试通过；未认证/能力缺失及非许可目标/开放 CONNECT 仍拒绝；HTTP/TLS 分支、可信 HTTPS 成功及不受信任/过期/错名拒绝不回退的断言通过。（CLI-CORE-PROTOCOL-001、CLI-SERVICE-PROXY-001）
- [x] 2.4 更新 `docs/cli-platforms.md` 和受影响 CLI 说明，列出 HTTP 默认/显式 Desktop、proxy、参数/环境/保存配置的用法，解释 HTTP/HTTPS 是用户选择的不同 origin；协调原生验收说明使 HTTP Core 能用于 HTTP 场景且 HTTPS 正反例仍单独执行。验证：示例匹配入口和测试，没有远程 HTTP 禁令、额外许可开关或平台特例，没有声称关闭 TLS 校验或完整发布已通过。（CLI-CORE-PROTOCOL-001、CLI-DESKTOP-001、CLI-SERVICE-PROXY-001）

## 3. WebUI 配置与反馈

- [x] 3.1 移除 `apps/desktop-webui/src/adapter.ts` 偏好输入的 HTTP loopback 限制及 HTTPS 必需文案，保留原状态与格式校验；更新浏览器负例为真实非法 origin，并增加 HTTP 保存/读取/清除、当前连接切换及状态断言。验证：Desktop 类型检查和偏好浏览器测试通过；远程 HTTP 可提交，格式错误保留输入且不写入，原加载/等待/未确认只读核对/晚响应/独立动作和 Inspect 保留测试通过。（DWUI-001、CLI-CORE-PROTOCOL-001）
- [x] 3.2 使用既有 Desktop 构建/同步入口生成内嵌资源，并验证浏览器与 API 使用一致的 HTTP(S) 准入。验证：生成资源不含旧远程 HTTPS 必需文案，实际 Desktop 浏览器流程覆盖 HTTP 切换、离线保存、读回/清除及本地授权拒绝；保存后当前 Core、凭证和 Inspect 不变，正常反馈仍按既有等待与短提示规则呈现。（DWUI-001）

## 4. 集成与实际产物验证

- [x] 4.1 运行 `go test -mod=readonly ./...`、Desktop 类型检查及受影响浏览器/进程套件、客户端构建/验收工具回归。验证：原业务输出、退出码、Desktop 恢复/退出及 proxy 行为保持；HTTP 失败按实际网络/鉴权结果报告，TLS 负例及原本地安全负例无必需 skip，未改动 Core/Console 部署行为。（CLI-CORE-PROTOCOL-001、CLI-DESKTOP-001、CLI-SERVICE-PROXY-001、DWUI-001）
- [x] 4.2 用现有独立客户端构建入口重建 Linux/Windows 候选，并从非源码目录在对应原生系统运行实际二进制，使用独立配置/端口验证真实 HTTP Core 的 status、默认/显式 Desktop、本地授权后的匿名连接状态、HTTP 偏好保存→退出→无覆盖新进程启动及 open 恢复。验证：候选摘要与内嵌 UI 匹配，保存不改当前连接，重启使用 HTTP 默认值；记录实际 Windows/Linux 结果及命令，缺失网络/账号/可信 HTTPS fixture 如实未验证，不把旧候选结果绑定到新文件。（CLI-CORE-PROTOCOL-001、CLI-DESKTOP-001、DWUI-001）
- [x] 4.3 形成本变更验证报告，更新跨平台验证记录中的受影响结果/候选身份，并根据实际复验恢复对应任务状态；分别执行两变更严格 validate 和 `git diff --check`。验证：每个本变更场景有实现与结果映射、相关条款无旧 HTTP 禁令；历史失败/缺 fixture 保留，HTTP 成功未被用于豁免 HTTPS 或原跨平台发布门禁，主规格未被提前同步、变更未擅自归档。（本变更全部需求）
