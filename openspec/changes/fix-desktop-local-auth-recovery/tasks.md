# Tasks

## 1. 可信实例控制与命令入口

- [x] 1.1 在用户 CLI 语法/帮助中增加 desktop open/logout，按 design 在凭证加载与 Core 解析前分流；对应 CLI-DESKTOP-002/003，测试默认/自定义端口、重复/非法 flag、--core/--json 拒绝、help 无 I/O、损坏或不同配置不阻断恢复，并在 docs/webui-integration.md 记录命令与退出码。
- [x] 1.2 实现同 UID 的私有 Unix 控制目录、端口锁、元数据及 socket 生命周期；对应 WACC-DESKTOP-001，测试目录/文件权限、链接/错误对象拒绝、活跃实例不被清理、崩溃残留恢复、旧实例 inode 条件清理，以及控制启动失败无 HTTP 半启动实例。
- [x] 1.3 实现十秒/16 KiB 单请求控制协议、双向 peer UID 与 version/port/instance 验证，连接数限制为 16 并在容量满时安全拒绝；对应 CLI-DESKTOP-002/003 与 WACC-DESKTOP-001，测试未知/重复字段、尾随 JSON、超限、超时、代次错配、UID 校验拒绝，真实同 UID 进程完成 RPC，更新文档说明同用户权限边界。

## 2. 新启动授权与实例注销

- [x] 2.1 统一 startup/open 的 ticket 签发与原子兑换，保留五分钟一次性、十二小时会话、128 个上限；对应 CLI-DESKTOP-002，测试重签失效旧未兑换 ticket、不撤销有效 Cookie、并发兑换仅一次、随机失败不消费、容量回收/拒绝、CLI 重启旧权限失效。
- [x] 2.2 接入 open 子命令的实例重签、启动链接输出与浏览器打开；对应 CLI-DESKTOP-002，真实进程测试不变 PID/端口/Core、不同目录/环境可用、实例不存在 exit 4、浏览器启动失败仍可手动打开、Ctrl+C 不停止实例，核对输出无 Core token 和普通日志无 ticket。
- [x] 2.3 提取浏览器/Unix 复用的有界实例注销，落实捕获身份、先撤销本地内容访问、远端五秒尝试、条件磁盘清理及清理失败重试记录；对应 CLI-DESKTOP-003、DWUI-001/015，测试成功/已无效/离线/响应丢失/存储失败、拒绝未完成清理时新登录、重复 logout、并发其他 CLI 新凭证与新身份晚响应，记录平台与本地结果边界。

## 3. 浏览器初始化与认证恢复

- [x] 3.1 将 adapter 本地授权和 Core identity 分开，先读 session 再按需兑换 ticket，专门处理 LOCAL_BOOTSTRAP_DENIED；对应 DWUI-001/014，原生 Desktop 路由浏览器测试有效 Cookie 加旧 ticket、无 Cookie/五分钟过期/已使用 ticket、CLI 重启及兑换成功后真实账号登录。
- [x] 3.2 接入检查去重、epoch/认证检查序号、失败后显式检查、CSRF 拒绝后的只读核验、兑换响应丢失及 Cookie 拒收说明；对应 DWUI-014，浏览器测试不重放 mutation/bootstrap、晚响应不污染新身份/草稿/锁、初始化失败仍可检查、Core 离线不变本地授权失效。
- [x] 3.3 修改原认证页、顶栏和账号菜单，显示 Checking browser access/Browser access required/连接不可用及当前端口的复制命令；对应 DWUI-001/014，测试未授权无 Account/Sign out/Inspect/已知操作、有效授权仍可无 Core 登录 Inspect、命令端口正确、键盘/live status/窄屏可操作，更新文档的故障与恢复流程。

## 4. 浏览器访问重置与撤销

