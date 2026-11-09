# Portable Work Spec Delta

## MODIFIED Requirements

### Requirement: Define a versioned complete Work aggregate

**Identifier:** PWORK-001

系统 SHALL 区分 Work Spec（版本化内容清单与关系）、Work Package（Spec 加完整制品字节）、Work Instance（归属接收者的运行实例）。V1/V2 Spec SHALL 分别声明 formatVersion=1 或 2，并声明 snapshotKind=cold-full、包生成时间、源 Work 名称、Linux OS/architecture/variant、agent protocol、Work history schema、storage layout、active/desired context 引用、所有保留 context、服务 heads/revisions、Work 持久资源预留、恰好两个受管持久卷及其当前 Work/service 引用、存储树、历史记录、固定镜像、平台依赖描述及逐制品大小/SHA-256。Spec SHALL 包含完整闭包：每个受管引用恰有一个目标，空集合显式为空，active 未初始化时为 null，不能以目标端默认值补缺。持久资源预留 SHALL 恰有一条 agent 记录及每个保留 service（包括 tombstone）各一条记录，保留非负的 desired CPU/内存和 service/volume slots；记录引用包内逻辑 service key，不携带源平台 subject ID。两个卷 SHALL 各有一个隐含 Work 引用；workspace 的 service 引用 SHALL 以去重有序的包内 service key 显式记录，agent-private 不允许 service 引用。缺少或多出预留/卷引用记录、重复逻辑键、悬空引用、缺失制品、未知字段/组件或版本 SHALL 返回 PACKAGE_INVALID 或 PACKAGE_FORMAT_UNSUPPORTED，不能静默忽略。

系统 SHALL 严格读取现行合法 V1 和 PWORK-WIRE-002 定义的 V2，新接受的 export SHALL 默认生成 V2。V1 保持其原 framing、完整必需字段与拒绝规则；V2 仅增加 blob 的存储编码描述，不重组 Work 内容模型。软件发行版本、包格式版本、history schema 与应用用户文件中的版本 MUST NOT 混同。未知版本或编码 SHALL 返回 PACKAGE_FORMAT_UNSUPPORTED；已识别版本的 magic/manifest 不匹配、缺失或未知字段 SHALL 返回 PACKAGE_INVALID。新增组件须通过明确格式演进，不能以可选字段名义被静默忽略。

Work Spec SHALL 是完整快照的清单，而不是要求用户编写的重建配方。系统 SHALL 复用原生历史记录归档；控制历史 requestJson/resultJson/errorJson 内部内容为只读不透明字符串，不属于需逐字段转换的运行合约，未知历史 kind 不等同于未知包组件。格式、身份映射与校验由系统完成，不能要求用户提供历史迁移脚本。

V1/V2 SHALL 必需包含 piPackageContract=1、全局 piPackageArtifacts 清单及每个保留 context 的 config.packages/packageBindings，即使为空也显式记录。每个 config 项（含 disabled）恰好绑定一个匹配 name 的制品，制品包含完整 tree、运行依赖、内容校验与兼容环境；不存在悬空绑定或未引用的包表项。相同内容去重，同名不同版本或同版本不同 bytes 分别保留。

#### Scenario: A self-contained Work
- **WHEN** 导出具有两份 context、两个服务和两个持久卷的已停止 Work
- **THEN** 包内可解析所有关系和实际字节，接收端不需要原 Core、原 Skill 库或镜像仓库来还原本地内容

#### Scenario: Reject missing or unknown structure
- **WHEN** 包遗漏 desired context、引用不存在的 blob、重复 service key 或包含当前未支持的 formatVersion=3
- **THEN** 导入在发布 Work 之前失败，且不会用默认配置或部分组件代替

#### Scenario: Reject an incomplete reservation graph
- **WHEN** 包缺少 agent 预留、缺少一个 disabled service 的预留、重复一个 service 预留或引用不存在的 service key
- **THEN** 包验证返回 PACKAGE_INVALID，不按 enabled、definition 或接收端默认策略猜测缺失预算

#### Scenario: Reject an incomplete storage graph
- **WHEN** 包缺少任一受管卷、把 service 引用指向不存在的 key，或在 agent-private 卷上声明 service 引用
- **THEN** 包验证返回 PACKAGE_INVALID，不用空卷或当前 service 定义补齐引用

#### Scenario: Reject a pre-package V1 file
- **WHEN** formatVersion=1 文件缺少 package 必需字段
- **THEN** 返回 PACKAGE_INVALID，不补 []、不迁移，也不将非法旧包改按 V2 接受

