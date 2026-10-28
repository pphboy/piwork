# Proposal

## Why

Desktop 的 Work 行、操作反馈和首屏等待把同一任务的状态拆成多行，出现 `Ready`、`Create Work · succeeded` 与 `Check progress` 并存，等待提示还会把列表、导航和表单推离原位。Chat 中的历史兼容文字和无 Service 蓝色提示占据正常对话区域，用户难以把界面反馈与正在进行的任务对应起来。

## What Changes

- 以已 Review 的可交互原型为基线，系统梳理 Desktop、托管工作台、登录／首次引导及管理界面的首读、普通操作、后台刷新和 Operation 等待；等待在发起控件、对象状态或所属任务已有区域原位更新，开始与结束不因普通 Loading 插入区域而改变周围几何。
- 全局入口在未知身份或目标页面时使用中性启动外壳；内容首次未确认时在实际内容区域显示贴合结构的轻量渐变骨架，已有内容刷新时保留内容。局部请求使用固定占位的三个点；真实传输进度继续表达真实字节及阶段。
- Work 和 Service 以原行或现有状态位呈现真实阶段；Work 的原操作和对象读回都确认收敛后，列表只保留真实状态与快捷动作，不继续堆叠成功流水和 `Check progress`。无对象或已移除对象的任务、未确认结果、失败和只读重查仍在所属流程可找回，不为隐藏提示解除保护。
- 消除 Chat 顶部 `Paged history is unavailable…` 常驻文字和无 Service 蓝色 Alert；真实历史读取失败或结果不完整仍在对应历史操作中表达。助手等待在所属回复位置显示，保留原 Run、取消和草稿语义。
- 把已确认的交互原型和合成示例图保存为本变更附件，并以受控延迟、状态切换、宽窄屏和中英文场景验证位置、状态收敛及恢复能力。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ui-language`: 统一跨浏览器入口的原位等待、固定几何、首次读取渐变骨架和减少动态效果行为。
- `desktop-ui-language`: 更新 Chat 首次进入的提示规则、Work/Service 任务状态及无对象任务入口的视觉和交互契约。
- `desktop-webui`: 更新 Work 生命周期与 Operation 收敛、Chat 历史及无 Service 呈现、Service／Files／Settings／列表读取和传输进度的具体行为。

## Impact

主要影响 `apps/ui-shared/`、`apps/desktop-webui/`、`apps/console-webui/`、对应浏览器测试及嵌入 Go 的浏览器资源。按现有接口和权限边界实现；允许修正 Desktop 客户端的状态归属与读回收敛，不改变 Core/API、远端任务语义或第三方 Service 内部页面。
