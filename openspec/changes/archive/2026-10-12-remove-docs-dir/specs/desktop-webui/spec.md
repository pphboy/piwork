# desktop-webui 规格变更

## ADDED Requirements

### Requirement: 本机 Desktop 的启动、授权和使用边界

**Identifier:** DWEB-USAGE-001

Desktop SHALL 由前台 CLI 提供 127.0.0.1:17891 的本机浏览器入口，可显式 port/no-open；端口占用不自动更换，help 不读取状态或连 Core。启动票据一次显示、五分钟且使用后从地址移除，浏览器使用 HttpOnly 本地会话，平台 token 不交给网页。Copy local link 仅当前电脑且需 CLI/会话持续有效；.work domain 不是同一 URL，外部 DAV 使用 proxy 的随机 Basic 密码。

Service 预览/独立页 SHALL 仅路由声明 HTTP/ws 端口，隔离各应用本机 origin，保留 CSP/X-Frame-Options、应用认证、SSE/WebSocket，不改响应正文或自动批准跨 Service 跳转。嵌入拒绝提供独立页回退；平台身份不交应用。Focus/Full screen、Chat、草稿、阅读位置及 iframe 沿有效 browser-service-access/desktop-ui-language 保持，不以换布局重建业务视图。

关闭浏览器或退出本机入口 SHALL 不停止 Work 或重发写入；平台过期确认后登录并按原 ID 恢复。导入仅浏览器选取/Inspect 不登录执行，真正 Import 需授权且保持 stopped；下载开始不等于落盘。图像粘贴/拖拽/选择、限额、模型能力与 About 版本日志沿 improve-desktop-chat-and-release-info 的有效 delta，技术身份按需展开，错误和恢复保持可见。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli desktop
piwork-cli desktop --no-open
piwork-cli desktop --port 18001 --no-open
piwork-cli --core https://core.example.com desktop
```
