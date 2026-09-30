# Tasks

## 1. CLI 启动与浏览器资源

- [x] 1.1 在 `apps/cli` 增加 Desktop 服务端/浏览器目录、独立浏览器 tsconfig 和静态资源复制步骤，保持 SDK 仅服务端使用；验证 Node24 下 CLI build/typecheck 成功且 dist 可独立加载资源，无浏览器 Node imports。（CLI-DESKTOP-001、DWUI-002；design §1）
- [x] 1.2 实现 `desktop [--port] [--no-open]`、固定 loopback/精确 Host、资源/端口错误及安全打开浏览器；进程测试验证默认17891、非法参数/`--json` exit2、占用exit6、打开失败继续运行、help 无文件/网络副作用。（CLI-DESKTOP-001）
- [x] 1.3 实现本地启动/退出资源收集与 SIGINT/SIGTERM 清理；进程测试检查监听/socket/暂存释放，Core 未收到 Stop/Cancel，既有 proxy 可同时运行。（CLI-DESKTOP-001、BSA-006）
- [x] 1.4 在 CLI 用户指南增加启动、手动打开、链接有效范围、退出影响与 Chrome/Edge 范围；按文档执行 `--help` / `--no-open` 并核对输出无平台 token。（CLI-DESKTOP-001、BSA-001）

## 2. 本地授权、身份与控制 API

- [x] 2.1 实现一次性 fragment 引导、HttpOnly `__Host-` Cookie、内存会话/CSRF 与精确来源检查；测试过期/重放票据、匿名借用保存 token、DNS rebinding Host、跨站表单和 Service origin 请求均拒绝，确认票据不进入普通链接/日志。（WACC-DESKTOP-001；design §3）
- [x] 2.2 实现 Core 地址选择、匹配凭证复用、login/me/logout、连接切换与会话代次；测试 A 的 token 不发给 B、旧响应不渲染、网络失败保留最后状态、确认401撤销内容流但保持监听、登出远端不可达准确提示。（DWUI-001、WACC-DESKTOP-001）
- [x] 2.3 建立 design §6 的所有者 API allowlist/schema、安全错误与敏感响应头；路由测试覆盖方法/路径白名单、payload/1MiB边界、admin/control旁路拒绝、保留头剥离及未知路由拒绝。（DWUI-001、WACC-DESKTOP-001）
- [x] 2.4 实现连接/账号页面和能力局部降级；浏览器测试区分 Core可达/运行环境不可用/文件缺失/未登录，切换身份无旧内容，未登录仍可进入受本地授权保护的 Inspect。（DWUI-001/002）
- [x] 2.5 在指南补充凭证复用、Core切换、登录过期和显式登出影响；验证示例与会话测试一致，无须复制 token 到网页。（DWUI-001、WACC-DESKTOP-001）

## 3. 共用界面、状态与操作恢复

- [x] 3.1 实现 Serve 浅色语义变量与共用按钮/输入/列表/菜单/弹层/状态/错误组件；浏览器验证长名称、英文文案、焦点2px、对比度、Escape/焦点返回及 reduced-motion，样式变量修改影响全部对应控件。（DWUI-002；DUL-007）
- [x] 3.2 实现独立 Work List 和单 Work Services/Files/Chat/Settings 壳，Service主区域/Agent辅助栏、聚焦聊天及360px切换；测试切换保持同一Session/草稿，列表行按钮不触发行导航，空/加载/失败/旧内容各自独立。（DWUI-002）
- [x] 3.3 实现 Operation acceptance/观察/错误状态与 design §9 只读退避、按ID详情及已知活动区；测试 superseded、404、网络中断、无ID未知提交不重发，关闭观察不取消后台任务。（DWUI-010）
- [x] 3.4 实现按Core/用户隔离的本地操作记录、原子写入/合并/清除及重载恢复；测试两个实例不覆盖记录、身份切换不混用、记录仅含许可元数据、删除隐藏Work仍可恢复操作。（DWUI-010、WACC-DESKTOP-001）
- [x] 3.5 在原型能力矩阵追加运行实现/测试映射列并标记未完成项，保留静态历史；核验01、09、29、32对应当前页面与测试，不将未实现模块标为完成。（DWUI-002；DUL-016）

