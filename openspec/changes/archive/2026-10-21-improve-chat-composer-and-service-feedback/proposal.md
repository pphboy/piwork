# Proposal

## Why

当前 Chat 的文本区单独显示直角焦点框，与外层圆角容器形成双重边界；Service 启动占位只有静态图标。Service 已失败时，前端又将安全诊断缩成一条消息，并主要依据 Work 汇总状态显示笼统的 capabilities 提示，用户难以区分正在启动、服务异常和状态未确认。

## What Changes

- 将 Chat 文本输入与底部工具栏整理为一体式圆角容器，输入聚焦由外层提供至少 2px 的可见轮廓；统一留白、底色与对齐，保留工具栏独立焦点、当前多行输入和草稿语义。
- 在尚未展示应用、且当前有效观测确认 Service 为 Starting 的启动占位中，让中央四格图标按 1.2 秒节奏依次淡入淡出；固定尺寸位置，支持减少动态效果。此处是统一三点等待规则的局部例外，其他 Pending 保持原规则。
- 在浏览器模型中保留现有 API 提供的安全错误码、阶段、退出码、修复建议与关联标识，兼容字符串、空值及部分字段缺失；主要提示、诊断详情与有界日志分层展示。
- 按具体 Service 的状态呈现启动、明确失败、停止/禁用及读取中断；Work 汇总状态与服务异常分开表达。单个故障的详情入口直接绑定该 Service，多故障复用现有管理列表；其他正常服务继续沿原准入访问。
- 通过合成浏览器场景核对状态转换、诊断兼容、对象关联、动画连续性、Chat 焦点与宽窄屏；同步 Desktop 构建与 Go 嵌入资源，并用独立安装验证真实静态资源交付。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `desktop-ui-language`：补充 Chat 一体式容器焦点与 Service 对象级启动/异常/未确认反馈的可见契约，沿用已有控件、详情和日志入口。
- `ui-language`：为 Service 首次启动占位声明四格图标动效例外，沿用透明度、固定位置、终态立即结束及减少动态效果规则。

## Impact

- `apps/desktop-webui/src/models.ts`、`adapter.ts`：扩展浏览器安全诊断视图，保留现有身份、读取代次与兼容处理。Go 已提供所需诊断，预计不新增 HTTP/proto 字段或改变 Work/Service 状态计算。
- `apps/desktop-webui/src/app.ts`、`public/style.css`：调整 Chat 聚焦与局部布局、启动占位和故障摘要/详情；保持同一 Session、草稿、站内动作与既有 Service iframe 连续性。
- `apps/desktop-webui/test/`：复用 recovery、pending、browser 等现有合成夹具，按影响追加行为与实际浏览器样式验证；不引入组件库或新测试框架。
- 沿 Desktop build/sync 入口更新 `internal/desktopassets/static/`，在独立输出构建 Core/CLI；现有 `dist/go` 中的用户数据与运行实例保持原样。
- 本变更仅修改 Piwork 仓库代码。现有 Work 内的 diary 源码、测试和数据不属于实施范围，不执行其 Start/Stop/Restart/Retry，不以该应用恢复为验收目标。此前排查只作为问题背景，不保存真实账号、凭证、Work 数据或现场日志。
- 无新外部依赖、数据迁移或发布动作；必要合成截图归本变更，临时构建和验证输出归忽略的 `dist/`。
