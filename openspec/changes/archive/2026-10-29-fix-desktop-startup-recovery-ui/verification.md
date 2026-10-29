# 启动恢复与操作记录验收

后续独立核验见 [verification-review.md](verification-review.md)。其中两处边界 WARN 已在后续 apply 中修复，最新复查结果与 GUI 输入身份见本文末节；前段保留首次 apply 的实际结果与限制。

## 已确认原因与修复边界

- 原实现的 Core RECOVERING 仅改变工具栏标签，列表与业务动作仍可用；新增浏览器回归在修改前因 `.core-startup-page` 缺失而失败。
- 原 Work 菜单遍历全部非 succeeded/superseded 关联任务，五条终态 failed 被渲染为五组进度；新增回归在修改前观察到五个 `.work-menu-task`。
- 原菜单历史条目的 `check-task-operation` 传入 Work ID，接收方却以该值查询 Operation。这一确定的查询对象错误已随原 ID 的任务入口修复；回归检查原失败详情可读取，且没有 `operations/work-1` 查询。
- 后端原有 Terminal 标记没有返回给浏览器，重载将已知操作统一重建为 unknown。新返回体兼容地携带终态提示、结果枚举及核实时间，展示提示与本轮确认、Work 准入和未知保护分离。
- 当前运行 GUI 的串口日志没有原 Operation 明细；未读取或修改其数据库、凭证及 Work。截图中各次实际失败的触发者和原因尚未核实，不将下面的合成失败当作现场根因。

## 已执行验证

| 范围 | 结果与证据 |
| --- | --- |
| 原缺陷回归 | `dist/startup-recovery-before.log` 记录修改前两项失败；相同启动/历史回归修改后通过 |
| 记录与竞态 | `go test -race -mod=readonly ./internal/cli -run 'TestDesktopOperation\|TestNativeDesktopOperationRecords\|TestHostedInspection' -count=1` 通过；覆盖旧格式、同身份桥接、错误归属、隐藏、500 条终态范围和并发读写，见 `dist/startup-records-race.log` |
| Core 状态及观察 | `core-admission.test` 和 `pending-adapter.test` 共 16 项通过，包括初次门禁、基础/非必需 helper 区分、直接写请求被本地拒绝且不制造未知任务、真实时间预算、旧响应隔离；最后补充的独立上传预检/导入边界也被本地拒绝，保留原预检状态，见 `dist/startup-final-core-adapter.log` |
| 页面与动效 | 六项启动/失败/超时/历史/草稿回归通过，涵盖双语、360px、减少动态效果与固定外框，见 `dist/startup-browser-target.log` |
| 历史与 iframe | 五条失败跨重载仍在操作记录、按原 ID 打开详情，Service iframe 恢复前后为同一节点，两项通过，见 `dist/startup-history-iframe.log` |
| 当前目标 | 原 Stop、多个控制目标、Create 归属、终态后读回和 C02 首次 Start 五项通过，见 `dist/startup-current-task-regression.log` |
| 导航上下文 | 37 项应用函数集成测试通过，见 `dist/startup-nav-vm.log` |
| Go 常规测试 | `go test -mod=readonly ./internal/cli ./internal/coreapp ./internal/corestore` 通过，见 `dist/startup-go-full.log` |
| Console 可用性 | `feedback.spec.mjs real-core.spec.mjs -g availability` 共 13 项通过，见 `dist/startup-console-availability.log` |
| 直达路由 | 恢复中依次进入 Work、Service 与 Works，业务入口不可提交；ready 后自动恢复原目标，见 `dist/startup-route-gate.log` |
| 导入与身份 | R4/R5 与丢失受理场景共六项通过；直接调用 adapter 的登录夹具先检查 readiness，再预检/导入，保留原身份隔离、只上传一次及未知保护断言，见 `dist/startup-final-inspection-contract.log` |
| Desktop 全量 | Node 24 执行全部 `apps/desktop-webui/dist/test/*.test.js`，1152 项中 1151 通过、0 失败、1 跳过，460.354 秒，见 `dist/startup-desktop-clean.log`；最终导入门禁补充后重新完整执行 |
| 构建与边界 | 最终 `make build` 通过，见 `dist/startup-final-build.log`；UI 语言、原生边界、文档边界和 `git diff --check` 通过；生产源码/Go 嵌入资源与最终 GUI 源码快照逐文件核对一致 |