## 4. Work 创建与生命周期

- [x] 4.1 实现 New Work 默认/高级表单，按CLI相同payload传镜像、Skills/Packages默认/显式空、AGENTS及完整JSON；API/浏览器测试覆盖字段省略与空数组、冲突校验、输入保留及accepted不等于Ready。（DWUI-003）
- [x] 4.2 实现查询、搜索、公开身份、状态快捷动作和Start/Stop/Retry确认；状态测试覆盖desired/observed分离、Start被Stop取代、停止失败不出现Retry running或Export。（DWUI-003）
- [x] 4.3 实现Delete确认、默认数据留存说明及删除后Operation入口；真实/模拟Core测试验证无purgeData扩权、列表隐藏后仍可观察，不显示虚假撤销。（DWUI-003、DWUI-010）
- [x] 4.4 补充Work创建/生命周期的用户操作说明及矩阵05、10、27、28映射；浏览器演练空列表创建→准备→停止→控制信息可用，停止后不新取Session/Run。（DWUI-002/003）

## 5. 浏览器 Service 入口

- [x] 5.1 实现基于Core公开域名/端口的route登记、每应用origin、entry票据和route Cookie；测试过期重放、跨Service/端口换票、匿名入口和未登记Host拒绝，无任意URL/IP/Docker目标。（BSA-001/002/003、WACC-DESKTOP-001）
- [x] 5.2 实现HTTP/SSE转发及Origin/Referer/Location/Set-Cookie精确改写与保留Cookie剥离；夹具测试原始路径/查询/体、根资源、同名平台路径、应用Basic/Bearer/401、多Set-Cookie及外部来源不洗白。（BSA-002/003/004）
- [x] 5.3 实现WebSocket升级、head与双向流、连接限额/释放及平台资格撤销；测试帧往返、拒绝升级、禁止任意CONNECT、会话/Service停止2秒内断流和应用错误不退出。（BSA-002/004/006）
- [x] 5.4 实现Service工具栏的域名/本地链接区分、端口选择、正常独立外壳与禁止嵌入直接打开回退；浏览器测试新标签页登录态、CSP/XFO保留、未确认预览不报成功、停止后正常外壳状态及直接导航不可用页。（BSA-001/004/005）
- [x] 5.5 增加两Service同名Cookie/storage和恶意应用负向浏览器测试；验证外壳DOM/存储/文件控制API、伪造postMessage、Service Worker跨源作用域均不可访问，平台凭据不在应用请求/响应中。（BSA-003、WACC-DESKTOP-001）
- [x] 5.6 记录本机链接、`.work`身份、上游HTTP范围、硬编码URL/SSO/脚本父域Cookie和保留入口路径限制；在真实Chrome/Edge当前稳定版执行根路径+登录+SSE/WS+内嵌/独立打开矩阵并记录版本/结果，不通过不得以PAC配置替代。（BSA-001—006）

## 6. Service 管理与 Agent 对话

- [x] 6.1 实现所有未移除Service列表/详情、启停重试重启移除、有界日志及刷新；测试禁用/失败/非Web项可管理、Stop持久禁用、Start不启动停止Work、Remove保留共享数据和Operation。（DWUI-005；DUL-013）
- [x] 6.2 实现Session创建/列表/切换、真实摘要标题、同一聊天输入与可见Service身份上下文；浏览器测试busy保留草稿、无自动队列/DOM采集、旧context给New session。（DWUI-004/005）
- [x] 6.3 实现Run提交、NDJSON事件/工具反馈、游标去重恢复与取消；测试断线、分段上限、游标过期、成功/取消竞争和停止后旧历史提示，统计断线恢复期间submit请求仍仅一次。（DWUI-004）
- [x] 6.4 补充Service控制及AI数据来源说明，映射帧11—17、33；用显式共享文件/API的测试服务演示请求分析与来源，另验证不可达数据不被描述为页面同步。（DWUI-004/005；DUL-006）

