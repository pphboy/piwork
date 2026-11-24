# Spec Delta

## MODIFIED Requirements

### Requirement: 查看 Core package 库

**Identifier:** SUI-PKG-001

能力库的 Packages 分类 SHALL 按 name 列出 enabled 和 disabled 的 Core package，左侧显示 name、enabled、isDefault，右侧在选中后显示 version（缺失显示未声明）、sourceKind、资源数量及其他公开详情，支持刷新。详情 SHALL 只使用公共管理元数据及安全 resolvedSource，不提供包内文件编辑。列表 SHALL 有加载、空态和失败状态。页面 SHALL 明确这是 Core 包库，不显示 Work loaded/pendingApply，也不提供 Work packages 或 .work 快照入口。

#### Scenario: 包已安装但未默认选择
- **WHEN** 普通安装已成功，isDefault 为 false
- **THEN** 页面显示已安装且启用、未加入默认，不宣称已被某个 Work 加载

#### Scenario: 空库或对象失效
- **WHEN** 包库为空或详情对象已被其他管理员移除
- **THEN** 分别显示安装入口或对象不可用提示，查询失败不被转换为空库

### Requirement: 控制 Core package 状态与默认关联

**Identifier:** SUI-PKG-005

每个 Package SHALL 在左侧对应行菜单提供信息、更新来源、enable、disable 和 remove；菜单、确认和请求均显式绑定被触发行的 Package 名称，不从当前选中项推测。默认集合通过“新 Work 默认”视图管理，引用保护反馈提供该视图的导航；页头不保留通用更多菜单，右侧详情不混入其他对象或默认集合的修改命令。disable/remove 遇到 `PI_PACKAGE_IN_DEFAULTS` SHALL 提示先移出默认，不能隐式编辑默认列表；移除前 SHALL 确认目标名称。遇到 `PI_PACKAGE_BUSY` SHALL 提示 Core 包任务正在进行，原动作未执行，等待后可显式重试。开关和移除为同步动作，不创建虚假的等待 Operation。所有成功或失败 SHALL 保持已有 Work 副本不受面板动作影响。

#### Scenario: 移除默认包
- **WHEN** 对仍是默认的包确认移除
- **THEN** 显示默认引用保护，包不被移除，提供修改默认集合的入口

#### Scenario: Core 正在安装其他包
- **WHEN** Core catalog 有非终态任务时提交包状态变更
- **THEN** 显示 busy，既有任务继续，界面不提前切换 enabled 状态

#### Scenario: 操作未选中的 Package
- **WHEN** 右侧打开包 A，而管理员从包 B 行菜单更新来源、启停或移除 B
- **THEN** 确认、请求和反馈只属于 B；取消或失败不更改 A 的选择、状态或任何文件草稿


## ADDED Requirements

### Requirement: 调整并保存默认 Packages 顺序

**Identifier:** SUI-PKG-006

“新 Work 默认” SHALL 对已选 Packages 提供上移、下移及显式保存，保留用户顺序；首项不能上移、末项不能下移。新增选择追加至末尾，移除后保持其余项相对顺序。仅改变顺序 SHALL 视为 packages 字段修改，保存沿用现有局部 PATCH，取消不改变已保存配置。回读、刷新和 Core 重启后 SHALL 保持保存顺序；新 Work 继承当时的默认数组，已有 Work 不变。原多选限额、可用性校验及资源冲突规则保持，不增加运行时优先级含义。

#### Scenario: 上移下移与边界
- **WHEN** 已选 Packages 为 a、b、c，管理员将 c 上移
- **THEN** 草稿变为 a、c、b，a 的上移和 b 的下移不可用；操作不立即提交，也不改变选择成员

#### Scenario: 只修改顺序并保存
- **WHEN** 管理员仅调整默认 Packages 顺序并显式保存
- **THEN** PATCH 只包含按草稿顺序排列的 packages 字段；未编辑的 Skills、AGENTS.md 及其他配置保持；成功回读、刷新及 Core 重启后顺序一致

#### Scenario: 取消及成员变更
- **WHEN** 管理员排序后取消，或在草稿中新增/移除 Package
- **THEN** 取消恢复已保存顺序且不提交；新增项位于末尾，移除项以外的相对顺序保持，直到显式保存才生效

#### Scenario: 新 Work 继承与已有 Work 隔离
- **WHEN** 默认 Packages 排序保存后创建新的 Work
- **THEN** 新 Work 取得当时保存的有序默认 Packages，已有 Work 保留原配置；不据此改变资源重名冲突、覆盖或其他运行时规则
