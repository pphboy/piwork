# Tasks

所有任务初始为未完成。R1—R7 对应 design 的已确认问题；每组包含自己的回归及接入说明，最后一组只做跨模块验收。执行顺序为 1、2、3、4、5、6、7、8；R4 的持有状态先于 R5 的释放状态落地。

## 1. R1：文件写入保护（DWUI-006）

- [x] 1.1 在当前 Desktop 编辑状态/adapter 中保存正文读取版本，保存时携带有效 If-Unmodified-Since；实现 412/unknown 保留草稿、独立显示重读版本和明确更新覆盖基线，后台刷新不替换脏编辑基线。验证：浏览器请求断言修改时间绑定原读取、412 保留草稿、重读只 GET、成功后新基线可确认，未知结果不自动 PUT。
- [x] 1.2 为串行上传建立逐路径覆盖意图：新目标 PUT 带 If-None-Match: *，已有目标按用户确认的版本带日期条件；HEAD 失败不当作不存在，目标变化需重新确认，缺时间须明确风险与覆盖同意。验证：断言 HEAD→目标新建、覆盖确认→目标再变化均不无条件覆盖，原 File 字节及待上传输入保留。
- [x] 1.3 将文件保存/上传正常路径、跨秒并发冲突、缺修改时间、刷新脏草稿及丢响应场景加入 Desktop 浏览器测试，并使用现有 Go file helper 条件测试验证 412 行为。验证：相关浏览器用例通过，`go test ./internal/filehelper` 通过，冲突后的后端内容保持且重读无新增写入。
- [x] 1.4 更新 `docs/webui-integration.md` 的文件说明，写清读取基线、条件冲突、显式覆盖和秒级条件边界。验证：说明与 DWUI-006 和 1.1—1.3 实际请求一致，不宣称锁/ETag/自动合并。

## 2. R2：统一配置草稿（DWUI-007）

- [x] 2.1 统一 Settings 的公开配置对象与 Advanced 原文，普通表单、JSON/AGENTS 文件导入和各保存入口共用同步/验证；非法 JSON 阻止配置页签转换与 PUT，保留修正/Discard，保存仅更新 desired。验证：从任一页签保存的完整 configuration 等价，显式空值及其他公开字段保留，同一字段最后一次有效编辑生效。
- [x] 2.2 增加 Advanced→Skills/AGENTS/Packages 保存、普通表单→Advanced 保存、同字段重复编辑、显式清空、非法 JSON、失败/unknown 与 Save/Apply 分离的浏览器回归。验证：捕获的 PUT 与最终用户草稿完全一致，非法/失败时不丢输入，没有暗中 Apply。
- [x] 2.3 更新 `docs/webui-integration.md` 的配置说明。验证：明确同一草稿和非法原文规则，与 DWUI-007 和 2.2 的双向回归一致。

## 3. R3：Run 历史恢复（DWUI-004）

- [x] 3.1 实现事件 410 后的只读历史恢复模式：实际查询原 Run/Session，活跃态串行观察并退避，终态获取最终历史并停止；失效事件游标不再重连，失败不得宣称恢复成功，身份/observer 变更释放本地观察并拒绝晚响应。验证：请求记录出现 Session GET、没有第二次 Run POST/失效游标循环，最终内容一次呈现，终态和鉴权/对象失效后停止自动读。
- [x] 3.2 增加 410→已完成、410→running→终态、最终历史读取失败、网络失败后恢复、身份切换晚响应的回归，并保留正常流去重与取消竞争验证。验证：Desktop 定向用例通过，原 Run ID 一致，历史替换不重复追加，轮询串行且退避/释放可断言。
- [x] 3.3 更新 `docs/webui-integration.md` 的 Run 恢复说明。验证：写清事件游标恢复与 410 历史降级的差异，不声称恢复时重新执行 prompt 或仍保证逐 token 输出。

## 4. R4：匿名检查延续（DWUI-008，遵守 DWUI-001 隔离）

- [x] 4.1 为本地检查保存来源 Core、transfer ID、summary、检查身份及导入状态；同一会话/同 Core 匿名 ready 检查进入首次登录时保留，登录成功回到原摘要，失败保留检查；其他身份/Core 转移不复用。验证：Sign in to import 使用原 transfer ID，登录前未取 Core 内容，用户确认前无 Core Import，切 Core/账号/登出仍隔离。
- [x] 4.2 增加匿名 Inspect→同 Core Login→显式 Import、登录失败重试、切换 Core/已认证账号/登出的浏览器和必要原生 CLI 契约回归。验证：本地包上传只发生一次，导入确认使用原 ID，非法身份转移不携带旧包或旧用户内容；`go test ./internal/cli` 对应会话/传输用例通过。
- [x] 4.3 更新 `docs/webui-integration.md` 的检查与登录说明。验证：保留例外明确限于同 Core 匿名升级，普通关闭与暂离登录的含义可区分。

