# Tasks

## 1. Retry 来源核对与行为回归

- [x] 1.1 在隔离安装中重现 Core 慢恢复及同一 Work 多条已知 Retry，按原 ID、类型、控制版本、安全原因和 POST 次数核对来源；有条件时读取现场诊断，无法取得时明确限制。验证：在本变更验收附件记录可复现事实与未证实的现场原因，原始输出置于忽略的 dist/，不包含真实秘密或修改用户 Work。
- [x] 1.2 在现有恢复/反馈测试中固定“Core 恢复中仍有业务入口、Ready 菜单堆叠五条失败、刷新后恢复为 unknown”的回归场景，并断言初始化、连接恢复与查看详情不会增加生命周期 POST。验证：实现前得到针对具体问题的失败断言，实现后用同组测试证明修复；不把所有 failed 过滤掉来通过测试。
- [x] 1.3 根据 1.1 的实际证据修复本流程内存在的重复提交或恢复处理问题，保留原幂等/代次和自动重试预算；若未发现重复生成，记录核实结论。验证：单次明确用户动作只产生一次相应受理，纯观察和重载不新增 Retry，独立环境故障或无法取证的现场原因不冒称已修复。

## 2. 已知操作终态与当前任务投影

- [x] 2.1 为已知操作记录及同源返回体兼容增加 terminal、可选 terminalState 与核实时间，写入前核验原 ID、类型及所属对象，复用私有原子存储和身份键。验证：扩展 `internal/cli/user_desktop_records_test.go` 与桥接测试，覆盖旧格式、终态无结果、正常终态、错误归属、并发读写、隐藏、500 条保留范围及托管/独立模式隔离。
- [x] 2.2 实现当前任务、历史候选、已核实历史和无法核实记录的展示投影，与 Work 准入、接受意图、记录保存失败、workSync 和 terminalEvidence 分离。验证：对应单元/adapter 测试覆盖五条旧失败且 Work 已收敛、当前真实失败、多个未决、旧成功与新 Stop 未知、Ready 但读回失败、404/410，不因展示归档清除任何不匹配保护。
- [x] 2.3 调整同身份重载恢复和历史读取安排，区分本地终态提示与本轮确认，优先当前问题、按需有界核实历史，保留旧格式及用户主动隐藏语义。验证：刷新、重新登录、多窗口、身份切换和迟到结果测试证明历史不回流为故障菜单，慢历史不阻塞当前 Work，全部恢复路径无自动生命周期写入。

## 3. Core 启动门禁与有界恢复

- [x] 3.1 增加统一 readiness 门禁投影，区分首次 checking、recovering、ready、缺配置、真实失败、不可达、未确认和观察暂停；保持 Core 与 Work/helper 独立就绪。验证：adapter 测试覆盖有效 503 RECOVERING、非法响应、初次状态未确认、ready 但单个 Work 恢复、非必需 helper 降级及 Work 列表读取失败。
- [x] 3.2 将 Core 恢复观察从列表扩展到可见门禁与活动工作区，沿用去重、四并发及单次十秒超时，实现两秒常规间隔、300 次/十分钟先到暂停、手动重开预算。验证：时钟与网络模拟测试覆盖直达路由、隐藏/返回、超时、预算耗尽、检查代次和身份切换，旧响应不会解开新门禁且观察无业务 POST。
- [x] 3.3 在初次页面、路由、动作派发及 adapter 业务发起处接入同一门禁，覆盖已有弹层和键盘路径；保留当前模式合法的账号、连接、诊断、只读检查和导航。验证：托管及独立 Desktop 浏览器测试从列表、Work、Service 直达并尝试创建、导入、生命周期、配置、Files 和 Run 入口，确认恢复期间未发出新业务请求，ready 后无需整页重载即进入原目标。
- [x] 3.4 实现使用中明确恢复时的原位暂停与恢复，保留 Chat/Files/Settings 草稿、选择、阅读位置及适用 Service iframe，不取消已接受执行或破坏导出交付。验证：连续性测试比较输入内容及 DOM/iframe 节点身份，覆盖恢复再就绪、普通读取失败不全局锁定、Stop/Delete/身份撤销仍按原规则关闭能力、已授权交付最多一次。

## 4. 启动页、Work 菜单与原任务详情

