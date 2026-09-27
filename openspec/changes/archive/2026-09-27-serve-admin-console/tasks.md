# Tasks

所有任务按 [design.md](design.md) 的接口和边界执行；括号内为规范 Identifier。每项提交行为都需要下述验证，单独的综合验收不替代领域行为测试。

## 1. 管理契约与 SDK

- [x] 1.1 在 contracts 增加 AdminStatus、RuntimeView、默认 Work patch/view、管理用户/Skill/Operation 的严格 schema 与公开错误字段，明确 package source 和编码路径契约（CADM-001–006、SKM-004）；验证 contracts 测试覆盖合法 DTO、未知字段、空值、2 MiB JSON 及 AGENTS 字节边界。
- [x] 1.2 给 client-sdk 增加显式管理员 JSON 管理方法，使用 bearer 并保留所有现有 operator 方法（CADM-002）；验证请求 fixture 对照完整路由表，覆盖 @scope/name、错误 field/correlationId 和两种凭证互不串用。
- [x] 1.3 增加管理员 Skill multipart 和 Core package 二进制上传 SDK 入口，允许传入有背压的流与取消信号，保留旧 operator upload 行为（SKM-004、CADM-006）；验证 Content-Type 边界、长度/摘要/来源头、断流和错误映射。

## 2. Core 管理入口、用户与配置

- [x] 2.1 在 Core 新增 /api/v1/admin 分发和管理员 guard，以当前 userId 构造 actor，并为异步准备后的提交提供会话复验（CADM-001）；验证真实 HTTP 测试覆盖无凭证、普通 user、admin、operator、过期/禁用/撤销、受保护 /control 凭证隔离及拒绝 bootstrap。
- [x] 2.2 接入用户列表、创建、enable/disable 和 reset-credential，保留最后管理员事务保护，确保密码哈希完成后的身份复验（CADM-003、SUI-USR-001–002）；验证重复账号、角色默认值、列表投影、并发最后管理员保护、自重置/自禁用与全部旧会话撤销。
- [x] 2.3 提供 adminApiVersion=1 的状态和未 ready 时可用的管理读取，复用恢复探测并防止重入（CADM-002、SUI-CFG-001）；验证 ADMIN_REQUIRED、RUNTIME_NOT_CONFIGURED、RUNTIME_UNAVAILABLE 和恢复为 READY，不把读取失败标成空数据。
- [x] 2.4 实现管理员 runtime 读取/保存投影与应用级串行变更，返回已保存配置及独立 readiness，不返回 secretRef/key/revision（CADM-004、SUI-CFG-002）；验证无效输入无变更、Docker 失败仍返回已保存状态、并发配置顺序、旧 operator 响应兼容及已有 Work 配置不变。
- [x] 2.5 实现 default-work 公开 view 和四字段 PATCH，在同一事务中解析 baseImage、验证并合并最新默认配置（CADM-005、SUI-CFG-003–004）；验证不相交并发编辑、同字段提交顺序、空集合/空文本、无效引用整体回滚、catalog 注册回滚和未初始化错误。
- [x] 2.6 让 operator default-work patch 支持 baseImage，并把 CLI base-image 分支改为仅提交指定字段，保留现有命令和全量 configuration 接口（SERVE-CTRL-001）；验证 CLI base-image 与管理员 package/AGENTS patch 并发不覆盖无关字段，运行原 CLI/default-work 回归。
- [x] 2.7 给新管理路由接入严格 2 MiB JSON、字段错误、安全公共错误及 404/405 行为（CADM-002）；验证 JSON 转义后仍在限额内的 256 KiB AGENTS、未知字段/非法类型/超限，以及响应和日志中无密码、路径、堆栈或原始执行输出。

## 3. Core Skill 内容上传

- [x] 3.1 实现 directoryName + files 的流式 multipart 接收，严格解码相对路径一次并进行文件/树边界校验（SKM-004）；验证嵌套目录、Unicode 名称、根 SKILL.md、空内容、逃逸、绝对路径、重复路径、文件目录冲突及非法编码。
- [x] 3.2 将完整暂存树接入已有 Skill 制品与 catalog 原子发布，发布前复验管理员身份，保留目录名称及更新 enabled 状态（SKM-002、SKM-004）；验证重复 add、名称不匹配、禁用 Skill 更新、上传中撤销及失败后旧制品/Work 副本不变。
- [x] 3.3 实现总 body、文件数、单文件/总内容、两项并发及上传超时限制，清理断流、失败与重启遗留 staging（SKM-004）；验证每个边界及超出一个单位、慢流、截断、第三个并发上传和发布区域不被 cleanup 误删。
- [x] 3.4 接入管理员 Skill list/show/enable/disable/remove，沿用公开投影与默认引用保护（SKM-002–003、CADM-002）；验证禁用项可见、普通用户仍只见启用名称、默认引用拒绝、未知 Skill 及原 operator 路径导入仍有效。

