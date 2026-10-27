# Design

## Context

问题和范围见 [proposal.md](proposal.md)，可测试行为见本变更的两份增量规格。当前 `apps/desktop-webui/src/app.ts` 的账号菜单和 Import 提示打开同一全局 `operations` 弹层；它混合已知任务、Operation/snapshot ID 查询和清除记录。Work 行、Service 详情和 Settings 已有部分局部进度，但不能覆盖所有重载和无对象情况。

`adapter.ts` 在 `recoverOperations()` 中读取当前身份的已知记录并观察原 ID；该记录由 `internal/cli/user_desktop_records.go` 在独立和托管模式按 Core/用户隔离，记录可包含 Work、Service 和 snapshot 身份。当前前端恢复时丢掉 `serviceId`，`checkOperation()` 只保留 `error.message`；Core 的 `operation_read.go` 已提供安全的 `error`、`diagnostics` 和关联标识。现有 `clearOperations()` 调用本地记录隐藏接口，隐藏后列表读取不再返回该记录，不能直接把它当作未决提示的关闭动作。

本设计沿用 [UI 组件采用说明](../../../specs/desktop-ui-language/ui-component-adoption.md) 和 [组件规范](../../../specs/desktop-ui-language/ui-component-spec-v1.0.md)。两个 Desktop 入口共用界面，Console 的管理 Operation 查询不在本范围。

## Goals / Non-Goals

**Goals:**

- 用同一套任务反馈组织多个已有界面，保留旧任务、当前对象状态和恢复入口之间的真实关系。
- 让原 ID 恢复、对象同步、用户隐藏展示和未知修改保护有各自独立的状态，不因导航或重载误提交。
- 对缺失身份、诊断、日志、名称和本地记录的情况提供诚实退化，不依靠推测填补。

**Non-Goals:**

- 不建立全局历史、通知中心或后台任务队列，不提供跨设备全量 Operation 发现。
- 不改变 Core 业务执行、服务端失败归因、权限、后台执行/取消语义或导出快照格式；不引入新的日志采集或把管理员日志授权给普通用户。
- 不整体重写工作台、组件系统、CLI 或 Console，不新增与任务无关的主题和控件。

## Decisions

### 1. 页面布局与任务归属

保留现有列表、详情和面板，以紧凑局部反馈承载任务；不把现有全局弹层改名或藏到另一个菜单。以下为结构示意，英文、中文文案按实际语言分别实现，状态和原因只来自真实响应：

```text
Works                                 [Refresh] [Import] [New Work]
[Search works]

Import Work: Importing                 [Check status] [Details]
Delete Work: Cleanup failed            [Check status] [Details]

Project A     Starting                 [Check status] [...]
Project B     Ready                    [Open]         [...]
```

Works 顶部提示只承接缺少可见 Work 的创建/导入及已离开列表的删除任务，不列其他历史。搜索框与提示独立；读取失败时保留已知内容并标记未确认，不把查不到当作真正不存在。任务较多时先展示有限条摘要并在原处展开其他条目，单项身份和状态不能合并丢失。对象被确认后可归属的进度回到其 Work 行；Import 成功结果可短暂保留用户选择查看或显式启动的动作。删除后清理结果必须有原提示，不恢复假的 Work 行。

```text
Work: Project A
Start Work: Failed
<confirmed cause and next step>
[Check status] [Details]

Service: Web
Restart: Failed
<confirmed cause and next step>
[Check status] [Details] [View logs when available]

Settings
Apply configuration: Applying
Previous configuration remains active.
[Check status] [Details]

Export Work
Preparing snapshot...
[Check status] [Details]
```

Service 被移除后，关联的 Remove 结果留在原 Work 的 Service 管理区域；无法确认具体 Service 时只显示目标未确认，不给另一 Service 贴标签。Settings 的 Package 与 Apply 各绑定原任务。Import、Export 沿现有表单和非遮罩面板承接阶段，下载仍使用原 snapshot。重载后只提供显式下载，不恢复已失效的一次自动交付意图；当前页面内关闭进度仍遵守既有交付及 Pause/Resume 语义。

同一任务同一上下文只显示一个主要进度/错误，Work 状态与 Operation 结果有不同事实时可以分别说明，不重复堆叠 toast。实时执行使用现有局部等待；失败、未知或观察中断停止进行动画。技术身份和较长诊断放在同一个任务的按需详情中；保留原手动按 ID 查询，但从具体 Work/Service、Import/Export 或当前无对象任务的恢复入口进入，Export 查询需核实 Work/snapshot 归属。保留完整键盘操作、焦点和 360px 布局，更新不能重载 Service iframe 或覆盖草稿。

### 2. 将记录、查询和显示分开

```text
known-operations -> recover original IDs -> read original Operation
                                             |
                              confirmed identity and kind
                                             |
               +-----------------------------+------------------+
               v                             v                  v
          Work / Settings              Service details     Works task hint
               |                             |                  |
               +---------- Check status: read only -------------+
```

