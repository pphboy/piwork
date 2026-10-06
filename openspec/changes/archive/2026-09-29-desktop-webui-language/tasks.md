# Tasks

本 change 的任务只交付产品、交互与 UI Spec 及静态原型；完成不表示 WebUI 已实现。第 1–9 组保留此前以三份 docs 整理设计及完成核验的历史记录；其规范来源由第 10 组迁移决定替代，旧文档不再作为最终交付要求。运行中的 MVP 依赖与验收见 design，实际实现由后续变更承接。

## 1. 规范适用边界

- [x] 1.1 在 `docs/ui-language.md` 与 `docs/product-language.md` 标明 Serve 专属布局与 Desktop 文档关系，核对互链且不改变 Serve 既有令牌（UIL-001）。
- [x] 1.2 固化 Work 独立面板、Service 主区域、Agent 辅助/聚焦态、Files 和独立窗口；核对英文文案、容器、视觉权重与 Serve 浅色配色（DUL-001 至 DUL-007）。

## 2. 可编辑原型基线

- [x] 2.1 保留已评审的 Work 列表、Service 与 Agent、独立 Service 窗口和 Files 四类主画面；本轮补齐工作区导航并检查可读性（DUL-001、DUL-002、DUL-007）。
- [x] 2.2 明确现有 proxy、未来浏览器入口、Core WebDAV 与 Agent 数据来源边界；检查没有假终端、重命名或全局列表（DUL-003 至 DUL-006）。

## 3. 文档一致性

- [x] 3.1 保持 proposal/design/spec、三份语言文档和原型说明对产品骨架、真实状态、访问与数据边界一致；本轮新增范围进入第 5–6 组校验（UIL-001、DUL-001 至 DUL-009）。

## 4. Work 生命周期和迁移

- [x] 4.1 规定 Start/Stop/Retry/Delete、原 Operation 恢复、显式 Stop 后 Export、Import 成功停止；逐项核对 CLI/Core 契约（DUL-008、DUL-009）。
- [x] 4.2 保留并修订 stopped Work、Export 结果、Import 审核和导入成功画面；删除停止后可加载历史的错误承诺（DUL-003、DUL-008、DUL-009）。
- [x] 4.3 补删除后清理、导入未发布、下载失败/过期和本地已知操作恢复；核对不是 Core 全局活动列表（DUL-008、DUL-009）。
- [x] 4.4 将生命周期与迁移的正常、进行中、失败、未知、确认和按 ID 找回映射到 05–08、27–31（DUL-008、DUL-009、DUL-016）。

## 5. 目标用户、产品语言与完整基础功能

- [x] 5.1 根据用户确认定义任务型 Work 所有者、六类场景及完成标准；固化任务优先、对象归属、渐进披露、真实状态和动作影响；在三份文档分别落实产品/交互/视觉职责（DUL-010）。
- [x] 5.2 补连接、身份、创建默认/高级选项、空 Work、Session 切换、Run 忙碌/取消/恢复；核对原型 09–14 与现有命令（DUL-011、DUL-012）。
- [x] 5.3 补 Service 列表、详情、控制、日志、端口/嵌入回退与危险确认；核对持久启停和 Work 状态前提（DUL-004、DUL-013）。
- [x] 5.4 补 Files 表单、编辑、传输、部分失败、覆盖/删除/dirty 确认与外部 WebDAV 流程；核对同 Work 和临时凭证边界（DUL-005、DUL-015）。
- [x] 5.5 补 Settings、Skills、Pi Packages 全来源/更新/开关/移除、AGENTS、高级配置和 Apply 状态；核对 active/desired/runtime 及安装不等于加载（DUL-014）。
- [x] 5.6 将静态画布扩展为 36 个具名 Frame 和同步 PNG，补完整 CLI 映射和状态/返回规则；修正 Session 标题/计数、停止历史和任意网页状态恢复承诺（DUL-001、DUL-003、DUL-007、DUL-016）。

## 6. 设计交付验证

- [x] 6.1 校验 36 个 Frame/元素 ID、PNG 内嵌场景与源 JSON 等价、主要文本边界，视觉检查主工作区、停止、连接、Run、Files、Settings、危险确认及窄屏（DUL-007、DUL-016）。
- [x] 6.2 核对能力矩阵含全部当前 CLI 命令组，文档相对链接可解析、错误承诺已清除；运行 `openspec validate desktop-webui-language --strict` 和 `git diff --check`，明确本轮未运行 WebUI 功能测试（DUL-001 至 DUL-016）。

## 7. 模块分区与人工评审

- [x] 7.1 将 36 个画面按 8 个模块分开放置，模块内最多两列并加大间距；导出模块文件、原尺寸单画面及评审目录，保留既有编号和界面内容（DUL-001、DUL-016）。
- [x] 7.2 核对原元素仅平移、无遗漏与重叠、各 PNG 内嵌场景与源文件等价及目录链接有效；视觉检查模块和单画面，并同步原型说明与规范（DUL-016）。

## 8. MVP 基础质量与列表对齐

- [x] 8.1 修正原型 01 的信息、状态、按钮、菜单对齐和工具栏尺寸，同步主场景、A 模块及单画面预览；检查四种状态下的中心线、列位置与文本边界（DUL-007）。
- [x] 8.2 将 MVP 基础质量、共享样式作用范围和避免过度设计写入现有语言文档及 change；核对基本能力未删减、未引入额外高保真阶段，验证预览与源场景等价及 OpenSpec strict（DUL-007、DUL-010、DUL-016）。

## 9. 统一需求基线与交付边界

- [x] 9.1 将 proposal 整理为目标、八组基础范围和交付边界，将 design 按容器、共享样式、状态恢复、访问链路与实现依赖组织；合并 Spec 重复表述，保留全部需求编号和既有功能，核对停止准入与旧历史表述一致（DUL-001 至 DUL-016、UIL-001）。
- [x] 9.2 比较更新前后的需求编号、场景与已完成任务，核对八组能力及三份语言文档、原型、矩阵的一致性；检查相对链接，执行 `openspec validate desktop-webui-language --strict` 和差异检查，确认变更只涉及已有规划文件且没有新增视觉交付门槛（DUL-001、DUL-007、DUL-010、DUL-016）。

## 10. 将 Desktop docs 归入 Spec

- [x] 10.1 将三份 Desktop docs 的产品语义、容器返回、视觉角色、表单/焦点和任务细则补全到现有 Spec，增加对应验收场景；更新 proposal/design/UIL-001，按 design 迁移表核对覆盖，保留 DUL 编号且取消三份 docs 作为规范交付物的要求（DUL-001 至 DUL-016、UIL-001）。
- [x] 10.2 按迁移表核对规则已在 Spec 中后，删除 `docs/desktop-product-language.md`、`docs/desktop-design-language.md`、`docs/desktop-ui-language.md`；修订 `docs/product-language.md`、`docs/ui-language.md`、`docs/design/piwork-desktop-prototype.md` 的规范入口为能力名与 DUL 编号，清理全仓活动引用，保留 Serve 原规则及原型素材。主 Spec 同步前不得引入失效或归档后断开的链接（DUL-001、DUL-016、UIL-001）。
- [x] 10.3 验证三份重复文档已移除、活动文档无旧链接或并行规范声明，现有 Spec 可独立覆盖八组能力和 UI 细则；检查全部相关相对链接、原型素材未变、OpenSpec strict 与差异检查。本任务仅核验规范迁移，不代表 WebUI 运行验收（DUL-001、DUL-007、DUL-010、DUL-016）。
