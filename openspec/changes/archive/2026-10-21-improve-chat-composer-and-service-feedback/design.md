# Design

## Context

动机与授权边界见 [proposal.md](proposal.md)；行为契约见 [Desktop delta](specs/desktop-ui-language/spec.md) 和 [Pending delta](specs/ui-language/spec.md)。本设计满足跨浏览器数据模型、状态呈现和样式的条件，提前确定诊断兼容、对象绑定与四格例外。

当前实现事实：

- `models.ts` 的 Service 只存单条 `error`；`adapter.ts` 的 `readServices` 将 `lastError` 映射为字符串或 `.message`，丢失其余公开诊断。
- `internal/coreapp/service_read.go` 已将错误投影为安全的 code/message/remediation/stage/exitCode/correlationId/retryable，并过滤内部运行信息。Core 对非必需服务失败保留 Work 的降级及 Agent 修复入口；本变更保留该状态计算。
- `app.ts` 的 Work notice 只判断 Degraded，Service 未就绪共用 `empty("grid", ...)`；现有 `serviceDetails` 和日志快照可复用。
- 可见 Work 每五秒通过 `refreshVisibleWork` 回读 Work 与 Services；已有 iframe 在符合条件的短暂 Starting 中通过 `keepStartingFrame` 保留。这里没有证据要求重建轮询或访问体系。
- `.composer` 已有圆角，`.composer textarea:focus-visible` 又画出直角轮廓；共享 `controls.css` 提供 1.2 秒透明度 Pending 和减少动态效果规则。

## Goals / Non-Goals

**Goals:** 从已有安全 API 到对象摘要、状态区域与详情保持诊断完整；用局部 CSS 和现有容器完成焦点及启动反馈；保留身份、代次、草稿和访问边界，以合成回归覆盖用户可见结果。

**Non-Goals:** 修改 Work 内应用或测试、恢复现有 Service、调整 required 或后端汇总状态、自动重试控制、分析日志猜测应用异常、新建全局状态/导航框架、引入依赖、修改所有 Pending 或增加 Modal 动画。真实用户实例不作为测试夹具。

## Decisions

### 1. 在浏览器边界归一化安全诊断

在 `models.ts` 增加轻量的可选 Service 诊断结构，`adapter.ts` 在已校验原 Work/身份/读取代次的映射中填写。允许保留原 `error` 字符串作为兼容摘要，避免扩大无关调用点的改动。

| 输入 | 处理 |
| --- | --- |
| 公开结构化错误 | 按类型保存安全字符串字段、整数退出码和 retryable；退出码为 0 时也保留 |
| 旧字符串错误 | 作为纯文本说明保留，其余诊断为空 |
| null、空值、未知码或部分非法字段 | 保留可确认状态及合法字段，使用英文回退；不输出对象字符串或猜测失败阶段 |
| correlationId | 保留为文本诊断；只有现有操作记录已确认属于原 Work/Service 时才提供 Operation 导航 |

只使用既有公开诊断与有界日志 API。与重新解析 Docker 错误或日志相比，复用安全投影能保持权限和脱敏边界，也无需更改 HTTP DTO、proto 或存储。日志只有用户打开详情/显式读取时按既有逻辑获取，不用于自动生成新错误类型。

```text
Go public lastError
       |
       v
Adapter normalization + identity/read guards
       |
       +--> Work notice: object summary
       +--> Service content: state + startup icon
       +--> Existing details: diagnostics + bounded logs
```

### 2. Service 状态投影与 Work 汇总分开

`app.ts` 使用局部展示函数统一 Work notice、Service 内容和详情中的对象事实；不新增持久状态机。明确失败由 Service 的有效 Failed 事实决定，历史 lastError 自身不把已确认 Ready 或新一轮 Starting 改成失败。

| 有效事实 | 展示 |
| --- | --- |
| 首次无应用、启用且 Starting，Work 可用 | 服务名、启动说明、中央四格；常规读取框架保留 |
| Failed | 明确失败标题、可理解原因、View details；已知 service-start/service-readiness 阶段可表达 failed to start，其他/缺失阶段仅表达 failed |
| Ready | 沿原入口、权限与拒绝嵌入规则显示应用或既有替代入口 |
| Stopped / Disabled | 准确的静态状态与现有管理方向 |
| 服务目录读取失败/首次未确认 | 保留最后确认事实或首次读取框架，叠加当前未确认和所属只读恢复；启动图标停止 |

Work notice 采用紧凑摘要：单故障显示名称并通过原 serviceId 进入 `service-details`；多故障显示已确认数量并进入现有 Service 管理列表；无 Web 端口的故障也计入可诊断对象。目录未确认时不输出零故障或声称所有服务可用。只有 Starting 时说明启动事实，不使用需要处理的故障措辞；混合状态优先说明明确失败，其他服务继续按自身事实显示。主区域、摘要与详情不重复堆叠整份诊断。

详情先可理解结果和下一步，再展示安全错误码、阶段、退出码、修复建议、关联标识及原有日志快照。静态文字均转义。查看详情和读取日志是只读；现有控制按钮、确认、写锁与终态核对保持，界面更新不触发控制。

复用原 Work/身份/Service 上下文检查处理晚响应。切换或关闭后旧日志不写入新对象的可见详情；不通过 correlationId 猜测另一 Operation。单纯把所有 Degraded 改为 Failed 会错误改变 Agent 和正常服务可用性，因此不采用该做法。

### 3. 中央四格是明确且局部的启动例外

给启动占位的原 32px SVG 增加局部类或包装，CSS 仅作用于其中四个 rect，不改全局 `icon('grid')` 或普通 empty 容器。复用既有透明度 keyframe：每格 1.2 秒，顺时针按 0、0.2、0.4、0.6 秒错开，透明度约 .35 到 1；不使用位移、缩放或旋转，不增加 JS 动画定时器。图标、标题和按钮几何保持。

