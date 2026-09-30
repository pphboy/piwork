# Tasks

## 1. 网络身份存储与兼容升级

- [x] 1.1 在 `packages/core-store` 增加 schema 9 的 Work 网络名和 service 域名 label 唯一表、事务分配方法，按 design 的 UUID 前缀/非 UUID 哈希/冲突延长规则实现；以并发创建、相同显示名、尾随连字符及删除后保留 label 的存储测试验证 SNET-001。
- [x] 1.2 将 schema 8→9 建表与 `(created_at,id)` 回填做成单事务，并保留对低于 8/高于 9 的拒绝；以现有 schema 8 数据副本的升级、故障回滚和旧状态保留测试验证 CST-ACCESS-001。
- [x] 1.3 在 Work 创建、service 创建及 Work 包导入发布的接受事务中分配派生身份，幂等重试复用原记录；以创建/导入两次及 stopped 导入测试验证 SNET-001、PWORK-SERVICE-ACCESS-001。

## 2. 域名解析、公开投影与容器名称

- [x] 2.1 在 Core 增加独立 `ServiceDomainResolver`，完成域名规范化、当前服务/Work 反查、TCP 80 与 HTTP readiness 默认端口优先级及错误语义；以多 TCP、UDP-only、无端口、尾随连字符和未登记主机测试验证 SNET-001/002。
- [x] 2.2 在 `packages/contracts`、Core HTTP/service gRPC 与 `apps/service-mcp` 的只读投影追加 `access` 字段，保留既有 `endpoints`；重新生成 protobuf 并以 HTTP/gRPC/MCP 契约测试验证 WSRV-ACCESS-001、CLI-SERVICE-002 的公开字段与秘密排除。
- [x] 2.3 在 Docker service adapter 传入可信显示名称，并保持 `DockerRuntime` 按 labels 和原 spec hash 接管旧容器；以新建名称、旧名称接管、异物同名冲突、无宿主端口的 Docker 单元及集成测试验证 WSRV-ACCESS-002。

## 3. Core 服务访问网关

- [x] 3.1 在生产 HTTP listener 接入 capability、受保护 resolve 与原始 path/query 的 HTTP 转发路由；逐请求执行 owner 内容授权、声明端口和 Docker labels/Work 网络核验；以跨用户、管理员、未知域名、IP/端口注入测试验证 SNET-003、WACC-SERVICE-ACCESS-001/002。
- [x] 3.2 实现请求/响应流、应用 Authorization/Cookie 保留、平台凭证及逐跳头隔离、平台错误标记、并发/头大小/连接超时界限；以 POST 二进制上传、应用 401、SSE 分段、超限与上游失败测试验证 SNET-003、WACC-SERVICE-ACCESS-002。
- [x] 3.3 在同一 listener 增加 WebSocket Upgrade 双向转发和每 2 秒的会话/Work/service 资格复核；以 WebSocket echo、登出、service 删除、Work 停止、Core 恢复中请求和 Docker 状态未知测试验证 SNET-003/004。
- [x] 3.4 更新 `docs/operations.md` 的 Core 网关状态码、归属权限、HTTP 入口/绝对跳转限制及升级备份步骤；用文档示例和 schema 8 升级测试结果验证 CST-ACCESS-001、WACC-SERVICE-ACCESS-001。

## 4. CLI 本地代理和公开命令

- [x] 4.1 在 `packages/client-sdk` 增加 gateway capability/resolve 及保留原始 body 的 HTTP/Upgrade 客户端，扩展 service access 字段白名单；以原 service list/show 输出、应用 401 和凭证不泄露测试验证 CLI-SERVICE-002、SNET-003。
- [x] 4.2 在 `apps/cli` 加入 `proxy [--port]` 解析、预检、loopback 监听、PAC、普通 absolute-form HTTP 请求转发和退出语义；以无凭证、非法参数、占用端口、未知 `.work`、其他网站 DIRECT、Ctrl+C 测试验证 CLI-SERVICE-PROXY-001。
- [x] 4.3 在本地代理实现 `ws://` 的 CONNECT 后受限 HTTP Upgrade 与 absolute-form Upgrade，拒绝任意裸 TCP、Host 不匹配及 HTTPS/wss CONNECT；以模拟浏览器 CONNECT/WebSocket echo 与禁止任意目标测试验证 CLI-SERVICE-PROXY-001、SNET-003。
- [x] 4.4 更新 CLI 顶层/Work 帮助、`README.md` 与 `docs/operations.md` 的 `curl --proxy`、浏览器 PAC、端口选择和重新登录使用说明；以文档命令在测试 Core 上的演练验证 CLI-SERVICE-PROXY-001。

