# Design

## Context

见 proposal.md 的问题范围。当前 `runUserDesktop` 为整个进程只生成一个五分钟 ticket；`bootstrap` 兑换后设置进程内会话与安全 Cookie。`DesktopAdapter.initialize` 先兑换 fragment，再查询 session，错误直接终止；`LOCAL_BOOTSTRAP_DENIED` 未纳入恢复分类。`logout` 位于本地授权之后，故无 Cookie 的浏览器无法清理平台登录。

当前 Desktop 的 Core identity、凭证和代次在进程内共享；Sign out 已影响该进程的所有派生内容授权。凭证存储已有 Linux fd-relative 校验和 `ClearSession(coreURL, token)` 条件删除，发布宿主为 Linux。新通道使用现有 Go 与 `x/sys/unix`，不新增运行时/外部依赖。本变更涉及可信本机控制与浏览器状态，design 为必要产物。

## Goals / Non-Goals

**Goals:** 在进程持续运行时恢复本地浏览器授权；正常账号登录/注销和无 Cookie 时实例注销均可执行；保持匿名浏览器不能继承 CLI 凭证、条件清理与晚回调隔离。

**Non-Goals:** 不增加多账号并行 Desktop、不自动授予匿名网页权限、不自动清理另一实例，不调整 Core、Agent、Service 代理或 `.work`；新增命令仅操作所选实例，不以环境 Core URL 重定向目标。

## Decisions

### 1. 两类认证状态独立

Browser access 为 `checking / authorized / required / unavailable`，Core identity 为 `signed-out / authenticated / offline`，分别保存确认时间和错误。Core 的 401/403 清理平台内容及派生授权，但保留有效本地控制会话。只有本地会话核验失败才清除本地 CSRF 并进入 required；Core 离线不被映射为 local required。

初始化先读取 fragment 到内存并立刻移出地址栏，再 GET session。有效则丢弃 fragment 并接纳真实 session；本地未授权且存在 ticket 时兑换一次，然后 GET session 核验。初次 GET 为授权探测，其 401 不应先发布错误页再兑换。网络/格式/来源错误不触发 bootstrap，提供显式只读检查；全部完成后启动会话检查。失败也保留可执行的 Check browser access，由显式检查重建观察；并发读复用同一次请求。

`LOCAL_BOOTSTRAP_DENIED` 转 required 并保留安全错误说明；兑换响应丢失先 GET session，有效则恢复，否则显示 required/连接未确认，不重放 POST。bootstrap 已确认但 GET 显示无 Cookie 时给出 Cookie 未保存提示。普通修改收到 `LOCAL_CSRF_OR_AUTH_REQUIRED` 先 GET session，只更新真实 CSRF，不重发原 mutation；有关失败/未知结果仍按既有动作语义保留，明确本地拒绝不伪装远端已执行。

所有认证读取带 adapter epoch 与认证检查序号；旧请求不得覆盖新身份/授权状态。登录、注销、重置、页隐藏后的本地缓存及观察清理分别处理，不能只改 signedIn。成功兑换不直接设置 signedIn。

备选：保留先 bootstrap 的顺序并仅换错误文案，仍会阻断已有 Cookie；自动重复 bootstrap 无法修复一次性票据且会混淆结果。

### 2. 新命令经同系统用户的 Unix 控制通道

新增 `desktop open` / `desktop logout` 子命令；顶层语法校验后在现有 credential Load/Core Resolve 之前分流，帮助不触发 I/O。默认 port=17891，open 支持一次 `--no-open`，logout 不支持；两个子命令拒绝全局 --core/--json。实例通过当前有效 UID 与端口寻址，因此在不同目录、环境或损坏凭证存在时仍能恢复；当前 Core 只属于服务实例，不由辅助命令重新解析。

