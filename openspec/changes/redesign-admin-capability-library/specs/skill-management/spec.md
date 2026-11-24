# Spec Delta

## MODIFIED Requirements

### Requirement: Manage a Skill by its directory name

**Identifier:** SKM-002

Core SHALL 允许 operator 及已启用管理员通过各自受保护管理入口，使用导入时的 basename 查看、列出、更新、启用、禁用和移除 Skill。operator 的路径更新 SHALL 接受 API 的 path 字段，要求规范化来源目录 basename 等于目标 Skill，在完整树验证后原子替换当前 Core 制品。Core MUST NOT 在更新时解析 `SKILL.md`。添加或更新失败 MUST 保留原 catalog 与制品。Skill 仍被默认 Work 选择时 SHALL 拒绝禁用或移除；Core Skill 的更新、禁用或移除 MUST NOT 修改或破坏已有 Work 持有的副本。

管理员目录整体更新 SHALL 使用 SKM-004 的目录上传，要求所声明根目录名等于目标 Skill；现有文本文件的保存 SHALL 使用 SKM-007。两者成功后均保留原 enabled 状态和默认引用。内容入口不得读取调用者指定的宿主路径；operator 的原有路径导入继续有效。Core 不解析文件正文或 frontmatter，也不把编辑后的 name 用作 Skill 身份。

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

## ADDED Requirements

### Requirement: 管理员读取 Skill 相对文件清单

**Identifier:** SKM-005

Core SHALL 提供 `GET /api/v1/admin/skills/<name>/files`，仅向当前已启用管理员返回该独立 Skill 当前制品的 `files`，每项只含相对 `path` 和字节 `size`，按相对路径排序；父目录可从路径推导。读取 SHALL 限于该 Skill，包含禁用 Skill，不包含符号链接、宿主路径或内部制品标识。原 catalog、普通用户发现、Work、Session 和 Run 的响应边界保持不变；新内容接口不成为 operator 路径读取或任意文件代理。

#### Scenario: 读取完整目录中的文件
- **WHEN** 已启用管理员请求含 SKILL.md、references/rules.md 和二进制附件的 Skill 清单
- **THEN** 返回当前制品的普通文件路径与大小，不携带正文，不依赖最初上传的浏览器或宿主来源路径

#### Scenario: 拒绝其他身份或任意资源
- **WHEN** 匿名、普通用户、失效或禁用管理员调用内容入口，或请求未知 Skill、其他 Work 路径
- **THEN** 依原鉴权规则拒绝未授权身份，未知 Skill 返回 SKILL_UNAVAILABLE；不读取其他资源，不泄露正文、路径或内部制品摘要

### Requirement: 管理员读取可编辑的 Skill 文件原文

**Identifier:** SKM-006

Core SHALL 提供 `GET /api/v1/admin/skills/<name>/file?path=<相对路径>`，仅向当前已启用管理员返回现有普通文件的 `path`、UTF-8 `content` 和不透明 `version`。正文按字节内容判定为有效 UTF-8 且不含 NUL，最大 8 MiB，不解析或执行文件。version SHALL 只校验该文件的内容，不暴露内部制品 digest。相对路径沿用上传的安全边界；内容响应 SHALL 禁止缓存，错误和日志不得附带正文或宿主路径。

#### Scenario: 读取指令和支持文件
- **WHEN** 管理员分别读取 SKILL.md 和 references/rules.md
- **THEN** 得到各自原文和可用于对应文件保存的版本；frontmatter 仍是原文，不成为管理元数据

#### Scenario: 非文本或不存在的文件
- **WHEN** 相对路径对应非 UTF-8、含 NUL 的文件，或该普通文件不存在
- **THEN** 前者返回 415 SKILL_FILE_NOT_TEXT，后者返回 404 SKILL_FILE_NOT_FOUND；不执行、转码或新建文件

#### Scenario: 路径逃逸与编码
- **WHEN** 文件路径含绝对路径、驱动器前缀、反斜线、空段、点段、父目录段、控制字符，或超过上传已有深度与长度边界
- **THEN** 返回 400 SKILL_FILE_INVALID；路径只解码一次，不通过二次解码或链接逃出当前 Skill

### Requirement: 原子保存一个现有 Skill 文本文件

**Identifier:** SKM-007

Core SHALL 提供管理员 `PUT /api/v1/admin/skills/<name>/file`，接受 `path`、UTF-8 `content`、非空 `expectedVersion`，只替换已存在的可编辑普通文件。保存 SHALL 基于当前制品核对该文件版本，完整校验并原子发布新制品，返回已保存文件的 `path` 和新 `version`。未编辑文件、Skill 名称、enabled、默认引用及已有 Work 副本保持不变。更新内容不超过 8 MiB，整个 Skill 不超过 32 MiB；不提供文件创建、重命名或删除。鉴权在接收前及发布前均有效；失败不发布半成品。

#### Scenario: 成功保存及重新读取
- **WHEN** 管理员提交当前文件的读取版本和合法新文本，随后重新读取或重启 Core 后读取
- **THEN** 返回已持久保存的新文本与新版本，其他文件字节和已有 Work 副本不变；新建 Work 可复制新制品

#### Scenario: 同一文件被并发修改
- **WHEN** 两次保存基于同一旧版本，或目录更新已改变该文件，后续提交的 expectedVersion 与当前正文不符
- **THEN** 返回 409 SKILL_FILE_CONFLICT，不覆盖已确认的新内容；前端可保留草稿并显式重新读取，不自动合并或重试

#### Scenario: 另一个文件已被更新
- **WHEN** 当前文件版本仍匹配，但同一 Skill 的其他文件在本次编辑期间已更新
- **THEN** 保存基于最新完整制品只替换当前文件，保留另一个文件已经发布的更新

#### Scenario: 文件被移除或目标是二进制
- **WHEN** 目录更新已移除目标文件，或该目标不再是可编辑文本
- **THEN** 分别按文件不存在或不可编辑拒绝保存，不把保存变成文件新增或二进制替换

#### Scenario: 请求格式、大小与身份
- **WHEN** 缺少版本、路径或正文非法、解码后单文件或总内容超限、鉴权失效，或传输/发布失败
- **THEN** 格式错误返回 400 SKILL_FILE_INVALID，超限返回既有 413 SKILL_UPLOAD_LIMIT_EXCEEDED，身份遵守既有 401/403；不改变原 catalog、其他文件或 Work 副本

#### Scenario: 写入响应无法确认
- **WHEN** Core 发布成功但连接在成功响应前中断
- **THEN** 已发布结果保持持久；后续只读原文件可核对当前内容，服务端不因连接中断回滚、不依赖客户端自动重放
