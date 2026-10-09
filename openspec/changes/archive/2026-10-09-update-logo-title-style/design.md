# Design

## Context

动机与用户确认范围见 [proposal.md](proposal.md)，品牌行为由 [UIL-010](specs/ui-language/spec.md) 规定。Console 是 Serve 管理界面，由 `piwork-console` 提供；Desktop 由用户本机 `piwork-cli` 提供，两端浏览器代码分别位于 `apps/console-webui/` 和 `apps/desktop-webui/`。

当前 Console 页头在 `src/app.ts` 的布局模板中显示箱形图标、`PiWork` 和 `Serve`，登录区域另有同类图标；Desktop 登录页和 Works 列表的 `brand()` 显示字符组成的 `pi`、`piwork` 和 `Desktop`。Work 常规页面使用独立的“返回＋Work 名称”身份栏，不调用 `brand()` 或 `topbar()`。仓库已有透明 PNG `docs/images/piwork-logo.png`，README 已采用该图片。

两端构建将 `dist/public`、`dist/browser` 同步到 Go 内嵌资源。现有 Go 静态服务只有 HTML、CSS 和 JS 的明确路由，因此仅替换 HTML 图片引用会产生 404。客户端 `desktopInputHash()` 当前覆盖 Desktop 源码、public、脚本及相关配置，不覆盖 `docs/images/`。

## Goals / Non-Goals

**Goals:**

- 让同一张既有 Logo 沿现有构建链进入两端独立程序，运行时无需源码或网络图片服务。
- 在移除页头产品名后继续提供明确的返回目标、可访问名称和产品区域标签。
- 保持 UIL-003、UIL-004 的 Serve 页面轨道与窄屏规则，以及现有 Desktop 工作区、专注布局和导航规则。

**Non-Goals:**

- 不重新设计 Logo，不改动原始 PNG、浏览器文档标题、功能标题、Work 名称、页脚或业务说明。
- 不在 Desktop Work 页面新增 Logo 或全局顶栏，保留原 Work 身份栏及焦点布局。
- 不增加 favicon、主题、界面语言或新的页面布局系统。
- 本规划不执行构建、远端部署、替换用户 Windows 客户端或正式发行；实现阶段完成本机构建，后续部署按明确请求执行。

## Decisions

### 1. 现有 PNG 为唯一品牌资源来源

两端 `scripts/copy-static.mjs` 从 `docs/images/piwork-logo.png` 复制到各自 `dist/public/piwork-logo.png`；现有 sync 脚本继续递归复制到 `internal/consoleassets/static/public/` 和 `internal/desktopassets/static/public/`。不在两个应用的源码 public 目录分别维护独立副本。

```text
docs/images/piwork-logo.png
  +-- Console copy-static -> dist/public -> consoleassets -> piwork-console
  +-- Desktop copy-static -> dist/public -> desktopassets -> piwork-cli
```

相较两份手工复制的资源，单一来源避免后续替换时两端不同步；相较外部 URL，内嵌交付符合客户端独立运行边界。`scripts/build-cli.mjs` 将原始 PNG 纳入 `desktopInputHash()`，使只更新 Logo 也能触发客户端资源身份变化；`scripts/build-cli.test.mjs` 的合成输入补齐同一路径并验证这一变化。现有调用该摘要函数的检查入口继续复用该函数。

### 2. 通过固定图片路由交付资源

`internal/consoleapp/console.go` 在现有静态分派中提供 `/piwork-logo.png`；`internal/cli/user_desktop.go` 提供 `/desktop/piwork-logo.png`。两者读取固定的内嵌 public 文件，返回 `image/png`，沿用各自已有的方法、Host、Origin 和访问控制处理。登录或本地引导完成之前可显示品牌图片，与已有 HTML/CSS/JS 一致。

选择固定路由而不开放通用目录或任意扩展名服务，可使范围清楚，并避免暴露无关文件。HTML 使用绝对资源路径，管理详情深链接不会改变图片定位；Core 不承接这些 UI 图片请求。

### 3. 修改品牌区域，保留导航和语义

- Console：页头占位图标与登录品牌图形改为 PNG，删除页头独立 `PiWork` 文本节点，保留 `Serve` 和原有 `href="/"` / `data-nav` 行为。
- Desktop：替换 `brand()` 的字符标记，删除 `<b>piwork</b>`，保留 `Desktop` 和 `href="#/works"`。
- 交互品牌链接提供英文 `aria-label` 表达产品及返回用途，其子图片使用空 alt 避免重复读屏；Console 登录独立图片使用英文替代文本。
- 更新两端 `public/style.css` 中品牌及登录图形样式：固定图片尺寸、保持纵横比、透明背景和可见焦点，移除只服务旧字符或色块 Logo 的样式。初始尺寸可沿用约 32px 的页头图形与约 48px 的登录图形，截图复核时只调整尺寸和间距，不裁剪图形。PNG 的透明留白需计入实际可辨识尺寸。

选择实际移除产品名节点而非用 CSS 隐藏，可避免窄屏规则重新显示旧标题。保留产品区域标签与浏览器标题有助于区分 Serve 管理入口和 Desktop 使用入口，符合本次“移除 Logo 旁产品名”的范围。

### 4. 使用现有夹具核对实际交付

扩展 `internal/consoleapp/console_test.go` 与 `internal/cli/user_desktop_test.go` 的静态资源断言，验证 PNG 路由、MIME、资源内容及原有路由边界。两端浏览器夹具核对登录页和已登录品牌顶栏图片完成加载、品牌区域没有独立 Piwork 文字、可访问名称、返回行为及 360px 布局；Desktop Work 页面单独核对原身份栏、Work 名称和返回入口，不断言不存在的品牌顶栏。

使用合成账号和数据保存代表性截图到被忽略的 `dist/`；依据现有浏览器入口验证，不在真实用户安装里创建测试 Work 或获取业务内容。运行既有 Console / CLI 相关 Go 测试、UI 类型检查和浏览器入口；构建摘要变更运行 `scripts/build-cli.test.mjs`。完成 UI 构建后再编译 Go Console、Linux CLI 和 Windows CLI，并用既有原生客户端烟测方式核对内嵌资源。无需模型或 Docker Work 验收。

## Risks / Trade-offs

- [图片有透明留白，缩小后可能不易辨认] → 桌面和 360px 截图按可见图形检查，适度调整图片盒子和间距，保留完整 Logo。
- [只改 HTML 或 public 源码造成独立二进制缺图] → 同时覆盖复制链、Go 路由、内嵌资源与独立程序检查。
- [Logo 更新未改变客户端构建身份] → 原始 PNG 纳入 Desktop 输入摘要，并验证仅 Logo 变化时摘要改变。
- [移除文字导致链接缺少名称或旧样式重新显示标题] → 明确 aria-label 与图片 alt，品牌区域按 DOM 断言，并复核窄屏规则。

## Migration Plan

实现后先构建两套浏览器资源，再重建 Console 与 Windows/Linux CLI；已有安装配置、数据和认证协议不迁移。用户后续要求部署时，仅替换并重启 Console，客户端换用新 CLI；Core 及 Work 无需重启。Console 重启后的浏览器会话按原规则重新登录。需要回退时恢复旧 Console / CLI 二进制即可，旧客户端偏好和凭证格式保持兼容。
