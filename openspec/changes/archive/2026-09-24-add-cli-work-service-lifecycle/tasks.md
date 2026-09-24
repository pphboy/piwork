# Tasks

## 1. 服务客户端接口与安全投影

- [x] 1.1 在 `packages/client-sdk/src/index.ts` 增加 WorkServiceSummary、AcceptedServiceOperation、WorkServiceLogs 类型及 workServices/workService/workServiceAction/workServiceLogs 方法，复用既有 request；扩展 SDK 测试验证 GET/POST、5 个 action、逐段 ID 编码、bearer、仅含 idempotencyKey 的 body、tailLines 参数和错误传播（CLI-SERVICE-002、003、005、006）。
- [x] 1.2 为 SDK 的服务 list/show 构造规范规定的十字段白名单投影，过滤 definition 和额外字段、投影 lastError/endpoints 并按 name/serviceId 排序；用含环境 credential sentinel、null 状态、失败状态、乱序和空列表的响应测试验证返回值与安全字段边界（CLI-SERVICE-002）。
- [x] 1.3 为 request 添加可选 AbortSignal 参数并允许 operation 转发，保留所有现有调用签名；用正常响应、挂起 fetch 和 headers 后 body 挂起测试验证取消生效，运行现有 SDK 测试证明原有认证、错误和大小限制保持兼容（CLI-SERVICE-004、006）。

## 2. 命令解析与主入口接入

- [x] 2.1 新增 `apps/cli/src/work-service.ts` 的服务命令 discriminated union 与纯解析器，按规范解析 8 个 action 和选项；添加 `work-service.test.ts` 覆盖完整合法矩阵以及缺失/空白/非法 ID、重复选项、未知命令、额外参数、禁止 create/update、purge/follow 和 tail 边界，验证 usage 退出码为 2（CLI-SERVICE-001、005）。
- [x] 2.2 在 `main.ts` 增加服务专用帮助、全局/Work 帮助提示以及分发；服务语法验证先于凭证加载，合法命令复用原凭证和 Core URL；扩展编译后 CLI 子进程测试，验证 help 无登录可用、畸形凭证不阻断服务 help/usage、合法未登录命令退出 3，且原 Work 帮助和命令继续可用（CLI-SERVICE-001、006）。
- [x] 2.3 接入 list/show，使用 SDK 投影并按 JSON/缩进 JSON 约定输出；通过 CLI 执行测试验证一个请求、一条 JSON、空列表、failed 服务读取仍退出 0、无名称查找请求，且 stdout/stderr 不含完整定义或 credential sentinel（CLI-SERVICE-002、006）。

## 3. 生命周期控制与持久操作观察

- [x] 3.1 实现五个控制命令的 action 映射和单次提交，原样使用显式 key 或生成 UUID，禁止 pre-read、自动重试和附加 definition/revision/purgeData 字段；测试验证 start->enable、stop->disable、其他同名 action、non-wait 五字段 acceptance、reused 保留以及 HTTP/网络错误无后续 mutation（CLI-SERVICE-003、004、006）。
- [x] 3.2 实现独立 observeServiceOperation，注入内部 timing 依赖，使用可中断的 120 秒 deadline 和串行 250 ms poll；受控时钟测试覆盖 pending/running 到三个终态、挂起 fetch/慢 body、断线、401/403、未知/畸形/ID 不匹配的 Operation，验证无并发 poll、deadline 后清理 timer、无重提与取消服务请求（CLI-SERVICE-004）。
- [x] 3.3 实现 wait 的 JSON 与文本输出，terminal 从 acceptance 补 serviceId，waiting 保留全部身份并区分 timeout/unavailable；测试验证 JSON 恰好一个对象、文本立即显示 acceptance 并含恢复命令、退出码分别为 0/6/5，同时既有 operation show 和 Work wait 输出回归通过（CLI-SERVICE-004、006）。

## 4. 日志输出与错误行为

- [x] 4.1 接入日志单次读取，默认 tail 100、范围 1..200；测试 available/空日志/truncated/unavailable 的 JSON 字段、文本换行、stderr 提示、0/5 退出码，以及 Core 已脱敏日志的原样保留，不引入 follow 或二次读取（CLI-SERVICE-005）。
- [x] 4.2 增加服务命令 HTTP 错误测试：401/403->3、404->4、网络和 502/503/504->5、409->6、429/其他->现有 fallback 1；验证 acceptance 前 JSON stdout 空、stderr 安全文本、无 stack/credential，acceptance 后认证丢失遵循 waiting/5 而不是认证退出（CLI-SERVICE-004、006）。

