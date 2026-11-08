# 两个 WARN 的修复与验证

## 用户确认的行为

本轮按用户明确要求采用简单表单：请求参数捕获后清空本次输入，HTTP 进行时临时禁用业务提交按钮；成功显示后端结果，失败或超时提示错误/未确认并只重新读列表。表单输入与未决提交不写浏览器存储，换页或采用新页面后表单为空，不自动重发 POST。当前文档内的普通业务刷新仍保护无关的未提交输入和焦点。后端相同 Action ID 的幂等与 Agent 原 Action/Job 恢复保持原契约。

这是对原先跨页草稿/提交恢复目标的明确收缩，已同步当前 proposal/design/specs、模板和指导；首次验收与 0.1.0 发布事实保持原样。

## WARN 1：网页提交恢复

- 移除 pending Map、表单草稿 save/restore 和自动核对提交流程。反馈回执 ID 的独立用途保留。旧版本的 todo-title 存储键在当前会话/Service 范围退役。
- htmx closest-main drop 互斥阻止并行重复提交，按钮只在请求期间禁用。参数捕获后清空输入，成功事件不再清空之后新输入的内容。
- 版本检测只检查实际表单 HTTP 是否仍在进行，响应结束后可自动采用新版，不再出现未决记录与版本采用互相等待。
- 浏览器回归实际覆盖：成功提交内容正确；第二笔请求被丢弃而不是排队；服务端 400 不恢复输入；未送达请求按夹具设置的超时结束，数据库无该条记录；已落库但回复丢失时只读列表，记录仍只有一次，导航及版本采用不产生新 POST；存储写入被故障注入禁止时表单仍正常。

## WARN 2：运行副本复用

- run/serve 共用 checked_release，先验证现有检查记录中的 release 指针，失败时检查标准版本目录，全部不可用才重新检查生成。
- 副本路径、版本、环境与实际内容验证后才采用；目录逃逸、链接、畸形记录和错误身份不会被当作有效副本。
- 新增回归先损坏标准副本，生成替代副本，再以相同输入准备。后续返回同一个替代副本，禁止再次运行检查，目录保持两份；坏副本未覆盖。

## 实际检查

- 镜像中的 runner 测试：7 项通过，含并发准备、准备期间改动、失败模板/测试、修复副本复用和非法指针。
- 对应 Node 工具测试：31 项通过。
- coreassets / bundled brain 相关 Go 测试通过；本地宿主重建通过。
- 镜像/前缀浏览器、显式依赖安装与离线重建、真实 CLI Desktop/托管入口、两个应用独立更新与正常 Core 重启通过。
- 统一集成运行器：发现 507 项，明确选择以下两项，最终为 partial 2/2 PASS，无跳过和聚合错误，不称全仓集成通过。

- TestNativeBrainFastAPIAcceptedActionGapRecovery: pass, 89.17s
- TestNativeBrainFastAPIWorkstationFeedbackExperienceAndActualCandidateBehavior: pass, 157.51s

真实 SDK 运行记录在 dist/fastapi-htmx-base/warn-fix-core-final/result.json，发布前源码身份为 4638d0efda0bbce3cc133c0d0d15d0f0a38050e983327e0c3e5bbfdb7d87d262。该记录包含反馈改进、异步导出、Evidence、Memory、候选 Update/显式 Apply/实际行为验证、两份独立导入及原副作用窗口恢复。发布后仅更新正式引用、使用说明、发布记录和本地宿主，Service 实现和镜像输入保持该候选身份。

前次 warn-fix-core 的窗口测试读到旧 pending 投影后又读到已接受 Action，产生观测竞态，保留其失败结果。测试现于注入中断前重读请求，仍要求 running 且 waitRef 为空，没有放宽断言。最新重跑通过。

## 修复版交付

沿用户此前对该 Service 镜像明确给出的推送授权交付补丁版，未扩展为 Core/MicroVM/官网正式发行。

