# Proposal

## Why

Console / Serve 管理界面和 CLI Desktop 目前分别使用通用箱形图标、文字拼成的 `pi` 标记，未采用仓库已有的项目 Logo，且旁边重复展示 Piwork 产品名。统一使用现有 Logo 并移除这段页头文字，使两端品牌呈现一致、顶栏更简洁。

## What Changes

- Console 页头和 Desktop 登录页／Works 列表的现有品牌顶栏改用 `docs/images/piwork-logo.png`；Console 登录区域的同类占位图标一并替换。
- 移除页头 Logo 旁可见的 `PiWork` / `piwork` 文字，保留现有 `Serve` / `Desktop` 标签、返回入口及无障碍名称。
- Desktop Work 页面保留原有“返回＋Work 名称”身份栏，不新增 Logo 或全局顶栏。
- 保留浏览器文档标题、页面功能标题、Work 名称和业务说明中的产品名称；此次移除只针对页头品牌文字。
- 将 Logo 作为本地静态资源随 Go Console 和 Windows/Linux CLI 内嵌交付，覆盖未登录、已登录、深链接和窄屏显示。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ui-language`：新增适用于 Console / Serve 与 Desktop 的共享品牌呈现要求，规定现有 Logo、页头产品名移除、可访问名称、响应式与本地资源交付。

## Impact

- 浏览器：`apps/console-webui/src/app.ts`、`apps/desktop-webui/src/app.ts` 及各自 `public/style.css`。
- 资源构建：两端 `scripts/copy-static.mjs` 从现有 Logo 复制到构建产物；沿用 `scripts/sync-console-assets.mjs` 与 `scripts/sync-desktop-assets.mjs` 同步 Go 内嵌资源。`scripts/build-cli.mjs` 的 Desktop 输入摘要需纳入 Logo 源文件。
- 资源路由：`internal/consoleapp/console.go`、`internal/cli/user_desktop.go` 目前只显式提供 HTML、CSS 和 JS，需新增固定 PNG 路由。
- 验证：现有 Go 静态资源测试、浏览器夹具、客户端构建摘要检查及桌面/360px 画面复核。
- 使用说明：`docs/ui-language.md` 补充共享品牌规则。实现完成后重新构建 Console 和 Windows CLI；远端部署、分发与正式发行按后续明确请求执行。

本变更不引入运行依赖、认证协议或数据格式变化。
