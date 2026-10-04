# Tasks

## 1. 动作状态、冲突和视图归属

- [x] 1.1 为两套应用添加轻量动作状态、确认/刷新独立字段、请求 token 与时间信息，接入原区域英文状态、live status 和 aria-busy；对应 DWUI-011、SUI-005/006，验证延迟响应前已有目标/动作、十秒等待不虚构失败、快速响应无强制延时、错误没有成功图标。
- [x] 1.2 按 design 冲突表统一 Desktop 鼠标/键盘/文件选择入口，替代 actionPending 整页锁；对应 DWUI-012，测试同对象重复/双向冲突只发一次、无关 Work/Service 合法动作和 Close/复制可用、接受后释放提交锁且允许合法 Stop 取代 Start。
- [x] 1.3 接入身份 generation、view token、草稿提交版本和计时器清理；对应 DWUI-012、SUI-005/006，测试切换 Core/账号/Work/路径、关闭弹层后的晚响应不污染新对象、不释放新锁、不复活旧弹层，保存期间新编辑仍 Unsaved；在集成文档记录锁和关闭边界。

## 2. Desktop 身份、Work 和 Run

- [x] 2.1 补全 D01 的 Login/Sign out/Switch Core/Check connection/readiness/Retry Works 反馈与只读去重；对应 DWUI-011/012，逐入口延迟测试目标可见、同值检查有确认时间、注销未知不伪装完成、身份提交期间平台修改受限且匿名 Inspect 准入不变。
- [x] 2.2 补全 D02/D03 Create/Start/Stop/Retry/Delete 并拆开 acceptance 与 Work/Works 刷新；对应 DWUI-011/012，分别阻塞提交和后续 GET 验证原 ID 已显示、慢/失败刷新不隐藏接受或重发、状态按真实 state/phase；覆盖 Start 被 Stop superseded。
- [x] 2.3 补全 D04/D05/D06 的 Open/Settings/深链接/Check status、Services/Files/路径及 Session 列表/创建/切换读取；对应 DWUI-011/012，逐入口验证加载≠空态、旧缓存有标识、404/拒绝/失败有恢复、晚结果不切回旧对象，会话创建确认不等待对话读回。
- [x] 2.4 补全 D07 Send/Cancel/Resume 的原对话反馈及接受/读取分离；对应 DWUI-011/012，验证鼠标和键盘提交防重复、草稿保留、原 Run ID 立即呈现、取消接受≠取消终态、恢复不重复发送；执行既有 Run 恢复回归并在集成文档记录 D01—D07 测试映射。

## 3. Desktop Service 控制和访问

- [x] 3.1 补全 D08/D09 各 Service 控制、详情/日志读取与刷新反馈；对应 DWUI-011/012，逐入口延迟测试目标行可见、原 Operation/确认先于读回、日志空态/失败/缓存时间区分、其他 Service 合法动作可用。
- [x] 3.2 补全 D10 入口失败/显式 Retry、有界 embed unknown 的 Check preview/独立打开；对应 BSA-005，测试慢准备、拒绝、unknown 不写成 Ready/blocked、切换端口晚响应失效、重复检查复用原 entry，反馈更新保持同一 iframe 节点及输入。
- [x] 3.3 将新标签页/独立窗口打开放在用户手势内并隔离 opener，补齐拦截说明、Copy local link、授权失败空窗清理；对应 BSA-005，模拟阻断与慢/失败授权，验证原 Work 可重试且不含 ticket、不发 Stop、不移除 CSP；执行正常/禁止嵌入及停止回退回归，在集成文档记录 D08—D10 的边界和验收。

## 4. Desktop Files