## 真实重启与多条失败历史

执行 `TestNativeWorkObservationDuringSlowRestartRecovery`，启用 Node/Playwright 和本地生产 Agent/file-helper/snapshot-helper 测试镜像。使用测试独立安装及数据目录，制造一次恢复失败和有截止时间的再次尝试；在该安装显式注入五条合成 failed Retry 及身份匹配的已知终态记录。

73.478 秒通过（见 `dist/startup-restart-integration.log`）：恢复门禁中没有 Work 行、新建或导入入口；基础就绪后，两条 Work 各自收敛，自动等待中的 Work 没有提前显示 Retry；最终菜单不堆叠旧任务，操作记录中的第五条和某条失败原详情均可打开。浏览器纯观察没有生命周期写请求，数据库中 Retry 数量仍为原注入的五条，证明该恢复流程没有新增用户 Retry。此结果不推断现场用户曾点击了几次。

## Windows 本地构建身份

使用独立 microvm 工作区，不改当前用户安装和仓库主分支。为了锁定本次未提交实现，在忽略的 `dist/startup-gui-source` 创建临时源码快照 `82dac4a245b0cf391b734fb4cda5ba65ff9a46d4`，父系来自主分支 `6ab885e2790eb3e2c529c6c5d0ecf8dfab4ddc84`；原工作区是 dirty，快照自身是 clean，未纳入用户原有的三个脚本改动、网站变更与其他未跟踪内容。最终生产源码和嵌入资源逐文件比对一致；后续 R4 夹具仅补上登录后的 readiness 等待，不影响交付源码。

- Piwork source input hash：`590e106a3f3aa97e0e2766283e08c8c4ea534b372dbf50f8397fc3c6a55ede1f`。
- Desktop UI hash：`b93e9e3ff2a8b8edd8b1cbd783e505176fd5508ff07e1edeacf902e522839b34`。
- Wrapper commit：`419b2d52a5f1b03b01555a0c63dc8e65969ec96c`；本次独立工作区 lock 指向上面的 Piwork 快照，版本为 `0.0.0-dev.419b2d52a5f1`。
- 原生 Windows Go 1.25.5 / Wails 2.17 构建 GUI；锁定 Kernel/QEMU，重新生成 Guest 并保留全部 167 份 Guest 包许可证。`internal/bundle`、`internal/launcher` 测试通过。
- 最终 GUI 为 Windows amd64 PE32+ GUI，416201032 字节，SHA256 `72c60fab22e50a0daed3a93bbbd4cb64b71708ba99485acc72c214017acc5872`；这只是成品完整性核验，不承诺 Guest 镜像字节可复现。
- 使用 `debugfs` 从 Guest 导出 Core，与本次生产构建的 Core 逐字节一致，SHA256 `fa944e400bf7b1cc75987daa9163b3ece165b24044e9af426ab5036c1d9b872c`；`--version` 返回上述源码提交/UI hash，Go 1.25.5、Linux amd64、modified=false。
- 最终 GUI 在独立 Windows 用户配置目录中出现原生窗口，图标、标题栏拖动/最小化/关闭检查通过；检查过程中未启动 VM。证据为本次临时 Windows 验收目录的 `gui-probe/evidence/windows-window.json` 和截图。
- 原生 Windows CLI 使用同一最终 Guest/QEMU 在独立数据目录和 `28191/28171` 端口真实启动。创建合成管理员后显式登录，首次未配置 Runtime 显示新的门禁页，业务入口为零，账号与状态弹层可用，页面脚本错误与资源加载失败均为零；正常退出码 0，日志确认 Guest stopped cleanly，runtime/unclean 标记均未留下。证据复制到 `dist/startup-windows-evidence/`，浏览器执行结果见 `dist/startup-windows-browser.log`。
- 由于用户原 GUI/VM 正占用默认端口，原生 GUI 窗口与同 Guest 的真实启动页分别通过上述两条路径验证，没有关闭用户安装来做默认端口的 GUI 端到端启动。Windows 新安装验证了未配置页；RECOVERING→READY、五条 Retry 与草稿连续性由前述真实 Docker/浏览器测试覆盖，未在用户现有数据上重放。
- `C:\Users\p\Desktop\piwork-microvm-gui.exe` 已替换为核验成品，落盘后 SHA256 与字节数一致；旧 exe 备份在本次 Windows 临时验收目录。现有 GUI PID 44612 / QEMU PID 40964 保持运行，需退出后重开桌面程序才能加载新包。交付记录见 `dist/startup-desktop-delivery.json`。没有主分支提交、打 tag、推送或发布。

