# Pi Package Management Spec Delta

## MODIFIED Requirements

### Requirement: Normalize four sources into owned package artifacts

**Identifier:** PKG-001

Core 与 Work SHALL 同时接受 npm spec、Git spec、本地目录和 `.zip` 四种来源。npm/Git SHALL 按本次解析的确切版本或 commit 冻结；本地内容 SHALL 来自客户端所选择的本地输入，经有界上传传给 Core，不把客户端路径解释成服务器路径；CLI 与浏览器适配器都可提交相同的 Core 上传协议。ZIP SHALL 包含根 package.json 或唯一外层目录中的 package.json，多个根包 SHALL 拒绝。所有来源 SHALL 形成独立、完整、包含运行依赖的不可变制品；后续启动/导出不得依赖来源目录、上传、registry 或 Git。

包身份 SHALL 使用 package.json.name，长度 1–214，匹配 `^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$`；不得缺失、为空或从目录名猜测。version 缺失 SHALL 返回 null。相同 name/version 的不同内容 SHALL 被视为不同制品。静态 manifest/资源声明失败 SHALL 明确失败，安装成功 MUST NOT 宣称已执行 SDK 加载。不得通过输入来源 URL 传入明文凭证或新增交互式私有源登录。

#### Scenario: Install the same package from each source
- **WHEN** 用户分别通过 npm、Git、本地目录和单根 ZIP 安装同一有效包
- **THEN** 每种方式均可获得以相同 manifest name 管理的完整独立制品，并报告实际 version、sourceKind 和资源数量

#### Scenario: A client path differs from the Core host
- **WHEN** 用户的本机有 ./tools 而 Core 宿主没有该目录
- **THEN** CLI 上传本机目录内容，安装成功后删除本机目录和上传不影响已安装包

#### Scenario: Reject an ambiguous identity or archive
- **WHEN** 来源缺失合法 name、ZIP 有多个包根、manifest 不合法或声明必需资源不存在
- **THEN** 任务以安全字段错误失败，不发布部分包或替代名称

#### Scenario: Freeze a mutable source
- **WHEN** tag、branch、npm dist-tag 或本地目录在安装完成后改变
- **THEN** 已安装 bytes 保持不变，只有新一次显式 update 重新捕获来源

#### Scenario: 浏览器提供本地输入
- **WHEN** 管理客户端上传浏览器选择的本地目录快照或 ZIP
- **THEN** Core 使用收到的内容执行同一 manifest 和制品校验，不读取浏览器上报的宿主路径


### Requirement: Validate and scope package input transfers

**Identifier:** PKG-003

本地目录与 ZIP 上传 SHALL 先鉴权、后流式读取，绑定 actor 和 Core/Work scope，并验证声明长度和 SHA-256。完成上传 SHALL 返回 uploadId/expiresAt，保留 24 小时；accepted Operation 的有效引用 SHALL 阻止过期回收。上传 SHALL 限制 60 秒无进展、30 分钟总时限；中断或不完整内容不得用于安装。

输入 SHALL 限制压缩体 256 MiB、展开制品 1 GiB、单文件 64 MiB、100,000 条目、64 层、路径 4096 UTF-8 字节、manifest 1 MiB。系统 SHALL 拒绝加密 ZIP、重复/绝对/越界路径、反斜线、特殊设备和循环/越界链接；只允许制品内部相对符号链接并保留执行位，不保留 setuid/setgid。超限 SHALL 返回 `PI_PACKAGE_LIMIT_EXCEEDED`，不安全结构 SHALL 返回 `PI_PACKAGE_UNSAFE_ARCHIVE`。同一限制 SHALL 适用于 npm/Git/local/ZIP 来源解包及准备结果；远端来源在依赖安装前 SHALL 检查已落盘的来源树，不能只在最终制品捕获时检查。

