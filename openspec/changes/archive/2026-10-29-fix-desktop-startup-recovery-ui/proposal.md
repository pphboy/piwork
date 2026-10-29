# Proposal

## Why

Core 已报告 `RECOVERING` 时，Desktop 仍显示 Work 列表及业务操作；Core 恢复为可用后，Work 菜单仍逐条常驻历史 `Retry Work · failed`。这使启动过程可以误操作，也使已恢复的 Work 看起来仍有一堆故障，需要将启动准入、当前任务和历史记录一起收敛。

## What Changes

- 首次进入、刷新和直达 Work 路由统一依据当前 Core readiness 呈现启动门禁：恢复中只提供等待、状态诊断及合法账号操作，确认就绪后自动进入原目标页面；失败、缺配置、不可达、超时和观察预算耗尽分别提供可执行出口。
- 已进入工作区后遇到明确的 Core 恢复，暂停新的业务入口并保留现有内容、草稿和 Service 容器；恢复后在原上下文继续使用。普通异步提交或单个 Work 恢复仍按原对象作用域限制操作。
- Work 菜单保留命令，以单一入口查看当前任务和该 Work 的已知操作记录；已结束且不再关联当前问题的 Retry 等历史不再堆在菜单中，原始失败事实与原 ID 仍可查询。
- 将“终态”“当前仍需处理”“历史展示”分别建模；重载后恢复分类，不将已核对的终态重新制造成当前告警，也不因 Work Ready、记录隐藏或旧成功解除未知提交和新控制目标的保护。
- 沿用已评审的 [交互原型](prototype/index.html)，Core 启动图标采用四个小方块依次移位接力、外框不动的动效，遵守减少动态效果设置。原型覆盖启动、正常菜单、历史、单个 Work 恢复、当前失败、结果未知及使用中恢复。
- 核对多条 Retry 的 Operation ID、时间、来源与安全诊断，并验证页面初始化、观察恢复和断线不会重复提交生命周期写请求；发现本流程内的重复提交或恢复问题时修复并做真实重启回归。截图尚不能证明各条失败的具体原因。

## Capabilities

### New Capabilities

无；复用现有 Desktop 和 UI 语言能力。

### Modified Capabilities

- `desktop-webui`：增加 Core 启动门禁及中途恢复行为，明确其与对象级异步限制的边界；规定 Work 当前任务、历史记录、重载恢复、未知结果保护和独立 Work 恢复的呈现。
- `ui-language`：将 Core 恢复等待的例外改为已确认原型中的页面状态及四格接力，区分主要动效与次级状态指示，保持其他等待组件约定。

## Impact

- 前端：`apps/desktop-webui/src/adapter.ts`、`app.ts`、`lifecycle.ts`、`observation.ts`、i18n 和 `public/style.css`，以及对应浏览器、观察及真实 Core 测试。
- 已知操作桥接：`internal/cli/user_desktop_known.go`、`user_desktop_records.go`、`user_desktop_control.go`；托管与独立 Desktop 共用该记录实现，按需增加兼容的终态元数据及对应测试，不增加全局操作发现接口。
- Core：复用现有 health/readiness、控制版本、Operation 及自动恢复契约；来源调查和重启验收涉及 `internal/coreapp/work_recovery.go` 等。只有证实属于本流程的问题才做对应实现修复，不预先宣称 Core 重复生成 Retry。
- 交付：WebUI 修改后同步 Go 嵌入资源并重建 Core/CLI；验收后复用既有本地 microvm 打包流程生成 Windows GUI 供复查，不构成对外发布。
- 无新增运行时依赖、数据库模式或全局操作中心；保留既有记录隐藏、权限和身份隔离。