#### Scenario: Validate a package reference graph
- **WHEN** context 的包 binding 缺失、重复、name 不匹配或指向不存在制品
- **THEN** 完整包被拒绝，不能从接收端 defaults 补齐

#### Scenario: 新导出使用 V2 并保留旧包读取
- **WHEN** 新版系统导出一个符合停止与完整性条件的 Work，或读取一个合法的现有 V1 包
- **THEN** 新导出为 V2，V1 仍严格按原规则读取；两者使用相同的内容闭包与恢复语义

#### Scenario: 格式升级不扩大内容与运行平台
- **WHEN** V1 内容通过显式导入与再导出进入 V2
- **THEN** 镜像身份、原始文件与保留历史、active/desired 差异、平台和外部依赖边界按既有契约保留，不因格式升级裁剪、联网补依赖或升级历史

#### Scenario: V2 仍拒绝不完整清单
- **WHEN** V2 缺少 encoding/storedSize 或既有必需内容字段，或携带未知字段
- **THEN** 返回 PACKAGE_INVALID，不通过补默认值生成成功 Work

### Requirement: V1 冷包的字节封装与原生兼容

**Identifier:** PWORK-WIRE-001

V1 冷包 MIME SHALL 为 application/vnd.piwork.work-package，字节按八字节 PIWORK1\n、uint64 大端 manifest 长度、UTF-8 JSON、按 manifest.blobs 顺序原始 blob 组成，无 blob header/压缩/尾随数据。完整包及每 blob SHA256 核验，digest 排序且去重的 blob 合并种类；重复 JSON key、未知字段、不安全整数、非法 UTF-8、悬空关系及不支持版本拒绝。

V1 SHALL 保留 cold-full、两个受管卷、active/desired/历史 context/包绑定/Service revision/终态控制与私有历史、固定镜像 config/非压缩层、模式/UID/GID/纳秒时间/空目录/链接及原用户字节；文件名为 POSIX 字节的 base64 段。100 GiB 包/逻辑恢复、metadata 64 MiB 单份/256 MiB 累计、一百万项、4096 字节/深度128，复用 blob 不绕过逻辑限额。临时层、进程、外部服务、平台用户/目录/秘密和活跃授权不迁移；用户自行存入的秘密不做内容过滤。

V1/V2 共用的原生内容校验 SHALL 精确识别 schema 4 及配套 Memory schema 1 的 history schema 5/6/7/8，SDK JSONL、图像 input 与用户内容沿现有传输保留，不重放 Run。schema 5/6/7/8 的 work.sqlite/memory.sqlite 独立重建目标身份并保留本地版本/条目/文本；未恢复联合 journal 返回 SNAPSHOT_HISTORY_BUSY。新 Agent SHALL 仅写入 schema 8；schema 4/5/6/7 的升级仅在授权的显式 Apply 中按 WMEM-005 经备份/恢复完成，成功后拒绝仅支持 schema 4/5/6/7 的旧镜像直接运行 schema 8。

inspect SHALL 只验证离线字节，不打开源 SQLite、不执行包代码；目标 Core 静态核验目标模型/凭据/外部 MCP/配额/平台并发布 stopped Work，显式 Start 才生成新网络证书。原请求/来源文本和业务 JSON 不为身份重建而改写。security.selinux 精确排除，不迁移宿主标签，其余不支持属性整体拒绝；hash 完整不代表发送者或包代码可信。


#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

#### Scenario: 升级后再次下载原 V1 快照
- **WHEN** 新版系统处理仍在保留期内的既有 V1 snapshot 下载或同键 export replay
- **THEN** 返回原 V1 字节及摘要，不转码为 V2、不重新采集源 Work

### Requirement: 导入后按目标身份重建默认服务域名

**Identifier:** PWORK-SERVICE-ACCESS-001

Work 的默认网络名称、service 域名、Docker 名称及活动访问连接 SHALL 属于目标 Core 派生状态，不进入 `.work` V1/V2 包或改变其内容 schema。导入 SHALL 在新 Work/service ID 发布时重新分配这些身份；导入仍保持 stopped，只有显式启动并达到 ready 才可通过新域名访问。源包的应用文件、数据库、历史文本中的字面 URL SHALL 原样保留，不做搜索替换或继承源平台路由。

