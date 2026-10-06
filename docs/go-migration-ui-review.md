# Go 迁移后的 UI 与静态规范复核

2026-10-02。本次保留浏览器实现，只替换其宿主为 Go；不以静态原型代替运行验收。

## 规范与覆盖来源

- `openspec/specs/desktop-ui-language/spec.md` 是 Desktop 的唯一产品、交互、视觉硬规则，`ui-language/spec.md` 规定与管理面板的适用关系。仓库不再有三份重复 Desktop 语言规则。
- `docs/design/piwork-desktop-prototype.md` 的 CLI 覆盖矩阵逐项列出身份、Work、Session/Run、Service、文件、配置、Pi Package、Operation、迁移入口；它指向 DUL-001 至 DUL-016，不另立规则。
- `docs/design/desktop-review/README.md` 将 36 个画面分为 8 个可单独评审的模块；草图是互斥状态研究，不要求产品同时陈列全部状态。
- 后续新增文件分析应在 Files/Agent 使用用户明确提出的文件/API 请求。技术设置进入 Settings/Advanced；Work 终端、改名和全局 Operation 列表在无能力前不提供假入口。新增功能仍需逐项记录对象、容器、返回路径、状态、窄屏/键盘及偏离理由。

## 运行与视觉证据

真实 Go Core、Go CLI、Docker 和完整 TS Pi harness 的 Chrome、Edge 流程均通过，见 `desktop-webui-acceptance.md` 当前 Go 验收章节。实际截图包括空列表、运行列表、Service 预览/独立窗口、Files、Settings、Chat、未知文件结果、pending、停止、导出、导入审核/停止/启动，以及加载与错误。截图在 `/tmp/piwork-desktop-real-chrome` 和 `/tmp/piwork-desktop-real-edge`；不是旧 TS 后端画面。

人工复核：Work List 名称/状态/动作的固定位置一致，Service 是主要可交互区域，Agent 辅助栏与输入可达；长 SDK 工具历史在局部滚动容器内，不挤掉 Service。停止后显示恢复入口，先 Stop 再 Export；导入成功默认停止。用户内容保留原文，产品文案英文。UI 使用统一 token，调整 accent 的浏览器测试证明公共主按钮随之变化。

Console 的 44 个浏览器用例实际检查列表加载/空/错误、表单网格、字段错误、readonly summary 与编辑顺序、360px、焦点、键盘及 token。浏览器 fixture 专门制造不确定响应、暂时不可达、缺少引用和未完成 Operation；这些结果只证明对应失败分支，不声称来自真实 Engine。Core HTTP/Go 单元与真实 Engine 测试分别提供平台边界证据。

规范中的“后续新增功能/需要例外”是维护规则。本次复核其规范自足、入口指向和现实现遵守规则；不把未来尚未提出的功能当作已实现。
