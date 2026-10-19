# Design

## Context

动机及已确认范围见 [proposal.md](proposal.md)。本设计基于当前源码与有效主规格：

| 当前事实 | 来源 | 设计影响 |
| --- | --- | --- |
| 三个入口各自建立 listener/信号处理 | `cmd/piwork-serve/main.go`、`cmd/piwork-console/main.go`、`internal/cli/user_desktop.go` | 要共享一个 Core 实例和关闭协调器，不能并发调用三个 Entry |
| 两套浏览器资源已经 embed | `internal/consoleassets/assets.go`、`internal/desktopassets/assets.go` | 复用资源构建，调整页面 base path 和 adapter，不重新实现业务 UI |
| Core 在未配置时可监听，runtime 后台准备 | `internal/coreapp/application.go`、`runtime_preparation.go` | 引导可以在 admin/model/Docker 缺失时工作 |
| ADMIN env 已与模型 env 分组解析；bootstrap 在事务中拒绝非空用户表 | `internal/coreapp/serve.go`、`internal/identity/users.go`、`docker_initialization_test.go` | 保留两项可选 ADMIN 的成本小；网页和 env 共享 bootstrap |
| 管理模型及引用式 runtime API 已有 | `internal/coreapp/model_admin_http.go`、`http.go`、`apps/console-webui/src/app.ts` | 引导只做流程编排，Test 不作为保存门槛 |
| Desktop 使用进程级 identity 和本机 ticket | `internal/cli/user_desktop.go`、`user_desktop_api.go` | 托管模式必须换成按浏览器会话解析的身份，不能共享 CLI credential store |
| Service 使用 `s-*.desktop.localhost`，Core gateway 已检查所有者和端口 | `internal/cli/user_desktop_service.go`、`internal/coreapp/service_gateway.go` | 远程入口由服务器提供，继续经 Core 授权，不直接暴露用户容器端口 |
| Docker Core 使用 host 网络、同绝对路径 bind、Unix socket | `Dockerfile.core`、`deploy/docker/docker-compose.yml.template`、`internal/workruntime/runtime.go` | 首版沿用 Linux 编排、路径和 mTLS，不引入 Windows Core |
| 发行材料仍围绕 Core/CLI 两入口及五个必填初始化变量 | `scripts/docker-quickstart-content.mjs`、`build-docker-release.mjs`、`sync-docker-website.mjs` | 构建身份、健康检查、模板与官网必须一起调整 |

本变更显式调整 NATIVE-001/003、SUI-001/002、CORE-DOCKER-INIT-001、BSA-001/003 和 Docker 默认终端交付约束。旧的“Console 独立 HTTPS 进程”“Desktop 只能本机访问”“五个必填初始化 env”不再约束新的统一入口；CLI 本地模式和历史发行材料保留各自适用范围。

## Goals / Non-Goals

**Goals:**

- 一次启动一个 Linux Go 服务端；同机和其他电脑只通过浏览器完成初始化及完整工作流。
- 默认仅凭 IPv4/IPv6 服务器地址使用，不依赖通配 DNS、公共 IP 转域名服务、浏览器扩展、客户端代理或 CLI。
- Agent 镜像随服务端版本内嵌，是程序默认值；引导、Runtime 管理与统一启动均不让用户填写或覆盖。
- 保留现有身份、所有者鉴权、异步 Operation/Run、文件条件写入、快照和正常关闭恢复语义。
- 页面共享任务与登录入口，身份、授权、上传/下载暂存和缓存仍有明确归属。
- 拆分应用存活、初始化完成、基础 Work readiness、完整依赖 preparation、具体 Work 能力。

**Non-Goals:**

- Windows Core、远程 Docker Engine、自动安装 Docker、新数据库/历史格式、自更新及任意第三方站点的无条件兼容。
- IP 模式首版不提供 document.cookie/Cookie Store 透明兼容，也不保证脚本自行写入浏览器 Cookie 的跨 Service 隔离；不为此引入脚本注入、Cookie shim 或 DNS 前置。
- 为本次整合更换 UI 技术栈、整体重写界面或引入新的全量组件规范执行项目。
- 自动 push 镜像、发布官网、归档当前变更或回填旧制品身份。
- 公网连通性、仅公网网卡及实际 IPv6 网络实测；本变更必做网络验收为通配监听后经局域网或独立客户端网络中的实际非回环 IPv4 访问，IPv6 地址格式与来源解析保留单元/契约覆盖。

