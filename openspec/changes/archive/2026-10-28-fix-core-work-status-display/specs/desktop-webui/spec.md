# Spec Delta

## ADDED Requirements

### Requirement: Desktop 准确呈现 Core 启动恢复状态

Desktop SHALL 区分 Core 可达且正在启动恢复、明确未就绪、不可达以及状态读取未确认；可解析的未就绪响应不得因 HTTP 503 被解释为 Core 不可达。启动恢复 SHALL 在 Work 列表工具栏以轻量状态和等待动效显示，依照所属原型排列搜索、状态与操作，不额外展示重复 Alert 或 Works 标题；中英文随界面语言一致。恢复中的状态 SHALL 自动只读更新，恢复完成或失败后及时切换；不可达或明确失败 SHALL 提供准确说明和检查入口，不能将失败渲染为持续启动。动效遵循减少动态效果设置，窄屏下控件保持可达。

#### Scenario: Core 启动恢复
- **WHEN** Core 返回有效的 RECOVERING 或其他明确表示正在准备的状态
- **THEN** 工具栏显示 Core 启动中，页面自动更新，不能显示 Core 不可达或故障警告

#### Scenario: 不可达及失败
- **WHEN** 状态请求失败或 Core 确认恢复失败
- **THEN** 分别展示未确认或真实失败及只读检查入口，不把旧启动状态当作当前事实

#### Scenario: 状态请求挂起
- **WHEN** 恢复期间的 Core 状态读取超过时限，或用户离开列表、切换身份
- **THEN** 取消该只读观察，超时显示状态未确认并允许手动重查，旧响应不得覆盖新状态

### Requirement: Work 行只展示当前状态及有效操作

Work 列表 SHALL 根据当前确认的 observed 状态及目标显示对应状态和安全快捷动作，启动恢复中 SHALL 自动更新；上次运行保存的 Ready 或 Stopped 在当前恢复尚未核实期间 SHALL 标识未确认或恢复中，不能宣称当前已就绪或已停止。已终结的 Create、Start、Retry 等历史 Operation SHALL 不常驻 Work 行状态旁，仍可在原 Operation 详情或记录中查看；未完成或未确认操作保留原身份、必要的检查入口和安全约束。读取 404 SHALL 按被查询对象表明未找到或状态未确认，不推断业务操作失败，也不能据此错误移除 Work。

#### Scenario: Core 重启自动恢复
- **WHEN** 原目标为 running 的 Work 在 Core 重启后等待恢复、启动并最终确认 ready
- **THEN** 列表分别展示未确认或恢复中、Starting、Ready，且无需用户重复 Start 或手动刷新

#### Scenario: 自动恢复失败后重试成功
- **WHEN** 恢复尝试失败但已安排自动重试，随后 Work 恢复成功
- **THEN** 列表继续只读观察，不显示最终失败或 Retry，并自动更新为 Ready；重试耗尽则显示失败及恢复操作

#### Scenario: 历史操作已经结束
- **WHEN** 旧 Create 或 Start 已成功且 Work 当前状态发生改变
- **THEN** 行仅展示当前状态与动作，旧操作仍可在记录中查询，不附带历史成功文本

#### Scenario: 原操作查询 404
- **WHEN** 某个原 Operation 查询返回 404 而 Work 查询仍可用
- **THEN** 说明该 Operation 查询结果并保留 Work 当前事实，不将其呈现为 Work 失败
