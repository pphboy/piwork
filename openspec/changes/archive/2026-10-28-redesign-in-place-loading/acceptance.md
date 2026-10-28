# redesign-in-place-loading 验收事实

执行日期：2026-10-28。实现未提交、未推送、未发行。本附件只记录本次实际执行结果与未测范围，不代表历史验收或提升既有状态。

## 环境

- 本 worktree 无 `node_modules`，本次使用 Node `24.20.0`（符合 `.nvmrc` 与 `engines`）执行 `npm ci`。
- `make build` 已执行成功，生成 `dist/go/piwork-core`、`dist/go/piwork-cli` 并同步 Go 嵌入资源。
- 首次 Go 测试与部分浏览器测试失败源于另一个 worktree 遗留的 `piwork-core` 进程占用固定端口 7172（`Agent RPC listener is unavailable`）。终止该外部进程后，`internal/app`、`internal/identity` 与 `internal/coreapp` 的相关用例单独重跑均通过。此失败不是本变更引入。

## 已执行

| 检查 | 结果 | 入口 |
| --- | --- | --- |
| 类型检查（Desktop） | 通过 | `npm run typecheck -w @piwork/desktop-webui` |
| 类型检查（Console） | 通过 | `npm run typecheck -w @piwork/console-webui` |
| 桌面浏览器测试 | 1085 项，1083 通过；1 项在并发全量中超时（`browser Work lifecycle keeps stopped failures out of Retry and preserves Delete Operation`），无其他并行任务时单独复跑通过 | `node --test apps/desktop-webui/dist/test/*.test.js` |
| 管理浏览器测试 | 235 项全部通过 | `npm run test:browser -w @piwork/console-webui` |
| Go 单元测试（受影响包） | `internal/app`、`internal/identity`、`internal/coreapp` 相关用例在释放端口后通过 | `go test ./internal/app ./internal/identity ./internal/coreapp` |
| 宿主构建与嵌入资源 | `make build` 成功 | `make build` |

## 实现范围（与 tasks 对应）

- 1.1：`apps/ui-shared/controls.css` 新增 `.pending-icon-slot`（三点叠在原字形盒内，图标/文字按钮命中区域不变）、`.skeleton-fill`（低对比渐变，`prefers-reduced-motion` 下静态）、`.sr-only`。Desktop 文件行、来源 chip、Works 首读骨架改用固定字形槽/共享骨架。
- 1.2：`apps/desktop-webui/src/action-state.ts` 增加记录级 `projected`，只抑制普通等待；error、blocked、failed readback 与不可见 anchor 一律回落到本地区域。Console 侧未启用（其几何问题由 `setup-status` 固定高度解决，启用会破坏既有保存确认断言）。
- 1.3：`readPlaceholder` 只输出一个 `role=status` 骨架，不再叠加三点与文字；`overlay-role`、`compact-work-controls` 骨架断言同步更新。
- 2.1：`adapter.requireWorkSync` 在同代内幂等，不再每次观察都推后 watermark；`workControl` 按该 Operation 自身目标判定收敛，不再依赖通用 `usable`。
- 2.2：Works 行与 Work 头部改为 `.object-control-state` 紧凑状态位；原 Operation 详情与只读检查移入该 Work 菜单（`workMenuTasks`）。
- 2.3：无可见 Work 的任务由 `works-tasks` 固定入口（`.works-task-entry`，位于 Works 标题动作区）+ 非模态抽屉承载，不再插在搜索前。
- 3.1：Chat 主区移除常驻 `Paged history is unavailable…` 与无 Service 蓝色 Alert；真实历史失败或过期时，能力事实与失败原因一起出现在对应历史操作处。
- 3.2：Run 等待收敛为助手回复处的 `.reply-slot`；单一等待由回复位或 Activity 之一承担，原 Cancel 入口在执行摘要中保持唯一可达，执行摘要不再重复播放三点。
- 4.1：Service 列表行的控制态替换该行 badge（同行位），服务详情日志刷新等待移入 `refresh-logs` 按钮槽。
- 4.2：Files 上传反馈进入既有 `file-add` 触发的固定字形槽（有真实总量时为进度环），按需展开详情；未知总量只用三点。
- 4.3：Settings catalog 检查与 Pi Requests 读取等待分别移入各自刷新/检查按钮槽。
- 5.2：Console `.setup-status` 改为固定最小高度，普通等待出现/结束不再推移表单与按钮。
- 5.4（部分）：About 读取等待移入 `refresh-about` 按钮槽；模型目录读取的触发按钮改为固定字形槽 + 可访问名称。

## 后续核对（2026-10-28）