## 4. Core packages 管理身份

- [x] 4.1 将 Core package install/update/accept 的 operator 硬编码改为显式授权 actor，贯穿上传引用、幂等查找、持久任务和提交前会话检查（CADM-006、PKG-003、PKG-006）；验证 A/B/operator 同 key 隔离、同 actor 重放、跨 actor/scope 上传拒绝和重新登录后的有效上传使用。
- [x] 4.2 接入完整管理员 package 路由与上传，Operation 查询允许启用管理员观察 Core scope，同时统一拒绝未知或 Work Operation（CADM-002、CADM-006、PKG-004）；验证四类 source、scoped name、403/404、旧 operator SDK 兼容及 Work 元数据不泄露。
- [x] 4.3 验证 operator 与管理员共用 catalog 并发门禁、默认引用保护及安装并加入默认的原子提交，确保会话失效不取消已接受任务（CADM-001、PKG-004、PKG-006）；增加 HTTP/持久 store 集成场景覆盖 busy、失败不发布、重启查询和已有 Work 副本不变。

## 5. 独立 console 进程与构建

- [x] 5.1 在 console 工作区增加服务端/浏览器 TypeScript 构建、静态资源复制、bin、根 console 脚本及必要依赖，替换占位入口（SUI-001、SUI-004）；验证 workspace build/typecheck，浏览器产物不导入 Node SDK，console 无 Core/core-store/runtime-docker 依赖。
- [x] 5.2 实现 piwork-console serve 参数、loopback Core 约束、public-origin/TLS 校验、HTTPS listener、自身 healthz 和安全启动输出（SUI-001）；验证 help 不读取文件、缺参数 exit 2、启动失败 exit 1、错误远程 Core/Origin/证书被拒绝、Core 停机仍可打开登录页。
- [x] 5.3 实现 console 专属数据目录权限、独占锁、旧 staging 清理及最多 10 秒的进程关闭（SUI-001）；通过子进程测试验证第二实例不清理活跃数据、崩溃重启清理、停止 console 后 Core/CLI 和已接受任务仍运行。
- [x] 5.4 实现固定 shell/static 路由、安全响应头及路径白名单（SUI-004）；验证未知路由 404、路径穿越和任意代理被拒绝、CSP/no-store 生效，页面不嵌入 bearer 或 secret。

## 6. 浏览器会话与管理适配

- [x] 6.1 实现内存 session、登录挑战、Core login/me/status 版本检查和管理员准入（SUI-002）；验证成功登录、user 拒绝、不存在/禁用/错误密码统一结果、Core API 版本不兼容、Cookie 属性及重启后重新登录。
- [x] 6.2 在全部变更/上传入口接入 Origin+CSRF、登录失败限流、挑战与会话容量及定时清理，迁移现有未接入 Core 的浏览器安全工具和测试至 console（SUI-002）；验证跨会话 CSRF、错误 Origin、无证明、限流等待和容量满不驱逐有效会话。
- [x] 6.3 实现绝对到期、每次请求身份复验、账号撤销及注销流程，区分 Core 不可达和身份失效（SUI-003）；验证双浏览器只注销一个、自重置/禁用退出、Core 断网保留会话、恢复后验证、注销失败可重试和 Operation 不被取消。
- [x] 6.4 实现白名单管理 API relay、公开 availability/受保护 health、JSON/传输超时与安全错误转换（CADM-002、SUI-004）；验证只转发服务端 bearer、不转发浏览器 Authorization/forwarding 头、未知端点拒绝和 502/504 不被误报为认证失败。

## 7. console 文件输入与传输

- [x] 7.1 实现 Skill multipart 流式转发，先鉴权/CSRF 后转发并保留边界，采用上传独立时限（SUI-SKL-002、SKM-004）；验证浏览器选择的目录仅传相对文件树、Core 主机无需客户端路径，以及断流/撤销不发布部分内容。
- [x] 7.2 实现 package directory 输入暂存、路径和限额校验、使用现有工具确定性打包并以管理员上传到 Core（SUI-PKG-002、PKG-001、CADM-006）；验证 manifest 身份独立于目录名、普通文件模式、重复相同内容摘要一致及得到 uploadId 后清理暂存。
- [x] 7.3 实现 package ZIP 原字节接收、长度/摘要、安全校验及 Core 上传，不执行第三方脚本（SUI-PKG-002、PKG-003）；验证单根/外层单根、内部合法链接、ZIP bomb/越界/超限拒绝和 metadata 头准确。
- [x] 7.4 给本地输入适配加入两项并发、body/树/文件限额、背压、Node requestTimeout 配置和全链路清理（SUI-001、SKM-004、PKG-003）；用受控慢流、截断、超限及进程中断测试验证容量错误、内存不随完整包大小增长、无可复用半上传或泄漏暂存路径。

## 8. 基础页面、用户和配置