## Decisions

### D1. 统一进程和可组合 Handler

保留 `cmd/piwork-serve` 为服务端构建入口，实际发布的 `piwork` 与 `piwork-serve` 是同一个程序的名称/链接。无参数和 `serve` 都启动统一应用；显式 status/admin/config 等命令仍进入现有 `internal/coreoperator`，用户 login/chat 仍属于 `piwork-cli`。新默认发行不要求独立 `piwork-console` 二进制或 CLI 容器。

提取薄的 `internal/app` 启动协调与 `internal/webapp` 浏览器入口层（名称可按实现习惯调整），让 Core 暴露可组合的业务 Handler/生命周期。Console/Desktop 的 HTTP 逻辑改为可复用 handler，旧 CLI 本机模式使用自己的身份适配器，托管模式使用会话适配器。两者共享业务动作与渲染契约，不复制 Core/Agent 实现。

一个应用生命周期持有 store 锁、Core、浏览器入口、Service 入口和后台准备；入口绑定失败须有界回收本次资源。拒绝用三个 Entry/goroutine 或子进程拼装，因为原 Entry 各自拥有信号处理、全局身份及退出语义。

建议页面路由为 `/` 工作台、`/setup` 引导、`/admin/*` 管理。用户 CLI 的 `/api/v1/*` 和 operator `/control/*` 契约保留，新增浏览器 API 独立命名，避免侵占应用根路径或把 operator 权限发给浏览器。旧管理深链接在新管理前缀下有明确映射。

### D2. 零必填环境的启动配置

服务端默认监听 `0.0.0.0:7171`，这属于显式选择统一服务端入口的产品行为；原 ParseListen 的受保护调用及高级明文 opt-in 不能被全局放宽。默认 HTTP 允许 IP 试用；HTTPS 支持显式证书/私钥及受信反向代理。HTTP 与 HTTPS 使用不同 origin/会话，HTTP Cookie 不伪装成 Secure 或使用无效的 `__Host-` 前缀，HTTPS Cookie 使用 Secure。部署材料说明 HTTP 和 HTTPS 的实际连接方式，不能声称自动获得可信证书。

原生新安装默认使用当前有效用户的持久数据目录（例如 `os.UserConfigDir()/piwork/server`）；容器继续使用 `/var/lib/piwork/quickstart/core` 同路径 bind。启动输出有效访问地址，禁止输出 `0.0.0.0` 为浏览器链接；多网卡/NAT 可用 `--public-origin` 覆盖显示及来源绑定。无 GUI 时输出 URL；浏览器打开失败不终止服务。已有安装通过 `--data-dir` 使用原目录，不自动迁移到新路径。

基础网络验收使用默认 `0.0.0.0` 监听，在另一电脑或独立客户端网络通过服务器实际非回环 IP 访问主站及 Service；基础场景不预填 `--public-origin`，不要求公网地址、实际公网连通或物理远程主机。通配地址是绑定地址，不是浏览器 URL 或任意 Host/Origin 授权；现有精确来源、CSRF 和会话边界保留。NAT/受信代理仍使用明确的 origin 配置并记录其实际边界，既有高级夹具不替代基础默认路径证据。

非业务部署参数使用默认值及显式 flags，例如 `--listen`、`--data-dir`、`--public-origin`、`--docker-context`/`--docker-host`、TLS 参数；发行引用内嵌，默认安装不要求 `PIWORK_RELEASE_CONFIG_PATH` 或旁置 JSON。只保留 ADMIN 两项作为用户业务初始化环境变量；模型及 Agent/helper 环境初始化入口删除。标准系统/网络环境、构建用变量、独立 CLI 环境与用户 Service 环境不在该删除范围。

Agent 引用属于当前服务端的发行元数据，不是部署输入；统一启动移除 `--agent-image` 及等效覆盖。原有高级 helper 显式配置仍保持其独立契约。原生包和 Docker 镜像都必须实际内嵌对应发行引用，不能只在旁置清单记录，也不能由 UI 填写镜像名补齐。

本机 Engine 默认 Unix socket，并保留显式 context、rootless 和未知目标不 fallback 的规则。移除业务配置 env 不代表忽略 Engine 设施配置；默认官网无需用户提供这些高级输入。

