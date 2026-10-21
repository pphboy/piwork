# Tasks

实施仅涉及 Piwork 仓库代码；用合成数据与独立安装验证。现有 Work 的应用文件、测试、数据与运行状态保持原样，不执行其服务控制或应用修复，不把现场应用恢复列为完成条件。

## 1. Service 诊断与对象级反馈

- [x] 1.1 扩展 `models.ts` 的可选安全诊断视图，在 `adapter.ts` 保留既有读取归属并归一化公开诊断；随本项加入并运行相关适配/浏览器契约用例，覆盖结构化字段完整保留、合法零退出码、旧字符串、null、未知码及部分非法字段，确认状态和合法信息不丢失且无需新增后端契约。
- [x] 1.2 调整 Work notice 和 Service 主内容的局部状态投影，区分具体 Failed、有效 Starting、Ready、Stopped/Disabled 与当前读取未确认；随本项用 recovery 合成场景验证非必需服务失败的明确标题、正常启动不误报故障、单故障直达原详情、多故障与无 Web 入口的管理方向、读取失败保留最后事实及恢复，以及正常服务访问保持。
- [x] 1.3 在既有 Service 详情中按主说明、修复方向、技术诊断和有界日志分层显示，并保持原对象导航与晚响应保护；随本项验证错误文本转义、关联标识不猜测 Operation、日志/详情绑定正确 Work/Service、切换对象或身份后旧响应不改新视图，打开/关闭及读取日志没有服务控制、设置或 Run 写入。

## 2. Service 启动动效与 Chat 输入样式

- [x] 2.1 实现仅属于首次应用未展示且有效 Starting 占位的四格透明度动效，按 design 的 1.2 秒周期及固定位置完成减少动态效果和 busy/装饰语义；随本项扩展并运行现有 pending/recovery 浏览器场景，实际采样四格透明度、几何及节点/动画连续性，覆盖 Ready/Failed/Stopped/Disabled/观察中断立即结束、恢复按新事实更新、无重复三点、顶栏静态及已挂载 iframe 的原保留/撤销规则。
- [x] 2.2 将 Chat 输入焦点改为外层圆角轮廓，按 design 统一底色、留白和底栏对齐，保留控件独立焦点及原输入规则；随本项在辅助栏、常规 Chat、Focus chat 的真实浏览器核对 1440px/360px、长模型名与 Stop and send、Tab/Shift+Tab、轮廓裁切和无溢出，复用现有输入法/图片/slash/设置/发送回归确认草稿、节点、选区、焦点及零隐式写入。保存并查看本变更必要的合成截图，临时样本归 `dist/improve-chat-composer-and-service-feedback/`。

## 3. 集成交付与边界验收

- [x] 3.1 使用 Node24 执行 `npm run typecheck -w @piwork/desktop-webui`、`npm run build -w @piwork/desktop-webui` 与 `npm run test:browser -w @piwork/desktop-webui`，完成跨模块浏览器回归并核对构建结果与 `internal/desktopassets/static/` 逐文件一致；记录真实通过、失败及既有可选 Engine 跳过，新增适用合成场景必须全部执行通过，不改写旧归档或截图。
- [x] 3.2 执行 `CGO_ENABLED=0 go test ./internal/webapp ./internal/desktopassets -count=1`；沿 design 指定的现有 Go 构建参数及真实版本/commit/dirty/UI hash 等元数据直接构建独立 Core/CLI 到 `dist/improve-chat-composer-and-service-feedback/go/`，在临时安装验证真实 HTTP 提供最终模块及样式、依赖无 404 且页面无脚本错误。受管输出脚本、现有 `dist/go` 数据和运行实例保持原样；该验证只证明宿主/资源交付，不声明真实业务 Service 恢复。
- [x] 3.3 在最终源码执行 `openspec validate improve-chat-composer-and-service-feedback --strict`、`node scripts/check-repository-docs.mjs`、`node scripts/check-native-boundary.mjs` 和 `git diff --check`；核对差异仅含本次 UI/诊断、必要测试/嵌入资源与所属变更，记录实际验证结果和未测事实，确认无现场凭证、用户 Work 内容或日志进入产物，全部验收不访问或控制用户现有应用。