- [x] 4.1 增加受 Cookie/CSRF/Host/Origin 保护的 browser-access/reset 和独立 local-access generation，撤销所有本地会话、票据、派生授权和临时资源，保留平台凭证；对应 DWUI-015/WACC-DESKTOP-001，测试授权确认、匿名/跨站/Service 拒绝、旧 Cookie 与票据失效、平台 token/Work 状态不变、临时资源安全清理。
- [x] 4.2 对内容请求、WebDAV、Run 观察接入有界取消登记与响应发布前代次检查，复用 Service 会话检查；对应 DWUI-015/WACC-DESKTOP-001，测试 reset/会话过期后两秒内流关闭、旧内容不得返回、新授权恢复、已经提交/接受业务不被描述为回滚，覆盖原 Service/WebDAV 安全回归。
- [x] 4.3 接入 Reset browser access 的影响确认、等待/防重复/结果核对，统一 Sign out 的平台/磁盘结果及终端清理说明；对应 DWUI-015，浏览器测试取消无 mutation、重置影响全部窗口但保存登录保留、正常 Sign out 可再次登录、无 Cookie 经 logout→open 可登录、清理晚响应不复活旧视图，更新文档三种动作的影响表。

## 5. 集成交付与验收

- [x] 5.1 构建 Desktop 并同步 Go embed，执行 Desktop typecheck/test:browser、相关 Go CLI/client/静态资源测试、make build-go 和规格严格校验；对应全部要求，验证实际 native 二进制提供新恢复 UI/命令且无需 Node 运行时，两套 UI 既有回归不受影响。
- [x] 5.2 在隔离真实 Core/CLI 中完成首次登录、旧链接重复打开、无 Cookie 重签、实例 logout 后重登、浏览器重置、Core 会话撤销及离线恢复；对应全部场景，实测 Chrome/Edge 当前验收版本，保留 Work/Service/WebDAV/Run 连续性和不重发证据，明确模拟/真实证据边界，不改用户 tmux 4 的测试环境。

## 6. 验证发现的修复与回归

- [x] 6.1 修复认证检查跨代次复用：检查去重及 session 读取必须绑定当前 epoch/认证检查序号，登录后的连接检查不得等待或复用已失效的旧检查。对应 DWUI-001/014；扩展浏览器并发测试，延迟旧检查并完成新登录，断言新身份保留、Works 实际加载成功、无错误 list-error，旧结果不覆盖草稿或释放新锁，登录 POST 不重发。
- [x] 6.2 修复 Service 活动连接的撤销时限：本地会话过期或 Reset 后，连接取消不得等待 Core service resolve 完成；对应 DWUI-015/WACC-DESKTOP-001。通过实际 HTTP SSE/WebSocket 连接测试，在后台解析阻塞时重置授权，断言客户端与上游在两秒内关闭，旧授权不可续用，Core 凭证与 Work 运行目标保持，新授权可恢复访问。
- [x] 6.3 补齐已接受 Import 的会话过期恢复验收：实际提交一次 Import，取得并保存原 Operation ID，观察期间令 Core 会话失效，再以同一账号登录；对应 DWUI-001。断言恢复并查询原 ID、Import POST 始终一次、无需新本地 ticket；同步最新 Go embed/native 构建，执行上述回归、相关 Go/browser 测试与严格规格校验，更新验收记录并区分受控故障与真实 Core 证据。
- [x] 6.4 修复业务 401 回查与重新打开初始化的竞态：对应 DWUI-001/014，旧业务请求的认证回查不得破坏更新的认证恢复流程；初始化因身份清理而失效时，必须由有效检查接管，或进入可显式检查的恢复状态，不得滞留 Checking browser access、无限循环或依赖未启动的后台定时器。保持真实 Core 会话失效后的内容清理、本地授权与平台身份独立、旧结果不得清除新身份/草稿/锁，以及不自动重发登录、bootstrap 或业务修改的约束。
- [x] 6.5 补齐该竞态的确定性回归与交付验收：固定旧业务请求收到 401、回查等待、新初始化等待、旧回查返回推进身份代次、新初始化返回的交错顺序，断言有效 Cookie 能进入可提交的账号登录页，旧回查不能清除更新的身份；复测实际 Go Desktop 在 Core 离线时终端 logout 后再 open 的既有标签页恢复，保持现有五秒验收，不通过延长超时或强制整页刷新掩盖竞态。同步 Desktop Go embed/native 构建，执行完整 Desktop 浏览器、相关 Go 与严格规格校验，更新 docs/webui-integration.md 的验收结果并区分受控故障与真实 Core 证据。