## 5. R5：未提交检查释放（DWUI-008）

- [x] 5.1 接入取消按钮、Escape、换包及取消本地上传的 abandon 流程：检查开始即持有 ID，停止观察/abort 上传并 DELETE；隔离检查代次，清理失败保留可重试记录。Import 提交中/unknown/accepted 保留恢复信息，关闭只停止观察，登录暂离不释放待导入包。验证：所有放弃路径请求删除正确本地 ID，晚回调不恢复旧包，原 Import 不被取消或重新提交。
- [x] 5.2 增加已检查后关闭/替换、上传中取消、旧响应晚到、DELETE 404/失败/丢响应重试、登录暂离及已提交后关闭的浏览器回归；以原生 CLI 临时目录验证释放真实文件。验证：DELETE 确认后文件不存在，清理未确认时不显示成功且留 ID，已提交 Import 数量与原 Operation 身份不变。
- [x] 5.3 更新 `docs/webui-integration.md` 的暂存生命周期说明。验证：区分放弃未提交包、登录继续、停止观察、未知清理与一小时 TTL 兜底，不把 TTL 当成显式取消完成。

## 6. R6：Serve 包阶段（SUI-PKG-003）

- [x] 6.1 将原始 packagePhase 与显示标签/索引分离，覆盖 queued/source/prepare/validate/publish/succeeded、cleanup-pending、failed/superseded 和未知值；acceptance 不冒充 Core phase。验证：阶段条与真实枚举一致，原值可读取，失败不点亮未来发布，真实 state 决定观察终止。
- [x] 6.2 在 Console 浏览器测试中按实际枚举逐阶段驱动同一 Operation，覆盖刷新/Find Operation、仅 acceptance、失败、清理待完成和未知阶段。验证：当前步骤、原始详情及轮询状态正确，没有新增安装/更新请求，现有稳定 key 恢复测试继续通过。
- [x] 6.3 更新 `docs/webui-integration.md` 的 Serve Operation 说明。验证：映射覆盖公开 phase，上传/接受/发布与清理状态区分，不暗示整体百分比或包任务取消能力。

## 7. R7：能力目录恢复（DWUI-007）

- [x] 7.1 分离 Skills/Packages 的 loading/error/confirmed 状态与全局 Core/readiness 状态；校验有效数组，失败保留旧目录，实际成功清除该目录错误并恢复合法动作，提示按真实结果生成。验证：恢复无需等待无关 session 刷新，部分失败只影响相应目录，Work 副本/选择/配置草稿及 env-not-ready/core-offline 不被覆盖。
- [x] 7.2 增加失败→成功、单目录失败、缺失/畸形响应、成功空数组、保留脏草稿、环境未就绪及普通 session 刷新的浏览器/adapter 回归。验证：错误和动作准入均与当前目录事实一致，误返回缺数组不变成空库，成功恢复不依赖 session 定时器。
- [x] 7.3 更新 `docs/webui-integration.md` 的目录恢复说明。验证：说明局部可用性与成功恢复条件，保留用户 Work 副本并不宣称其等于当前 Core 库。

## 8. 构建与跨模块验收

- [x] 8.1 构建 Desktop/Console 浏览器应用、同步两套 Go embed 并通过 `scripts/build-go.sh` 重新构建原生二进制。验证：从二进制取得的新模块包含修复，嵌入模块路由和深链接正常，`go test ./internal/cli` 与 `git diff --check` 通过，无新增 Node 运行依赖。
- [x] 8.2 运行两套完整浏览器测试及 `go test -p 1 ./...`，核对 1—7 各组用例已经落地而非只保留未触发 fixture 分支。验证：相关命令通过，7 项均有实际执行的断言，正常聊天与弹窗不重载同一个 Service iframe，认证/CSRF/跨 Work 边界保持。
- [x] 8.3 使用隔离真实 Core/CLI 执行 Desktop Service/WebDAV/Save-Apply/Stop-Export-Download-Inspect-Import-Start 链路及 Console 实际包 Operation 深链接验收，记录命令与覆盖范围并严格验证本变更。验证：真实数据与恢复结果一致、测试资源清理、敏感信息不输出，`openspec validate fix-webui-data-integrity-and-recovery --strict` 通过，只有执行并验收完成的任务可勾选。
