# Work Snapshots Spec Delta

## MODIFIED Requirements

### Requirement: Validate complete bounded packages before installation

**Identifier:** WSNAP-002

V1/V2 package SHALL 使用完整性校验，不宣称签名或加密。接收端 SHALL 在加载镜像或写入最终 Work 存储之前验证 framing、严格 schema、全部长度/hash、唯一条目、引用闭包、文件路径和链接、历史 schema 与关系、平台兼容和声明资源限制。用户可离线 inspect 包；inspect SHALL 验证全部字节，仅显示格式/平台/计数/总大小/模型及外部 MCP 凭证依赖概况和敏感数据警告，不打印文件内容、env 值、历史正文或原平台内部身份。

V1/V2 SHALL 分别检查物理包总字节、解码包总量和恢复逻辑量：物理包至多 100 GiB；`16 + manifest字节长度 + sum(blob.size)` 至多 100 GiB（V1 中与物理大小相同）；文件恢复逻辑字节（跨树重复引用重复计数，同树硬链接只计一次）加去重镜像层原始字节至多 100 GiB。V2 的物理大小按 storedSize 累计，另外两种计数使用原始 size，不能因压缩或去重减少必要的恢复计数。manifest 及解码后的每个 JSON metadata blob 各最多 64 MiB，累计 metadata 最多 256 MiB，总文件条目最多 1,000,000，路径最多 4096 字节和 128 层；大小累计须检查溢出，不按文件类型过滤内容。上传/下载 SHALL 流式执行，不能以 Base64 JSON、一次性内存 Buffer 或原有 1 MiB JSON 路由传输；超限返回 413 PACKAGE_LIMIT_EXCEEDED，截断/尾随字节/hash 错误返回 400 PACKAGE_INVALID。中断/未验证包不可用于 import。接收端解包 SHALL 不访问允许根之外的路径、不跟随文件树内链接写入、不创建特殊设备或执行包内程序。

离线 inspect SHALL 完整校验 framing、manifest/树/镜像声明结构、持久卷引用闭包和全部 blob 字节，但不执行包内 SQLite、不代替目标平台兼容性、历史数据库语义、目标模型可用性和 quota 校验；摘要 SHALL 明确 integrityVerified=true、installationValidated=false。服务器 SHALL 在 package 标记可导入前完成隔离历史数据库语义检查，导入发布前再次验证目标相关约束。active=null 且三个受管 Work SQLite 文件全部缺席是合法空私有历史；存在孤立 WAL/SHM，或 active 非 null 却缺主数据库 SHALL 拒绝，不能自动创建一个空数据库冒充来源。

静态验证 SHALL 覆盖 V1/V2 的 Pi package 表、context bindings、manifest name、resourceInventory、完整树/hash 与依赖链接，PKG-003 的单包展开限制与本规格整包总量限制同时生效。复用 blob 不得绕过按 context 引用累计的逻辑恢复量限制。inspect SHALL 增加安全 Pi package name/version 和 uniqueArtifacts/contextBindings/enabledDesired/enabledActive 摘要，保持 integrityVerified=true、installationValidated=false，不执行 npm/Git/extension/SDK 或联系源 registry。

#### Scenario: A package exceeds JSON request size
- **WHEN** 用户传输一个合法 8 MiB 包
- **THEN** 系统通过有背压的流完成验证和传输，不触发 1 MiB JSON 请求上限或将整个包加载进内存

#### Scenario: Duplicate blobs cannot bypass restore limits
- **WHEN** 一个小包通过重复引用同一大文件声明超过 100 GiB 的恢复逻辑数据
- **THEN** 校验返回 PACKAGE_LIMIT_EXCEEDED，不创建目标卷

#### Scenario: Tamper or truncate
- **WHEN** 任一 blob 被改变、重复、缺失或传输提前结束
- **THEN** 校验失败且没有可导入 package 或可见 Work