### D3. 首次设置授权与 ADMIN 初始化

空安装生成高熵、限时、单次的 setup 证明，通过启动终端输出一次性设置链接的 fragment 提供给安装者；只保留摘要及必要过期/代次状态，不复用 operator credential。网页先移除 fragment，再兑换受限 setup 会话；公开缺项状态不泄露凭证。允许本机 `piwork setup link` 在持相同安装锁/可信控制面权限后轮换链接，便于容器后台运行时恢复，不读取用户 CLI token。

设置会话只授权创建首管理员，不授权模型/Work/文件操作。网页提交和 env 调用同一个 `Identity.Bootstrap`，在提交事务核验用户表仍为空；并发至多一个成功。管理员创建成功后废止全部 setup 证明并进入正常登录；账号禁用、密码重置或模型移除不能重开 bootstrap。

ADMIN env 两项都不提供时进入网页创建；成对有效时在空安装创建持久账号并进入普通登录，仍需网页配置模型。缺一、空值或非法值给出字段名称和安全错误；不输出值。不因重启时合法 env 改变而更新已有账号。模型旧变量和别名不再读取、验证或形成配置；存在时至多报告已废弃的变量名称，不能回显值或保留自动迁移解析器。已有持久模型继续读取。

### D4. 引导是现有配置 API 的编排

公开页面仅报告“需要初始化/需要登录”和应用存活；管理员登录后展示 Docker 检查、模型配置、Runtime 保存、后台依赖准备、完成五个阶段。普通用户看到管理员正在配置的真实状态，不获得配置 API。

模型表单复用四项连接输入（ID/API type/Base URL/Key），名称可选，Test 可选。保存完整模型后使用返回的 modelRef 和内嵌 Agent 引用提交现有 runtime selection；两个已确认步骤分别记录，第二步失败时复用已保存模型，不自动重建模型或重复发送未知写入。Test 不改变模型和默认值，供应商认证失败不注销管理员。

Agent 镜像是硬性的发行默认值。引导、Runtime 管理页及复用 Console 页面只读展示已保存或当前发行镜像，不出现输入框、选择器或“高级镜像覆盖”。从旧 `/runtime` 深链接进入 `/admin/runtime` 也遵守相同规则。新建和显式保存全局 runtime 时由可信服务端取得当前内嵌引用；如适配既有 DTO 携带 agentImage，受信适配层自动提供并核对一致，不接受浏览器自定义的不同引用。现有低层 operator/用户 CLI 契约保留，不据此为统一启动或网页恢复手填入口。

发行引用缺失/无效时报告制品配置错误；拉取失败显示实际 preparation 与重试/运维恢复，不要求用户更换镜像。故障验收通过隔离 Engine/registry 夹具产生，不能保留产品覆盖控件来支撑测试。读取既有 runtime 如实展示其持久值，仅重启、升级或打开页面不自动重写；显式保存使用当前发行默认，已有 Work 继续按原配置与显式 Update/Apply 运行。

引导从 Core 实际持久状态与 preparation 快照推导，不能仅靠浏览器 `completed=true`。关闭、刷新、返回、服务器重启后读回已确认状态；密码与 Key 不进入 localStorage/草稿记录。首次配置不自动创建 Work、不自动调用计费模型；新 Work 沿用默认配置的既有一次性 seed，旧 Work 不受全局默认变化影响。

### D5. 托管浏览器会话

采用 Console 已有的服务端不透明 Cookie 会话模式，抽出通用会话服务；每个浏览器登录独立保存 Core 用户 token、userId、角色、到期及 CSRF。浏览器看不到 bearer；当前 Cookie 不是进程级“当前用户”。登录页的 challenge、失败限流、容量上限和绝对到期复用现有边界。

每次业务请求以该会话主体调用/校验 Core，角色只决定是否有管理入口。上传暂存、快照传输、已知 ID 记录、Service grant 和活动流均绑定 installation/user/session，禁止使用共享 CLI credential store。服务端模式不展示 Switch Core、本机 Browser access required 或 CLI open/logout；CLI 模式仍保留原有行为。托管模式的 Inspect 在已登录会话私有暂存中执行，保留格式校验和不执行包内容；既有 CLI 继续提供匿名离线 Inspect。