## 测试夹具调整与限制

- 既有浏览器夹具原来仅用 `ready: true` 或仅用 `status: ready` 模拟 `/readyz`，现补成有效状态响应；绕过 UI 直接调用 adapter 登录的夹具，在业务动作前显式检查就绪。原来期待恢复期间出现列表、新建按钮或每条失败菜单行的断言改为本变更规定的门禁、单个当前任务入口与历史入口。没有取消原来的幂等、身份隔离、未知锁、草稿、权限与请求计数断言。
- 全量套件唯一跳过项为 `real Engine prepares fixed release dependencies and permits one explicit Work from the IP workbench`，因为没有设置其专用 `PIWORK_RUN_ENGINE_BROWSER` 开关；不能将其算作通过。单独执行并通过的真实 Docker 重启测试范围见前文，不能替代该独立场景。
- 原生 GUI 的默认端口端到端启动、用户现场 Retry 的实际原因及用户现有 Work 上的升级/重放均未执行；GUI 与 Guest 分别核验的范围见前文，不作超出证据的结论。
- 测试使用的动态内部 RPC listener 覆盖仅存在于忽略的测试构建目录，防止占用用户正在运行的 7172；最终 GUI 使用正常生产构建，不包含测试覆盖二进制。真实重启验收结束后，按本次 installation ID 检查容器、网络和卷均无残留，没有全局清理。
- 本变更尚未同步主规格、归档或提交。原有三个脚本、BOARD.md 等无关工作区内容保持原状。

## 两项 WARN 修复复查（2026-10-29）

WARN-1 已修复：恢复缓存继续核对当前 Work/Service 的运行能力及入口授权，只撤回已失效的 iframe，保留工作区其他节点与草稿。覆盖 Stop、Delete、Work 权限撤销、Service 停止/失败/禁用/权限撤销/移除共八种浏览器场景；原正常恢复前后的 iframe、输入节点身份保持规则继续通过。

WARN-2 已修复：失败的 Service 任务按原 Service 身份、有效读取及清理义务分类，Work Ready 不能代替 Service 收敛。单一当前任务菜单入口也覆盖 Service 等该 Work 的已知任务。对应 Service 恢复后归历史，原 failed 结果与其他未知保护不变；单元测试覆盖不同 Service、未确认身份/读取、缓存终态、清理未完成及完成，不把全部 failed 保留为当前任务。

| 验证 | 实际结果 |
| --- | --- |
| 新持久回归的修复前结果 | 9 项均失败，见 `dist/startup-warn-before.log` |
| 新回归与原连续性/历史场景 | 12 项通过，见 `dist/startup-warn-target.log` |
| admission/pending adapter | 17 项通过，见 `dist/startup-warn-adapter.log` |
| 核验时的原始复现 | 3 项通过，包含原两项失败复现和可见性场景，见 `dist/startup-warn-original-probes.log` |
| Desktop 全量 | 1162 项：1160 通过、1 失败、1 跳过，430.816 秒，见 `dist/startup-warn-desktop-full.log`；失败为既有 native-auth 离线阶段出现“新认证流程拥有该响应”的未确认状态，未得到该次预期的不可达文案；单独复跑该项通过，整个 native-auth 文件 6 项复跑也通过，见 `dist/startup-warn-native-auth-recheck.log`、`dist/startup-warn-native-auth-full-recheck.log`。本轮没有修改认证实现或放宽断言，也不将该次全量记为零失败。唯一跳过项仍为需专用开关的真实 Engine 浏览器场景 |
| Go 及构建 | `make build` 通过；`go test -mod=readonly ./internal/cli ./internal/desktopassets ./internal/webapp` 通过，desktopassets 无单元测试，见 `dist/startup-warn-build.log`、`dist/startup-warn-go.log` |
| 边界与规格 | UI 语言、原生边界、文档边界、严格规格检查及 `git diff --check` 通过；构建资源与 Go 嵌入资源一致 |