#### Scenario: A hostile file tree
- **WHEN** 包以 ../、绝对条目路径、重复路径、符号链接父路径或设备节点试图写出暂存根
- **THEN** 导入拒绝整个包且不改变宿主或其他 Work 文件

#### Scenario: Inspect has no execution side effects
- **WHEN** 一个包内含恶意 startup 命令和 AGENTS 指令
- **THEN** inspect 只验证数据和显示安全摘要，不执行这些内容或联系网络

#### Scenario: Inspect a Work containing packages
- **WHEN** 离线用户 inspect 包含 extension 和 lifecycle script 的合法 .work
- **THEN** 验证全部 bytes 并显示安全包数量/名称/版本，不运行脚本或将 loaded 标为 true

#### Scenario: Reject a missing package blob
- **WHEN** manifest 包绑定有效但一个依赖树 blob 缺失或摘要错误
- **THEN** 校验返回 PACKAGE_INVALID，无可导入记录或已发布 Work

#### Scenario: 小压缩文件不能绕过解码总量
- **WHEN** 物理包很小，但声明的原始 blob 总量、恢复逻辑量或 metadata 超过对应限制
- **THEN** 返回 PACKAGE_LIMIT_EXCEEDED，不能仅依据 storedSize 接受包，也不建立可见目标 Work

#### Scenario: 限制解码窗口与实际输出
- **WHEN** zstd 声明超过 PWORK-WIRE-002 的窗口，或实际输出超过 blob.size
- **THEN** 分别在资源分配前或读出超额时拒绝，不把整 blob 或镜像层加载到内存后再核对

#### Scenario: 各入口执行同一完整校验
- **WHEN** 同一个合法或损坏 V2 包经过离线 inspect、CLI/Desktop 本地验证、Core 上传、helper 和导入重验
- **THEN** 所有适用入口按同一字节契约接受或拒绝，物理 size/digest 一致，原内容与目标相关校验不因压缩省略

### Requirement: Scope transfer lifetime and errors explicitly

**Identifier:** WSNAP-005

接口 SHALL 提供导出接受、快照安全详情、快照二进制下载、二进制上传和导入接受入口；新内容接口使用 application/vnd.piwork.work-package，上传必须提供 Content-Length 与 X-Piwork-SHA256，下载返回同名校验字段及 Cache-Control:no-store。非适用 Content-Type 返回415，缺失或错误 header 返回400；不支持 Range，显式 Range 返回416。JSON 元数据请求仍受1MiB上限约束，具体路径/DTO遵循本变更设计的接口表。

上传 SHALL 先认证，再流式落入 owner-only 暂存；完整验证后返回 packageId、digest、size、expiresAt、bindingRequirements；末字段为 V1/V2 共用的只读平台依赖摘要，不得要求客户端据此填写 bindings。已完成 upload 和 export 包 SHALL 从就绪起保留 24 小时；任务或下载持有有效引用时不可回收，其后新请求返回 410 PACKAGE_EXPIRED，不影响已导入 Work 或 Operation 历史。新 transfer SHALL 限定 60 秒无进展超时及 30 分钟总时限；中断上传删除未完成暂存，下载可以从头重试，不承诺 range/resume。上传同 owner/digest 复用现存完整内容，不能允许另一用户仅凭 digest 获得字节。

接口 SHALL 使用 400 表示包/请求不合法或 TARGET_MODEL_UNAVAILABLE/EXTERNAL_MCP_SECRET_UNAVAILABLE，401 表示未认证，403 表示非所有者管理员内容访问被拒，404 表示普通跨所有者或未知资源，409 表示状态/名称/幂等/配额冲突，410 表示本人的已过期包，413 表示限额，503 表示运行依赖或暂存不可用。错误体只包含安全 code/message/field；导入前置条件错误 SHALL 给出具体 code 与可执行处理方向，不得统一映射为 `Work snapshot request cannot be accepted`。接受后的失败通过 Operation 报告，不能在流已开始后插入 JSON。包字节是完整内容通道，不经过普通日志/JSON 脱敏器；控制响应和日志仍禁止输出用户内容和凭证。

