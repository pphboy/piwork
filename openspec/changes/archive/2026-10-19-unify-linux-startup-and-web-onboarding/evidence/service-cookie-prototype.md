# Service Cookie 原型验证

本附件仅记录任务 1.1 的合成双应用原型，不代表统一服务端、真实 Core、独立客户端网络或 Windows 浏览器验收。

2026-10-19，使用 Node 24.20.0、Linux 上的 Google Chrome 155.0.8059.84 和 Microsoft Edge 155.0.4283.62，通过宿主非 loopback 数字 IP 执行。浏览器保留默认安全设置，无 DNS、客户端代理、Cookie shim 或脚本改写。

复现入口为 [verify.mjs](../prototype/ip-cookie/verify.mjs)，其调用 [Go 双应用夹具](../prototype/ip-cookie/main.go)。在已安装 Node 24、Go、仓库依赖和两个浏览器的环境运行：

```sh
node openspec/changes/unify-linux-startup-and-web-onboarding/prototype/ip-cookie/verify.mjs \
  --server-ip <服务器实际IP> \
  --browser-bin <Chrome可执行文件> \
  --browser-bin <Edge可执行文件>
```

新结果输出到忽略的 `dist/unify-linux-startup/ip-cookie/accepted-boundary/result.json`，原始 `dist/unify-linux-startup/ip-cookie/result.json` 不覆盖。原始全面兼容 gatePassed=false 保留，新结果仍记录 gatePassed=false，另外报告已确认首版范围的 supportedBoundaryPassed=true。本次命令退出码为 0，两浏览器各 15 项支持检查通过，4 项脚本 Cookie 限制均复现。

| 范围 | Chrome / Edge 实测 | 首版结论 |
| --- | --- | --- |
| 两个应用同名响应 Cookie 登录 | 各自返回 200 | 支持；正式会话/所有者边界待真实网关验证 |
| 服务自身 Domain Cookie | 两应用均收到自己的 Cookie | 支持 |
| Path、过期和删除 | 路径正确，过期移除，B 删除不注销 A | 支持 |
| 浏览器中的上游响应 Cookie | document.cookie 不包含上游 Cookie | 响应 Cookie 留在分区 jar |
| 平台/入口 Cookie 过滤 | 上游只收到本应用 jar 中的 Cookie | 支持；这里使用合成凭据，非真实平台授权 |
| 根路径、query、逻辑域跳转 | 保留原路径与查询，跳转回已映射入口 | 支持 |
| SSE / WebSocket | 使用 jar Cookie 认证并收到消息 | 支持；两秒撤销尚未验证 |
| 独立标签页 | 保持本入口登录 | 支持；完整工作台 iframe 生命周期待验证 |
| DOM / localStorage | 跨源 DOM 访问被拒绝，存储互不覆盖 | 端口 origin 隔离有效 |
| 应用 CSP | 保留原始 script-src 'self' | 没有注入脚本或削弱响应策略 |
| document.cookie 读取 | 无法读到 jar 内本应用 CSRF Cookie | 已确认不透明兼容 |
| CSRF 双提交 | 页面取不到 Cookie，应用返回 403 | 已确认不透明兼容，不表示 Piwork 登录失败 |
| 脚本自行写入 Cookie | B 能读 A 写入的 Cookie | 已确认不保证这部分跨 Service 隔离 |
| 脚本 Cookie 转发 | 浏览器写入值不进入上游 jar | 不做同步或混入 |

原样转发的负向对照还证明：脚本 CSRF 原先可用，但 B 可读 A 的 Cookie、同名登录覆盖使 A 返回 401，B 删除也影响 A；因此不能用原样转发替代分区 jar。

尚未验证：真实 Core 的所有者/身份撤销、grant 重放和端口复用、两秒流断开、Service Worker/安全上下文、TLS/反向代理、独立客户端网络、Windows 浏览器和 Docker 整体交付。这些仍归后续任务，不能由本原型结果推断通过。

后续统一程序及真实 Core 的覆盖见 [Service 支持矩阵](service-support-matrix.md)。该附件仅补充后续事实，不修改以上原型失败和当时未测结论。