- brain 版本：1.3.2
- 固定镜像：`docker.io/pphboy/piwork-fastapi-htmx-base:0.1.1-08fc54adda53-291497dc377a-dirty@sha256:2314f5a787a1be0e575c892899e32cb779cacd163d02a137c777e3a0358a1aad`
- image ID：`sha256:0365240a31f698b3cda3f380ba101ba76d633fec5f8b03ab573abea86e00b74c`
- input hash：`291497dc377ac62a053a620049d3acbbb00f5811bfcae7d9c8a1badbc41bce0f`
- 构建 commit：`08fc54adda53a0c9ee71f66d3ec237050adf9be0`，dirty：`true`
- 匿名验证时间：2026-11-08T10:20:06.256Z
- 匿名拉取的 image ID、只读/离线 HTTP、sqlite3、启动器和本地资源 SHA256 均通过。
- 0.1.0 原发布记录保存于 deploy/images/fastapi-htmx-base/releases/，旧 tag/digest 保留；当前 release.json、双语说明和正式 brain 引用指向相同补丁 digest。
- 本地 Core SHA256：`b2fdaf1163991ffda183b1b6bb0b3e208692dba74de126a566ac8fab9cb03a97`
- 本地 CLI SHA256：`ecbcf20c8887d771ac05c1d21653745bb572deccad5e078f69e5bde1b5dd18f1`

本机日志与候选输出在被忽略的 dist/fastapi-htmx-base/warn-fix-*。未执行全仓集成或其他浏览器/平台矩阵；未改写其他安装和已有 Work 的应用源码。

## 后续 WARN：慢提交期间列表刷新提前启用按钮

验证发现：Add Todo 的 HTTP 请求保持未完成时，轮询会替换业务列表并提前启用新渲染的 Complete 按钮。原复现日志保留于 dist/fastapi-htmx-base/verify-button-disable.log。该问题归类为 DEFECT，违反 WEBBASE-012 的请求期间按钮禁用约定。

本轮读取并修改 templates/fastapi-htmx/static/page-client.js:36-42 的 refresh 准入条件，使用已有 form.htmx-request 暂停业务列表刷新。既有 epoch 检查继续拒绝提交前开始、提交后返回的旧读取；不新增请求状态、浏览器存储或恢复机制。直接消费者为 initializer 生成的应用副本与 brain embed；同一业务与 Action/Job 契约保持。

scripts/check-fastapi-htmx-base.mjs:145-168 的真实浏览器用例将表单请求保持 3.5 秒，跨过两个 1.5 秒轮询周期后再次检查全部业务提交按钮禁用，并继续验证重复触发被丢弃、发送后的输入清空、新输入保留及请求结束后按钮和列表恢复。现有失败/超时、导航、版本采用及不重发回归一同通过。

- 浏览器回归通过时间：2026-11-08T10:41:06.583Z；包含 pending-form-pauses-polling 检查。
- 镜像 runner 7 项、相关 Node 工具 7 项、coreassets/bundled brain 相关 Go 测试通过；make build-go、文档/native-boundary/docker-quickstart/风格、git diff --check 与 OpenSpec 严格校验通过。
- brain 更新为 1.3.3；相应包更新测试期望同步，本地 Core/CLI 已重建。
- page-client.js SHA256：56ce70657585bf0629bf2053f931a86fa2686024d510fa1f5f11ac17099bdf6b。
- 本轮 Core SHA256：efacf4ca539fabf60a2dc3e543e3ce343277fea7bf7c7347e2ae98022d92f930；CLI SHA256：ecbcf20c8887d771ac05c1d21653745bb572deccad5e078f69e5bde1b5dd18f1。

基础镜像不包含本次修改的业务模板；重新计算镜像输入 hash 与已发布 0.1.1 身份一致，脑包固定引用保持原 digest。本轮不需要新镜像发布，未推送、未部署真实安装、未归档。相关日志位于 dist/fastapi-htmx-base/polling-warn-*。本轮没有重跑真实 Core/SDK 子集或全仓集成，前述 partial 2/2 结果仍只代表其记录的运行。
