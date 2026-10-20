# Tasks

## 1. Core HTTP 契约与领域边界

- [x] 1.1 在既有 `/control/status` 增加准确的 `hasUsers` 投影，保留基础状态和 preparation 语义；验证空安装、已有用户、禁用管理员、未配置 Runtime 和 Docker 不可用的 HTTP 契约，不能以启用管理员数重开创建入口。
- [x] 1.2 为既有 `/control/admin/bootstrap` 增加本次进程的单用途初始化委托，与 operator/env 共用原子空集合约束；测试并发首次创建、已有用户拒绝、错误路由拒绝、旧进程委托失效及凭据不进入响应/日志，验证不新增 Core 路由或 operator 广泛授权。
- [x] 1.3 在公开客户端/DTO 中表达状态和初始化调用，普通登录、`/me`、注销、admin runtime/defaults 复用已有 API；涉及生成契约时执行 `make generate` 及对应跨语言契约测试，核对未知创建响应只能只读确认、不能自动重发。

## 2. 同进程双服务与 ControlPlane 调用

- [x] 2.1 改造 `internal/app` 和 `internal/coreapp` 的 listener/lifecycle 组合：默认 UI `0.0.0.0:17891`、Core `127.0.0.1:17871`，增加独立 `--core-listen`，Core 支持显式可达地址；测试两端口冲突、参数错误、数据锁冲突、通配/IPv6 地址与原子清理，更新命令帮助和对应双语原生启动说明。
- [x] 2.2 改造 `internal/webapp`，分离浏览器 origin 与 Core URL，移除 Core 对象/handler 和生产 `HandlerTransport` 注入；通过实际 TCP Core 完成登录、首次创建、状态、Runtime 和用户/管理请求，验证关闭 TCP 后不能凭共享对象继续业务。
- [x] 2.3 替换直接 Identity/WatchSession 调用，按会话去重使用已有 HTTP 身份接口和 Core 流撤销能力；测试禁用/密码重置/注销、短暂断网、会话容量、未知写入及两秒活动流撤销，验证错误不会恢复 Access 门禁或泄漏用户 token。
- [x] 2.4 为 ControlPlane 注册明确的页面/API/内容/探针路由，移除 `/api/v1/*`、`/control/*` 通配 passthrough；测试原始 Core 路由不能从 UI 端口直接执行、伪造 Host/Forwarded 不改上游、Core 不提供网页或接受 UI Cookie。
- [x] 2.5 统一两个 server 的异常退出、readiness 撤销和有界关闭，保留 Core 正常停止受管 Work 与恢复意图；以进程/集成测试覆盖任一 listener 异常、SIGTERM、重复信号和启动中退出，确认只执行一份关闭流程、总预算及锁释放正确。
- [x] 2.6 固化依赖边界检查，确保网页业务包不导入 Core/store/identity 实现且组合根之外不使用进程内 Core transport；以检查器测试和实际 HTTP 集成测试共同验证，更新 AGENTS.md 的当前双服务架构说明，不新建开发文档目录。

## 3. 原生客户端直连与现有独立入口

- [x] 3.1 将用户 CLI、Desktop 默认 Core、operator 和独立 Console 的默认上游改为 `17871`，保持显式参数/环境/偏好/凭据优先级与 origin 绑定；运行 `internal/client`、`cli`、`coreoperator`、`consoleapp` 相关测试，覆盖旧保存地址不可达时不静默改连。
- [x] 3.2 验证 CLI/operator 直接连接真实 Core，用户、管理员、operator 和初始化委托不能互相代用；覆盖状态、登录/退出、Work 操作和 operator 管理，不依赖 ControlPlane 页面/Cookie，在线未知结果不转离线或重发。
- [x] 3.3 保留独立 Desktop Host 路由、CLI proxy/PAC/WebDAV 和本机恢复命令；运行相关现有测试，验证与新 Core 配合及同机 17891 冲突时仍用显式 `--port`，同步高级客户端双语使用说明和示例。

## 4. 托管 Service 同端口路径入口

