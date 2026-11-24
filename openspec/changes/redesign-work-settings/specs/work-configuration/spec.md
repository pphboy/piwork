# Spec Delta

## ADDED Requirements

### Requirement: Work 所有者可读取独立 Skill 文本

**Identifier:** WCFG-EDIT-001

系统 SHALL 为 Work 所有者提供显式的 Settings 编辑内容接口，读取该 Work desired 中独立 Skill 的相对文件列表及选定 UTF-8 文本。读取 SHALL 绑定请求中明确的 Work、Skill 和相对文件，不读取 Core 全局制品、其他 Work 或宿主路径。管理员控制权限与 operator 身份 SHALL 不额外授予他人 Work 的内容读取权限。现有普通配置、目录、历史与事件响应 SHALL 不因此附带 Skill 正文。

#### Scenario: 管理员不能借控制权限取得他人文件
- **WHEN** 普通用户、非所有者管理员或 operator 尝试读取不属于自己的 Work Skill 内容
- **THEN** 按现有 Work 内容授权拒绝，不读取目标文件，不返回正文或宿主/制品路径

#### Scenario: 只读取显式请求的文本
- **WHEN** 所有者请求某个 Work Skill 的文件列表和其中 `SKILL.md`
- **THEN** 只返回该 Work 副本的相对文件名与所请求文本，不返回 Core 当前正文、内部摘要或宿主路径

### Requirement: Skill 文件编辑遵守现有边界

**Identifier:** WCFG-EDIT-002

文件编辑器 SHALL 支持既有 `SKILL.md` 和配套文本文件；编辑操作不创建、删除或重命名文件或 Skill，完整目录的新增导入由 WCFG-EDIT-009 处理。非文本、无法有效解码的 UTF-8 内容或超过现有 1 MiB 文本编辑上限的文件 SHALL 仅标明不可编辑原因，不截断、替换或损坏原内容。相对路径 SHALL 遵守现有 Skill 路径与目录安全规则，拒绝逃逸、重复目标、符号链接及不属于目标 Skill 的文件；完整树仍满足现有 Skill 制品限制。

#### Scenario: 非文本配套资源保持不变
- **WHEN** Skill 含二进制资源或超出文本编辑上限的文件，用户编辑另一个合法文本
- **THEN** 列表说明不可编辑项的原因，保存原样保留这些文件，不将预览、编码替换字符或截断文本写回

#### Scenario: 路径逃逸与拒绝泄漏
- **WHEN** 请求包含 `../`、绝对路径、符号链接或重复文件目标
- **THEN** 整次读取或保存被拒绝，不返回私有内容或宿主路径

### Requirement: Settings 保存原子合入最新 desired

**Identifier:** WCFG-EDIT-003

Settings 保存 SHALL 将本次明确提交的 Skill 选择变更、已存在文件的文本修改、AGENTS.md 及已安装包的启停字段原子合入该 Work 最新 desired。未提交的字段、未编辑的 Skill 文件、未涉及的 Work Skill 和包制品、Work 自有镜像及模型/MCP/工具/资源设置 SHALL 保留。该接口 SHALL 不改变现有完整配置 PUT、专用 Skill 显式重选及 CLI/API 的既有语义。

#### Scenario: 只编辑当前 Work 的两个文件
- **WHEN** 所有者修改 Work A 中 `code-review/SKILL.md` 与 `references/checklist.md` 并保存
- **THEN** 两个文本同时进入 A 的新 desired；A 的 active、另一个未编辑配套文件、Core 与 Work B 的同名 Skill 内容保持不变，只有显式 Apply 后才采用新内容

#### Scenario: 原子拒绝部分非法编辑
- **WHEN** 同一次保存含合法 AGENTS 修改和一个逃逸路径、重复文件目标、非法文本或超限的 Skill 编辑
- **THEN** 整次修改不发布，原 desired/active 保留，客户端保留全部编辑并定位错误

#### Scenario: 网页保存保留隐藏字段
- **WHEN** 现有或导入 Work 使用不同于 Core 默认的镜像、模型及 MCP/工具/资源值，用户只保存 Skill 文件或 AGENTS
- **THEN** 保存从该 Work 当前 desired 保留这些字段，不从 Core 默认值或 active 覆盖，且不要求在网页输入完整 JSON