## 7. Files 与 WebDAV

- [x] 7.1 实现独立受保护Files路由，复用严格DAV路径、Destination/Location/href映射及安全XML解析；测试中文/空格/百分号/隐藏文件、跨Work/根穿越/DTD拒绝及无Cookie/Basic泄漏到Core。（DWUI-006、WACC-DESKTOP-001）
- [x] 7.2 实现目录导航、文件类型/元数据、普通下载及≤1MiB UTF-8文本编辑；浏览器测试二进制/超限/特殊项拒绝编辑、BOM/换行保持、Save/Discard/Keep editing和停止状态不可读写。（DWUI-006）
- [x] 7.3 实现逐文件上传、新目录、覆盖确认、Rename/Move/Copy/Delete和递归影响确认；方法链测试字节一致、Overwrite/条件请求、工作根保护、单Work mutation并发及取消确认无写入。（DWUI-006）
- [x] 7.4 实现207逐路径结果、条件冲突、未知写入重读及能力降级；故障测试断开已发PUT不重放、保留草稿、部分失败不声称回滚、Files缺失仍可使用Service。（DWUI-006、BSA-006）
- [x] 7.5 实现Connect with WebDAV辅助流程并更新指南/帧18—21、34矩阵；在真实Core上用既有proxy和rclone等通用DAV客户端与浏览器交替读写同一文件并核对字节，确认临时密码仅在终端、重启失效且浏览器无需该密码；记录实际客户端、浏览器和结果。（DWUI-006、WACC-FILES-002、WACC-DESKTOP-001；design §10）

## 8. Settings 与 Pi Packages

- [x] 8.1 实现Skills catalog/选择/清空、保留Work副本语义和AGENTS当前/待应用编辑导入；测试省略与清空、目录与loaded区别、字段校验及未保存离开确认。（DWUI-007）
- [x] 8.2 实现Advanced完整JSON导入编辑和配置状态条，使用当前有效schema；测试modelRef/agentImage/mcp/resources/tools字段、非法值定位、Save不Apply、不展示内部revision/平台secret。（DWUI-007）
- [x] 8.3 实现Work包列表/详情、Core/npm/Git安装更新、选择/启停/移除；测试catalog不等于installed、来源互斥、修改只影响desired、active/history留存说明。（DWUI-007）
- [x] 8.4 实现本地目录/ZIP选择、受限multipart暂存/打包和work scope上传；测试相对路径/重复项/穿越/压缩炸弹/限额拒绝，确认无adminUpload调用，文档说明目录权限/符号链接限制。（DWUI-007、WACC-DESKTOP-001）
- [x] 8.5 实现独立Apply与进度/恢复、runtime loaded/modelVisible状态；状态测试busy不取消Run、失败保留active/回退失败、后续编辑仍pending以及stopped Apply不Start。（DWUI-007）
- [x] 8.6 更新Settings指南及帧22—26、35、36矩阵；演练安装→Saved→Apply→Loaded，确认五类来源与配置子页面均有成功/失败/恢复证据。（DWUI-007）

## 9. Inspect、Import 与 Export

- [x] 9.1 实现transfer job、私有暂存、流式接收/hash、并发/容量/空间保护及TTL清理；测试取消/退出/ENOSPC/超限/符号链接与另一实例保护，合成大流验证内存不随包大小线性增长。（DWUI-008/009、WACC-DESKTOP-001；design §8）
- [x] 9.2 实现无Core登录的完整Inspect、安全摘要/私有提醒与关闭清理；使用合法、损坏、超限和恶意包测试，不连接Core、不执行包内容、不接受任意宿主路径。（DWUI-008）
- [x] 9.3 实现已检查包上传/Import审核、名称省略、acceptance/Operation恢复和stopped结果页；测试显式重名、依赖/权限错误、未发布失败不出新Work、取消观察不取消Import、未知提交不重发。（DWUI-008、DWUI-010）
- [x] 9.4 实现Stop→Prepare package→Download的独立动作与Core准入反馈；测试running/stopping/停止失败无Export、真实锁冲突可见、无隐式Apply/Cancel/Start，保留原Operation/snapshot ID。（DWUI-009）
- [x] 9.5 实现原snapshot下载准备、长度/hash/格式校验、原生流式attachment、按ID找回和过期/中断恢复；测试损坏包不开放下载、空间不足不删Core包、重试不Export、浏览器仅显示Download started。（DWUI-009）
- [x] 9.6 更新迁移指南与帧06—08、30、31矩阵；真实Core完成Files写入→Stop→Export→Inspect→Import→Start→下载比对workspace字节，记录Operation与快照恢复结果并清理测试资源。（DWUI-006/008/009/010）

