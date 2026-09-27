# Skill Management Specification

## Purpose

定义 Core 如何从 operator 提供的目录安全导入和管理完整 Skill 制品，并以导入目录 basename 作为稳定公开身份供默认配置与 Work 选择。

## Requirements

### Requirement: Import a complete Skill directory into Core

**Identifier:** SKM-001

`piwork-serve skills add` SHALL accept exactly one `--path <directory>` from an authenticated operator. Core SHALL require an absolute readable directory whose root is not a symbolic link, derive the sole public Skill identifier from the final non-empty directory basename after path normalization, and require that basename to match `[a-z0-9][a-z0-9-]{0,63}` without case conversion or character rewriting. The directory SHALL contain a readable regular `SKILL.md`; Core MUST NOT parse, decode, or derive identity or public metadata from its contents. Core SHALL recursively copy the complete directory into Core-managed durable storage and publish the Skill atomically only after validating the copied tree. The full source path MUST NOT be persisted, disclosed, or remain a runtime dependency. A Skill import SHALL contain at most 2,048 regular files and 32 MiB total content; symbolic links, devices, sockets, FIFOs, path escapes, duplicate directory basenames, and an individual file larger than 8 MiB MUST be rejected.

#### Scenario: Import a valid directory
- **WHEN** an operator adds absolute directory `/opt/piwork-skills/code-review` containing a regular `SKILL.md` and whose tree satisfies all import limits
- **THEN** Core returns enabled Skill `code-review`, preserves the complete copied tree in Core-managed storage, and no longer needs the source directory for later Work creation

#### Scenario: Reject an unsafe or malformed directory
- **WHEN** the source is relative, missing, unreadable, rooted at a symbolic link, contains a symbolic link or unsupported file type, exceeds an import limit, lacks a readable regular `SKILL.md`, or its directory basename is invalid
- **THEN** Core returns a field-specific import error and creates neither a visible Skill nor a partial managed artifact

#### Scenario: Reject a duplicate Skill name
- **WHEN** an operator adds a directory whose basename already identifies an existing Skill
- **THEN** Core returns `SKILL_ALREADY_EXISTS`, keeps the existing managed artifact unchanged, and directs the operator to the update command

#### Scenario: Ignore SKILL metadata when assigning identity
- **WHEN** an operator adds directory `code-review` whose `SKILL.md` omits `name`, contains malformed frontmatter, or declares a different name
- **THEN** Core imports the bytes without parsing them and assigns public Skill identifier `code-review`; any Pi SDK format failure is reported later when a Work attempts to activate that copied Skill

#### Scenario: Reject non-operator import
- **WHEN** an ordinary user or unauthenticated caller attempts to import a Skill directory
- **THEN** Core rejects the operation without reading the supplied host path

### Requirement: Manage a Skill by its directory name

**Identifier:** SKM-002

Core SHALL 允许 operator 及已启用管理员通过各自受保护管理入口，使用导入时的 basename 查看、列出、更新、启用、禁用和移除 Skill。operator 的路径更新 SHALL 接受 `--path`，要求规范化来源目录 basename 等于目标 Skill，在完整树验证后原子替换当前 Core 制品。Core MUST NOT 在更新时解析 `SKILL.md`。添加或更新失败 MUST 保留原 catalog 与制品。Skill 仍被默认 Work 选择时 SHALL 拒绝禁用或移除；Core Skill 的更新、禁用或移除 MUST NOT 修改或破坏已有 Work 持有的副本。

管理员内容更新 SHALL 使用 SKM-004 的目录上传，要求所声明根目录名等于目标 Skill，成功后保留原 enabled 状态。内容入口不得读取调用者指定的宿主路径；operator 的原有路径导入继续有效。

#### Scenario: Update current content
- **WHEN** operator 从 basename 同样为 `code-review` 的合法目录更新 `code-review`
- **THEN** 后续 Work 复制新导入的完整制品，每个已有 Work 继续使用原有独立副本

#### Scenario: Reject an update name mismatch
- **WHEN** operator 使用另一个合法 Skill 名称的目录更新 `code-review`
- **THEN** Core 返回 `SKILL_NAME_MISMATCH`，保留现有 `code-review` 制品和状态

#### Scenario: Protect the default selection
- **WHEN** operator 尝试禁用或移除仍被默认 Work 配置选择的 Skill
- **THEN** Core 拒绝操作，要求先将该名称移出默认选择

#### Scenario: Remove an unreferenced managed Skill
- **WHEN** operator 移除不在默认 Work 选择中的启用或禁用 Skill
- **THEN** Core 将其移出发现列表和 Core 管理存储，保留副本的已有 Work 仍可启动和恢复

#### Scenario: 管理员更新禁用 Skill 的上传内容
- **WHEN** 已启用管理员上传与目标同名的合法目录更新禁用 Skill
- **THEN** 新内容原子发布且 Skill 仍为禁用，已有 Work 的副本保持不变

### Requirement: Discover selectable Skills without host details

**Identifier:** SKM-003