### Requirement: 保留项使用 Work 副本，新增项区分内容来源

**Identifier:** WCFG-EDIT-004

保留的 Skill SHALL 从该 Work 已有副本取得；只有通过 Core 名称选择新加入的 Skill 从 enabled Core 目录捕获，WCFG-EDIT-009 导入则使用本次上传内容。增删或排序其他 Skill SHALL 不重新复制同名内容。当前 Core 同名 Skill 变化、禁用或删除 SHALL 不阻止保留 Work 副本及其文件编辑。相同名称已经属于该 Work desired 时，重复 Core 选择 SHALL 保留已有副本；目录导入重名 SHALL 拒绝覆盖。

#### Scenario: Core 变化不刷新保留副本
- **WHEN** Core 中的同名 Skill 已更新、禁用或删除，用户保存保留项的文件编辑
- **THEN** 保存继续使用该 Work 已有副本和编辑结果，不读取也不刷新 Core 内容

#### Scenario: 添加其他 Skill 保留本地内容
- **WHEN** Work A 已持有与 Core 同名但内容不同的 Skill，用户通过 Settings 添加或移除其他 Skill
- **THEN** 保留项继续使用 A 的副本；通过 Core 名称选择的新加入项才读取 enabled Core 目录，目录导入项使用上传内容；Core 已删除保留项也不会导致保存失败

### Requirement: Context 不可变发布与失败保留

**Identifier:** WCFG-EDIT-005

保存 SHALL 发布新的完整、不可变 Work-owned context，成功前不得暴露部分更新；active、既有 Run/Session 引用及只读运行挂载不变。任何授权、路径、文本、容量或制品校验失败 SHALL 保留原 desired 与 active，并定位可公开的 Skill/文件或字段。相同目标的并发修改按既有 Core 提交顺序生效，不相关的并发字段更新 SHALL 保留；不引入公开配置 revision 或新的可变持久草稿。

#### Scenario: 不相关并发字段保留
- **WHEN** 另一个客户端同时更新模型或包开关，而本次保存只编辑 Skill 文件
- **THEN** 本次显式修改生效，不相关的已提交字段保持最新值，不被旧表单覆盖

#### Scenario: 发布失败不暴露部分内容
- **WHEN** 新 context 发布或提交校验失败
- **THEN** 原 desired 与 active 保持不变，失败 candidate 被清理，客户端保留编辑并定位错误

### Requirement: 文件 bytes 差异参与待应用判断

**Identifier:** WCFG-EDIT-006

同名同选择但文件 bytes 改变 SHALL 参与 `pendingApply`，不能仅比较 Skill 名称判定无改动。保存成功不证明当前运行已加载新内容；显式 Apply SHALL 继续遵守 WCFG-002、WCFG-004 与 SKILL-001—003，包括捕获时点、SDK 验证、后续保存保留、stopped 状态和失败恢复。

#### Scenario: 同名文件修改仍待应用
- **WHEN** 只有某个已选 Skill 的配套文件 bytes 变化，名称数组与其他配置均不变
- **THEN** 保存后 desired 与 active 的内容差异使 `pendingApply` 为 true，当前已确认 runtime 不冒充加载了新 bytes

#### Scenario: 晚保存不改变在途 Apply 的捕获内容
- **WHEN** Apply 捕获 B 后，所有者保存 Skill 文件 C
- **THEN** 原 Apply 只验证并激活 B；C 保留在 desired，依真实内容差异继续待应用，运行加载状态按 B 的实际观测表达

### Requirement: 添加 Skill 只捕获新增副本

**Identifier:** WCFG-EDIT-007

显式从 Core 添加 Skill SHALL 能只提交所选新增名称；本地目录新增遵循 WCFG-EDIT-009。两种来源 SHALL 在确认保存后立即取得可编辑的 Work 自有副本和真实 `pendingApply`，不包含其他本地未保存编辑，不触发 Apply。Core 名称已经属于该 Work desired 时 SHALL 保留已有副本，不将重复选择解释为采用 Core 新内容。