Sign out 只撤销当前浏览器对应平台会话及其派生授权；密码重置/禁用按既有 Core 规则影响该账号会话。注销和服务器重启不取消已接受的 Operation/Run。服务器重启可要求浏览器重新登录，不能复用旧 Service 临时 grant。

### D6. IP-only Service 独立端口与服务端 Cookie jar

同 IP 下不同端口能隔离 DOM、localStorage 和浏览器允许注册的 Service Worker，但浏览器 Cookie 不按端口隔离。HTTP IP 默认不是安全上下文，不能承诺 Service Worker 可用。因此不能简单把 `s-*.desktop.localhost` 改成 `server-ip:port` 并原样转发 Set-Cookie；也不能把所有应用放进平台同源子路径。

选择最小方案：“统一进程管理的 Service 独立入口端口 + Go 标准 net/http/cookiejar”。处理上游响应 Cookie 的常规登录，明确保留脚本 Cookie 限制，继续统一启动与远程工作台实施：

- 默认入口池建议为 17891–17954，可用参数配置；这是 Piwork 网关的 listener，不是 Docker 用户 Service 的 HostConfig.PortBindings。Linux host 网络下无需另建容器或代理程序；默认部署材料明确池的网络可达要求。
- 每个有效浏览器会话/Service/声明端口分配一个独立入口，绑定当前安装、所有者、Work、Service、声明端口和授权代次；浏览器生成的链接使用当前有效服务器 IP（IPv6 使用方括号），不使用 localhost、容器 IP、域名服务或全局服务发现。
- 入口先通过单次 fragment 兑换 grant，浏览器只保存 HttpOnly 的不透明路由 Cookie。只允许自己的已登记 grant；主站和其他入口的 Cookie 即使因同 IP 被浏览器附带，也不得到达应用或成为入口授权依据。平台 API 校验精确 Origin/CSRF，应用源不能借共享 site 发起控制请求。
- 上游应用 Set-Cookie 存入按 browser session/entry/上游逻辑域分区的服务端 Cookie jar，按 Domain/Path/Secure/过期/删除语义处理；发往上游的 Cookie 仅由该 jar 构造，不采用浏览器传来的任意应用 Cookie，也不将上游响应 Cookie 原样写入同 IP 浏览器空间。应用 Authorization 保留；平台 bearer、setup 证明和入口 grant 不转发。
- 不同步 document.cookie 或 Cookie Store 与服务端 jar。依赖脚本读取 CSRF Cookie 再提交请求头等应用不列入透明兼容范围；脚本自行写入的浏览器 Cookie 仍受同 IP 共享主机规则约束，可能被其他 Service 读取、覆盖或删除，也不会被代理采纳为上游 Cookie。此限制明确写在 Service 说明和部署材料，不宣称任意脚本 Cookie 已隔离；无需为这部分兼容继续阻塞一键启动，也不承诺自动识别所有不兼容应用。
- 透传根路径、请求方法/查询/体、HTTP 状态和流式内容，按已授权映射改写必要 Location/Origin/Referer；应用认证失败与平台鉴权失败分开。原 `.work` 稳定逻辑身份不变。
- iframe 和新标签页使用同一入口，正常切布局不重建 iframe。保留应用 CSP/X-Frame-Options；拒绝任意上游目标、不向任意页面注入 Cookie shim 或放宽浏览器安全设置。
- Core 授权代次同时纳入 Work 控制版本、Service 修订、已接受控制操作的持久 epoch、运行实例和 ready 代次，避免相同 IP 的快速停启恢复旧 grant；epoch 与控制意图共用现有事务/元数据表，既有安装无记录时兼容读取。入口数量、过期和清理有界；容量耗尽显示具体状态和恢复，不能复用别人的 origin。关闭/注销、Work/Service 停止、身份撤销时主动断开所属流，沿用两秒撤销目标。应用服务器重启后旧 grant 失效，响应 Cookie jar 和 grant 不跨重启保留。端口 origin 持久绑定逻辑所有者/Work/Service/声明端口，不分配给其他对象，避免旧标签页或 localStorage 被新应用接手；退役绑定计入有界容量，耗尽时维护者显式扩大并放行端口范围。有效旧 grant 在短期内仅能取得含 Work 返回链接的不可用页，未知旧链接不能访问新对象。
- TLS/反向代理模式须覆盖入口池的实际访问能力，不能只验证主站证书；若上游代理只转发主站，须显示部署缺项并给恢复，不能报告完整工作台 ready。