准备 helper 的临时工作卷 SHALL 监测总用量，并以每个 helper 4 GiB 为终止阈值，计入下载缓存、Git checkout、依赖安装及 staging 副本；检测到超限 SHALL 终止准备，以 `PI_PACKAGE_LIMIT_EXCEEDED` 使 Operation 失败并清理临时资源，不发布制品或改变原 catalog/desired/active。该运行期监测不宣称为 Docker volume 的硬磁盘配额；来源树和最终制品的上述静态限额仍须独立验证。

Core scope 的 actor SHALL 为 operator 或实际已登录管理员 userId；Work scope 继续沿用既有 Work 授权。上传接受和安装引用都 SHALL 验证 actor/scope；普通 user 不得创建 Core scope 上传。有效管理员会话在上传期间失效时，完成提交 SHALL 拒绝。上传由同一账号重新登录后仍可在有效期内使用，不授予其他管理员消费权限。

#### Scenario: Use another scope's upload
- **WHEN** 调用者将另一 actor 或另一 Work 的 uploadId 用于安装
- **THEN** Core 拒绝访问且不泄露上传名称、内容或所属人

#### Scenario: Preserve a valid dependency link
- **WHEN** 包含 node_modules/.bin 的相对链接且完整链始终位于包根内
- **THEN** 安装保留该链接及执行位，后续 SDK 和依赖可读取对应文件

#### Scenario: Reject a ZIP bomb or escaping link
- **WHEN** ZIP 展开超限、条目重复、包含 ../ 越界或链接最终指向包根外
- **THEN** 输入整体失败，既有包及宿主文件不变，不出现可用于 install 的完成上传

#### Scenario: Retain a leased upload
- **WHEN** 上传达到 24 小时但已接受任务仍持有有效引用
- **THEN** 系统保留任务需要的内容，任务结束解除引用后才允许过期回收

#### Scenario: A remote source or install script exceeds preparation space
- **WHEN** npm/Git 来源树、依赖缓存或 lifecycle script 持续写入，使来源树超过 1 GiB 或临时工作卷的监测用量超过 4 GiB
- **THEN** 准备阶段以 `PI_PACKAGE_LIMIT_EXCEEDED` 失败并停止 helper，原 catalog/desired/active 不变，临时 volume 与来源引用在确认 helper 退出后清理

#### Scenario: Core 上传隔离管理员
- **WHEN** 管理员尝试安装由其他管理员、operator 或 Work scope 上传的内容
- **THEN** 返回统一不可用错误，不泄露上传内容或所有者，也不产生 Operation


### Requirement: Manage the Core catalog separately from default selection

**Identifier:** PKG-004

仅 operator 和已启用管理员 SHALL 通过各自受保护的管理 API 管理 Core package catalog；普通 user 仍只能使用原有 enabled catalog 只读能力。普通 install SHALL 发布 enabled=true 且不加入默认；install --default SHALL 原子发布并追加默认集合，保留其他默认项。默认选择最多 64 个唯一 enabled 包；显式空集合 SHALL 有效。Core update SHALL 保留 enabled 和默认引用；默认引用中的包 disable/remove SHALL 返回 `PI_PACKAGE_IN_DEFAULTS`，先移出默认后才能操作。Core 更新/禁用/移除 SHALL NOT 修改已创建 Work 的任何副本。

用户只读 catalog SHALL 只公开 enabled 包；operator 及通过管理 API 访问的管理员 SHALL 能看到 enabled/disabled 和 isDefault。列表 SHALL 按 name 的 UTF-8 字节顺序返回，不返回制品文件内容、宿主路径、secret 或内部 digest。

#### Scenario: Install without changing defaults
- **WHEN** operator 安装 tools 且没有 --default
- **THEN** tools 在 enabled catalog 可发现，已有默认集合及新 Work 的默认选择不变

#### Scenario: Atomically install a default
- **WHEN** 默认已有 a、b，operator 成功安装 c --default
- **THEN** catalog 和默认集合一起提交为 a、b、c；安装失败时两者均不增加 c

#### Scenario: Protect a default reference
- **WHEN** operator 尝试 disable/remove 一个仍为默认的包
- **THEN** 返回 PI_PACKAGE_IN_DEFAULTS，包和默认集合保持不变