`models.ts`、`adapter.ts` 保留可靠受理和记录中的 `serviceId`、Work/snapshot ID，保留 Core 原任务类型及结构化诊断。通过原 Operation ID 重新读取并核验可用的身份、类型和状态，再投影到对应对象；不能按记录时间、同名 Service 或数组顺序推断当前目标。旧记录没有 `serviceId`、Core 响应不提供足够关联，或对象已删除时保持未确认，并在已确认的 Work 范围提供原结果入口，不制造 Service 关联。多个旧任务仍各自可查，当前目标来自已确认的 Work 状态和较新接受意图。

`app.ts` 的 `workControls`、`serviceControls`、Settings 和传输进度要能使用恢复后的原 Operation，而不只依赖当前页面点击产生的临时 Map。Work/Service/列表读取与 Operation 查询分别记录结果；延迟、失败及终态同步沿用 `DWUI-017`，旧回复不得覆盖新控制目标。仅通过原 ID 只读恢复，不新增业务 POST。未取得 ID、记录保存失败、404/410 或认证失效分别说明限制；本地记录不是服务端全局历史，也不承诺找回未记录的请求。

该选择复用现有持久记录与 Core 查询，比新增服务端操作发现 API 的范围更小。接受响应和记录中都没有的对象信息不会被虚构。

### 3. 关闭提示不等于删除协调依据

进行中、未知及尚需处理的失败任务可关闭详情或收起成可再展开的摘要；未决任务不因普通收起调用 `DELETE known-operations/{id}`。重进或重载后，仍需关注的已记录任务可从同身份记录重新出现。终态成功提示可由用户明确关闭，避免成功消息长期堆积；需要同步对象或列表时，保留原 ID、终态和代次直到同步完成。只有用户明确移除已完成展示且相关同步义务不再依赖记录时，才可复用现有隐藏能力或等价的身份隔离展示状态。即使本页仍需同步，隐藏展示也不能清除当前协调证据；旧操作的收尾不能释放新意图或未知锁。

替代方案是在点击关闭时直接调用现有隐藏 API；但 `list()` 会过滤隐藏记录，重载后可能找不到未决任务或尚未完成的协调依据，因此不采用。未取得 ID 时仍遵守现有未知结果保护，不能通过查询无关 Operation 来解锁或自动换键重提。

### 4. 安全诊断按原任务显示

扩展 Operation 视图模型，只复制和校验公共响应中实际存在的 `code`、`stage`、`message`、`remediation`、`retryable`、`correlationId`、可确认的对象 ID 及有限阶段记录。服务端安全投影和 Service 现有诊断处理可作为依据；缺字段、旧字符串、无效值和不同 Operation 类型分别处理，不能将任意对象直接转为字符串或原始 HTML。

主反馈使用本地化的失败事实和下一步；技术字段、原 ID 和安全服务端消息在详情中以文本呈现。仅在真实关联且当前身份有权时链接原 Service 日志；Work 级诊断若没有可用日志入口，说明不可用或联系管理员，不新建第二个管理员日志导出入口。记录缺失时显示“未提供更具体原因”，特别是不推断此次凭证冲突的根因。

### 5. 模块与验证边界

- `apps/desktop-webui/src/models.ts`、`adapter.ts`、`lifecycle.ts`：扩充安全视图模型和恢复投影，继续维护对象同步、新旧控制目标与身份检查。
- `apps/desktop-webui/src/app.ts`、相关样式与 `src/i18n/{app,adapter}.js`：移除全局入口及旧提示，整理各任务的呈现和原 ID 查询，并支持中英文、长内容和窄屏。
- `internal/cli/user_desktop_records.go`、`user_desktop_known.go` 和托管入口：保留现有 API 与隔离；仅在需要安全展示状态或保持已知关联时做最小兼容调整，不暴露凭证或包内容。
- `apps/desktop-webui/test/` 与对应 Go 测试：验证真实用户路径、跨重载原 ID、Service 关联、同步竞争、安全诊断和不重复提交；更新以旧账号菜单进入为前提的测试。

## Risks / Trade-offs

- [本地记录缺失或旧记录无 Service ID] -> 明示自动找回或归属限制，保留已知 ID 和安全的原对象检查；不扩大为服务器全局发现。
- [关闭提示误隐藏未决记录] -> 未决显示状态与记录隐藏分离，覆盖重载、多个窗口、未知提交和终态对象同步失败。
- [状态查询成功但对象读取失败] -> 分开呈现操作终态和对象未确认；只读重试有界且能手动恢复。
- [诊断缺失或内容不可信] -> 仅展示类型校验后的安全字段并转义；无实际根因或无权日志时明确缺失，不添加推测。
- [历史操作与新目标竞争] -> 按原 ID、身份和控制代次投影，旧结果不能更新新目标或解除新锁。

## Migration Plan

1. 保持 `known-operations`、Operation/snapshot 查询及既有记录格式兼容；前端允许旧记录无新增字段并逐步恢复可确认的信息。
2. 按任务落位和诊断能力完成后移除菜单、全局弹层入口及旧文案；更新嵌入资源，确保两种 Desktop 使用同版页面。
3. 回退时恢复旧界面和资源即可继续读取未破坏的既有记录；不回退或更改已经执行的 Core 任务。
