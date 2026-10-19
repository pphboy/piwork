# Tasks

2026-10-19 复核后更新：必做网络验收采用通配监听后经实际 IP 访问，不要求公网实测；Agent 镜像是随版本内嵌的程序默认值，统一启动和所有相关网页均不提供手填、选择或高级覆盖。受新约束影响的任务及 Compose 零 env 验收缺口重新置为待完成；已有证据只按其原候选身份及实际覆盖范围使用，不改写历史结果。

## 1. 验证 IP-only Service 首版支持范围与已知限制

已确认采用独立端口与服务端 Cookie jar；脚本 Cookie 透明兼容及脚本写入 Cookie 的跨 Service 隔离不属于首版保证，不再作为第 2–5 组统一启动、引导和工作台实现的前置阻塞。原型失败保留原样，本次规划调整不自动勾选任务。

- [x] 1.1 维护 D6 双应用夹具，按首版支持项与已知限制分别验证同名 Set-Cookie、document.cookie/CSRF、删除/过期、根路径及 WebSocket 握手 Cookie；验证：真实 Chrome/Edge 经服务器 IP 记录版本及结果，响应 Cookie 支持项须通过，脚本读写/CSRF 限制保留可复现结果与说明，原始 gatePassed=false 不改写为通过，不以首页或单例 HttpOnly 登录代替。证据：[Service Cookie 原型验证](evidence/service-cookie-prototype.md)。
- [x] 1.2 验证恶意 Service 读取平台凭据/其他服务端 Cookie 分区、DOM/localStorage、允许注册时的 Service Worker、跨端口调用平台 API、重放 grant 和旧端口复用；验证：负向场景拒绝越权，SSE/WebSocket 在撤销后按两秒目标断开，HTTP IP 的 Service Worker 不可用如实记录，脚本自行写入 Cookie 的已知串用不误报为已隔离，无 DNS/客户端代理依赖。
- [x] 1.3 按 BSA-003/BSA-004/BSA-IP-001 固化支持与限制矩阵；验证：必要事实归本变更、临时输出在 dist/，记录脚本 Cookie 限制及原型实际覆盖范围；该限制不阻塞一键启动，平台鉴权、响应 Cookie 分区或支持协议失败仍须修复，不追加 DNS 前置或注入 Cookie shim。

## 2. 统一程序与启动生命周期

- [x] 2.1 提取 Core、Console/Desktop 的可组合 Handler 和统一启动协调，保留一个 Core/store 所有者；验证：Go 测试覆盖单进程启动、部分 listener 失败回收和同目录第二实例拒绝，不通过调用三个 Entry 拼装。
- [x] 2.2 支持 piwork/piwork-serve 无参数或 serve 启动完整应用，保留 operator 子命令及用户 CLI 分工；验证：进程测试覆盖默认启动、help/version 无网络、status/admin/config、错误 login/chat 入口与原退出语义。
- [x] 2.3 核对默认持久目录、通配监听、有效访问 URL、no-open/公开 origin/TLS 等参数，移除统一启动的 `--agent-image` 及等效 Agent 覆盖，实际内嵌同版发行引用；验证：监听 `0.0.0.0` 后从独立客户端网络经实际非回环 IP 访问，基础场景不预填 public-origin、不输出通配地址或客户端 localhost；保留空目录、非源码 cwd、端口冲突、打开器缺失和 IPv6 URL/来源单元覆盖，不要求公网或实际 IPv6 网络实测，不放宽精确 Host/Origin/CSRF。
- [x] 2.4 合并关闭协调与健康/就绪接口，保持 Core drain/停止/恢复预算；验证：缺管理员/模型时 health 和页面可访问而 readiness 非 ready，SIGTERM 后本安装容器停止、数据/意图保留，故障关闭安全非零退出。
- [x] 2.5 随启动变更更新双语原生入口/运维说明和嵌入资源构建映射；验证：已记录命令与实际 help/路径一致，资源来自同一输入，node scripts/check-native-boundary.mjs 与相关构建测试通过。

## 3. 网页首管理员与可选 ADMIN env