只在当前目录确认、启用、Starting、Work 允许且尚无可保留应用时挂载。顶栏保留静态 Starting 标签，中央启动任务不再叠加三点。读取失败后展示静态最后事实与恢复，恢复取得新确认才决定是否重新显示动效；终态立即到达，不等完整周期。

减少动态效果时四格保持静态可见。状态容器提供英文说明和 busy/状态语义，SVG 为装饰，不随每次透明度变化播报。后台同一启动状态更新应保留节点及动画对象，不周期性重启动效。

当前 UIL-PENDING-001 仅允许三点，delta 已保留其全部既有场景并声明本例外。其他 Pending 和 Modal 不变。已显示 iframe 的短暂 Starting 继续原保留分支，不用启动占位覆盖或重挂应用。

### 4. 焦点属于 Chat 整体输入容器

优先纯 CSS 通过 `.composer:has(textarea:focus-visible)` 将输入焦点放到外层，而不新增 JS focus 状态。工具栏控件仍使用自己的焦点，避免仅用宽泛 focus-within 让按钮聚焦也被误认为文本输入聚焦。

| 项目 | 设计 |
| --- | --- |
| 容器 | 保持 12px 圆角，1px `var(--border)`，底色 `var(--surface-subtle)`；沿用既有布局宽度 |
| 留白 | 顶部及两侧 12px、底部 8px；输入与底栏约 8px 间距，文字和工具栏沿同一内边界 |
| 输入 | 透明底、无内部边框与轮廓；保留当前各容器字号、行高、多行高度范围与输入行为 |
| 输入焦点 | 外层 2px `var(--accent)` 轮廓，2px offset；焦点不参与尺寸计算、不被裁切 |
| 底栏 | 保留现有摘要收缩/换行和右侧动作组，图标与 Send/Stop and send 等高；控件自身 hover/focus 保持 |
| 响应式 | 常规、辅助栏及 Focus chat 共用同一规则，360px 和长名称下操作仍可达 |

已有节点与事件绑定不为样式重建。直接删除输入轮廓会破坏 DUL-007，给整个区域再嵌一层边框也保留双框问题；选择外层轮廓保留了明确输入位置。

### 5. 验证与资源交付沿现有入口

| 模块 | 责任 |
| --- | --- |
| `src/models.ts` / `src/adapter.ts` | 可选诊断模型、兼容归一化与原读取归属 |
| `src/app.ts` | 对象级状态摘要、启动占位、详情/日志导航；保留原 iframe 与 Session |
| `public/style.css` | 局部四格透明度与 Chat 外层焦点/留白 |
| `test/recovery.test.ts`、现有 pending/browser 测试 | 合成状态转换、对象绑定、兼容和原语义回归；截图、实际几何与动画采样 |
| Desktop build 与 `scripts/sync-desktop-assets.mjs` | 编译、共享样式合成及 `internal/desktopassets/static/` 同步 |
| Go 宿主与 WebApp/资源测试 | 嵌入资源可交付，真实 HTTP 返回最终模块与 CSS |

新增测试围绕实际用户行为：用合成 Service/错误/日志模拟 Starting 到 Ready/Failed、观察中断、恢复、多个对象与晚响应；核对查看只读、已有 iframe 文档及 Chat 输入身份不变。样式使用真实浏览器，采样透明度和固定几何、键盘焦点、1440px/360px、长模型与 Stop and send；保留必要合成截图，不增加镜像实现的文案单元测试。

使用 Node24 的 typecheck/build 与现有 test:browser；记录既有可选真实 Engine 用例的实际跳过，不把跳过说成通过，新增适用合成场景全部执行。真实 Core 验证只确认隔离安装及资源 HTTP 交付，不声称完成真实 Docker Service 或用户应用恢复验收。

临时输出统一放 `dist/improve-chat-composer-and-service-feedback/`。`managed-output` 只支持固定受管输出，直接给 `PIWORK_GO_BUILD_DIR` 嵌套目录会失败；沿 `scripts/build-go.sh` 的 releaseinfo 校验、CGO=0、Linux amd64、readonly/trimpath/buildvcs、真实 Version/Commit/Modified/UI hash 及适用发行元数据参数，直接在该临时目录构建 Core/CLI。保留真实构建身份，不替换含用户数据的 `dist/go`，不修改受管输出脚本。

## Risks / Trade-offs

- [汇总状态掩盖服务故障或将正常启动标成失败] → 用 Service 有效事实做局部投影，Work 汇总与独立能力可用性保持。
- [结构化或旧错误被直接拼接为 HTML、错误关联 Operation] → 类型化白名单、转义文本、只复用确认过的对象绑定，关联标识默认纯文本。
- [观察中断仍无限显示 booting] → 结合目录读取确认状态；保留最后事实及恢复入口，停止未确认任务动效。
- [动画重建导致闪动或损伤已有 iframe] → 局部 CSS 与稳定节点，沿原 keepStartingFrame；实测节点/动画对象与 iframe 文档身份。
- [外层焦点丢失、底栏挤出窄屏] → 输入专属容器选择器与独立按钮焦点，实测三种布局和长标签。
- [实施被扩成修复现场应用] → 所有用例使用合成数据与独立安装；不访问、修改或控制用户现有 Work。

## Migration Plan

无数据迁移。先实现诊断归一化和 Service 状态/详情，再实现启动动效与 Chat 样式，随后构建资源、运行回归和隔离宿主验证。实现、测试、嵌入资源应配套交付；当前运行实例保持原样，后续加载新程序由用户正常安排。回退对应浏览器源码及嵌入资源即可，模型、Work 与 Service 数据无需改写。
