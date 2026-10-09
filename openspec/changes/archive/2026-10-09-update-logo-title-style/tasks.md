# Tasks

## 1. 本地 Logo 资源与构建身份

- [x] 1.1 修改两端 `scripts/copy-static.mjs`，将唯一来源 `docs/images/piwork-logo.png` 复制到各自构建 public 目录；构建两套 WebUI 后核对构建图片与 Go 内嵌 public 图片的 SHA-256 均等于源文件。
- [x] 1.2 将 Logo 源文件纳入 `scripts/build-cli.mjs` 的 Desktop 输入摘要，更新 `scripts/build-cli.test.mjs` 合成夹具及仅修改 Logo 的摘要断言；执行 `node --test scripts/build-cli.test.mjs` 验证通过。
- [x] 1.3 在 `internal/consoleapp/console.go` 和 `internal/cli/user_desktop.go` 添加固定 PNG 路由，扩展对应现有 Go 测试验证 PNG 内容、`image/png`、未登录静态访问及原有 Host/未知路径边界；执行 `go test -mod=readonly ./internal/consoleapp ./internal/cli` 验证通过。

## 2. 两端品牌区域与交互复核

- [x] 2.1 修改 Console 页头与登录区域、Desktop `brand()`，使用正确的绝对图片路径并移除 Logo 旁独立 Piwork 文本节点，保留 Serve / Desktop 标签和原导航；在现有两端浏览器夹具中核对图片实际加载、品牌区域文字、功能标题及原返回目标；Desktop Work 页面单独核对原身份栏、Work 名称和返回入口，不新增品牌顶栏。
- [x] 2.2 更新两端品牌与登录图形 CSS，清理旧占位图形样式并保留图片比例、透明效果与可见焦点；利用现有浏览器夹具复核桌面和 360px 下图片、导航、账号、键盘操作及整页无横向溢出，将代表性截图保存到 `dist/`。
- [x] 2.3 设置英文品牌链接名称与恰当图片 alt，并在现有两端浏览器夹具核对可访问名称和原链接行为；执行两端 workspace 类型检查及 `test:browser` 入口，确认相关回归通过。
- [x] 2.4 在 `docs/ui-language.md` 补充两端共享 Logo 来源、页头文字移除范围及功能标题保留规则；核对其与 UIL-010、现行 Desktop 规则和实际页面一致，执行 `git diff --check`。

## 3. 独立程序交付检查

- [x] 3.1 完成两套 UI 构建后重建 Go Console / Linux CLI，并运行 `node scripts/build-cli.mjs --target windows/amd64 --target linux/amd64`；核对客户端 build.json、运行时身份、资源摘要与本次源码一致。
- [x] 3.2 在独立程序中验证 Console 登录和详情页图片、Linux/Windows Desktop 的内嵌图片取得及最新品牌区域；从无源码和无相邻 UI 资源的目录执行原生启动检查，记录相关通过结果和截图，明确不将这些检查宣称为完整 Windows 正式验收。