- [x] 3.1 新增限时一次性 setup 证明、兑换会话和安装者链接取得/轮换入口，绑定来源/CSRF并排除普通日志；验证：Go 契约/负向测试覆盖匿名、过期、重放、错误来源、容量和证明不泄漏。
- [x] 3.2 网页和 env/operator 复用首管理员创建事务，初始化后撤销全部 setup 授权；验证：网页/网页、网页/env 并发最多一个成功，已有用户或管理员禁用不重开，旧证明不能用于管理或 Work API。
- [x] 3.3 保留独立两项 ADMIN 环境解析及原校验，删除模型/镜像 env 初始化和别名，保留持久模型；验证：docker_initialization/settings 测试覆盖无 env、有效成对、部分/空/非法 ADMIN、重启不覆盖、旧模型变量不被读取采用且不泄漏值。
- [x] 3.4 实现首次设置页面、普通登录和证明过期/响应未知恢复，复用现有组件及英文文案；验证：Playwright 覆盖无 env 创建、env 跳过创建、刷新/重启及密码不持久化，浏览器无需 CLI open。
- [x] 3.5 同步初始化 HTTP DTO、生成代码及测试/自动部署说明；验证：make generate 后契约/跨语言检查通过，文档默认流程无必填 env，ADMIN 示例使用合成值，现有 Go 数据初始化测试不退化。

## 4. 模型与 CoreRuntime 引导

- [x] 4.1 统一引导页、Runtime 管理页和复用 Console 页的 Agent 发行默认行为，移除镜像输入框、选择器和高级覆盖，由可信服务端自动取得并核对随版本内嵌的引用；验证：在已有模型、尚无 runtime 的安装分别通过 `/setup`、`/admin/runtime` 和旧 `/runtime` 深链接选择模型保存，无须输入镜像，结果与实际服务端内嵌发行引用一致；浏览器不同引用不能覆盖默认，保留自定义模型、四字段、无 Provider/模板/重填 Key、普通用户拒绝及旧模型复用覆盖，显式保存不隐式修改已有 Work。
- [x] 4.2 分开记录模型保存、runtime 绑定、Test 和 preparation 结果，未知修改先读回；验证：延迟/丢响应夹具证明模型不重复创建、Test 失败不禁止保存、不自动请求模型或创建 Work。
- [x] 4.3 基于 Core 持久状态和准备快照恢复引导，提供 Docker/镜像失败与重试反馈，移除依赖产品 Agent 手填入口的故障驱动；验证：以隔离 Engine/registry 故障夹具覆盖默认 Agent 拉取失败及恢复，发行引用缺失/无效提供安全错误而不让用户手填；保留刷新、离开重返、重启、已保存模型不重复创建、旧代次晚结果隔离及密码/Key 不进入浏览器存储。
- [x] 4.4 迁移管理页到统一路由并保留旧深链接映射和后续配置入口；验证：路由/前进后退/360px/键盘测试与现有 Console 测试通过，全局修改不隐式改变已有 Work。

## 5. 托管工作台会话及完整功能

- [x] 5.1 提取按浏览器会话解析的身份适配器，复用正常 Core 登录/管理员校验，保留 HTTP/HTTPS Cookie、Origin/CSRF、限流和容量策略；验证：两账号/两浏览器并发测试，网页无 bearer，用户不能进管理区或读取他人 Work。
- [x] 5.2 将文件/图片/包/Inspect/快照传输及已知操作资源绑定安装/用户/会话；验证：跨身份读取/清理/上传拒绝、过期回收、并发晚响应、空间/容量失败、下载校验和目标不覆盖场景通过。
- [x] 5.3 接入托管 Work/Chat/Files/Settings 全流程并按模式移除本机 ticket、Switch Core 和 CLI 恢复控件；验证：远程 Playwright 覆盖实际创建/生命周期、Chat 设置与图片、Files 条件写入、Save/Apply、包与快照，不出现客户端 localhost。
- [x] 5.4 实现当前浏览器注销、账号撤销、重启后登录及原 Operation/Run 只读恢复；验证：独立登录不互相注销，撤销断开所属内容流，未知写入不重发，浏览器关闭不停止远端执行。
- [x] 5.5 为原生 piwork-cli desktop/proxy 保留独立本机适配器和凭证/偏好/匿名 Inspect；验证：现有 CLI/Desktop 测试、make build-cli、相关平台检查通过；Windows 原生运行未执行项如实保留，不以交叉构建代替。

## 6. 落地远程 Service 网关

