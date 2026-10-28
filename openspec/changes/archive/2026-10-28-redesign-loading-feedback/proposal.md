# Proposal

## Why

浏览器界面的等待反馈会在已有按钮、对象行和工作区旁插入新的状态块或改变文案尺寸，造成布局跳动并让用户难以判断正在等待的是请求、内容读取还是远端任务。需要一次梳理所有自有界面入口，让真实等待与对象关联，并保持正在使用的界面稳定。

## What Changes

- 系统排查 Desktop、托管工作台、Admin、独立 Console 和首次引导的初始读取、显式操作、后台刷新与真实长任务，统一反馈归属。
- 短操作在原控件或既有状态槽显示三点；已确认内容更新时保持原内容，普通等待不插入挤压布局的状态行或重复动画。
- 首次读取在对应内容区域使用贴合实际结构的骨架，允许低对比动态渐变，并保留减少动态效果下的静态呈现；初始壳清晰表达连接与读取状态。
- Work、Service 及 Operation 在原对象位置呈现真实状态与阶段；保留真实传输进度、错误、未知结果、操作详情和现有写入保护。
- 通过受控延迟和状态切换的浏览器验证检查宽窄视口、中英文、按钮与邻近元素几何、焦点/草稿和长任务恢复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ui-language`: 跨入口等待归属、稳定几何、首次骨架及动态效果规则。
- `desktop-ui-language`: Desktop 首次读取骨架和 Work/Service 局部等待呈现。
- `desktop-webui`: Desktop 首读、操作状态、原位反馈及布局稳定行为。

## Impact

影响 `apps/ui-shared/`、`apps/desktop-webui/`、`apps/console-webui/` 的浏览器呈现、静态入口及相应测试，构建后同步 Go 嵌入资源。不改变 Core/API、任务执行与权限、用户数据或第三方 Service 内部界面。