## 5. 集成验收

- [x] 5.1 扩展真实 Docker 产品验收：agent 创建 HTTP service，用户 CLI proxy 经 curl 访问 HTTP/SSE/WebSocket，停止/重启 Work 和 Core 后同域名可访问，容器无宿主发布端口；运行 `npm run acceptance` 验证 SNET-001/003/004、WSRV-ACCESS-002。
- [x] 5.2 扩展 `.work` 包回归：保持旧 V1 golden 文件合法；用包含未删除 HTTP service 及源 URL 文件、历史文本的同一包导入两次，验证两个目标域名不同、停止态 list/show 能显示 `unavailable` 且访问被拒、只启动其中一个不使另一个可访问；导出、导入、再次导出后核对字面 URL 未改写，运行相关快照与集成测试验证 PWORK-SERVICE-ACCESS-001。
- [x] 5.3 运行 `npm run typecheck`、`npm test` 和 `openspec validate cli-service-access --strict`；核对上述验收场景全部通过，并确认 `git diff` 只包含本变更相关实现与文档。

## 6. 验证发现项修复与复验

- [x] 6.1 在 Core WebSocket 网关与 CLI 代理透传应用握手的非 101 响应，保留应用状态码、响应头和正文，仅对平台错误添加网关标记；测试应用 401/403/404 不终止代理或误判登录失效，平台 401 仍按退出码 3 处理，验证 SNET-003、WACC-SERVICE-ACCESS-002。
- [x] 6.2 确保活动 SSE/WebSocket 在会话撤销、Work 停止或 service 停止/删除后 2 秒内关闭，复核耗时包含 Docker 状态查询；加入计时断言和 Docker 延迟场景，验证 SNET-004、WACC-SERVICE-ACCESS-001。
- [x] 6.3 统一 CLI 本地代理与 Core 网关的 32 KiB 请求头上限，使 16–32 KiB 的合法请求可通过、超限请求得到可识别的平台错误；覆盖普通 HTTP、WebSocket Upgrade 与 CONNECT 的边界测试，验证 SNET-003、CLI-SERVICE-PROXY-001。
- [x] 6.4 完成上述修复后运行 `npm run typecheck`、`npm test`、`npm run test:integration`、`npm run acceptance` 和 `openspec validate cli-service-access --strict`；核对变更文件范围，并将工作区中无关的技能文件改动与本变更分开处理。

## 7. 遗留问题修复与实流程复验

- [x] 7.1 修复 CLI 代理在超大 CONNECT 请求头触发 `clientError` 时重复写入或已结束 socket 再写入的竞态；保证单次、可识别的 431 平台错误，并重复运行普通 HTTP、Upgrade、CONNECT 与 CONNECT 后 Upgrade 的 32 KiB 边界测试，验证 SNET-003、CLI-SERVICE-PROXY-001。
- [x] 7.2 修复 Core WebSocket 网关对应用 101 握手响应的多值头序列化；多个 `Set-Cookie` 必须作为独立头行保留，不合并为逗号分隔值，同时继续剔除网关保留头；以实际 Upgrade 握手测试验证 SNET-003、WACC-SERVICE-ACCESS-002。
- [x] 7.3 修复 CLI 代理对 Core 101 握手响应的多值头序列化；直接 Upgrade 与 CONNECT 后 Upgrade 均保留多个独立 `Set-Cookie` 及应用握手头，以端到端 WebSocket 测试验证 SNET-003、CLI-SERVICE-PROXY-001。
- [x] 7.4 保留 CLI absolute-form HTTP/WS 请求的原始 path 和 query 字节，不经 `URL` 规范化改写 `%2e` 等编码路径；Core 网关按原始路径转发，加入路径、查询、重复编码和 Upgrade 回归测试，验证 SNET-003。
- [x] 7.5 用含未删除 HTTP service、源域名文件和历史文本的同一 V1 `.work` 包导入两个目标 Work，再从实际导入后的目标 Work 执行导出；验证两个新域名、停止态隔离、源 URL 字面字节与 V1 包契约均保留。完成 7.1–7.4 后运行相关快照/集成测试、`npm run typecheck`、`npm test`、`npm run test:integration`、`npm run acceptance` 和 `openspec validate cli-service-access --strict`，验证 PWORK-SERVICE-ACCESS-001 及整体回归。
