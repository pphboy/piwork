# Spec Delta

## MODIFIED Requirements

### Requirement: Service 在浏览器内和独立窗口一键可用

**Identifier:** DUL-004

Desktop SHALL 在当前 Service 工具栏展示 Core 映射的 `.work` 域名、真实状态和可复制身份；域名与浏览器实际可打开链接 SHALL 明确区分。WebUI 内嵌 Service、`Pop out` 独立窗口和复制可打开链接 SHALL 通过 CLI 提供的受保护本地浏览器入口访问同一运行中的 Service，用户 SHALL 无需配置浏览器代理/PAC。入口 SHALL 支持 HTTP、SSE、WebSocket 及正常应用导航、路径、跳转和会话行为，隔离不同 Service 的浏览器状态，并遵守 Work/Service 的真实准入。目标禁止嵌入时 SHALL 给出独立窗口入口；无默认 Web 端口时 SHALL 引导选择可用入口或说明无法预览，不假装成功。现有外部工具的 CLI forward proxy 继续作为独立访问方式。

域名按 Core 的 `service_name.work_network_name.work` 映射展示；Work 网络标识、用户显示名称与完整 Work ID SHALL 分开，复制身份不替代复制可直接打开的链接。Work/Service 变为不可用时，正常独立外壳 SHALL 显示所属对象、不可用原因和 Back to Work，不保留虚假的成功状态。禁止嵌入的应用 SHALL 可直接在独立标签页打开，保留其安全策略与原应用界面；该模式的返回入口保留在原 Work 面板，下一次真正到达本地入口且被拒绝的文档导航 SHALL 返回带 Work 身份和 Back to Work 的不可用页，活动网络连接仍遵守 Core 撤销边界。外壳不承诺实时覆盖任意应用已渲染或离线缓存的画面。

#### Scenario: 打开正在运行的 Service
- **WHEN** 用户在未设置浏览器代理/PAC 的环境中打开 Work Service 并点击 `Pop out`
- **THEN** 嵌入视图和独立窗口都能一键访问同一 Service；工具栏显示 Core 域名，复制的浏览器链接可直接打开

#### Scenario: Service 拒绝嵌入
- **WHEN** Service 的响应不允许被 WebUI 嵌入
- **THEN** Work 保留 Service 身份和真实状态，给出直接打开原应用的独立标签页入口并保留原 Work 返回位置，不删除 CSP/X-Frame-Options，不将空白框当作成功预览

#### Scenario: Service 无默认 Web 入口或已停止
- **WHEN** 当前 Service 无可用默认 Web 入口或 Work/Service 已停止
- **THEN** 界面说明原因及可执行下一步，不提供虚假的交互页面


#### Scenario: 禁止嵌入应用在停止后重新访问
- **WHEN** 用户已在独立标签页直接打开禁止嵌入的应用，随后 Work 停止，下一次文档导航到达本地入口
- **THEN** 入口显示所属 Work、不可用原因和 Back to Work；已渲染或离线缓存页面不被承诺自动替换，活动连接按 Core 撤销规则关闭
