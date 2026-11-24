# Spec Delta

## MODIFIED Requirements

### Requirement: Discover selectable Skills without host details

**Identifier:** SKM-003

已认证用户 SHALL 能在创建或配置 Work 前，按 Core 分配的目录名称列出和查看启用 Skills。 Operators 及通过管理员管理 API 访问的启用管理员 SHALL 额外看到禁用 Skills、文件数、总字节数、时间和管理状态。普通用户发现接口继续只返回启用项的公开名称。Core MUST NOT 暴露从 `SKILL.md` 解析的元数据。普通用户发现响应、一般 Work 配置响应、Session 历史、Run 事件和错误 MUST NOT 泄露原导入路径、Core 制品路径、内部内容摘要、Skill 文件正文或其他 Work 的副本。仅 WCFG-EDIT-001 定义的显式 Work 所有者内容接口 SHALL 能返回该用户自己 Work 副本的相对文件名和所请求文本；这不授权读取 Core 全局制品或他人 Work，也不扩大全局发现响应的字段。结果 SHALL 按 Skill name 排序。

WCFG-EDIT-009 的 Work 私有目录导入 SHALL 不依赖全局发现是否为空，不创建或更新 Core catalog；导入内容仅在目标 Work 的所有者接口内可读取编辑，其他用户不得经全局发现取得其名称或正文。Core 全局导入及管理权限继续遵守 SKM-001、SKM-002 和 SKM-004，不因新增 Work 内容入口而扩大。

#### Scenario: 私有导入不进入 Core 发现目录
- **WHEN** 普通所有者将本机目录导入自己的 Work，且 Core 此前没有该 Skill
- **THEN** 该 Work 可读取编辑其副本，Core 全局发现仍不包含此私有 Skill，其他 Work 与默认配置不变

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

#### Scenario: 发现目录与编辑 Work 副本分开
- **WHEN** 所有者查看 Core 目录后显式读取自己的 Work Skill，而 Core 与 Work 中同名内容不同
- **THEN** 发现仍只返回名称；内容接口仅返回该 Work 的相对文件列表和所请求文本，不返回 Core 当前正文或制品身份

#### Scenario: 管理权限不扩展 Work 内容权限
- **WHEN** 管理员可管理 Core Skill 但不是目标 Work 的所有者
- **THEN** 全局管理能力不允许通过 Work 编辑接口读取或修改目标 Skill 正文，现有 Work 内容权限继续生效
