# 统一服务端 Service 支持与限制矩阵

2026-10-19；对应 BSA-003、BSA-004、BSA-IP-001。真实 Core 使用独立 Docker Engine 28.5.2，客户端为独立 Docker bridge 网络中的 Linux Chrome 155.0.8059.84 和 Edge 155.0.4283.62。两者均直接访问数字 IP，无 DNS、客户端 CLI、客户端代理或 Cookie shim。原型的全面兼容 `gatePassed=false` 保持不变，见[原型记录](service-cookie-prototype.md)。

| 场景 | 实际覆盖与结果 | 首版边界 |
| --- | --- | --- |
| 多 Service 同名响应 Cookie | 最终 Docker 候选上 Chrome/Edge 各自登录两个实际 Service，自己的 `/echo` 只收到自己的 Cookie | 支持；jar 按浏览器会话及 Service 分区 |
| Domain、Path、删除、过期、握手 Cookie | 双浏览器原型、正式 Go 网关测试通过；真实应用 Domain=.work、HttpOnly 登录通过 | 支持服务自身 Cookie；上游响应 Cookie 不下发浏览器 |
| 浏览器 Cookie 混入 | 两浏览器实际复现脚本写入值跨同 IP 端口可读，但上游只收到 jar 中的 Cookie；正式 Go 测试覆盖伪造平台 Cookie | 禁止浏览器 Cookie 混入上游；脚本 Cookie 本身不隔离 |
| document.cookie / Cookie Store / CSRF 双提交 | 原型保留应用 403 和脚本无法读取 jar Cookie 的结果 | 不保证透明兼容；不能把应用 403 当平台注销 |
| DOM、localStorage、平台 API | Chrome/Edge 跨端口 DOM 访问拒绝、localStorage 分离、跨源读取平台会话失败 | 按浏览器 origin 隔离；不宣称 Cookie 按端口隔离 |
| HTTP 数字 IP 的 Service Worker | 两浏览器实际安全上下文为 false，Service Worker 不可用 | 如实报告浏览器限制 |
| HTTPS Service Worker | 受信 IP 证书下实际注册、接管本 Service 并返回测试响应；平台仍未被接管，平台 API 不可跨源读取 | 仅控制该 Service origin；不能跨端口控制平台 |
| grant 重放、账号/会话隔离、旧端口 | 正式 Go 测试覆盖一次性票据、两浏览器/用户 jar、并发创建、容量、重启注册表；持久端口绑定不分配给其他逻辑应用 | 老页面和 localStorage 不因端口回收移交给另一应用；池耗尽须显式扩大范围 |
| 控制代次 | Go race 测试覆盖 Work 停启、Service restart、disable/enable，即使地址及 revision 相同，旧 generation 仍拒绝；幂等重放不再推进代次 | 绑定已接受控制意图及运行实例 |
| HTTP、根路径、跳转、Basic/Bearer、应用 401 | Chrome/Edge 在最终候选中登录、根资源、302、Authorization 回显及应用 401 通过；平台保持登录 | 支持；保留请求方法、路径、查询和应用状态 |
| SSE / WebSocket | 最终候选双向 echo 通过；Service disable 后 Chrome 268ms、Edge 264ms 内断开两个流 | 达到两秒目标；不以网络超时掩盖撤销 |
| 浏览器注销 / 账号撤销 | 受信 HTTPS 独立浏览器实测 119ms / 12ms 断流，独立登录不受当前浏览器注销影响；Work 继续运行 | 所属内容流关闭，不停止远端任务 |
| iframe / 独立窗口 | 最终候选双浏览器实际应用登录共享；原 iframe 节点相同且新窗口期间 load 次数为 0，草稿保留，opener=null | 支持预览与独立使用 |
| CSP / X-Frame-Options | 原型 CSP 保留；真实 DENY 应用无法嵌入，UI 提供直接标签页，重载后 DENY 头仍存在 | 不削弱应用安全策略 |
| Secure Cookie / HTTPS | Chrome/Edge 正常信任测试 CA 的 IP SAN 证书，无忽略证书错误；平台及入口使用 Secure Cookie，上游 Secure Cookie 留在 jar 并正常认证 | Secure 应用 Cookie 仅在 HTTPS 逻辑入口发送 |
| 受信 TLS 代理 / 防火墙 | 独立 Chrome 经服务器 TLS 终止代理通过同样 Cookie/Worker 检查；只开放主站时预览显示未确认，主站可用；恢复端口及显式重载后可用 | 必须代理/放行主站及完整 Service 端口池 |
| 上游硬编码 .work、跨站 SSO、强制上游 HTTPS | 未作透明适配 | 首版不保证，不通过脚本注入或 DNS 前置补偿 |

本机宿主 Engine 为 26，验收另建带精确 installation 标签的 Engine 28，未接管既有安装。宿主测试环境的 Docker 发布端口只能经 loopback 到达，因此服务器侧使用 TCP 转接将测试 LAN IP 接至该端口；HTTPS 代理测试另使用显式 TLS 终止。客户端未配置任何转接、代理或 DNS。产品默认 host 网络的物理远程主机直连未在此夹具中额外复测；不能将本结果扩大为 Windows 浏览器、实际 IPv6 网络或公网部署验收。

临时驱动、版本、截图及安全结果位于忽略的 `dist/unify-linux-startup/`；含凭据的会话文件、安装者链接、Core 数据、私钥和 Work 归档不随本证据提交。完整安装事实见[统一启动验收](unified-startup-acceptance.md)。