- [x] 4.1 在 ControlPlane 增加 `/services/<workId>/<serviceId>/<port>/` 的目标解析与普通会话认证，复用 Core Service 元数据/resolve/gateway；测试多 Work、多 Service、多端口、他人目标、未知目标、编码分隔符/双解码/点段逃逸和应用路径与平台路径同名，验证无额外 listener 或 Docker 地址直连。
- [x] 4.2 复用并拆分现有 Desktop 代理中的协议能力，保留原始 path/query/body、应用 Authorization、流式与错误标记，规范传递前缀并处理 Location；测试根相对/相对/绝对/已带前缀跳转、外部来源、SSE、WebSocket 首帧与双向帧，确认凭据过滤和两秒撤销不退化。
- [x] 4.3 保留按浏览器会话和 Service/端口分区的上游 Cookie jar，删除托管跨端口 grant 交换；测试同名 Cookie 登录/删除/过期、两账号并发、平台 Cookie 不进入容器，以及脚本 Cookie 限制，更新 Service 说明为同源可信应用和前缀兼容边界。
- [x] 4.4 更新 Desktop WebUI 的 entry DTO、URL 生成、预览、独立打开、复制、深链接刷新与登录返回，完整保留 basePath；通过 Playwright 覆盖多标签页目标不串用、晚响应不换对象、Focus/布局保持 iframe、CSP 拒绝回退和入口失败恢复，所有网络请求均留在 ControlPlane origin。
- [x] 4.5 删除 `HostedServicePool`、`--service-ports`、托管端口 pin/回收和旧 hosted 假 Core origin/transport 分支，仅保留独立客户端仍使用的逻辑；以引用扫描和新旧模式测试证明没有托管回退，旧参数安全报错且旧派生目录不被继续读取，不删除 Work 持久内容。

## 5. 官方 Web 环境、模板与迁移

- [x] 5.1 适配 `deploy/images/web-base/tools/piwork_web_runtime.py` 与 `page-client.js`，统一动态前缀的资源、版本、反馈、下载和 Socket.IO 路径；运行 Web base 工具测试及实际前缀浏览器夹具，验证前缀只加一次、内部 `/health`/`/pi/v1` 和无前缀独立 CLI 入口仍可用。
- [x] 5.2 更新默认 web-app/工作站模板及相关脑包 SKILL/Reference，提供请求级 URL helper 和按身份/Service 分名的非秘密草稿；测试深层页面刷新、API、反馈、自动版本采用、两个应用草稿及身份切换，不在源码中持久写入服务器 IP 或目标 ID。
- [x] 5.3 同步 Web base 双语说明的前缀支持、同源信任和旧应用边界，构建真实本地 base/脑包候选并记录固定输入/镜像身份；验证源码、工具、模板与候选引用一致，不把未发布 tag/digest 写成已公开正式默认，不自动推送。
- [x] 5.4 用支持前缀的真实模板 Work 完成 Stop/Export/Inspect/Import/Start，再从新目标路径操作应用；核对包格式、捕获镜像及用户字节不变，资源/API/WebSocket 和业务数据实际可用，并验证合法旧根路径包仍按原安装契约处理、不被自动替换镜像或改写代码。

## 6. 部署、探针与候选材料

- [x] 6.1 同步 `Dockerfile.core`、默认 Compose/模板和健康检查到 ControlPlane 17891，CLI readiness 到 Core 17871；保留 host 网络、同路径数据、Unix Engine 和 Agent 7172 mTLS 回连，验证真实容器连接，不以关闭内部 RPC 达成“浏览器单端口”。
- [x] 6.2 更新 `examples/single-host` 与双语部署手册，明确默认 Core loopback、远程/bridge CLI 的显式监听、Service 前缀和独立 Desktop 端口冲突；实际核对示例地址可达及 CLI 无 Engine/安装数据权限，保持 ADMIN 可选、模型网页配置和固定 Agent 默认。
- [x] 6.3 更新 quickstart/官网生成源、模板及一致性检查，覆盖 17891/17871 分工、无旧 Service 端口池、TLS/代理路径和候选身份；执行 `node scripts/check-docker-quickstart.mjs`、`node --test scripts/check-docker-quickstart.test.mjs` 与相关生成器测试，在隔离目录生成双语官网预览，不部署外部网站或把新说明配给旧发布镜像。
- [x] 6.4 重建两套 WebUI、嵌入资源、Go 服务端/CLI 和受影响的候选镜像/脑包；执行相关构建、原生边界与文档路径检查，核对版本/commit/dirty/input hash 及实际候选引用，保留历史发布身份，README 继续保持当前精简入口。

