# Proposal

## Why

Desktop Chat 目前只接收文本，用户无法直接把截图或图片交给 Agent；Create Work 提交时的状态提示还会拉伸按钮，干扰操作。Core 与 Desktop 缺少可发现的运行版本和应用内更新说明，用户难以确认当前环境及升级带来的变化。

## What Changes

- Chat 支持剪贴板粘贴、拖拽和文件选择添加图片，发送前可预览、移除，支持纯图片及图文消息；所有 Chat 布局共用当前 Work/Session 的草稿。
- 将图片贯通 Desktop、Go CLI、Core、Agent RPC 与 Pi SDK 的真实多模态输入，定义有界校验、模型能力、幂等受理及旧环境降级；失败或结果未知时保留输入，不自动重发或换模型。
- 在会话历史中显示已发送图片，重新连接、Agent 替换及完整 Work 导出导入后仍可查看；图片归属原 Work 的私有会话历史，不经公共 URL 或共享 workspace 交付。
- 调整 Create Work 提交反馈的布局，使状态区域与按钮布局分离；创建按钮在提交、长时间等待、拒绝和未知结果下保持尺寸和可操作位置稳定，复用公共反馈容器的其他弹窗进行回归。
- 新增 `About Piwork` 入口：Desktop 分别显示本机 Desktop（piwork-cli）与当前连接的 Core 版本；Core 的 Console 管理界面显示远端 Core 版本，不能将 Console 自身版本当作 Core 版本。
- 更新日志随程序内置、在应用内离线阅读，并附完整 GitHub Releases 链接；日志明确对应组件和版本，缺少精确匹配时如实说明，不用最新版日志冒充当前运行版本。
- 补充图片链路、按钮几何稳定性、版本来源、离线日志及跨版本降级的自动化验证和用户文档。此次不包含自动升级、在线更新检查或对外发布。

## Capabilities

### New Capabilities

- `product-release-info`：定义 Core/Desktop 的版本身份、只读信息入口、About 展示、内置更新日志与 Releases 导航及交付一致性。

### Modified Capabilities

- `agent-conversation`：扩展 Run 的图片输入与幂等内容、可发现能力、持久图片历史和完整包恢复规则，保留旧文本调用语义。
- `desktop-webui`：增加图片草稿、三种添加方式、纯图片发送、历史展示与失败恢复，并明确创建弹窗状态变化时按钮布局稳定。

## Impact

- 前端：`apps/desktop-webui/src/{app,adapter,models,chat-projection}.ts`、局部样式与浏览器测试；Console 的 About 入口及其 adapter/models、测试；构建后同步 Go 内嵌资源。
- 协议与运行：`proto/agent.proto`、`packages/contracts` 及 Go/TS 生成产物、`internal/cli/user_desktop_control.go`、Core conversation 路由、`internal/agentclient`、`apps/agentd` 与 `packages/pi-adapter`。图片需要独立于原文本小请求限额的有界传输，不能整体放宽普通 API。
- 历史：沿用私有 SDK history 与当前 Work 包传输；复核 `packages/work-store`、`internal/workhistory` 的静态校验及对应跨语言测试。现行源码采用 history schema 5 并兼容 schema 4，旧 CONV-CHAT-HISTORY-001 中只写 schema 4 的描述需同步澄清。
- 产品信息：复用 `internal/buildinfo.Read`，为 Core、Desktop 与 Console 增加各自授权边界内的只读版本/日志入口；新增内置日志源及必要的构建、打包输入校验，不改写已发布制品身份。
- 文档与依赖：补充 Desktop 图片操作和 About/更新日志说明，相关 README 中英文保持对应；宿主运行时继续使用 Go 平台，不增加 Node/Python 或外部日志服务依赖。
- 与在途工作关系：延续已实现的聊天设置摘要及生命周期反馈，不覆盖它们的对象锁、未知结果和焦点规则；独立 CLI 与 Docker 发行流程各自绑定本次新增日志输入，当前待验收事项不作为已通过事实。