```text
Browser
  +--> server-ip:7171             --> Web session --> Core
  +--> server-ip:17891 (Service A) --> Grant + jar A --> Core gateway
  +--> server-ip:17892 (Service B) --> Grant + jar B --> Core gateway
```

原型验证与本次确定的边界如下。2026-10-19，在 Linux 本机使用非 loopback 数字 IP、默认安全设置的 Google Chrome 155.0.8059.84 和 Microsoft Edge 155.0.4283.62 执行双应用夹具，两浏览器结果一致：

| 路线/场景 | 实测结果与首版处理 |
| --- | --- |
| 原样转发 Cookie | B 可读 A 的脚本 CSRF Cookie，同名登录覆盖使 A 返回 401；不采用 |
| 分区 jar 的同名响应 Cookie 登录、Domain/Path/删除/过期 | 原型检查通过；正式网关仍须按会话和所有者验证 |
| 根路径、跳转、SSE/WebSocket 握手 Cookie、独立标签登录 | 原型检查通过；仍需真实 Core 和独立网络客户端验收 |
| document.cookie 读取及 CSRF 双提交 | jar 中的 Cookie 不向脚本提供，示例提交返回 403；列为已确认不透明兼容项 |
| 脚本写入 Cookie | 另一 Service 可读，且不会进入上游 jar；列为已确认的兼容与隔离限制 |
| DOM/localStorage | 原型检查证明端口 origin 隔离；不代表 Service Worker、安全上下文或平台鉴权已验收 |

夹具为 [prototype/ip-cookie/main.go](prototype/ip-cookie/main.go) 和 [verify.mjs](prototype/ip-cookie/verify.mjs)，原始输出在忽略的 `dist/unify-linux-startup/ip-cookie/result.json`。该次原始 gatePassed=false 和失败项保持原样，不改写为通过；所有者随后明确接受上述首版脚本 Cookie 限制。本原型未验证真实 Core、两秒撤销、独立客户端网络或 Windows 浏览器，任务不因规划调整而自动完成。后续按支持范围验收，脚本 Cookie 场景保留限制复现；支持范围内的安全或功能失败仍阻止交付。

未选择的方案：通配域名依赖 DNS；公共 IP 转域名增加外部服务；平台同源子路径不能隔离 Service Worker/存储且破坏根路径；仅不同端口不处理 Cookie 会串会话。现有本地 CLI 的子域名方案继续存在于其本机模式。

### D7. 健康、关闭及恢复

`/healthz` 继续代表应用存活，新增统一入口可配置状态查询；镜像 liveness 使用存活探针，不能用缺管理员/模型时必然失败的完整 readiness 导致安装反复重建。现有 `/readyz` 与 docker-delivery profile 继续表示基础 Work 和完整依赖就绪，托管 UI 将 Service 入口可达性作为独立能力展示。下载准备超时与镜像重试沿用现有策略，不阻塞引导/状态读。

统一关闭先关闭新浏览器 mutation/入口分配及 Core 准入，再撤销 readiness、断开浏览器流、排空并停止本安装受管 Agent/Service/helper。沿用默认 30 秒 drain、10 秒确认、45 秒 Core 总预算及容器 60 秒 stop 窗口；无法确认停止继续安全非零退出。保留 Work desiredState、enabled 选择、数据卷、对象 ID 与模型配置。关闭浏览器不触发任何服务器停止。

### D8. 发行与材料

Docker 主入口仍基于现有 Core 镜像构建路径，但镜像中包含完整统一服务端和两套 UI 摘要；名称可继续使用发行清单 core 角色，不能据标签名误认是旧 Core-only。CLI/Agent/helper 角色仍有独立身份。默认无参数镜像直接启动应用，不进入 shell、不等待用户尚未完成的 runtime ready 才开放页面。

根 README 以一个固定已发布镜像 Docker 命令和网页步骤为默认；Compose 同样零必填 env，单机示例中 CLI 改为显式可选，不把其启动作为统一应用依赖。默认 Docker 命令须兼顾首次设置链接的可取得方式，采用前台输出示例或明确后台日志恢复方式，不把真实 setup 证明写入静态材料。

