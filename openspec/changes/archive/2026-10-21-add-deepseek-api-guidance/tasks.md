# Tasks

## 1. Quick setup 指引与交互

- [x] 1.1 在 Quick setup 新增模型表单的 API Key 标签前添加规定文案、固定平台链接及局部浅色提示样式，按 design 的颜色、圆角、字号和间距实现；复用首设及模式切换浏览器场景核对出现一次、默认值保持、Add model 显示而 Choose saved model/准备阶段/完整 AI models 不显示，静态提示不产生请求。
- [x] 1.2 为平台链接保留新标签页原生行为，调整局部链接代理并保留站内保护；通过合成平台响应验证鼠标点击、键盘激活、目标地址及 opener 隔离，原文档/Key/草稿/dirty/高级区保持且无写入或 Test，复用原内部导航、unknown、后台回读及晚响应回归确认保护未弱化。
- [x] 1.3 核对 1440px 与 360px 的真实浏览器样式，修正对齐、自然换行、链接 hover/focus-visible 和外链标记；保存合成 fixture 宽窄截图并检查提示位于 Key 上方、域名完整、无溢出/裁切/遮挡，沿既有几何与键盘检查补必要断言。运行相关 Quick setup 与管理页浏览器用例，实际截图与结果归属本变更，临时输出放 dist。

## 2. 资源交付与集成核对

- [x] 2.1 执行 `npm run typecheck -w @piwork/console-webui`、`npm run build -w @piwork/console-webui`，核对 Console 构建/Go 嵌入资源逐文件一致；沿现有脚本的 Go 参数与真实构建元数据直接构建到 `dist/deepseek-api-guidance/go/`（managed-output 不接受嵌套输出），运行受影响的 Go WebApp/资源测试，确认真实 HTTP 入口返回更新后的指引模块及样式，不替换 dist/go 数据目录或停止当前安装。
- [x] 2.2 在最终源码执行 `openspec validate add-deepseek-api-guidance --strict`、文档归属、native-boundary 与 `git diff --check`；核对差异仅含本指引、链接处理、相关测试/嵌入资源及本变更，记录实际通过项、截图 fixture 与未测事实，确认无真实 Key/账号资料进入证据且未改写旧归档。

## 本轮实施验收（2026-10-21）

- Node24.21.0 / Go1.25.5 / Chromium。Console typecheck/build 通过；16 个运行资源与 Go 嵌入文件逐字一致。Quick setup 与 management-flow 浏览器回归 89/89 通过（41.956秒，0失败/跳过/重试）；最后仅调整链接排版以消除真实管理壳窄屏的孤立外链图标，随后相关六项定向 6/6 通过（3.7秒），并重新 build、重建 Core 和执行真实 Core 浏览器验证。未将89项说成最后一次样式微调后全部重跑。
- 外链普通点击及 Enter 使用合成平台响应，核对固定地址、noreferrer/noopener、同一文档、Key/草稿/dirty/高级区与零模型写入；修饰键检查在 document 观察到组件未取消原生事件后，由测试自身取消导航。这样验证代理不接管修饰键，又避免 Chromium 原生 Ctrl 新标签首请求绕过 Playwright route 而访问真实网站。原站内离开、unknown、自动回读、晚响应和管理页行为均由上述回归覆盖。
- `CGO_ENABLED=0 go test ./internal/webapp ./internal/consoleassets -count=1` 通过（WebApp 8.890秒；资源包无独立测试）。最初规划的 `PIWORK_GO_BUILD_DIR=... make build-go` 被 managed-output 固定目录约束拒绝，已修正规划；随后沿原脚本的 readonly/trimpath/buildvcs、CGO=0 与真实版本/commit/dirty/UI hash 参数，直接构建独立的 `dist/deepseek-api-guidance/go/piwork-core`、`piwork-cli`，构建记录保留于同目录上级的 `build.json`。没有修改受管输出脚本或用户安装目录。
- 最终新 Core 在独立用户/网络命名空间与临时数据目录中，以私有 IP 提供真实 HTTP 页面：合成管理员登录后，指引位于 Key 上方；模块及 CSS 为更新后的内容，全部脚本200且无脚本错误；平台外链新标签及原 Key 保留通过；完整 AI models 新增表单无该指引。没有提交模型/Runtime/Test、创建 Work 或调用付费模型，真实 Docker/模型准备不属于本次执行。
- [宽屏截图](evidence/core-guidance-1440-synthetic.png) 与 [360px截图](evidence/core-guidance-360-synthetic.png) 来自最终重建 Core 的真实管理页面，使用独立安装和合成账号；不是用户现有安装。图中 Docker 状态是该空安装的实际未检查状态；截图时 Key 为空。已查看两图确认对齐、换行及外链图标，另有 fixture 键盘焦点/hover 检查；临时命令、fixture截图、日志及报告在忽略的 `dist/deepseek-api-guidance/`。
- 最终 OpenSpec strict、repository-docs、native-boundary 与 diff 检查通过；范围核对为6个实现/测试/嵌入文件及本变更7个文件，旧归档和主规格未修改。5/5任务完成；当前运行中的用户实例未重启，新程序位于独立构建目录。