- [x] 4.1 依照 `prototype/index.html` 实现首次启动页、失败/缺配置/超时/断线/观察暂停出口与使用中恢复区，补齐中英文文案；中央四格依次移位接力、外框不转，状态结束停止动效。验证：浏览器覆盖 1440px 与 360px、两种语言、减少动态效果、键盘操作及快速成功不人为延迟，Core 与 Service 启动动效互不混用。
- [x] 4.2 将 Work 菜单改为命令入口，保留原快照找回等既有功能；有当前问题时提供一个当前任务入口，所有已知原操作可经该 Work 的操作记录及筛选查看。验证：`compact-work-controls`、反馈和操作恢复测试证明五条历史失败不再产生五组菜单按钮，未决任务和无可见 Work 的任务仍有原身份入口，正常列表布局与准入保持。
- [x] 4.3 更新原任务详情：已终结历史提供原结果、安全诊断、时间及可读取/复制 ID，按需显式重查；当前失败和结果未知提供匹配的只读恢复与合法操作。验证：历史 failed 不改成 succeeded，不常驻推进执行的 Check progress/Retry；当前未知未核对前不能重试，不相关历史查询不释放锁，404/410 说明原对象查询结果而不改 Work 状态。

## 5. 集成验证与本地 GUI 复查

- [x] 5.1 运行受影响 Go/浏览器套件、UI 检查与完整构建，同步并核验 Go 嵌入的 WebUI 资源。验证：`go test -mod=readonly ./internal/cli ./internal/coreapp ./internal/corestore`、相关 race 测试、Desktop Playwright、`make build`、`node scripts/check-ui-language.mjs`、`node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs`、`git diff --check` 通过；Console 可达性等受影响入口按实际范围回归，不把未执行项目写成通过。
- [x] 5.2 扩展并执行真实 Core/Docker 重启验收，覆盖慢恢复门禁、基础 ready 后单 Work 恢复、多条终结 Retry、当前失败、提交结果未知及两个独立 Work。验证：`TestNativeWorkObservationDuringSlowRestartRecovery` 与对应浏览器场景通过，纯读取期间生命周期 POST 数不增长，明确用户重试才增加一笔原操作；仅清理本次精确 installation ID 的资源。
- [x] 5.3 用实际验证的 Piwork 输入在独立 microvm 构建工作区生成本地 Windows GUI，复用锁定 Guest/QEMU 资源并使用原生 Windows GUI 工具链。验证：打包输入的 commit、dirty 状态、input hash 如实可查，Guest 中 Core 与验证程序一致，成品格式/校验和和真实启动页面通过；用户复查用桌面 `piwork-microvm-gui.exe` 由核验成品替换，不打 tag、推送或对外发布。
- [x] 5.4 在本变更内记录最终验收范围、实际结果与限制，分别标明现场 Retry 来源、合成场景、浏览器检查及 Windows GUI 复查。验证：附件引用有效命令/证据且不含真实秘密，`openspec validate fix-desktop-startup-recovery-ui --strict` 与变更文件检查通过，未测项不标记完成。

## 6. 核验 WARN 修复

- [x] 6.1 修复 WARN-1：恢复期间的缓存页面继续遵守当前 Work/Service 运行能力撤销，Stop、Delete、权限撤销及 Service 不再可用时撤回旧 iframe，同时保留适用草稿和正常恢复的节点连续性。验证：将核验复现转为持久浏览器回归，覆盖 Work/Service 撤销及原有恢复再就绪；业务请求不因重绘重发。
- [x] 6.2 修复 WARN-2：当前任务投影按原 Service 的有效归属、读取结果和当前失败/清理义务判定，不以 Work Ready 代替 Service 收敛；问题恢复后归历史，保留 failed 原结果与未知锁。验证：持久测试覆盖非必需 Service 失败且 Work/列表已读回、恢复 Ready、不同 Service、未确认归属及历史失败，不把全部 failed 一律显示为当前任务。
- [x] 6.3 执行受影响回归与构建，同步 Go 嵌入资源，重新构建/核验并替换桌面 Windows GUI；更新本变更中两项 WARN 的修复证据与实际限制。验证：两项原复现及相关浏览器/adapter 测试、边界检查和严格规格检查通过；GUI 记录更新后的真实输入与校验和，保留用户运行安装和无关工作区内容，不提交、归档或发布。
