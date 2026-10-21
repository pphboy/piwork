# Spec Delta

## ADDED Requirements

### Requirement: Quick setup 提供 DeepSeek API 获取指引

**Identifier:** ONBOARD-006

Quick setup 的新增模型表单 SHALL 在 API Key 标签正上方提供一处始终可见的英文推荐与获取入口：`We recommend using the DeepSeek API directly.`，下一行显示 `Get your API key at platform.deepseek.com.`，其中 `platform.deepseek.com` SHALL 是指向 `https://platform.deepseek.com` 的真实链接。该指引 SHALL 同时适用于首次空配置和已有安装显式 Add model 的新增模式；选择已有模型、准备阶段及完整 AI models 通用表单不显示该局部指引。高级字段仍可编辑，推荐不得限制用户配置其他合法模型。

说明 SHALL 采用与表单同宽的紧凑浅色提示块，具有细边框、圆角、推荐文字与次级说明的清晰层级；链接 SHALL 使用可辨的链接颜色、文字标识及外链标记，悬停与键盘焦点可见。360px 窄屏与宽屏下文字、域名 SHALL 自然换行，完整可读，无横向溢出、截断或遮挡输入。该内容属于静态帮助，不显示错误、成功、进行中状态或弹窗。

链接 SHALL 在新标签页打开，并明确表达外链行为；鼠标普通点击、键盘激活及浏览器原生修饰键操作 SHALL 保留相应链接语义。打开平台时，原页面地址、模型草稿、API Key、dirty 与高级区展开状态 SHALL 保持，不触发站内离开确认、隐式保存、Test、准备或模型/Runtime 写入。链接目标 MUST NOT 拼接表单字段、秘密、会话数据或跟踪参数；平台页面不得取得原页面的 opener。原站内离开、显式保存、敏感清理和 unknown 保护继续有效。

#### Scenario: 首次配置看到推荐与获取入口
- **WHEN** 管理员进入首次空配置的 Quick setup 新增模型表单
- **THEN** 在 API Key 标签上方看到一次完整的两行指引和正确平台链接；原 DeepSeek 默认值、Key 输入、高级区及 Save and continue 继续可用，页面不会因显示指引发送模型请求

#### Scenario: 已有配置按当前表单模式呈现
- **WHEN** 管理员在已有安装选择 Add model、切回 Choose saved model，或查看准备阶段及完整 AI models 表单
- **THEN** 指引只随 Quick setup 新增模型表单出现；其他模式保持其原内容，不在选择已有模型时要求获取新 Key，也不覆盖任何已有值

#### Scenario: 打开平台保留当前配置草稿
- **WHEN** 管理员填写 Key 或修改高级字段后，用鼠标或键盘打开平台链接
- **THEN** 浏览器以新标签页打开固定的 HTTPS 平台地址，目标不含表单或会话数据且无法访问原页 opener；原标签页地址、输入、dirty 及展开状态保持，没有离开确认或新增模型/Runtime/Test 请求

#### Scenario: 宽窄屏下提示清晰且可操作
- **WHEN** 管理员在宽屏或 360px 窄屏查看指引，并悬停或通过 Tab 聚焦链接
- **THEN** 浅色提示块与表单对齐，推荐与说明层级可辨；域名完整、自然换行，链接的外链标记和焦点可见，输入及原主要动作保持可用，不出现横向溢出或错误/进行中提示

#### Scenario: 后台回读与内部导航保持原保护
- **WHEN** 管理员保持新增模型草稿，后台状态读取返回，或随后选择站内其他页面
- **THEN** 提示不重复插入、不替换当前输入节点或改变焦点；原站内未保存草稿确认、unknown 锁及敏感清理规则继续生效，外链行为不绕过这些站内保护
