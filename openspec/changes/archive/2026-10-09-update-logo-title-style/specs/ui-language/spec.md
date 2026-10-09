# Spec Delta

## ADDED Requirements

### Requirement: Console 与 Desktop 统一项目 Logo 并移除页头产品名文字

**Identifier:** UIL-010

Console / Serve 管理界面与 CLI Desktop 登录页、Works 列表的现有品牌顶栏 SHALL 使用仓库已有的 Piwork 项目 Logo 作为页头品牌图形，Console 登录区域的品牌图形 SHALL 使用同一 Logo。页头品牌区域 SHALL 移除 Logo 旁单独显示的 `PiWork` / `piwork` 产品名文字，以及原先作为占位 Logo 的箱形图标或 `pi` 字符图形；现有 `Serve` / `Desktop` 产品区域标签 SHALL 保留。

品牌链接 SHALL 保留原有返回目标、键盘操作和可见焦点，并提供英文可访问名称，使屏幕阅读器仍能识别产品及返回用途。图片 SHALL 保持比例与透明效果，不拉伸、不裁掉图形、不添加改变原 Logo 外观的滤镜。桌面与 360px 视口下，Logo SHALL 清晰可见，且不遮挡导航、账号或主要操作，不引起整页横向滚动。

Logo SHALL 作为本地静态资源随独立 Console 与 Windows/Linux CLI 程序交付；未登录页及已登录页均能取得正确图片，深链接不依赖当前页面路径，不需要外部图片站点、源码目录或相邻资源文件。视觉更新 SHALL 保留浏览器文档标题、页面功能标题、Work 名称、业务说明中的产品名称，以及现有认证和 Service 访问边界。

Desktop Work 常规页面 SHALL 保留原有“返回＋Work 名称”身份栏，不新增 Logo 或全局顶栏；专注布局继续遵循 DUL-002。

#### Scenario: 管理登录页与已登录管理页
- **WHEN** 管理员打开 Console 登录页，并登录后进入 Overview 或其他管理路由
- **THEN** 顶栏及登录区域的品牌图形使用现有项目 Logo，顶栏品牌区域不再显示独立 Piwork 文字，Serve 标签和原导航仍可辨识

#### Scenario: Desktop 登录与 Work 页面
- **WHEN** 用户在 Windows 或 Linux 启动 CLI Desktop，查看连接页、Work 列表和某个 Work 的常规布局
- **THEN** 登录页和 Works 列表的品牌顶栏使用同一项目 Logo 且移除旁边的独立 piwork 文字，保留 Desktop 标签；Work 页面保留原身份栏、Work 名称、状态及返回和其他操作，不新增品牌顶栏

#### Scenario: 品牌返回与无障碍名称
- **WHEN** 用户以键盘聚焦品牌链接或使用屏幕阅读器浏览页头
- **THEN** 品牌链接有可见焦点和英文可访问名称，激活后沿原规则返回管理首页或 Work 列表，Logo 本身不产生重复的可访问名称

#### Scenario: 深链接与独立二进制交付
- **WHEN** 用户打开管理详情深链接，或从无源码及无相邻资源文件的目录启动已构建 CLI
- **THEN** Logo 从对应 Console 或本机 Desktop 的固定静态资源地址成功取得，返回 PNG 图片，图形与现有项目 Logo 一致，不请求外部图片站点

#### Scenario: 窄屏与原功能标题
- **WHEN** 用户在 360px 宽屏访问两端登录页和已登录页面
- **THEN** Logo 保持比例且不被裁切，导航与账号入口可达，页面无新增横向溢出；功能标题、Work 名称与浏览器文档标题保持原有意义