#### Scenario: 添加后立即编辑但不保存其他更改
- **WHEN** 用户已有未保存的 AGENTS 或另一个 Skill 文件编辑，并显式添加新的 Skill
- **THEN** 只将新增副本保存到 Work desired；确认后可立即读取并编辑其文件，原本地编辑保持未保存，当前 runtime 不变且新增项待应用

### Requirement: 未确认保存按实际内容核对

**Identifier:** WCFG-EDIT-008

保存结果未确认时，接口 SHALL 支持对请求明确涉及的字段、Skill 选择和文件内容取得同一 desired 的一致读取视图，不暴露内部 context ID 或 digest。界面 SHALL 按实际内容核对当前保存事实，不仅核对名称，不重放原写入；读取失败或内容不同 SHALL 保留用户编辑并说明尚不能确认，不能自动判为保存失败或成功。后续本地编辑 SHALL 不被原保存响应或核对读取覆盖。

#### Scenario: 结果未确认时按内容检查
- **WHEN** Skill 文件保存的响应丢失，名称未变，用户在等待期间又编辑了该文件
- **THEN** 检查读取本次保存涉及的实际字段与文件 bytes；不能以名称相同判定成功，不重新发保存，原响应或读取均不覆盖后续编辑

### Requirement: Work 所有者可直接导入自己的 Skill 目录

**Identifier:** WCFG-EDIT-009

Work 所有者 SHALL 能通过浏览器上传含根 `SKILL.md` 的本机目录，直接添加为当前 Work 的独立 Skill；无需管理员或预先存在的 Core Skill。名称取目录 basename 并沿用 SKM-001，上传沿用 SKM-004 的路径与容量限制，不读取客户端指定的宿主路径，也不解析正文推断名称或创建/更新 Core catalog、默认配置与其他 Work。系统 SHALL 在读取 body 前与发布前检查目标 Work 的 Content 权限及身份有效性；完整校验成功后才公开新增副本，失败清理暂存并保留原 desired/active。导入只新增本次 Skill，保留已有内容、隐藏字段与其他本地草稿，成功后待应用且不隐式 Apply；同名 SHALL 返回 `SKILL_ALREADY_EXISTS` 且不覆盖。取消或响应丢失不被解释为服务端已撤销；明确失败与结果未确认分别表达，不自动重传。

#### Scenario: 空 Core 目录下普通所有者导入
- **WHEN** Core 的 Skill 目录为空且 Work 无独立 Skill，普通所有者上传合法目录 `code-review`，其中含 `SKILL.md` 和 `references/checklist.md`
- **THEN** 两个文件完整成为该 Work 的已保存待应用副本，可立即读取和编辑；Core 目录仍为空，无需管理员操作

#### Scenario: 导入不保存其他草稿或覆盖隐藏配置
- **WHEN** 用户已有未保存 AGENTS 编辑，另一客户端更新了模型，用户导入一个新 Skill
- **THEN** 仅新增副本合入最新 desired，模型更新与所有已有内容保留，AGENTS 草稿仍未保存，当前 active 不变

#### Scenario: 同名导入不替换已有 Work 内容
- **WHEN** 上传目录名称已存在于当前 Work desired，且其内容与上传不同
- **THEN** 返回 `SKILL_ALREADY_EXISTS`，原副本、Core 和其他 Work 不变，界面允许取消或另选目录

#### Scenario: 非所有者或身份失效不得导入
- **WHEN** 他人、非所有者管理员、operator 请求导入，或所有者身份在接收后发布前已失效
- **THEN** 拒绝发布，不读取未经授权的 Work 内容，清理本次暂存且不泄露宿主路径

#### Scenario: 不完整或越界目录不产生半个 Skill
- **WHEN** 上传缺少根 `SKILL.md`、包含逃逸或重复路径、违反已有树限制，或接收中断
- **THEN** 整次导入失败，原 desired/active 不变，未完成副本不可见，本次暂存得到清理

#### Scenario: 导入成功后经显式 Apply 实际使用
- **WHEN** 用户导入 SDK 可加载的 Skill，编辑并保存其文件，再显式 Apply
- **THEN** 只有 readiness 成功后才报告该 Skill 已加载，Agent 通过 SDK 读取该 Work 的正文及配套文件；重启继续使用其副本