## 5. 正式接口兼容与生命周期回归

- [x] 5.1 扩展 `apps/core/src/application/control-plane.test.ts` 的正式 CoreApplication 服务路由测试，使用测试准备创建服务，验证 CLI 所依赖的查询、enable/disable/restart/retry/remove、同键重放及 Operation 查询路径，包含 stopped Work enable 不启动 Work和 tombstone 后 Operation 仍可读；测试通过且无生产 Core 路由变更（CLI-SERVICE-002、003、004）。
- [x] 5.2 在正式路由测试中验证所有者控制、管理员元数据/控制权限及非所有者日志 403、普通非所有者/跨 Work ID 的 404、日志 tail 合法边界与非法值；确认错误 body 可由 SDK/CLI 原样映射且无越权回退（CLI-SERVICE-005、006）。
- [x] 5.3 复跑并补齐 `service-management.test.ts` 中持久 disabled 跨 Work 重启、显式 retry 恢复预算、Work stop 竞态和 workspace 保留的断言，使用已有 fake runtime 验证服务端语义未改变；不增加运行时功能或模型依赖（CLI-SERVICE-003、004）。
- [x] 5.4 用异步子进程与本地 mock HTTP server 完成编译 CLI 的请求/输出贯通测试，验证完整 argv 分发、认证 header、单次 action 和 Operation follow-up、JSON 单值和退出码；运行旧 main.test.ts 测试确认其他命令兼容（CLI-SERVICE-001..006）。

## 6. 文档与最终验证

- [x] 6.1 更新 `docs/operations.md` 和 README，提供从 list 获取 ID 到 show/启停/retry/remove/logs 的示例，注明创建/更新由 pi-agentd 承担、全局参数位置、持久 stop、停止 Work 上 start、remove 保留 workspace、日志所有者权限和限制、120 秒观察超时后的 operation show；逐条核对示例与编译 CLI help 一致（CLI-SERVICE-001..006）。
- [x] 6.2 按设计运行 `npm run build`、`npm run typecheck`、SDK 与 CLI 的 workspace unit tests，以及在 `apps/core` 下运行 `node --test dist/application/control-plane.test.js dist/work-services/service-management.test.js`；记录各命令结果并将 CLI-SERVICE-001..006 的场景映射到通过的测试。最终确认未添加 create/update、名称解析、purge/follow、生产 Core 状态机或 schema 变更，所有规定场景均已覆盖后再勾选完成。

## 验证记录

- `npm run build`：所有 workspace 构建通过。
- `npm run typecheck`：所有 workspace 类型检查通过。
- `npm run test:unit --workspace @piwork/client-sdk`：10/10 通过。
- `npm run test:unit --workspace @piwork/cli`：14/14 通过，包含真实编译 CLI 子进程与 HTTP fixture。
- 在 `apps/core` 运行 `node --test dist/application/control-plane.test.js dist/work-services/service-management.test.js`：23/23 通过。
- `git diff --check` 与 `openspec validate add-cli-work-service-lifecycle --strict`：通过。
- 未运行 Docker/模型验收；本次未修改 Docker runtime、模型路径、生产 Core 状态机或公共 schema。

| 要求 | 通过的验证覆盖 |
| --- | --- |
| CLI-SERVICE-001 | service parser 命令/非法输入矩阵；main.test 的帮助、usage 优先、缺少登录和编译命令 HTTP 测试 |
| CLI-SERVICE-002 | SDK 元数据投影/排序/空集合测试；CLI list/show 的 failed 状态读取、单请求、ID 原样定位及 credential sentinel 检查 |
| CLI-SERVICE-003 | CLI 单次 action 路由映射；正式 Core enabled/stopped/restart/retry/remove；manager 的真实 Work stop/start、workspace 引用保留和 stop fence 回归 |
| CLI-SERVICE-004 | pending/running 到各终态、重放、单 JSON、文本诊断、断线/认证失效/畸形响应、挂起 fetch/body、120 秒受控时钟 deadline；删除后 Operation 查询及旧 Work wait 回归 |
| CLI-SERVICE-005 | tail 解析边界；available/空/truncated/unavailable 日志输出；正式 HTTP tail/owner 权限与 manager 日志字节上限/脱敏测试 |
| CLI-SERVICE-006 | 编译 CLI HTTP/网络错误退出码、stdout/stderr/脱敏；Core 所有者/admin/普通非所有者/跨 Work 检查；单次 mutation 无回退断言 |