托管浏览器的 Service basePath/访问链接 SHALL 同样属于当前安装和目标身份的派生信息，不增加 `.work` V1/V2 内容字段。符合动态前缀契约的应用 SHALL 在导入、显式 Start 并 ready 后通过新 ControlPlane 的 `/services/<新workId>/<新serviceId>/<port>/` 使用，不依赖源平台、旧 IP、旧入口池或重新安装其既有依赖。

包格式可导入与其中网页适配当前入口 SHALL 分别判断。旧应用不支持前缀时，不得把它误报为包字节损坏，也不得为了透明兼容自动替换固定镜像、搜索替换源码/数据库/历史 URL，或回退旧托管端口。应用路径适配须显式进行，原内容与独立所有权继续保留；任意旧网页不属于新路径的透明兼容承诺。

#### Scenario: 同一包导入两次
- **WHEN** 同一含 `notes` service 的 `.work` 文件被导入两次
- **THEN** 两个新 Work 获得不同域名，均不占用源域名；启动其中一个不使另一个可访问

#### Scenario: 未启动的导入 Work
- **WHEN** 用户刚完成导入并查询 service，再尝试访问返回的新域名
- **THEN** 能看见稳定地址但状态为 unavailable，访问失败且不隐式启动 Work

#### Scenario: 保持 V1 包字节契约
- **WHEN** 新版读取或重新下载已存在的合法 V1 包，其中含原历史 URL 文本
- **THEN** 原包保持 V1 字节与摘要，不增加访问身份字段；导入不改写历史文本，目标域名由目标 ID 推导

#### Scenario: 再次导出时访问身份与封装版本分离
- **WHEN** 合法 V1 或 V2 包及历史 URL 文本完成导入与再次显式导出
- **THEN** 新导出按 PWORK-001 使用 V2，访问身份无需新增内容字段，历史文本字节不被改写，目标域名由目标 ID 推导

#### Scenario: 新模板搬迁后改变浏览器身份
- **WHEN** 支持动态前缀的 Work 停止、导出并导入新 Work 后显式启动
- **THEN** 同一代码和捕获镜像通过目标 ID 的新前缀加载资源、执行 API 和建立 WebSocket，源和目标互不串用，动态前缀不改变包内容 schema

#### Scenario: 旧根路径应用导入
- **WHEN** 合法旧包包含不支持前缀的网页应用
- **THEN** 原静态格式与安装校验按原契约执行，源码/镜像/数据保持；网页入口兼容范围明确，不宣称导入成功已证明该网页可用，不隐式修复用户内容

## ADDED Requirements

### Requirement: V2 冷包逐 blob 无损编码

**Identifier:** PWORK-WIRE-002

V2 SHALL 使用扩展名 `.work` 和 MIME `application/vnd.piwork.work-package`。字节布局 SHALL 为八字节 `PIWORK2\n`（末字节是 LF）、uint64 大端 manifest UTF-8 字节长度、未压缩 JSON manifest，以及按 `manifest.blobs` 顺序排列的存储字节；无独立 blob header、额外 offset 索引或包尾随数据。magic 与 `formatVersion=2` SHALL 一致；JSON、字段严格性、摘要排序、去重与引用闭包沿用 PWORK-001 和 PWORK-WIRE-001。

每个 V2 blob SHALL 恰好包含 `digest`、`size`、`kinds`、`encoding`、`storedSize`。`digest` 为解码后原始内容的 SHA-256；`size` 为原始字节数；`kinds` 沿用现有用途集合；`encoding` 只能为 `raw` 或 `zstd`；`storedSize` 为物理包中该项占用的字节数。大小 SHALL 为安全非负整数，所有长度/偏移累计 SHALL 检查溢出。相同原始内容仍只存一次并合并用途，文件树、镜像 diff_ids、历史和包引用 SHALL 指向原始摘要。

`raw` SHALL 满足 storedSize=size；`zstd` SHALL 恰好为一个无需任何外部或预置字典的普通 Zstandard 帧，解码窗口至多 8 MiB，不接受 skippable frame、拼接帧或尾随字节。帧声明 content size 时 SHALL 与 size 一致；存在帧 checksum 时 SHALL 验证。即使帧未声明这些可选信息，也 SHALL 精确消费 storedSize 字节、完成帧解码，验证输出恰为 size 且 SHA-256 匹配 digest。读取超出声明输出量 SHALL 当即失败，不能先无限解压再比较。格式不合法、截断、哈希或长度不符返回 PACKAGE_INVALID，窗口/字节/元数据超限返回 PACKAGE_LIMIT_EXCEEDED，未知编码返回 PACKAGE_FORMAT_UNSUPPORTED。

