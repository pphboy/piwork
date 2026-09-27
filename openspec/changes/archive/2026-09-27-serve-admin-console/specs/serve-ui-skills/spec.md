# Serve UI Skills Spec Delta

## Purpose

定义管理员通过浏览器查看和管理 Core Skill 库的交互，使用本地目录内容上传实现添加及更新，并明确目录名称、文件限制、默认引用保护以及失败后的恢复，使 UI 可依据公开管理接口独立实现。

## ADDED Requirements

### Requirement: 浏览完整 Skill 管理状态

**Identifier:** SUI-SKL-001

Skills 页 SHALL 列出启用和禁用的 Skill，按名称排序，详情显示 name、enabled、fileCount、totalBytes、createdAt 和 updatedAt。页面 SHALL 区分加载、空态和失败，并支持手动刷新。不得展示或推断 SKILL.md 的 frontmatter、Skill 文件内容、宿主路径或内部 digest。详情对象不存在 SHALL 显示已不可用并提供返回列表入口。

#### Scenario: 查看禁用 Skill
- **WHEN** Core 中存在禁用 Skill
- **THEN** 管理列表仍显示该项和禁用状态，详情只显示公开管理元数据

#### Scenario: 列表为空或详情失效
- **WHEN** 列表为空或已打开的 Skill 被移除
- **THEN** 分别显示添加目录入口或已不可用提示，不将失败当作空列表

### Requirement: 通过本地目录添加和更新 Skill

**Identifier:** SUI-SKL-002

添加和更新 SHALL 使用浏览器目录选择，完整发送浏览器提供的相对文件树；页面不得提供宿主路径输入。名称 SHALL 来自所选根目录 basename，符合 `[a-z0-9][a-z0-9-]{0,63}`，不可由 SKILL.md 或上传临时目录覆盖。更新时 basename SHALL 等于目标 name。提交前 SHALL 显示目录名、文件数和总大小，验证根 SKILL.md、最多 2,048 文件、32 MiB 总内容及 8 MiB 单文件，Core 独立重验。

选择文件夹取消 SHALL 保留原选择；不支持目录选择的浏览器 SHALL 显示不支持提示并禁用上传，不退回服务器路径。上传 SHALL 展示已发送字节进度和随后服务端验证状态；只有收到 Core 成功响应才显示添加/更新成功。错误 SHALL 保留可重选和重试入口；响应丢失 SHALL 提示查询当前条目后再决定重试，不把重复添加自动改成更新。关闭页面可能终止未完成传输，但完整请求已被 Core 发布后不能宣称已撤回。

#### Scenario: 上传另一台设备上的目录
- **WHEN** 浏览器选择 code-review 目录，Core 宿主不存在该路径
- **THEN** 请求携带相对文件名及内容，成功新增 code-review，未来使用不依赖客户端目录

#### Scenario: 目录名称与内容名称不同
- **WHEN** code-review/SKILL.md 声明其他名字或含不可解析 frontmatter
- **THEN** 页面仍以 code-review 上传，不解析该内容作为身份；Core 接受安全文件树后返回该名称

#### Scenario: 更新名称不符
- **WHEN** 正在更新 code-review 却选择 other-skill
- **THEN** 显示 SKILL_NAME_MISMATCH 并阻止提交，原 Skill 不变

#### Scenario: 无效目录或上传中断
- **WHEN** 缺少 SKILL.md、超过限制或传输未完成
- **THEN** 不显示成功，完整发布前原条目保持不变，用户可重新选择并提交

### Requirement: 执行 Skill 开关与移除

**Identifier:** SUI-SKL-003

每项 SHALL 提供与 enabled 状态对应的开关及移除动作。移除 SHALL 确认名称与后续新 Work 不再可选择的影响；已存在 Work 的副本仍保留。被默认 Work 选择的 Skill 禁用/移除失败时 SHALL 提示先在默认 Work 页移出，并提供入口；不得自动修改默认选择。成功后 SHALL 更新行或返回列表；并发状态变化 SHALL 以 Core 实际结果为准。

#### Scenario: 默认引用保护
- **WHEN** 管理员禁用或移除仍被默认配置引用的 Skill
- **THEN** 显示引用保护原因，条目及默认选择不变，可跳转默认 Work 页面

#### Scenario: 移除非默认 Skill
- **WHEN** 管理员确认移除未被默认引用的 Skill 且 Core 成功
- **THEN** 列表移除该项，不暗示已有 Work 的副本被删除