最新 GUI 使用独立源码快照 `fb89800426f532231f95febaf3213d690a9ab37c`；原主分支仍为 `6ab885e2790eb3e2c529c6c5d0ecf8dfab4ddc84` 且工作区 dirty，冻结快照自身 clean，未包含原有无关脚本与网站变更。生产源码及嵌入资源与快照逐文件匹配，没有在用户主分支提交。

- Piwork source input hash：`eae8bb6e2b1b785da69fb37e50761834a2dbf6d52b78d8db4ab1260a3749180d`；Desktop UI hash：`4bc78b90059e3756ad415dd06520c4cff22f2bb98dcb1e8276ecff83e77cc6a4`。
- Wrapper 仍为 `419b2d52a5f1b03b01555a0c63dc8e65969ec96c`，本地 lock 指向上述新快照；原生 Windows Go 1.25.5 / Wails 2.17 构建，复用锁定 Kernel/QEMU 并重新生成 Guest。Guest 导出的 Core 与生产构建逐字节一致，SHA256 `e946f0be112baf8e366de79cdcbec08d1396b5406309532685ad3358e1543521`，版本返回新提交/UI hash。
- GUI 为 Windows amd64 PE32+ GUI，416190291 字节，SHA256 `7c4bc0522e34e0470e93145a0c3410f0918e9ce2585bf6408f2895bdb36ee7f6`。完整身份记录为 `dist/startup-warn-gui-inputs.json`、`dist/startup-warn-gui-artifact.json`。
- 新 GUI 原生窗口、图标和标题栏检查复跑通过；首次窗口检查的拖动断言未通过，原始输出保留在 `dist/startup-warn-windows-gui.log`，完整复跑见 `dist/startup-warn-windows-gui-recheck.log` 和 `dist/startup-warn-windows-evidence/gui-windows-window.json`，未更改 wrapper 源码。
- 同一最终 Guest 在独立 Windows 数据目录和 28191/28171 端口真实启动。合成管理员正常登录，新门禁页面及状态弹层可用，业务入口为零，脚本错误和资源加载失败均为零；正常退出码 0，日志确认 clean shutdown。证据位于 `dist/startup-warn-windows-evidence/`。沿用原限制：GUI 窗口与同 Guest 启动页分别验证，未关闭用户安装做默认端口 GUI 全流程，未在 Windows 新安装上配置模型并重放实际 Service 故障；两项 WARN 的组合行为由浏览器回归验证。本轮未重复此前真实 Docker 重启场景，没有改变 Core 恢复调度或协议。
- 桌面 `C:\Users\p\Desktop\piwork-microvm-gui.exe` 已再次替换为新成品，落盘校验一致；旧桌面文件 SHA256 `72c60fab22e50a0daed3a93bbbd4cb64b71708ba99485acc72c214017acc5872` 已备份，交付记录见 `dist/startup-warn-desktop-delivery.json`。用户 GUI PID 44612 / QEMU PID 40964 保持运行，需重开桌面程序加载新包。

两个已报告 WARN 均已关闭；保留上述全量时序失败及复跑事实，不将未执行环境扩充为已经通过。未同步主规格、归档、提交或发布。

## 规格同步、归档与提交（2026-10-29）

本次同步将 `desktop-webui` 的三项修改与一项新增要求、`ui-language` 的一项修改合入主规格；原 Purpose、未涉及要求及场景保持，逐块比对确认没有待同步差异。`openspec validate --specs --strict` 为 47 通过、0 失败。产物及 20 项任务均完成后，变更归档到 `openspec/changes/archive/2026-10-29-fix-desktop-startup-recovery-ui/`，`.openspec.yaml` 与原型、验收附件随同保留。

实现按依赖分别提交：

- `97af7fb fix(cli): preserve verified operation terminal hints`。
- `0f11bb0 fix(desktop): gate Core startup and separate operation history`。

主规格与变更归档材料另行作为一笔规格/归档提交。原有三个脚本、BOARD.md、网站变更及 promo 等无关工作区内容未纳入，本次不推送。

GUI 仍对应已冻结并验证的源码快照 `fb89800426f532231f95febaf3213d690a9ab37c`；提交与规格归档没有重新标记或改写其 source commit、dirty、input hash 或 SHA256。前面各阶段的“尚未提交/归档”等描述保留为执行当时事实，以本节记录本次归档状态。