导出 SHALL 使用一个内置、兼顾体积与速度的无损压缩策略；成功压缩不比原始内容小时选 raw，空 blob 写 raw 且两项大小为零。压缩等级不是 manifest 字段或用户配置。压缩过程失败 SHALL 使本次导出失败，不能以 raw 回退掩盖读取、编码、取消或写入失败。第三方生成的合法 zstd 项不以“必须节省体积”为读取前提。

整包 SHA-256 SHALL 覆盖文件头、manifest 和全部存储字节；包物理长度 SHALL 等于 `16 + manifest长度 + sum(storedSize)`。内容身份与编码字节身份 SHALL 区分：不同合法编码结果可以有相同 blob digest 与不同包 digest；不要求不同实现或版本产出相同压缩字节。已有同一快照的重复下载仍须返回原字节。

V2 SHALL 继承 PWORK-002/003/004、PWORK-SERVICE-ACCESS-001、PWORK-BRAIN-001、PWORK-MODEL-001 及现行存储、历史和快照规则的完整内容、平台/模型依赖、身份映射和不重放行为。压缩只影响包的编码大小，不改变导入后的原始环境、数据布局或运行能力，也不保证不同内容均有固定压缩收益。

#### Scenario: 压缩镜像层保持原始身份
- **WHEN** 一个镜像层以 zstd 编码写入 V2 并被读取
- **THEN** 文件区间按 storedSize 定位，解码后的 size/digest 与原层及 image config 的 diff_ids 匹配，镜像身份不因压缩改变

#### Scenario: 小文件或不可压缩内容使用 raw
- **WHEN** 成功试压后的内容不小于原始内容，或 blob 为空
- **THEN** writer 写 raw 且 storedSize=size，保留全部原始字节，不要求用户选择编码

#### Scenario: 严格消费压缩边界
- **WHEN** blob 截断、输出长短不符、摘要错误、帧后附垃圾，或包含第二帧/可跳过帧/字典依赖
- **THEN** 包校验失败，不越过该项 storedSize 区间读取其他 blob，不发布可导入包或 Work

#### Scenario: magic 与 manifest 不一致
- **WHEN** PIWORK1 对应 formatVersion=2，或 PIWORK2 对应 formatVersion=1
- **THEN** 返回 PACKAGE_INVALID，不通过猜测或宽松解析选择另一个版本

#### Scenario: 同一内容跨不同编码实现
- **WHEN** 两个符合 V2 约定的 writer 为相同原始 blob 生成不同合法压缩字节
- **THEN** 两包各自通过物理包校验，解码后的相同内容摘要与引用均被接受，不要求压缩字节完全一致

### Requirement: Work Spec 提供独立公开说明入口

**Identifier:** PWORK-DOC-001

Work Spec SHALL 在现有 portable-work 能力归属下提供自己的 README 入口和对应中英文说明，作为可独立阅读的模块级格式说明；项目导航与官网既有 Work 规范页 SHALL 提供有效入口。README SHALL 解释 Work、Spec/manifest、Package、Instance、内容闭包与外部依赖，列明 V1/V2 framing、全部 manifest 字段及引用关系、blob 编码、文件树与镜像身份、历史校验范围、资源限制、错误和版本兼容，并链接同版机器可读 schema 与可验证合成样例。读者 SHALL 能据此实现格式读写，不以源码内部函数名或已归档设计代替必要格式规则。

公开说明、schema、样例、实际 reader/writer SHALL 表达一致的接受与拒绝范围。官网 SHALL 沿用现有 Work 规范页面并清楚区分已支持与未发布版本；不把提案当作当前能力。该 README 属于 Work Spec 本身，不要求每个用户 Work 创建或自动维护 README。根项目 README 继续作为简短导航入口；真实 Work、凭证和私有内容不得成为公开样例。

#### Scenario: 第三方按规范读取 V2
- **WHEN** 开发者从 Work Spec README 或官网 Work 规范页实现读取器
- **THEN** 能找到精确字节布局、五项 blob 字段、允许的 Zstd 子集、schema、限制及合成正反例，正确区分内容摘要与包摘要

#### Scenario: 同时阅读旧包和新包规则
- **WHEN** 用户查阅 V1 兼容和 V2 导出说明
- **THEN** 两种语言明确新版读 V1/V2、默认写 V2、旧版不能读取 V2，以及压缩不等于减少安装占用或裁剪内容
