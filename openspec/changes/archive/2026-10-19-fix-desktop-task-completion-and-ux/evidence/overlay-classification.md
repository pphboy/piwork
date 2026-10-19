# 2026-10-14 组件职责扫描

规范来源：用户提供的 `Piwork-UI-Component-Spec-v1.0(1).md`，26944 bytes，SHA256 `9aa41c6de7a938ae803e3ab0f8e4e3869be99fccd564cb7932c10147b271dd32`。原文唯一持久位置：[UI Component Spec v1.0](../../../../specs/desktop-ui-language/ui-component-spec-v1.0.md)；[采用说明](../../../../specs/desktop-ui-language/ui-component-adoption.md)。原文逐字保存；没有同步或归档其他delta。

## 入口矩阵

| 模块/入口 | 原实现 | 正确组件/处理 | 本次状态 |
|---|---|---|---|
| 账号、Work、Agent、Service、File更多操作 | generic showModal；账号仅外观像menu | 锚定Dropdown，menu/menuitem、命令后关闭 | 实现完成；403项纯回归，最终GUI事实见验收记录 |
| Service选择、Sessions | 阻断Modal内的选择列表 | Popover容器内Select popup（listbox/option） | 实现完成；403项纯回归，最终GUI事实见验收记录 |
| Response settings：模型/Thinking | 阻断Modal内menuitemradio | Popover内Select popup，当前值和焦点分离 | 实现完成；403项纯回归，最终GUI事实见验收记录 |
| Input options | 阻断Modal内一个Checkbox | Popover内真实Checkbox | 实现完成；403项纯回归，最终GUI事实见验收记录 |
| Core connection、Work info、Skill detail | 阻断事实窗 | 锚定信息Popover，保留必要动作 | 实现完成；403项纯回归，最终GUI事实见验收记录 |
| Manage services、Service details | 宽Modal内列表/状态/控制/日志 | 非模态Inspector Drawer | 实现完成；403项纯回归，最终GUI事实见验收记录 |
| Operations、Operation恢复详情 | 宽Modal含查询与异步恢复 | 非模态Inspector Drawer；原ID与完成出口保留 | 实现完成；原恢复/对象回归保留，定向GUI见验收记录 |
| Run details、Package details | Modal内历史/Cancel或长JSON/源码 | 非模态Inspector Drawer；保留准入/dirty guard | 实现完成；原恢复/对象回归保留，定向GUI见验收记录 |
| Files＋ | 已是锚定命令菜单 | 保持Dropdown | 保留并回归 |
| Pi Requests、Export | 响应式Inspector、非模态进度Panel | 保留已有对象/任务连续性容器 | 保留并回归 |
| Work settings | 持续Page | 保留Page及Save/Apply分离 | 保留 |
| Slash命令建议 | Composer内局部建议 | 保留既有command suggestions | 保留，不新增全局Palette |
| Show/Hide Chat | Work导航上的按钮 | Service Header同一切换入口；窄屏保留Header | 实现完成；403项纯回归，最终GUI事实见验收记录 |
| Reset access、Switch Core、New Work、Stop/Delete Work、Service Stop/Remove | 独立或危险任务Modal | 保留阻断Dialog和原影响/身份说明 | 合理保留 |
| Upload overwrite、New folder、Move/Copy/Rename、Delete files、dirty file/settings | 表单/目标选择/写入确认Modal | 保留独立子任务及明确风险；本次不改Inline Rename流程 | 合理保留 |
| Refresh Core skills、Remove/Install package、Import | 独立或不可逆任务Modal | 保留表单、校验/受理、未知恢复与明确确认 | 合理保留 |
| About、图片preview、WebDAV说明 | 独立阅读Dialog | 可独立退出的短时阅读/预览任务 | 合理保留；不是持续工作空间 |
| Icon title/aria-label | 解释控件 | Tooltip/可访问名称，不承接交互 | 保留；不重写Tooltip系统 |

| split分隔线 | 仅细线，拖动不明显 | 常驻握柄、12px独立热区、hover/focus提示 | 实现完成，定向GUI见验收记录 |
| Service失败/Chat首次历史失败 | 假空态/欢迎；通用health重试未读原资源 | 持续错误与对应资源Retry | 生产renderer/handler与adapter回归 |
| Session列表重读 | 丢历史checkedAt/imageProfile、误换Loading | 保留同对象缓存metadata | 挂起重读及身份撤销回归 |
| Works名称/Open Work | Button导航，不能原生打开新标签 | 真实Link，普通点击保留原guard | URL/modified click回归 |
| File Delete/Upload review | 未说明恢复性；失败一律称覆盖 | 明确UI不可恢复；真实覆盖/普通重试/unknown分离 | 原路径版本锁与新增分类回归 |

## 边界

本次修正职责错位和真实使用问题，不把SHOULD条目机械展开为全量UI重写。保留必要安全确认、原操作对象、身份清理、草稿、iframe、未知结果和写锁。无Core/API/依赖/Service业务页面修改，无Modal动画。新列表分类与纯函数/合成GUI只能证明各自实际覆盖，不能替代真实Core、读屏或完整浏览器矩阵。
