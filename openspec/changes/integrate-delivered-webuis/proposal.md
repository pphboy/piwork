## 为什么

用户已交付 `PiWork-Desktop-Serve-UI.zip` 与 `PiWork-UI-Verification.zip`，要求将两套界面接入当前项目。交付代码提供了浏览器界面和模拟 adapter，验证包证明的是原型行为；正式入口需要接到既有 Go Core、Go CLI、Go Console，不能把模拟登录、示例 Service 或演示 JSON 下载当成实际能力。

## 变更内容

- 采用交付 Desktop 的 Work 列表、单 Work 工作台、Service 主区与 Agent 辅栏、文件和设置界面。
- 采用交付 Serve 的 Overview、User access、Work setup 工作区与独立 Operation 查询入口，保留既有管理路由。
- 用真实异步 adapter 连接已有本地 Desktop API、WebDAV 和 Console API；保留账号、Core、Work、Service 的隔离。
- 浏览器模块与公共样式继续嵌入 Go 二进制，公共 tokens 保持一份来源。
- 调整浏览器验收以检查真实后端结果、失败恢复与交互状态，交付原型截图不替代实际验收。

## 能力

### 修改的能力

- `serve-ui`：调整管理员导航组织，保留原管理功能和深链接。

## 影响

影响两个浏览器应用、静态资源构建和 Go 的嵌入模块路由。Core 的业务 API、CLI 命令、Pi Agentd、`.work` 格式及 Service/WebDAV 安全边界保持既有契约。实现不新增 Node/Vite 运行依赖，不扩展团队、支付、任务管理等交付范围外功能。
