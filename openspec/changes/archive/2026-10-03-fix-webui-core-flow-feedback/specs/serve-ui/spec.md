## ADDED Requirements

### Requirement: 管理员手动动作与文件预检有明确等待反馈

**Identifier:** SUI-005

Serve SHALL 沿用 UIL-008/009，在有效异步动作开始后的首个可绘制机会、结果返回前，在原对象/表单显示英文动作和等待状态，提供可访问的状态说明及 busy 语义；只禁用按钮不构成反馈。手动 Refresh status、Verify runtime、Retry connection、Refresh/Resume Operation、Read current runtime/defaults 和 Sign out SHALL 均覆盖，重复入口只能有一个在途请求。不同对象的合法导航和操作保持可用，读操作不得与后台轮询叠加成并行查询同一对象。

选择 Skill 目录、Package 目录/ZIP、AGENTS 文件后，浏览器本地读取/预检 SHALL 显示 Checking selected files，未完成不能提交本次未确认选择；取消选择保持原输入，预检失败保留旧选择，替换/关闭后的晚结果不能恢复旧文件。已有登录、保存、上传和 Package Operation 反馈 SHALL 保持真实；上传、验证、接受、后台准备与发布分别表达。

检查成功即使值未改变 SHALL 有新的确认时间或简短已确认说明。十秒以上未取得响应显示仍在等待及已等待时间，不虚构超时失败。明确失败、结果未知、旧缓存和成功空数据 SHALL 区分；错误不得使用成功措辞/图标。身份/路由变更后旧请求不覆盖当前页面，密码/key 处理仍遵守既有规则。快速动作不人为延迟，普通导航和复制不要求额外 toast。

请求的成功、失败及最终清理回调 SHALL 均受发起时的身份与视图归属约束；离开后返回同一路由也属于新的视图。旧请求不得清理新页面的敏感输入、改变新草稿或释放新动作的提交锁。

#### Scenario: 手动检查等待与重复点击
- **WHEN** 用户点击 Verify runtime、Refresh status、Read current configuration 或 Refresh Operation，响应被延迟并再次触发同一入口
- **THEN** 原区域已显示 Checking/Reading，只有一个对应请求；返回相同内容仍可确认本次检查完成，后台轮询不使等待提示提前消失

#### Scenario: 本地大文件预检
- **WHEN** 用户选择 Package ZIP 或较大目录，本地校验尚未结束
- **THEN** 原表单显示文件目标与预检中，不能提交未确认的新选择；失败、换源或关闭后不恢复晚到的旧选择

#### Scenario: 注销与身份失效
- **WHEN** 注销响应缓慢或 Core 暂时不可达
- **THEN** 显示 Signing out，重复注销受限，随后按 SUI-003 区分已撤销与未完成，旧账号的晚结果不覆盖新登录页

### Requirement: 已确认管理修改与关联刷新独立呈现

**Identifier:** SUI-006

Serve SHALL 在收到可靠的账号创建、启用/禁用、密码重置、Skill 添加/更新、Skill/Package 启用/禁用/移除、Runtime/Defaults 保存确认后，立即保存并显示目标与已确认结果。后续 Users、catalog、defaults、readiness 查询 SHALL 单独显示 Refreshing 和取得时间，不能阻塞成功反馈、撤销原确认或重新执行修改。

刷新失败 SHALL 显示“修改已确认；当前列表/状态未确认”及对应只读 Retry refresh，保留安全的旧数据并标记为最后已知。反馈 SHALL 位于仍存在的页面/结果容器，不能只写入已关闭弹层。更新自身凭据/状态导致撤销仍按 SUI-USR-002 返回登录，不能被普通刷新成功覆盖。响应未知继续使用既有只读核对或稳定 package key 恢复，不能据此显示确定成功。

Runtime 保存后的 API Key 清理 SHALL 仅作用于该次提交的原输入上下文。用户离开 Runtime 后重新进入并输入的新 Key 与非敏感草稿不得被旧保存请求或后续 readiness 查询的晚回调清空；原提交 Key 仍按既有敏感输入规则清理，不从后端回填，不进入动作状态、日志或验收截图。

#### Scenario: 创建用户成功但刷新缓慢
- **WHEN** Core 已返回新用户，随后用户列表查询被延迟
- **THEN** 创建结果及普通用户/管理员入口已可见，密码清空，列表显示刷新中，不要求再次创建

#### Scenario: 目录修改成功但刷新失败
- **WHEN** Skill 上传或 Skill/Package 状态修改已确认，随后 catalog/defaults 查询失败
- **THEN** 显示原成功和刷新失败，提供只读恢复；不访问已移除弹层、不抛出因其缺失而产生的异常、不再次上传或修改

#### Scenario: 保存结果与 readiness
- **WHEN** Runtime 保存成功后 readiness 查询失败，或 Defaults 保存后的辅助查询失败
- **THEN** 保留保存成功，readiness/辅助信息单独未确认，非敏感新草稿保留，key 不被回填或记录

#### Scenario: Runtime 旧保存不清理重新进入后的输入
- **WHEN** Runtime 保存请求被延迟，用户按脏草稿规则离开页面，再返回编辑并输入新 Key 与新草稿，旧保存或其 readiness 回调随后完成或失败
- **THEN** 新 Key 与新非敏感草稿保持不变，新动作的锁不被旧回调释放；旧反馈不替换新视图，原提交 Key 仍遵守敏感清理规则且不回填、不记录