V1/V2 上传/下载的 Content-Length、X-Piwork-SHA256、package size/digest、snapshot 回执和下载校验 SHALL 均描述实际存储的完整包字节。系统 SHALL 不在传输或下载重试中转码；已有 V1 包及回执保持原身份，新的 V2 包按自身物理摘要使用现有所属用户去重和幂等规则。

完整 `.work` 传输对象 SHALL 与独立 Pi package upload 分属不同接口/作用域，ID 不得互换。导入后 `.work` 或其 upload 过期 SHALL 不影响 Work 自有 package bytes；export/import 控制诊断不得输出包脚本日志或来源 credential。

#### Scenario: Retry a download
- **WHEN** export 成功后的下载断开，用户在保留期内重新下载
- **THEN** 下载相同包/hash，不再锁定或重新读取源 Work

#### Scenario: Expired content
- **WHEN** 本人请求一个没有活动引用且已超过保留期的包
- **THEN** 返回 PACKAGE_EXPIRED，原 Operation 仍可查询，不重新导出

#### Scenario: Disabled user during observation
- **WHEN** 任务已接受后调用者凭证失效
- **THEN** 后续读取重新鉴权，任务不因观察失败而重提；重新登录后仍按所属用户访问原结果

#### Scenario: Expire the original Work upload
- **WHEN** 完整 import 成功后原 .work upload 过期
- **THEN** 导入 Work 的 package 仍可 start/apply/export，不从过期上传重新取数据

#### Scenario: V2 传输使用物理大小与摘要
- **WHEN** 一个 800 MiB 原始内容被编码为较小 V2 包并通过上传、下载或重试传输
- **THEN** 所有传输声明与实际物理包字节匹配，恢复量另行按原始 size 计算，不用原始大小冒充 Content-Length

#### Scenario: 压缩器更新不改写就绪快照
- **WHEN** Core 更新后，用户重试下载已就绪快照或重放同一个 export 幂等键
- **THEN** 返回已有包与原摘要，不重新压缩或建立不同身份的同名成功回执

## ADDED Requirements

### Requirement: 压缩导出沿用快照事务和恢复边界

**Identifier:** WSNAP-COMPRESSION-001

新导出 SHALL 在既有已停止与独占快照条件下捕获完整内容，为 V2 确定实际存储编码和长度，完整生成并重验包后才发布 succeeded。原始与压缩暂存及最终包 SHALL 属于同一个已有导出任务和所属安装，沿用既有期限、锁、发布、幂等与清理规则；不能在包未完成时宣称可下载。

压缩/解码的取消、I/O 错误、磁盘不足或完整性失败 SHALL 经现有 Operation 明确失败；未发布资源只按确切归属清理，未知清理继续占用原 gate。重启恢复 SHALL 验证完整已落盘 V1/V2 文件，或将未完成任务中断清理，不通过重新压缩重放旧任务。新格式导入仍静态还原原始内容并原子发布 stopped Work；显式 Start 才恢复执行。

#### Scenario: 压缩或封装中断
- **WHEN** 在压缩候选或最终包写入期间取消、磁盘失败或 Core 崩溃
- **THEN** 不出现成功半包，源 Work 内容不变；原任务失败或按既有 journal 恢复，并清理确切所属暂存或保留可查询的 cleanup-pending

#### Scenario: 发布后响应丢失
- **WHEN** V2 包已经完整验证并持久发布，但响应未到达调用方
- **THEN** 同键查询返回同一 snapshot/Operation/包字节，下载不重新采集或压缩

#### Scenario: 压缩包离线搬迁
- **WHEN** V2 在来源镜像和包 registry 不可达、目标平台与模型要求满足的隔离安装间导入
- **THEN** 完整恢复固定镜像、两个卷、配置与包闭包和保留历史，发布 stopped Work；显式 Start 后按原行为使用，再次导出仍有完整闭包