- 4.4：受控测试通过文件上传后等待确认、未知总量和失败停止动效、Import 原 transfer 重查、Export 同一 transfer 重查与单次交付，以及本地目录/ZIP Pi Package 原上传和 Operation；上传详情改放在文件菜单内，避免被菜单遮挡。
- 5.1：本机和托管深链接在会话未确认时显示中性壳；会话超时保留重试、旧响应不覆盖新身份，Service 四格启动与终态测试通过。入口 watchdog 恢复沿原机制。
- 5.4：会话和 Core 检查、图片读取与未知提交、模型自动保存、Activity 和 About 的针对性延迟与失败测试通过；默认 Core 的保存/读取/未知结果测试通过，普通等待改为原按钮显示，按钮和登录字段几何测试通过。Core 检查改为固定状态槽后，延迟及连接按钮几何测试通过。
- 1.2：Console 和 Desktop 的普通请求等待已回到实际触发按钮或模块状态槽；针对重复按钮、Service 并发、未知锁、失败读回及重复提交的测试通过。原有 Console 例外不再适用。
- 6.1：参照本变更交互原型，合成浏览器夹具对创建、Works、Files、Settings、Service 日志、Chat/Session、Pi Requests 和登录执行 1440/360、中英文及普通/减少动态效果矩阵；检查原按钮、相邻控件及已有行的等待前、中、后矩形。首读骨架的动画期间几何与减少动态效果单独验证。原型截图留在 `dist/`。
- 6.2：真实超过十秒的延迟创建、失败和未知写入、原 ID 只读恢复、多 Work/Service 并发与重载、草稿/焦点/阅读位置及 Service iframe 保持由受控浏览器用例验证。Desktop 全量本轮 1091 项中 1080 通过、1 跳过，10 项失败包含旧断言、Work 状态回归及一次超时；修复后相应失败项和矩阵单独复跑通过，未将本轮记为全量一次通过。
- 6.3：两端类型检查、`make build`、原生边界及 `git diff --check` 通过。Console 全量本轮 236 项中 233 通过，3 项因首读夹具等待条件过早而失败；修正夹具后 3 项单独复跑通过。Desktop 本轮全量及失败项复跑结果见上；后续目录、日志、About、Session 及 Import 的修改分别运行相关延迟/失败测试。最终构建已同步两端 Go 嵌入资源。
- 未测范围：矩阵使用合成 API 数据和本机浏览器，没有重新运行真实 Docker Work/第三方 Service 内部页面；未执行人工逐像素视觉比对。真实新增消息或对象的布局变化未作为等待位移判定。

## 核验问题修复（2026-10-28）

- 两个变更的四项重叠 Requirement 已逐项比较为相同文本，保留双方独有场景；账号菜单不设 Known operations，原 Operation ID 在所属任务详情按需查看。两个变更均通过 `openspec validate --strict`。
- Desktop 的实际发起控件在同类按钮插入时保持归属；控件被重建时只重新关联唯一且动作身份相同的候选，消失且身份无法确认时回退，其他对象的状态槽不会抑制其反馈。浏览器测试覆盖插入、消失、重建、跨 Service 并发和端口切换。
- Desktop 与 Console 的通用按钮等待超过十秒后显示对象、阶段、等待时间和后续说明，并保留状态播报。Desktop 合成场景检查 1440px/360px、中英文及相邻控件几何；Console 的真实计时慢请求检查说明可见及不重复发请求。
- 最终 `npm run test:browser -w @piwork/desktop-webui`：1109 项，1108 通过、1 跳过、0 失败；跳过的是需要真实 Docker Engine 的可选验收。`npm run test:browser -w @piwork/console-webui`：244 项全部通过。两端类型检查、`make build`、原生边界、仓库文档边界和 `git diff --check` 通过。
- 本轮未运行真实 Docker Work 或第三方 Service 页面，也未进行人工逐像素视觉比对。

## 等待反馈警告复核（2026-10-28）

- 共享容器或对话框不能作为状态槽归属证据；只有原控件自身或带相同动作记录身份的槽才抑制重复反馈。浏览器验证了同容器不同对象、原控件消失和重建，及模态窗口内的可见回退；普通回退不改变邻近控件位置。
- Service 日志请求实际等待超过十秒时，在原按钮附近显示所属对象、阶段和后续方向；受控成功和失败均停止等待，成功后再次读取重新计时。Desktop 和 Console 慢等待覆盖滚动、窄屏尺寸变化和所属控件移除。
- 两端类型检查、`make build`、嵌入资源比对、两个变更的 OpenSpec 严格校验、原生边界、文档边界和 `git diff --check` 通过。Console 完整浏览器测试 244 项通过。
- Desktop 最终使用隔离网络、合成非回环网卡及 4 个并发运行：1113 项中 1111 通过、1 失败、1 跳过。失败项是 `browser Work lifecycle keeps stopped failures out of Retry and preserves Delete Operation`：等待 `works-tasks` 入口超时，失败时列表仍显示删除前的 Work；此前同一最终流程有独立重跑通过，也有独立重跑失败，竞态原因尚未确定，不将整套记为通过。跳过项需要真实 Docker Engine。
- 独立网络用于避开另一工作区已占用的 Agent RPC 7172；此前未配置非回环网卡导致的 6 个原生身份用例已在补齐网卡后全部通过。未运行真实 Docker Work 或第三方 Service 页面。

## Delete 读回竞态修复（2026-10-28）

- 受控测试确认：较早发出的空列表与较新的 Work 详情冲突时，不再把删除和列表同步标记为已收敛；终态前的空列表也不能代替 Delete 成功后的读回。新列表仍包含 Work 或读取失败时保留保护与原 Operation，后续空列表确认移除后收敛；重复观察不重置义务，较新的生命周期意图和新建保护不受旧 Delete 影响。
- 原先等待 `works-tasks` 超时的浏览器生命周期流程连续单独运行三次通过，并在最终 Desktop 全量中通过。最终全量在独立网络和合成非回环网卡下以四并发运行，1117 项中 1116 通过、0 失败、1 项真实 Docker Engine 验收按条件跳过。
- 随后单独运行包含额外读回失败及恢复断言的生命周期单元套件，31 项全部通过；相关生命周期、连续性及控制单元套件此前 69 项通过。Desktop 类型检查、`make build`、嵌入资源比对、两个变更的 OpenSpec 严格校验、原生边界和 `git diff --check` 通过。本轮未运行真实 Docker Work。