- [x] 4.1 补全 D11 文本读取、条件 Save、Re-read 的状态及已确认写入/版本读回分离；对应 DWUI-011/012，阻塞 PUT 与后续 GET 验证确认先显示、读回失败不重写/不复用旧版本授权覆盖、新编辑不丢失，执行已有条件覆盖回归。
- [x] 4.2 为 D12 逐文件上传/覆盖接入保留原 File 和条件头的 XHR 进度；对应 DWUI-012/013，测试 HEAD 检查、当前文件/总数、真实字节、发送完仍等待确认、部分失败/未知保留输入、不自动重传，文件选择与键盘重复不多发修改。
- [x] 4.3 补全 D13 建目录/Rename/Move/Copy/Delete 的逐路径等待、结果及独立目录刷新，保留文件下载发起的真实反馈；对应 DWUI-011—013，逐入口测试慢响应、207/部分失败/未知、同 Work 修改串行、其他 Work 不锁，更新集成文档 Files 进度及刷新边界。

## 5. Desktop 配置和 Pi Package

- [x] 5.1 拆分 D14 Settings Save/Refresh/Apply/Skill copy 的确认与配置读取，按提交版本更新保存基线；对应 DWUI-011/012，逐入口验证已保存/原 Apply Operation 在慢读回前可见、读回失败只读重试、编辑期间不清除新草稿、不暗中 Apply。
- [x] 5.2 补全 D15 catalog、AGENTS/JSON 文件读取的本地检查及选择 token；对应 DWUI-011/012，验证文件读取未完成提示可见、失败和取消保留旧输入、替换/关闭后的晚结果无效、检查完成才更新新草稿。
- [x] 5.3 为 D16 五种 Pi Package 来源安装/更新及移除接入提交反馈、本地目录/ZIP multipart XHR 真实进度、发送完等待校验/转发和即时 acceptance；对应 DWUI-011—013，逐来源/动作测试延迟、未知不重发、Installed/Apply/loaded 不混用、没有远端字节不造百分比，记录 D14—D16 验收与来源边界。

## 6. Desktop Work 包、下载和恢复

- [x] 6.1 补全 D17/D18 Inspect/Import 的查询/清理及 Export 准备/检查反馈并保持原身份；对应 DWUI-011—013，测试接受后慢读取、十秒等待、重复入口和鼠标/Escape 关闭，执行匿名检查/明确导入/未知恢复/暂存释放/先 Stop 后 Export 的既有回归。
- [x] 6.2 实现 D19 UUID v4 预先分配、原准备 POST 与串行 GET 并行观察、初始未 claim 的 404 区分及真实字节/校验/ready 展示；对应 DWUI-013，浏览器测试 POST 未结束可见进度、未知总量无百分比、晚查询不覆盖 ready，并增加 Go CLI 慢速合法 `.work` 契约测试，验证相同 transfer 在 POST 未返回时可查询且未校验内容不可下载。
- [x] 6.3 实现 D19 Check transfer 的只读恢复、关闭后原上下文 Download ready、同 ready transfer 内容下载；对应 DWUI-012/013，测试观察失败≠准备失败、重新查询无第二次 POST/Export、离开后不自动下载、返回可下载原内容、只提示 Download started、身份变更不暴露旧内容。
- [x] 6.4 补全 D20 Known Operations/Lookup/Refresh/恢复观察/Snapshot 查询与清空已完成本地记录反馈，手动查询与后台轮询去重；对应 DWUI-011/012，逐入口测试请求计数、同值确认时间、阶段/错误真实、同步清空无虚假等待，在集成文档记录 D17—D20 的传输与恢复边界。

## 7. Serve 手动动作和修改读回