- [x] 6.1 按 D6 实现有界入口池、授权映射、有效服务器 IP/IPv6 URL、按浏览器会话/Service 分区的 Go 标准 Cookie jar 和会话回收，出站 Cookie 仅取当前 jar；验证：覆盖容量、并发、旧链接、端口复用、同名响应 Cookie 及浏览器 Cookie 不被混入，不新增用户 Service Docker 端口绑定，不实现脚本 Cookie 同步/shim。
- [x] 6.2 对接现有 Core service gateway 的所有者/声明端口/代次鉴权，保持 HTTP/根路径/Location/Authorization/SSE/WebSocket；验证：真实 Service 集成测试覆盖应用 401、平台鉴权、跳转、流式往返及两秒撤销目标。
- [x] 6.3 接入预览、新标签页、嵌入拒绝回退和已有 Focus/Chat 布局；验证：真实浏览器证明同一入口/iframe 与应用登录保留，CSP/X-Frame-Options 未削弱、opener 隔离、无代理/DNS 要求。
- [x] 6.4 更新远程端口、HTTP/HTTPS/受信代理、失败恢复及 Service 说明/UI 能力状态，明确脚本 Cookie 兼容与隔离限制；验证：从独立客户端网络检查完整入口池、TLS/代理和仅主站放行的负向场景，未通的 Service 不显示已就绪；限制说明可见、不要求自动识别所有不兼容应用，不把应用 CSRF 403 当作平台注销。

## 7. Docker、发行身份与默认安装材料

- [x] 7.1 修改 Dockerfile.core 默认入口为统一应用，携带两套 UI/默认依赖及应用 liveness，保留同路径 bind/host 网络/socket/60 秒关闭；验证：镜像入口/资源/协议静态检查和空安装 smoke 证明无需 env 或第二容器即可打开网页。
- [x] 7.2 重新构建并核对修改后的原生包、统一 Docker 镜像、两套 UI、内嵌 Agent 发行引用及候选材料身份，区分统一 core 与可选 CLI；验证：build-docker-release、stage-go-release、publish-preflight 相关检查绑定实际二进制、UI/hash 和对应 Agent 元数据，原生/容器首次保存结果一致，无旁置 Agent 配置或用户覆盖，真实记录新输入及制品身份，预检不执行 push。
- [x] 7.3 同步双语 README、原生/部署手册、默认 Compose、单机示例、模板及官网可审阅材料，说明通配监听后通过实际 IP 访问、Agent 随版本内置且无手填/覆盖步骤，CLI 显式可选、默认零业务 env；验证：Quick Start/官网一致性检查及对应测试通过，保留主站/Service 端口、首次设置链接、脚本 Cookie 限制和数据保留说明，不新增公网实测前置。
- [x] 7.4 更新官网同步/检查脚本及双语首页、Quick Start、安装、First Work、源码导航和当前下载材料的可审阅输出；验证：使用合成 candidate 连续同步 A/B 后无旧当前引用，历史下载身份不改，仓库/官网一致性检查通过，不推送镜像或发布官网。

## 8. 跨组件验收与交付核对

- [x] 8.1 从无本版依赖缓存的独立空 Linux 安装，分别完成默认 Docker run 和可选 Compose 零业务 env 的网页首管理员创建、模型/runtime 保存、准备、Work 创建及真实首回复，原生统一程序和可选 ADMIN env 路径各自验证；验证：通配监听后从另一电脑/独立客户端网络经实际 IP 完成规定工作流，核对默认 Agent 发行引用及受支持 Service、Files、配置/包和快照，不要求公网实测；必须补齐 Compose 零 env 独立证据，不能以 Compose/ADMIN 或 Docker run 零 env 记录代替，不将已确认脚本 Cookie 限制计为支持项通过。
- [x] 8.2 验证已有 Go 安装重建和失败恢复，覆盖两个用户、撤销、Core 正常关闭/重启、缺模型/Docker/镜像网络故障和旧 CLI 并存；验证：账号/模型/Work ID/历史/卷/意图保持，不重提未知修改或接管其他安装，Windows 浏览器/真实模型未执行项明确列出。
- [x] 8.3 按修订后要求重新核对整体构建、契约、文档路径、候选身份和规划一致性；验证：npm ci、make build、make test、相关 integration/Playwright、原生边界、仓库文档与 Quick Start 检查按实际影响通过，git diff --check 和 OpenSpec strict 校验通过；新增通配监听/IP、无 Agent 手填及 Compose 零 env 证据与修改后候选绑定，旧记录不改写为新结果，必要证据归本变更且无真实秘密。

验收对象、发行身份、执行结果及未测边界见 [Linux 统一启动验收](evidence/unified-startup-acceptance.md) 和 [Service 支持与限制矩阵](evidence/service-support-matrix.md)。Windows 原生、物理远程 host 网络及公共发布均未冒充已验收。

本次修订后的通配监听/IP、Agent 发行绑定及 Compose 零 env 补验见 [修订后补验](evidence/revision-acceptance.md)。前轮证据按其原候选身份保留。
