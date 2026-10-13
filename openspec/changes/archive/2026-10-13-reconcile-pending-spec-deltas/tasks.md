# Tasks

已按 design 中的现行契约完成本轮 Linux 核对；实际结果与平台边界见 `evidence/verification.md`。不重新同步或归档原三个变更，不纳入另外十项未完成任务。实现修复以违约复现为前提；已有行为正确时交付实际核验及必要测试即可。

## 1. 固定本轮核对对象与证据基线

- [x] 1.1 将原六块 63 个 Scenario 及 CST-NATIVE-001 四个关联场景对应到 design 已定位的源码符号和测试断言，在本变更创建 `evidence/verification.md`，记录实际代码身份、完整正文中的判定点、已覆盖项及缺少的执行/断言。验证：每个范围内 Scenario 都可定位到当前主规格和具体测试或明确待验证项；不以场景数量、测试名称或旧通过状态代替行为判断。
- [x] 1.2 核对当前规格/归档基线及原证据身份，执行 OpenSpec 严格校验、文档边界检查，并捕获原归档冻结输入摘要与那十项未完成任务的状态。验证：旧 TS 升级规则未重新出现，原三项合并后的场景保留；旧归档没有被改写，新清单及临时日志不进入根 docs 或长期替代目录。

## 2. 授权恢复与 HTTP/容器边界

- [x] 2.1 复核并运行 `local-auth.test.ts`、`native-auth.test.ts`、`preferences.test.ts` 及 Go Desktop 本地授权/容器模式专项测试，核对 DWUI-001 和 WACC-DESKTOP-001 的 Cookie/ticket、CSRF、HTTP origin、身份清理和当前实例授权。验证：旧票据不阻断有效本地会话，远程 HTTP 与 HTTPS 不串 token，容器入口仍需本地授权，未授权/错误 Host/Origin/CSRF 在内容或磁盘访问前被拒绝；本组结果写入专项证据。
- [x] 2.2 对旧业务 401/CSRF 拒绝、重新初始化和匿名 Inspect 首次登录的交错逐项检查现有断言；缺少判别力时补 gate/时钟驱动回归，复现违约后仅修复所属 adapter 或 Go 授权实现。验证：新身份及本地授权恢复不被旧响应破坏，原 Inspect 只在允许的同 Core 匿名升级中保留，没有自动重发 bootstrap、登录或业务修改；缺陷保留修复前失败和修复后同断言通过结果，无缺陷则记录实际一致性结论。

## 3. WebUI 数据恢复与已合并行为衔接

- [x] 3.1 核对 DWUI-004 的 R3 与 Controls recovery 回归，补足原 Run 410 历史恢复和另一 Session/Service 活跃 Run 并存的确定性交错；仅对复现的观察/身份问题修改实现。验证：原 Run/Session 的 GET 目标和当前用户错误保持，后台停止目标不被改绑，历史回复不重复，终态或授权失效后观察停止，无第二次 Run POST；本组证据区分 HTTP 夹具与真实后端。
- [x] 3.2 核对 DWUI-007 的 R2、R7 和 Brain 相关断言，对目录失败/恢复、非法 JSON、Save 或候选晚返回与后续编辑组合补足缺失回归；违约复现后最小修复 `configuration.ts`、app 或 adapter。验证：提交包含同一份完整有效草稿和显式空值，非法输入无 PUT，后续编辑不被旧结果清空，目录错误不伪装全局离线，Saved、Apply、Loaded 和实际行为验证仍各自表达；记录每项当前执行结果。
- [x] 3.3 核对 DWUI-008 的 R4、R5、Work naming 及 `TestNativeDesktopAnonymousInspectionLoginAndExplicitRelease`，验证匿名 Inspect→原 Core 首次登录→名称冲突/留空自动命名/接受回执未知的原 transfer 链路；缺口用现有夹具复现并修复。验证：不重复本地上传或 Import，sourceName 与最终目标名称来自确认事实，未知结果不释放或替换原提交，用户后续输入、原 Operation 及同一 Service iframe 保持；必要的 R1 文件条件写入和 R6 Console 包阶段回归随本组复查并记录。

## 4. Go 存储、正常关闭与恢复

- [x] 4.1 核对 CST-NATIVE-001 与现行 corestore，运行格式拒绝、初始化中断、单一所有者和内容保持测试；仅对可复现的契约偏差修复存储实现。验证：`piwork-go-core`/schema 1 正常恢复，旧 TS、未知版本及无合法 marker 的非空目录拒绝且原字节不变，没有自动迁移或重新分配安装身份；记录测试及实际结果。
- [x] 4.2 对 `Application.Close` 的 gRPC/HTTP→worker→受管 Work 关闭顺序建立受控未结束请求，明确总预算使用及容器停止尝试；复现关闭契约违约后再作最小修复。验证：默认 30/10/45 秒保持，阻塞/失败不会无限等待或报告正常关闭成功，仍按现行契约尝试停止其他受管 Work并保留安全诊断；缩小预算的复现和默认预算核对分开记录，store/listener 释放可验证。
- [x] 4.3 在匹配镜像及独立 Engine 安装上运行 `TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain`、Core 进程重启与 `TestNativeCoreCrashAdoptsExistingAgent`，补足 enabled/disabled Service 选择的实际读回。验证：正常停机确认受管容器已停且 desired、配置、历史和选择保留；异常退出不冒充正常停机，重启不重复 Run/Work 或启动禁用 Service；只清理本次 installation 标签资源，将代码/镜像身份、实际退出和恢复结果写入本组证据。

## 5. 集成交付与最终核验

- [x] 5.1 按实际修改范围构建并运行相关 Go 与 Desktop 完整回归；浏览器源码有变动时重建 Desktop、`internal/desktopassets/static` 和 Go CLI，再核对嵌入资源一致性。验证：新测试实际经过预定分支，原授权、数据恢复、命名、后台请求及聊天控制保持；没有源码修改时不制造构建资源差异，未执行或必需 skip 不记录为通过。
- [x] 5.2 以当前构建复用 Desktop real-core 独立安装，按需启用本地授权恢复与 Chat controls 检查，将授权恢复、后台执行、Save/Apply、Stop→Export→Inspect→Import→Start 贯通复核。验证：真实 Core/Agentd/CLI 的请求与原 ID 保持，无隐式重发、错误身份或 iframe 重载；记录真实后端与浏览器故障注入的边界，精确安装的容器/网络/卷清理完成，不操作用户预览实例。
- [x] 5.3 完成专项证据中每个判定项的当前结果及必要安全附件，执行本变更和全部主规格的 OpenSpec 严格校验、`node scripts/check-repository-docs.mjs`、`node scripts/check-native-boundary.mjs` 与 `git diff --check`。验证：范围内契约都有匹配实现及可定位执行证据，剩余阻碍一致性结论的未验证项保持任务未完成；旧归档摘要、十项未完成任务及发布身份不变，不以本轮 Linux 验收宣称 Windows 或公共下载已完成。