- [x] 7.1 为 S01 手动 Health/Verify runtime/Retry connection/Operation refresh-resume/Read runtime-defaults/Sign out 接入原对象反馈、读取去重和确认时间；对应 SUI-005，逐入口测试请求未结束可见、与轮询只有一个请求、十秒仍等待、离线注销和身份晚响应按既有规则处理。
- [x] 7.2 为 S02 Skill/Package 目录、ZIP、AGENTS 本地预检接入 Checking selected files 与选择 token；对应 SUI-005，逐来源测试预检中不能提交新选择、失败/取消保留旧输入、换源/关闭的晚读取无效。
- [x] 7.3 拆分 S03 User create/enable-disable/reset 的确认和 Users 刷新，结果落在稳定页面；对应 SUI-006，逐动作阻塞读回验证确认/入口先显示、密码清空、刷新失败仅只读 Retry、无消失 dialog 引发的异常，自撤销返回登录不被刷新覆盖。
- [x] 7.4 拆分 S04 Skill 添加/更新/控制与 Package 控制的确认和 catalog/defaults 刷新，上传 API 不等待列表；对应 SUI-005/006，逐动作测试真实上传、慢/失败刷新仍保留确认、未知沿用稳定身份核对、无重复上传和缺失 dialog 异常。
- [x] 7.5 补全 S05 Runtime/Defaults 保存后的独立 readiness/辅助读取，保持已有 Login/Package install 反馈与草稿/敏感清空规则；对应 SUI-005/006，测试保存确认先显示、readiness 失败不改写保存结果、新非敏感编辑不丢失、key 不回填，记录 S01—S05 测试和反馈语义。

## 8. 构建与跨模块验收

- [x] 8.1 构建两套 UI 并同步对应 Go embed 资源，运行两应用 typecheck/build/test:browser 和 `go test -p 1 ./...`、`make build-go`；对应全部新增/修改要求，验证运行二进制提供新动作模块且无需 Node 运行时，已有条件覆盖、Run、Inspect/Import、安全路由回归均通过。
- [x] 8.2 使用隔离真实 Core 执行现有 Desktop `test:real-core` 与 Serve 真实 Core 用例，并在桌面 Chrome/Edge 实测 Service 独立打开；对应 DWUI-011—013、SUI-005/006、BSA-005，验证创建/生命周期、对话、Service、Files、配置与 Work 包主链路不因反馈改造改变结果，不改动用户手动测试环境。
- [x] 8.3 核对 D01—D20/S01—S05 每个实际动作的测试映射、桌面/窄屏长状态、键盘焦点/live status、iframe 与输入保持及 Close/复制可用性；对应全部要求，更新 `docs/webui-integration.md` 汇总真实链路与模拟延迟证据并明确局限，检查无遗漏入口、无秘密截图/日志、无新增 API 或范围外布局变化。

## 9. 核验 WARNING 修复与回归

本节收集本次核验确认的三个前端缺陷；原 28 项任务保留既有实施记录，新增修复及验收任务单独跟踪。修复范围为浏览器状态协调与对应测试、构建资源，不修改 Go Core/CLI 的业务逻辑或 API。

- [x] 9.1 修复 Desktop Service 控制锁，将控制资源按 Work + Service 绑定，预览入口继续按 Work + Service + port 区分；对应 DWUI-012，延迟 Restart 后关闭详情、切换端口、重开详情及再次触发控制，验证只有一个冲突请求，原等待反馈可见，其他 Service 的合法控制仍可用。
- [x] 9.2 修复 Desktop 未知结果核对范围，匹配原 Core/账号、Work、动作和资源并核对实际返回对象，禁止任意查询成功批量解除 lifecycle/transfer/agent 锁；对应 DWUI-011/012，覆盖未知 Start 后查询其他 Work 的 Operation、同 Work 无关 Operation、关联证据不足及合法原对象核对，验证无第二次 Start、仅恢复对应准入、其他未知锁保留，原提交未知不被改写为确定成功。
- [x] 9.3 修复 Serve Runtime 保存及 readiness 的晚回调清理，将原提交 Key 清理绑定原输入上下文或有效视图 token；对应 SUI-005/006，延迟 PUT/readiness 后离开、返回并输入新 Key/草稿，覆盖旧成功、失败及 finally，验证新输入不丢失、新提交锁不被释放，原敏感输入仍按既有规则清理且不回填、不记录。
- [x] 9.4 执行三个 WARNING 的新增回归与两应用既有浏览器回归，运行 typecheck/build 并同步两套 Go embed 资源，运行相关 Go 静态资源/交付契约测试及 `make build-go`；更新 `docs/webui-integration.md` 记录每个 WARNING 的修复与证据边界，验证实际二进制提供修复后的资源，无新增后端业务 API、不改动用户测试环境。