固定控制目录 `/tmp/piwork-desktop-<euid>`：目录必须为本 UID 所有、0700、无符号链接，使用持有的 directory fd 执行资源操作，不能跟随替换路径。每个端口具有 0600 普通单链接锁文件、0600 元数据文件和 0600 Unix socket；元数据只含 version=1、port、随机 instance ID、socket 身份，无平台秘密。进程持有非阻塞排他 flock，正常或崩溃后的清理由锁与 fd/inode 校验保护；客户端不竞争服务的排他锁。

现有 HTTP listener 绑定成功后创建控制通道，通道失败必须关闭本次 HTTP listener 并 exit 5，不能留半启动实例；HTTP 端口被占用仍 exit 6，不能碰原实例的控制资源。启动目录/资源不安全时拒绝，不 chmod/删除其他用户对象。锁持有者才可清理核验过的陈旧 metadata/socket；退出只 unlink 本次 instance/inode，不递归删除共享控制目录。锁文件保持用于后续安全复用，不通过 unlink 活动锁制造第二个持有者。

控制协议为单次、换行终止的 JSON：请求 `{version:1,instanceId,port,action:"open"|"logout"}`；每连接请求/响应最多 16 KiB、最多处理一次，连接全过程十秒 deadline，拒绝未知字段、重复 JSON 键、尾随对象及其他 action。双方校验 socket/目录所有者及 Linux SO_PEERCRED UID；客户端校验响应 version/instance ID/port，服务端在执行前比对代次。失败不签发票据、不注销身份。socket 不经 HTTP 暴露，浏览器和 Service 无访问权限。

控制连接最多 16 个，容量满时关闭新增连接并返回安全的通道繁忙诊断（exit 5），既有连接继续；连接完成/失败均释放计数。拒绝未经认证的请求前不能查询 Core 或读取平台身份。

open 响应为当前 origin 的 launch URL；logout 响应为 localCleared、remoteRevocationConfirmed、credentialCleared 和安全错误码，绝不返回 Core token/账号。辅助命令只在主动输出中显示启动 ticket，其余诊断不含票据/路径/身份。成功 open 由辅助命令打开浏览器；失败仅打印手动地址仍 exit 0；Ctrl+C 只关闭辅助连接。

备选：匿名 HTTP reauthorize 会让任意网页继承 CLI 登录；新的 HTTP 密钥/磁盘 descriptor 增加秘密处理与浏览器入口面。当前 Linux 宿主使用用户权限 socket 可直接复用 OS 身份边界。

### 3. 有界、可更新的 ticket

进程仍只保留一个待兑换 ticket，由 startup/open 通过同一锁生成 32 随机字节并设置五分钟期限；后续签发使前一未兑换 ticket 失效，但不改 sessions、Core identity 或其 generation。多个并发 open 最后签发者的链接生效，错误页说明使用最近一次输出；原有效 Cookie 可直接进入。bootstrap 先成功生成 sessionID/CSRF，随后原子消费 ticket 并登记 session；随机失败不消费 ticket。兑换一次与重放拒绝保持。

浏览器会话维持既有十二小时绝对有效期及安全 Cookie，不滑动续期，不改 Secure/HttpOnly/SameSite/Host 隔离。会话注册上限 128 个，签发/兑换先清理已过期会话；容量满返回 503 LOCAL_SESSION_CAPACITY，保留有效会话，票据未消费。返回可执行容量/重置说明，不自动驱逐有效用户。

### 4. 明确三种清理语义

| 动作 | 平台凭证 | 浏览器控制会话 | 派生内容访问 |
| --- | --- | --- | --- |
| Sign out / desktop logout | 清理所选实例捕获会话；有界尝试远端撤销 | 保留 | 撤销该平台身份的全部访问 |
| Reset browser access | 保留 | 撤销该实例全部会话 | 全部撤销 |
| desktop open | 保留 | 保留；新 ticket 可创建新会话 | 不改变已有访问 |

将实例注销的捕获/撤销/远端请求/条件清理提取成现有浏览器 logout 与 Unix action 共用流程。先在锁内捕获 coreURL/token/generation 并撤销内存身份，再释放锁请求远端（五秒上限），最后仅对捕获 token 执行现有条件清理。Core 已无效算已确认；清理存储失败必须报告 credentialCleared=false，不能成功后下次启动再次复用却声称已清理。晚结果只能报告捕获会话，不得调用会覆盖新身份的通用 view/清理。重复注销空身份返回成功；Unix 客户端断开不撤销已接受清理，清理有独立有界生命周期，可再查询当前 session 或显式再次命令核对。