## 10. 跨模块交付验收

- [x] 10.1 在Node24运行仓库typecheck/build与受影响单元/进程测试、CLI浏览器测试；保留既有proxy/PAC/WebDAV/CLI命令回归，确认新浏览器入口未改变原命令退出/认证语义。（CLI-DESKTOP-001、WACC-FILES-002、全部新增需求）
- [x] 10.2 在真实Core与Chrome/Edge稳定版完成双Work/双Service/双用户场景，覆盖应用登录、SSE/WS、文件操作、对话、配置Apply、导入导出及撤销；记录浏览器版本和未通过项，不以mock结果替代。（DWUI-001—010、BSA-001—006、WACC-DESKTOP-001）
- [x] 10.3 按36帧能力矩阵人工复核宽屏/360px、长内容、键盘、状态动作及返回路径；逐项链接实际页面与测试证据，修正错位/遮挡/假成功，确认DUL覆盖并记录BSA-005的直接应用标签页例外。（DWUI-002；DUL-001—016）
- [x] 10.4 完成断线/重载/登出/CLI退出跨模块验收及交付说明；核对所有任务证据、无秘密日志/遗留测试资源，运行OpenSpec严格校验并确认文档不把本地链接描述为公网分享。（DWUI-001/010、BSA-001/006、WACC-DESKTOP-001）

## 11. Verify 遗留问题修复

- [x] 11.1 在 Core/用户切换、登出和确认会话失效时，清除浏览器中的 Work/Service/Session/Run 选择、聊天草稿及已检查包，并撤销和清理旧身份的本地传输暂存；测试同一浏览器会话中 A 登出、B 登录且两人均可访问同一 Work 时，B 看不到 A 的草稿、选择或传输，未登录时仍可开始新的本地 Inspect。（DWUI-001/008、WACC-DESKTOP-001；design §3/8）
- [x] 11.2 将 Files 下载、上传及其他转发请求绑定当前身份代次；身份撤销时及时关闭请求、上游和下游流并释放监听，已提交的写入保持结果未知且不自动重试；以长时间 GET/PUT 验证登出、Core 切换和确认 401 后不再传输旧身份数据，新登录仍可访问。（DWUI-001/006、WACC-DESKTOP-001；design §3/7）
- [x] 11.3 按身份最多保留 500 条 Core 已确认终态的本地操作记录，未确认终态的记录不得因配额淘汰；安全合并多实例记录并在单文件达到读取上限前轮转或压缩，测试超过 500 条终态及超过 16 MiB 的历史仍能恢复未终态操作，且不引入敏感字段或符号链接回归。（DWUI-010；design §9）
- [x] 11.4 在真实Core上创建两个普通用户及各自Work/Service，双向核对Work List、直接Work/Service访问和workspace文件隔离；不得用管理员可见普通用户数据代替普通用户间隔离验收，记录Chrome/Edge结果并清理资源。（DWUI-001、BSA-002、WACC-DESKTOP-001；design §10）
- [x] 11.5 在真实Core上使当前会话异步失效，并分别停止有活动连接的Work；验证浏览器Service的SSE/WebSocket及Files长时间GET/PUT及时停止、旧本地授权不能续用、WebUI进入准确恢复状态，已发写入结果未知且不自动重试；核对Service不超过2秒的撤销边界，记录Chrome/Edge结果并清理资源。（DWUI-001/006、BSA-002、WACC-DESKTOP-001；design §3/7/10）