已认证用户 SHALL 能在创建或配置 Work 前，按 Core 分配的目录名称列出和查看启用 Skills。 Operators 及通过管理员管理 API 访问的启用管理员 SHALL 额外看到禁用 Skills、文件数、总字节数、时间和管理状态。普通用户发现接口继续只返回启用项的公开名称。Core MUST NOT 暴露从 `SKILL.md` 解析的元数据。普通用户响应、Work 配置响应、Session 历史、Run 事件和错误 MUST NOT 泄露原导入路径、Core 制品路径、内部内容摘要、Skill 文件正文或其他 Work 的副本。结果 SHALL 按 Skill name 排序。

#### Scenario: User lists selectable Skills
- **WHEN** 已登录用户列出 Skills，此时 `code-review` 启用而 `legacy-review` 禁用
- **THEN** 响应包含目录名 `code-review` 并省略 `legacy-review`，不包含宿主路径、制品路径、解析的 `SKILL.md` 元数据或文件内容

#### Scenario: Operator lists all managed Skills
- **WHEN** 已认证 operator 列出 Skills
- **THEN** 响应按名称返回启用和禁用条目及公开管理状态，不包含 Skill 文件正文

#### Scenario: Show an unavailable Skill
- **WHEN** 用户按名称查询不存在或禁用的 Skill
- **THEN** Core 返回相同的公开不可用结果，不透露隐藏宿主路径是否存在

#### Scenario: 管理员查看完整管理状态
- **WHEN** 启用管理员通过管理 API 查询 Skills
- **THEN** 返回与 operator 一致的公开管理投影，包含禁用项，不包含文件正文或宿主路径

### Requirement: 接收客户端 Skill 目录内容

**Identifier:** SKM-004

Core SHALL 通过管理员内容入口接收 multipart/form-data 目录快照并原子添加或更新 Skill。第一个 part SHALL 是唯一文本字段 directoryName，匹配 Skill name 规则；后续 part SHALL 都是名为 files 的普通文件，每个 filename 为相对路径的 encodeURIComponent 结果，经一次严格 UTF-8 URI 解码后作为目录内路径，不使用原始文件名或临时目录 basename 推断身份。根目录不计入相对路径；根 SKILL.md 必须作为普通文件存在。文件内容 SHALL 不经过 Markdown 或 frontmatter 解析。

协议 SHALL 只创建普通文件及其必要父目录，不表达符号链接、设备或文件权限，也不承诺保留未传输的空目录。相对路径 SHALL 拒绝绝对路径、驱动器前缀、反斜线、空段、点段、父目录段、NUL/控制字符、重复路径、文件与目录冲突、无效 UTF-8；最大 64 层、4,096 UTF-8 字节。上传 SHALL 限制 2,048 文件、总文件内容 32 MiB、单文件 8 MiB、总 HTTP body 64 MiB，以及 60 秒无进展、30 分钟总时限。Core SHALL 在读 body 前鉴权，在完整接收并验证后、发布前重新鉴权。最多同时接收两个 Skill 内容上传，超额返回 429 SKILL_UPLOAD_BUSY。

接收和验证期间 SHALL 不产生可见 catalog 变更；添加重复 name 返回 409 SKILL_ALREADY_EXISTS，更新 name 不同返回 400 SKILL_NAME_MISMATCH，未知目标返回 404 SKILL_UNAVAILABLE。格式/树安全错误返回 400 SKILL_UPLOAD_INVALID，超限返回 413 SKILL_UPLOAD_LIMIT_EXCEEDED，超时返回 408 SKILL_UPLOAD_TIMEOUT，不支持媒体类型返回 415 UNSUPPORTED_MEDIA_TYPE。连接中断和失败 SHALL 清理本次暂存，启动恢复 SHALL 清理未发布上传。最终发布 SHALL 复用与路径导入一致的制品与 catalog 规则；已有条目和 Work 副本在失败时保持不变。

#### Scenario: 远程目录内容成功添加
- **WHEN** 客户端发送 directoryName=code-review、根 SKILL.md 和 references/rules.md 的有效 multipart
- **THEN** Core 返回 enabled 的 code-review 及文件统计，完整内容在 Core 持久保存，来源机器路径不被保存

#### Scenario: 拒绝逃逸和重复内容
- **WHEN** multipart 含编码后的 ../、绝对路径、重复 files 路径或文件/目录冲突
- **THEN** 整体拒绝，暂存清理，catalog 和暂存目录之外的文件不变

#### Scenario: 中断与限额
- **WHEN** 传输中断、长度不完整、超过任一大小限制或超时
- **THEN** 不发布半个 Skill，返回可返回的安全错误，旧 Skill 保持可用

#### Scenario: 恰好达到上限
- **WHEN** 合法树恰好达到 2,048 文件或 32 MiB，且每个文件不超过 8 MiB
- **THEN** 在其他约束满足时成功；超过任何边界一个单位则整体失败

#### Scenario: 内容入口不读取宿主路径
- **WHEN** 客户端发送 JSON path 或附加 hostPath 字段试图导入服务器目录
- **THEN** Core 拒绝不符合内容协议的请求，不读取该宿主路径