#### Scenario: Future Works observe the new head
- **WHEN** A 捕获 tools v1 后 Core 将 tools 更新为 v2，再创建 B
- **THEN** A 的 desired/active 仍为自己的 v1，B 获得 v2

#### Scenario: 管理员和 operator 共享同一 Core 库
- **WHEN** 管理员安装或修改 Core package 后 operator 查询，或反向执行
- **THEN** 双方观察到同一 catalog/defaults，并共同遵守 Core package 并发门禁，已有 Work 副本不变


### Requirement: Persist package operations and idempotent outcomes

**Identifier:** PKG-006

install/update SHALL 返回持久 Operation acceptance；成功仅表示完整制品发布到 catalog 或 desired，不代表 Work loaded。相同 actor/scope/verb 的相同幂等键和语义请求 SHALL 重用同一 Operation，包含终态失败；不同请求复用键 SHALL 冲突。语义比较 SHALL 使用上传内容摘要，不把重复上传的新 uploadId 视为新请求。新键 SHALL 允许显式重试。

Core 重启 SHALL 保留 Operation、阶段、结果和发布状态；能够验证原 helper 及完整结果时继续收尾，无法证明时明确失败，不重复执行第三方脚本。查询 SHALL 区分 pending/running/succeeded/failed/superseded，失败返回安全 stage/code/message，不输出未经处理的子进程日志、凭证或宿主路径。客户端停止等待 SHALL 不取消已接受任务。

Core 与 Work 的 package Operation 查询 SHALL 额外返回 `packagePhase`，取值仅为 `queued|source|prepare|validate|publish|cleanup-pending|succeeded|failed|superseded`，反映该 Operation 已持久化的当前准备阶段；非 package Operation 不返回该字段。该字段 SHALL 经过 operator、启用管理员的 Core 管理查询授权或原有 Work 查询授权，不包含 helper 标识、命令参数、来源路径、子进程输出或凭据，也不改变 Operation 的 `state` 及结果契约。

Core 操作的幂等 actor SHALL 区分各管理员 userId 与 operator。任何启用管理员或 operator SHALL 能按已知 ID 查询 Core package Operation 的安全详情；该权限不允许查询用户 Work Operation 或消费其他 actor 的上传。相同 key 在不同 actor 下不是同一请求，仍须遵守整个 Core catalog 的唯一非终态准备门禁。

#### Scenario: Retry an accepted request after a lost response
- **WHEN** install 已接受而响应丢失，调用者以同键及同内容重新提交
- **THEN** 返回原 Operation 和 reused=true，不准备或安装第二次

#### Scenario: Retry a failed installation
- **WHEN** 来源临时失败，调用者先重放旧键再用新键提交相同来源
- **THEN** 旧键返回原 failed Operation，新键创建一次新的准备尝试

#### Scenario: Observe safe package preparation phase
- **WHEN** 已授权调用者查询进行中的 Core 或 Work package Operation，准备阶段从 queued 推进至 prepare
- **THEN** 查询保留原 state 和 ID，并在 `packagePhase` 显示已持久化的阶段；其他 Operation 无该字段，响应不暴露 helper 标识、子进程输出或敏感路径

#### Scenario: Crash at publication
- **WHEN** 制品落盘后、状态提交前 Core 崩溃，或状态已提交后响应前崩溃
- **THEN** 重启分别识别不可见暂存或唯一已成功结果，不出现半包、重复默认项或重复 desired 更新

#### Scenario: 管理员按 ID 恢复 Core 任务
- **WHEN** 任一启用管理员在新会话查询已知 Core package Operation ID
- **THEN** 返回原持久状态及安全阶段，Work Operation 或不存在 ID 则返回相同不可用结果

#### Scenario: 同键不串用管理员
- **WHEN** 管理员 A、B 和 operator 分别使用相同幂等 key
- **THEN** 各自的重放空间隔离，不错误返回另一个 actor 的接受结果
