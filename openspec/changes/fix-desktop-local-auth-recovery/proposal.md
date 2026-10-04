# Proposal

## Why

Desktop 的一次性启动链接失效后，用户停留在 `Open a fresh launch address`，账号登录及注销均被本地授权拒绝。实测还发现旧 ticket 会中断有效浏览器会话恢复、错误登录表单可见，以及正在运行的实例缺少可用的重新打开入口，基础登录链路需要闭环。

## What Changes

- 分别表达浏览器本地授权、Core 用户会话和连接状态；先核验已有本地会话，旧启动链接不阻断有效会话，不展示无法提交的账号登录表单。
- 增加 `piwork-cli desktop open [--port <port>] [--no-open]`：为当前系统用户拥有的既有 Desktop 签发新启动链接并默认打开浏览器，不新增监听实例、不重启 Core/Work。
- 增加 `piwork-cli desktop logout [--port <port>]`：通过可信本机通道清理指定 Desktop 的当前 Core 登录和派生访问，浏览器 Cookie 丢失时也可执行；区分本地已清理和远端撤销未确认。
- 在已获本地授权的界面保留正常 Sign in/Sign out，并提供经确认的 `Reset browser access`，结束该实例全部浏览器授权但保留 Core 登录；未授权页面只提供检查本地授权、复制实际端口恢复命令和清理命令说明，不能凭匿名请求清除 CLI 登录。
- 明确启动 ticket 的五分钟、一次性和重新签发规则；可在同一 CLI 进程中重复授权不同浏览器，既有有效浏览器会话不因签发新 ticket 失效。
- 覆盖过期、重放、CLI 重启、Cookie 丢失、响应丢失、CSRF 拒绝、远端离线及身份切换晚响应，构建并交付 Go 内嵌资源。

### 范围与非目标

交付范围为 Go CLI 本地 Desktop 服务、浏览器认证交互、测试和使用文档。保留现有 Linux 原生宿主范围及桌面 Chrome/Edge 验收范围；不新增 Windows/macOS 原生宿主支持、自动授权浏览器、公网分享、平台登录持久化格式或 UI 重设计。不修改 Core 账号认证、Pi Agentd、Work 生命周期、`.work` 格式、Service 转发或外部 WebDAV 认证协议；恢复不自动重发用户业务修改。

## Capabilities

### New Capabilities

无；扩展现有能力。

### Modified Capabilities

- `control-cli`：增加既有 Desktop 的可信重新打开和实例注销命令，规定参数、退出码及独立于 Core 凭证的本地控制边界。
- `desktop-webui`：补齐本地授权初始化、错误恢复、账号登录及注销与结束浏览器访问的用户流程。
- `work-access`：明确启动授权与 Core 会话的独立性、同用户本机控制、浏览器撤销及匿名拒绝边界。

## Impact

- Go：`internal/cli/user.go`、`user_desktop*.go`；扩展 Linux 本地控制及启动 ticket 管理，复用安全凭证的条件清理规则。仅增加 CLI 本地接口，不增加 Core API。
- 浏览器：`apps/desktop-webui/src/adapter.ts`、`app.ts` 和必要的局部样式；分别跟踪本地与平台认证状态，所有晚响应受身份及视图归属约束。
- 测试与交付：Go CLI 进程/安全契约测试、Desktop 原生路由浏览器测试、真实 Core 验收、`internal/desktopassets/static` 和 `docs/webui-integration.md`。
- 持久数据：控制通道仅含短期本机控制资源，不将授权 ticket 写入 Core、Work 或凭证文件；既有登录文件保持版本与结构不变。
- 原 `desktop` 的启动和端口占用契约保持；新增 `open`/`logout` 子命令具有独立语义。注销仅针对所选实例捕获的当前 Core 会话，条件清理不得删除另一进程新保存的登录。