磁盘清理失败保留单个原会话待清理记录；未处理完前新的平台登录/切换返回明确的 cleanup-required，不替换该记录。重复 logout 对该记录再次执行条件清理，保留另一 CLI 新凭证；成功后释放记录。无待清理记录的空身份注销只表示当前没有平台登录，不追认历史的远端未确认结果。浏览器 Sign out 同样显示磁盘清理错误和可执行实例 logout 方向。

新增 `POST /_desktop/api/browser-access/reset`，仍受精确 Host/Origin、有效 Cookie 和 CSRF 校验；UI 在提交前确认“影响该 Desktop 的所有浏览器、保留 Core 登录、Work 继续运行”。服务锁内清空 sessions、待兑换 ticket、派生 Service grants/entries、临时传输并提升独立 local-access generation，保留 Core identity/凭证。清除当前 Cookie，返回 `{browserAccessCleared:true,coreSessionRetained:true}`；等待状态先显示，成功进入恢复页。失败/丢失响应只读检查，不自动重复 reset。

为 Desktop 内容请求/文件传输/Run 观察建立按 local-access generation 的有界取消登记，重置/会话过期时关闭对应活动流，正常结束删除登记；Service 已有本地 session 检查继续使用。注册数受既有请求/连接限额约束，reset 响应自身不被取消。最多两秒结束被撤销内容流，后续请求必须重新 authorize；内容在响应发布前复核本地及平台代次。清理未提交本机暂存、已准备本机下载，保留 Core 已接受任务和持久已知 Operation ID，不能自动重传或删除平台数据。

未授权页面隐藏 Account/Known operations/Inspect 和账号提交，只显示安全原因、检查与复制命令。命令使用 location 的已验证端口，不展示 CLI config 路径或保存账号：`piwork-cli desktop open --port N --no-open` 与 `piwork-cli desktop logout --port N`。CLI 不可达提示独立启动；有实例时不要求重启。登录、连接或清理后待导入对象遵守既有身份/Inspect 安全范围，不借新授权复用旧暂存。

## Risks / Trade-offs

- 同 UID 的本机进程可操作该 UID 的 Desktop → 与现有用户凭证权限模型一致；防其他用户、网页和 Service，SO_PEERCRED 与私有文件同时检查。
- 实例的 Core identity 和 Reset 为全进程共享 → UI 与文档明确所有浏览器影响；本轮不建立独立多账号模型。
- 浏览器删除/拒收 Cookie → 不弱化 Cookie 安全属性；状态检查说明结果，受信终端可再次签发 ticket。
- 注销请求丢失与并发新登录 → 原身份有界注销、条件磁盘清理、generation 隔离；明确本地已清理但远端未确认。
- Unix 资源替换和崩溃残留 → fd-relative 安全校验、端口排他锁、instance/inode 条件清理；拒绝任意路径 unlink。
- 五分钟/一次性链接仍会过期 → 新命令在原进程重签，有效 Cookie 直接复用；不把延长期限作为恢复机制。

## Migration Plan

1. 执行 tasks 中本地控制、票据、浏览器状态及清理测试，构建 Desktop 并同步 Go embed，再构建 native 二进制。
2. 只需重启 Desktop 装载新代码；旧 ticket/Cookie 按进程边界失效，保留 Core、Work 和保存凭证。新版本的 open/logout 无通道时报告需升级/启动 Desktop，不回退到匿名 HTTP。
3. 使用隔离实例验收，包含与当前故障一致的过期链接及无 Cookie 注销；不改用户 tmux 4 或其 Core/Work 状态。
4. 回滚时停止新 Desktop、恢复前一二进制再启动；控制资源按上述清理，登录存储无需转换，已接受任务不受影响。
