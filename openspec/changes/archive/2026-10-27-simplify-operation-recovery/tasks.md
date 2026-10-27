# Tasks

## 1. 原任务身份与恢复依据

- [x] 1.1 扩展 Desktop Operation 视图与接受/恢复映射，保留当前身份、Work、Service、snapshot ID 和原任务类型；以适配器测试验证重载后仍绑定原 Service，旧记录缺字段、类型不匹配和不同 Work 不被猜测关联。
- [x] 1.2 将提示收起/关闭与未决记录、未知修改锁及终态 Work/列表同步分离，保留现有 `known-operations` 接口；以测试验证收起后重载、两个窗口及终态同步失败时原 ID 仍可恢复，没有新增业务 POST，旧记录清理不解除新目标。
- [x] 1.3 保持 Work 生命周期接受代次、较新控制目标及只读观察独立收敛；以测试验证 Start 被 Stop 取代、旧响应晚到、Operation 成功而 Work/列表读取失败后恢复，以及确认 deleted 的合法收尾。
- [x] 1.4 将后端安全 Operation 错误与阶段诊断映射为类型明确的视图数据，并兼容旧字符串、空值、无效字段与不同任务类型；以适配器测试验证错误码、阶段、建议和关联标识不丢失，也不复制未知对象或伪造缺失字段。

## 2. 任务界面与局部恢复

- [x] 2.1 在 Works 行和 Work 面板统一呈现启动、停止、Retry 的真实进度、失败、只读检查及次级详情；以浏览器测试验证接受不等于 Ready、读取中断、原 ID 查看及既有 Work 主动作不重复。
- [x] 2.2 在 Works 列表加入仅针对无可见 Work 的创建/导入及已移除 Work 的删除任务提示，支持多任务、收起和对象确认后的归属；以浏览器测试验证空列表、搜索、读取失败、重载、失败和原结果检查均不会丢失任务或新增提交。
- [x] 2.3 在对应 Service 详情或所属 Work 的服务管理区域呈现原控制任务及日志入口；以浏览器测试验证重载恢复、Service 已移除、身份缺失、多个 Service 及检查原状态不会重载 iframe 或执行控制。
- [x] 2.4 在 Settings 的 Apply 和 Package 原位呈现各自进度、失败及原 Operation 详情；以浏览器测试验证不同任务不互相替代，Apply 已接受但配置读取失败时保留事实、草稿和恢复入口。
- [x] 2.5 整理 Import 与 Export 的任务、transfer/snapshot 恢复和结果动作，保留同一快照、单次交付及用户显式 Start and open；以浏览器测试验证 Import 未发布/失败/重载、原 snapshot 按 ID 查询、Pause/Resume 和下载中断均不重复提交。
- [x] 2.6 在所属任务中实现按需展开的诊断和技术详情，并按真实关联及权限提供现有日志入口；以浏览器测试验证完整/部分/缺失原因、安全转义、无权日志、长 ID 可复制，以及未记录的凭证冲突根因不会被臆造。
- [x] 2.7 完成以上恢复入口后，移除两种 Desktop 账号菜单及 Import 中通往全局 Known operations 的入口和过时中英文提示；以浏览器测试验证普通用户/管理员菜单均无该入口，所属任务的原 ID 检查仍可达，Console 管理入口不受影响。
- [x] 2.8 调整任务提示、行内反馈及详情的现有样式和中英文文案；以 Playwright 检查宽屏、360px、长名称/ID、键盘焦点及减少动态效果，确认主要动作可达、无整页横向溢出且反馈不重复堆积。

## 3. 集成验证

- [x] 3.1 运行 `npm run typecheck -w @piwork/desktop-webui` 和 `npm run test:browser -w @piwork/desktop-webui`；修复本变更相关失败，覆盖独立/托管身份切换、重新登录、记录保存失败、缺原 ID 和跨对象误查询。
  - Desktop 和 Console 类型检查通过；Desktop 浏览器回归 1078 项通过、1 项既有真实 Engine 条件用例跳过，Console 浏览器回归 202 项通过。首次设置页的 360px 布局与键盘访问已复核；独立真实 Core/Docker 测试见 3.3。
  - 后续核验发现：重载时任务记录接口暂时失败后，Works 刷新不会重读记录，连接检查可重新恢复；用户选择不增加额外提示。
- [x] 3.2 运行 `make build`，核对 Desktop 源码、嵌入资源及 Go 宿主构建一致；如修改 Go 记录或托管处理，运行相关 `go test -mod=readonly ./internal/cli` 并验证旧记录兼容。
- [x] 3.3 在独立测试安装及数据目录准备匹配的 Agent/helper 镜像，运行 `npm run test:real-core -w @piwork/desktop-webui`，并以真实 Core/Docker 核验所改创建/控制与导入导出的原 ID、重载恢复和提交次数；清理仅限本次 installation ID，实际未覆盖的路径如实记录。
  - 并行恢复修正后重新运行真实测试，覆盖 Create、Stop、Service Restart、Import 原 Operation 和 Export 原 snapshot 的新页面恢复，以及单次导出/下载、源 Core 离线导入和两套测试安装的定向清理。无权日志、记录保存失败和未记录的凭证冲突根因由合成浏览器/适配器场景验证，未复现真实凭证冲突。
- [x] 3.4 执行 `openspec validate simplify-operation-recovery --strict`、`node scripts/check-repository-docs.mjs` 和 `git diff --check`；核对增量规格与实现一致，临时截图和日志放在被忽略的 `dist/`，不记录真实凭证或用户内容。
  - [36 帧和 CLI 能力的当前映射](evidence/frame-cli-mapping.md)以现行源码与测试定位入口；历史原型仅作编号索引，真实依赖和模拟场景的边界按 3.3 区分。