- [x] 8.1 实现中文导航、session 引导、通用表单/列表状态、键盘焦点、脏草稿确认和安全文本渲染（SUI-002–004）；浏览器验证加载/空态/错误不同、重复提交禁用、脚本字符串按文本显示、360px 操作可用及 15 秒会话检查。
- [x] 8.2 实现用户列表和创建两种角色的表单，加入密码确认、字段错误及创建成功后的入口提示（SUI-USR-001）；浏览器验证 user/admin 创建、默认角色、重复账号、密码不回填和普通用户不能进入面板。
- [x] 8.3 实现用户 enable/disable/reset 确认和自账号处理（SUI-USR-002）；浏览器验证取消不发请求、最后管理员保护、旧会话撤销、自重置退出及其他管理员继续使用。
- [x] 8.4 实现 Core 状态和全局 runtime 页面，区分健康/readiness、保存/探测结果并按要求清空 key（SUI-CFG-001–002）；浏览器验证未配置、不可达、恢复、保存但未 ready、字段错误和无 secret 响应/持久存储。
- [x] 8.5 实现默认 Work 完整公开配置展示和四字段编辑、Skill 排序、默认 package 多选及 dirty patch 提交（SUI-CFG-003）；浏览器及真实 Core 验证显式清空、64 个 package 边界、不可用选择保留、并发无关编辑和已有 Work 不变。
- [x] 8.6 实现 AGENTS 本地文件选择、严格 UTF-8 读取、编辑器、字节计数和覆盖草稿确认（SUI-CFG-004）；浏览器验证选择后再编辑、取消、无效 UTF-8、恰好/超过 256 KiB、Unicode/BOM/换行保留和显式清空。
- [x] 8.7 实现 Skill 列表/详情、目录预览上传、更新名校验与开关/移除操作（SUI-SKL-001–003）；浏览器验证本地目录上传进度、无目录支持提示、重复/超限、默认引用保护、失败保留旧条目及宿主路径不参与表单。

## 9. Package 页面与操作找回

- [x] 9.1 实现 Core package 列表/详情及同步开关/移除，连接默认 Work 页面（SUI-PKG-001、SUI-PKG-005）；浏览器验证缺 version、disabled/isDefault、空态、PI_PACKAGE_IN_DEFAULTS/PI_PACKAGE_BUSY 和成功后刷新。
- [x] 9.2 实现 npm/Git/目录/ZIP 四类安装与更新表单、来源切换确认、浏览器上传进度及安装并加入默认选项（SUI-PKG-002）；浏览器验证每种来源送入正确 API、更新显式来源/不可改名、ZIP/目录限制提示和上传完成不等于安装成功。
- [x] 9.3 实现稳定 intent key、接受响应丢失后的显式同键恢复、Operation URL/复制及串行轮询（SUI-PKG-003）；受控网络浏览器测试验证不重复安装、只一个在途 poll、phase 展示、观察失败保留 ID、终态停止和显式新尝试换 key。
- [x] 9.4 实现按 ID 查询页以及另一个浏览器/面板重启后的 Operation 恢复（SUI-PKG-004、SUI-003）；验证新会话能查询其他管理员 Core 任务，Work/不存在 ID 同样不可用，复制失败可选中文本，页面没有取消任务或虚构任务历史入口。

## 10. 综合验收与交付

- [x] 10.1 配置 console 的 test:unit 和 Playwright test:browser，使用真实 HTTPS console 与临时 Core、可替换 runtime/package fixture 覆盖全部 SUI 主流程（SUI-001–004、SUI-USR/CFG/SKL/PKG 全部要求）；执行浏览器套件并确认真实 Cookie、目录选择、故障恢复及敏感响应检查通过。
- [x] 10.2 在现有 Docker package integration 中加入管理员 bearer 的本地目录/ZIP 安装、默认发布和 operation 查询验收（CADM-006、PKG-003–006）；执行该集成测试，确认真实 helper 准备成功、会话撤销后任务继续及 operator CLI 仍能按 ID 查询。
- [x] 10.3 完成 Core/console/CLI 同机进程回归及模块依赖检查（SERVE-CTRL-001、SUI-001、CADM-001）；关闭 console 后运行 piwork-serve 管理命令、查询原任务，并验证用户 CLI 与 Work 内容授权未改变。
- [x] 10.4 更新 README、操作文档和 console 使用说明，写明启动参数、证书、bootstrap、角色入口、目录/ZIP 差异、AGENTS 编辑和按 ID 找回边界（SUI-001–004、SUI-CFG-004、SUI-PKG-002–004）；用文档命令启动测试部署并逐项核对帮助与页面文案。
- [x] 10.5 执行根 build/typecheck/test、console test:browser 及上述 Docker 集成，检查每个规范场景有对应验证记录，并运行 openspec validate serve-admin-console --strict（全部能力）；结果通过后才将实现标记完成，不以 artifact 文件存在代替行为验收。
