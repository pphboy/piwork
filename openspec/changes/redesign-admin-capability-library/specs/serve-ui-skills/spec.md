# Spec Delta

## MODIFIED Requirements

### Requirement: 浏览完整 Skill 管理状态

**Identifier:** SUI-SKL-001

能力库的 Skills 分类 SHALL 按名称列出启用和禁用 Skill；左侧先选择 Skill，再在其下展开相对文件树，切换 Skill 时收起上一项，并在右侧默认打开根 `SKILL.md` 原文。文件内容 SHALL 从专用管理员内容接口读取，按纯文本显示，不渲染 Markdown/HTML，不从 frontmatter 派生身份或管理元数据。name、enabled、fileCount、totalBytes、createdAt、updatedAt SHALL 在对应 Skill 的信息入口可读；宿主路径和内部制品 digest 不得展示。页面 SHALL 区分加载、空态和失败，支持手动刷新；对象不存在 SHALL 显示不可用及返回列表入口。

#### Scenario: 查看禁用 Skill
- **WHEN** Core 中存在禁用 Skill
- **THEN** 管理列表显示该项及禁用状态，管理员仍可读取其文件；启用状态、文件统计和时间在该项信息入口可读

#### Scenario: 列表为空或详情失效
- **WHEN** 列表为空或已打开的 Skill 被移除
- **THEN** 分别显示添加目录入口或已不可用提示，不将失败当作空列表；已有未保存正文不被失败或空结果覆盖

#### Scenario: 从 Skill 进入文件内容
- **WHEN** 选择 code-review，随后展开 references 并选择其中一个文件
- **THEN** 左侧维持 Skill → 文件层级，右侧先显示 `SKILL.md`、后显示所选文件原文，选中项与展开状态分别表达

#### Scenario: 名称与文件内容包含标记
- **WHEN** 文件原文包含 frontmatter、HTML 标签、脚本或与目录名不同的 name
- **THEN** 内容按原文显示，不执行、不作为产品管理元数据，Skill 身份仍为目录名

### Requirement: 执行 Skill 开关与移除

**Identifier:** SUI-SKL-003

每项 SHALL 在左侧对应 Skill 行菜单提供信息、更新文件夹、与 enabled 对应的启用/禁用及移除动作，菜单明确显示目标名称。操作 SHALL 使用被触发行的 Skill 名称，不从当前打开的 Skill 或文件推测目标。页头只承载页面操作，文件工具栏只承载当前文件保存；默认选择在“新 Work 默认”视图管理，不放进这些菜单。移除 SHALL 确认名称与后续新 Work 不再可选择的影响；已存在 Work 的副本仍保留。被默认 Work 选择的 Skill 禁用/移除失败时 SHALL 在目标 Skill 的反馈中说明先移出默认，并提供导航；不得自动修改默认选择或把失败当作当前文件错误。成功后 SHALL 更新目标行或返回列表；并发状态变化以 Core 实际结果为准。

#### Scenario: 默认引用保护
- **WHEN** 管理员禁用或移除仍被默认配置引用的 Skill
- **THEN** 显示目标 Skill 的引用保护原因，条目及默认选择不变，可跳转新 Work 默认；离开当前文件前仍处理未保存草稿

#### Scenario: 移除非默认 Skill
- **WHEN** 管理员确认移除未被默认引用的 Skill 且 Core 成功
- **THEN** 列表移除该项，不暗示已有 Work 的副本被删除

#### Scenario: 管理未打开的 Skill
- **WHEN** 右侧正在编辑 code-review，而从 legacy-notes 行菜单查看信息、启停或移除 legacy-notes
- **THEN** 请求、确认和反馈均属于 legacy-notes，不切换或保存 code-review，不丢失其草稿；文件保存仍只提交原文件

## ADDED Requirements

### Requirement: 编辑并显式保存当前 Skill 文件

**Identifier:** SUI-SKL-004

右侧 SHALL 提供当前独立 Skill 文件的 UTF-8 原文编辑和显式保存，显示完整相对路径及未保存状态；无修改时保存禁用。保存只提交当前文件及其读取版本，确认成功后更新该文件基线，不批量保存其他文件，不修改默认选择或触发 Work Apply。切换文件、Skill、分类或视图前有未保存修改时 SHALL 提供保存后切换、放弃修改、继续编辑。非文本文件 SHALL 显示不可编辑及更新文件夹入口说明，不转码保存。失败、冲突、结果未知和迟到结果 SHALL 保留所属草稿并遵循原管理反馈与身份规则；不自动重放写入，不持久化浏览器草稿。

#### Scenario: 保存当前文件
- **WHEN** 管理员修改 references/checklist.md 并保存
- **THEN** 请求只携带该文件的相对路径、文本及读取版本；只有 Core 确认后显示已保存，其他文件和默认选择不变

#### Scenario: 保存时继续输入
- **WHEN** 文件保存已提交，管理员又输入新文本，原提交随后成功
- **THEN** 成功只确认原提交快照，后续输入继续标为未保存，不被原响应覆盖

#### Scenario: 离开未保存的文件
- **WHEN** 当前文件有修改，用户选择另一个文件或切换到新 Work 默认
- **THEN** 继续编辑保留原对象与草稿；放弃后才切换；保存后切换只在保存明确成功后继续，失败时停留原文件

#### Scenario: 保存被拒绝或内容冲突
- **WHEN** 保存被限额、权限、文件不可用或版本冲突拒绝
- **THEN** 保留输入并显示可执行原因；冲突不被自动覆盖或重试，重新读取替换草稿前须显式确认

#### Scenario: 保存结果未知
- **WHEN** 请求可能已被 Core 提交但浏览器未收到可确认的响应
- **THEN** 保留原 Skill、路径、提交快照及未知提交锁，提供原文件只读核对；核对不自动重提保存，也不覆盖之后的输入

#### Scenario: 读取切换和身份失效
- **WHEN** 文件 A 的读取晚于切换到文件 B 返回，或管理员会话失效
- **THEN** 前者不覆盖 B；后者停止受保护读取与保存，清理内容、草稿及上传文件引用，不跨身份复用

#### Scenario: 文件不是可编辑文本
- **WHEN** 所选文件不是有效 UTF-8 文本或包含 NUL
- **THEN** 显示不可编辑，保存不可用，说明可从该 Skill 行菜单更新文件夹；不显示乱码、不执行文件