## 7. 跨组件验收

- [x] 7.1 在独立原生 Linux 安装通过通配监听和实际局域网 IP 验证零业务 env 创建管理员、密码确认、普通登录、Quick setup 和真实准备反馈；浏览器网络仅放行 17891，保留请求记录证明 UI/文件/图片/事件/Service 不访问 Core、旧端口池或容器。
- [x] 7.2 分别用实际候选 Docker run 与 Compose 的独立空安装完成零业务 env 网页配置、首条真实模型回复及完整工作台流程；真实模型读取本机私有 `.env.test` 中的测试配置并通过 API/页面保存，不恢复产品模型 env，不输出 Key，不用 ADMIN env 记录替代零 env 验收。
- [x] 7.3 在同一候选验证两个用户、多 Service 的响应 Cookie/授权、前缀资源、业务 API、HTTP/SSE/WebSocket、反馈、文件条件写入、包及导出导入；记录同源可信与脚本 Cookie/旧根路径限制的实际行为，支持范围内失败不得改写成已知限制。
- [x] 7.4 从独立客户端网络显式连接可达 Core 17871，验证 CLI 登录/Work/Service/文件/包/会话与 operator 的原身份规则；同时运行浏览器仅连接 17891 的流程，确认两种入口指向同一个 Core、彼此不借用会话，CLI 不依赖 ControlPlane 代理。
- [x] 7.5 验证正常退出停止本安装全部运行 Work/Service、持久意图和数据保留、重启恢复及旧会话失效；覆盖异常 listener 退出和旧端口/旧链接失败路径，只清理本次精确 installation 标签资源。
- [x] 7.6 执行变更影响到的完整 Go/浏览器回归、构建与材料检查，核对最终候选和验收身份一致；验收事实归本 change、临时输出归 dist，分别标明 Linux/Windows 浏览器与原生 CLI 的实际证据，未测目标不宣称通过，不执行外部发布。

## 8. Verify 后续处理（WARN 2、3 与 SUGGESTION）

- [x] 8.1 在隔离且无本版依赖缓存的 Engine 上，分别完成 Docker run、Compose 零业务 env 安装至真实模型回复，记录依赖从本地测试 registry 拉取及固定镜像身份；不触碰现有安装和外部 registry。
- [x] 8.2 在同一新候选的真实 Service 前缀下验证页面自动采用新版本、草稿与路径保留、另一应用不重载，并记录新旧运行版本与网络请求证据。
- [x] 8.3 清理旧托管端口池错误文案，重建 WebUI 嵌入资源及受影响候选，核对输入/镜像/材料身份并更新本变更验收事实；该阶段尚未处理的 WARN 1 由第 9 节补验。

## 9. Verify 后续处理（WARN 1）

- [x] 9.1 在独立客户端网络命名空间以 IPv4/IPv6 出站规则仅放行目标 ControlPlane 17891，核对真实 Core 17871 在管理侧可达而客户端被拒；完成零 env 引导、真实回复、配置 Save/Apply、文件/图片、多个 Service 的 HTTP/认证/SSE/WebSocket、账号隔离及 Stop/Export/Inspect/Import/Start，记录网络/候选身份并清理本次资源。
- [x] 9.2 修复验收复现的配置读取与 Save 上下文目录锁竞争，保留安装独占锁、路径校验和原子发布；补充并发回归并重建一致的新候选，以新候选完成 9.1。