Docker run 与 Compose 必须分别在无本版依赖缓存的独立空安装完成零业务 env 的网页首管理员创建、模型/runtime 保存、准备和真实首回复；可选 ADMIN env 路径另行验证。现有 Compose/ADMIN 成功记录不代表 Compose 零 env 已通过，该缺口保持待完成。两种网页入口和原生包均核对保存后的 Agent 引用与对应实际服务端的发行元数据一致；使用说明不出现 Agent 镜像输入或覆盖步骤。

源码、build flags、Go binary、两套内嵌资源、发行依赖、镜像与材料保持同输入身份；保留 candidate/published、真实 dirty/hash/digest、不覆盖旧标签和显式发布授权。同步仓库的两语言说明及 `scripts/sync-docker-website.mjs` 指向的官网源码，官网外部仓库写入/发布在 apply 时依已有明确授权范围执行，不在本规划中改动。

## Risks / Trade-offs

| 风险 | 处理 |
| --- | --- |
| IP-only jar 不透明支持脚本 Cookie，脚本写入 Cookie 仍可能跨 Service 串用 | 所有者已接受首版限制；明确说明、不注入 shim、不新增 DNS 前置。保留原型失败，不将已知限制作为一键启动阻塞；平台鉴权、响应 Cookie 分区和来源隔离仍须通过 |
| Service 入口池需要多个可达 TCP 端口，防火墙/代理可能只开放主站 | 命令、Compose、UI 能力状态及远程实测一起覆盖；容量明确、有界，端口不是用户容器直出 |
| 默认 HTTP 与现有独立 Console 强制 TLS 不同 | 明确修改 SUI 约束与 Cookie 策略；HTTPS/反向代理单独验收，不虚构自动可信证书 |
| 进程级 identity 残留导致跨用户访问 | 以请求上下文和会话适配器替换全部共享状态；两账号、多窗口、并发传输及晚响应测试 |
| 引导某一步已写入但下一步失败/响应丢失 | 分阶段读回已确认模型/runtime，保留原 ID，不自动重复创建/提交 |
| 引导与复用 Runtime 管理页的 Agent 默认行为不一致 | 统一使用服务端随版本内嵌引用，移除全部网页及统一启动 Agent 覆盖；分别验收引导、管理页与旧深链接保存结果 |
| 默认路径变化导致误建空安装 | 输出实际路径；升级材料要求显式复用原路径；同目录锁、不扫描接管其他安装 |
| 旧 Go 数据与旧模型环境同时存在 | 保留持久配置，旧变量仅安全提示名称，不覆盖或要求重输 Key；记录撤除配置方式 |
| 重构影响原生 CLI、旧 Desktop 的本机授权 | 通过独立适配器保留 CLI 语义并运行对应测试，不能把服务端授权规则全局套用到 CLI |

## Migration Plan

1. 以已确认的独立端口与服务端 jar 边界继续统一进程和会话实现；复用双应用夹具验证支持范围并记录脚本 Cookie 限制，保留旧 CLI 路径的测试。首版不再以解决脚本 Cookie 透明兼容作为统一启动前置。
2. 同步 HTTP 契约及生成代码、两套 UI/内嵌资源、原生程序与镜像构建；不得只重建前端而交付旧 Go 资源。
3. 新安装使用默认路径和网页引导；升级现有 Go 安装先正常停止旧入口，复用原数据目录及匹配 Work 卷，再启动统一程序。原 operator 命令仍可诊断。
4. 更新部署模板并删除模型 env 传递；已有存储模型直接使用，不重新初始化。旧 CLI 凭证仍归 CLI，托管网页要求独立登录，不导入客户端 token。
5. 回退仅在存储格式兼容且可关闭新入口时使用旧程序/镜像；否则恢复一致的 Core 数据与匹配卷。不能把 `.work` 导入称作保留原 ID 的安装回滚。
6. 本地候选通过空安装、远程真实浏览器、真实模型和关闭恢复验收后供审阅。公开镜像推送、Release/官网发布另行执行用户明确要求的发行流程。
7. 本次复核后的调整重新验证通配监听加实际 IP 路径、移除 Agent 手填/高级覆盖及 Compose 零 env 初始化；历史候选与验收记录保持原样，修改后的二进制、UI、镜像和材料按新实际输入重建与记录，不沿用旧制品身份冒充新验收。
