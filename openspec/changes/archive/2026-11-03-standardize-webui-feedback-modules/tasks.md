# Tasks

2026-11-01 已获“先执行吧，完成这个Change，然后提供PR给我”新实施授权。每批先保留行为建立测试，再抽取责任边界，最后应用 UI 变化；仅在完整证据满足后勾选。V13 代表性场景不构成全部状态的验收豁免。实施事实见 [implementation-evidence.md](implementation-evidence.md)。

## 1. 实施基线与逐族验收

- [x] 1.1 在新实施授权后核对源码基线及未归档双语/Linux changes，合并本 change 重叠要求而不覆盖既有语义；以逐项冲突表与 OpenSpec strict 校验验证。
- [x] 1.2 将附件 23 个 Desktop、12 个 Serve 来源族逐一映射实际入口、可观察状态、状态所有者、恢复与测试，补齐登录/会话、独立表单、初始壳和 hosted Quick setup 等原型缺口；以无未解释遗漏的覆盖表验证，不适用项附源码依据。
- [x] 1.3 为本批触达模块建立最小依赖/接口和行为基线，记录首次读取与保留旧数据、未知锁、原 ID、晚响应和实际协议例外；用现有相关契约测试及准确的通过/失败/未执行记录验证。

- [x] 1.4 建立项目级影响分类与选择性来源索引，覆盖 Go/TS、配置、协议/生成、文档及 UI；分别用一项代码改动和一项纯文档改动演练 owner→消费者→检查选择，验证不会默认要求全仓上下文或无关真实集成。
- [x] 1.5 将既有配置默认/校验/兼容测试纳入选择规则，以启动三参数、弃用环境键、Work 配置生效边界为当前样例补齐必要负例；验证非法/重复/旧键与合成秘密不回显，确认不改变实际默认值或擅自恢复旧配置，并同步索引。
- [x] 1.6 明确协议/schema/history 与 UI 生成源及输出清单，为触达生成链补充陈旧输出/接口失配检测及合成负例；通过 `make generate` 对应链和 Go/TS wire/golden 验证同步，保留有效旧格式与冻结证据身份，不靠手改输出通过。
- [x] 1.7 复用 repository-docs、docker-quickstart、ui-language 检查及既有负例测试，核对当前双语命令/链接/配置/UI 的真实来源；新增需要的漂移负例并证明失败，对本批发现的失效配置/文档/入口给出授权内修复或明确阻塞结论，不泛扫全仓后无限扩项。
- [x] 1.8 将以上治理检查按影响接入现有 Makefile/脚本入口和 Skill 导航，记录自动检查与人工审查边界；以配置漂移、失效链接、旧生成物、非法依赖等各规则适用反例验证，不新建平行工具体系或声称未存在的 CI 已执行。

## 2. 共享反馈与视觉来源

- [x] 2.1 以窄事件/只读模型抽取通知策略及单一宿主，不输入整份 view/adapter；直接 import 测试去重、当前语言、失败不超时、未知优先级、关闭不解锁及身份隔离，并同步所属模块导航。
- [x] 2.2 接入 Desktop/Serve 浮动通知，移除重复推动布局的普通 Alert，保留首读/空态/准入无框内容、字段错误、危险确认和私有提醒；以两端浏览器测试验证键盘、360px、长中英文、模态共存及恢复入口。
- [x] 2.3 从现有共享源统一原 PW PNG、Open 进入工作区图标、单圆 18px Refresh 与等待固定槽，不合并业务不同的 ActionState；以原资源 hash、语义图标测试、busy/静止尺寸截图和无双份活动定义检查验证。
- [x] 2.4 保持 V12 Header 基线（Desktop 首页/Admin/Work 56px，Service Toolbar 39px，必要时 96px 双行）、首页 B icon-only 与 Work 行 Open 图标加文字；以等高/对齐及窄屏截图测量验证，并更新所属视觉契约记录。

## 3. 显式导航与菜单边界

- [x] 3.1 抽取 Work Header、Service Toolbar 与菜单视图模型，显式传 scope/目标/权限，渲染不修改选择或发请求；直接 import 测试 global-account/work-row/work-header/service、非活动 Work 与过期菜单，并更新实际模块入口索引。
- [x] 3.2 将 Administration 仅保留在全局 Account，Admin Header 提供直达 Workbench，移除 Work 行 Admin/Requests，Requests 仅在已打开 Work 内并保持 Service 过滤；浏览器验证语言入口未丢失、iframe 不重挂、草稿/焦点/路由不回退。

## 4. 导出展示与既有协调器分离

- [x] 4.1 保留 ExportFlows/ExportPort 等现有协调边界，抽取纯导出面板模型与具名控制端口；替换读 app 源码/正则/VM 的面板单测为直接 import，验证布局修改不需 Files/Chat/Serve 全局依赖。
- [x] 4.2 保持 Export Details 非模态；所有既定仅进度 drawer 只展示同任务进度和必要控制，其他容器保留既有模态/非模态语义；把技术 ID、旧快照和诊断放到所属独立恢复上下文，保留隐私提醒；以隐藏/重开同任务、背景交互、键盘与长文本测试验证并更新模块导航。
- [x] 4.3 回归停止确认、desired/observed 停止准入、原 snapshot/hash/长度、一次交付、Pause 与 Close、Check 与 Resume、过期和身份撤销；以直接协调器测试与现有真实 Docker/Core 导入导出链验证，未运行真实链不得勾选完成。

## 5. Desktop 全部来源状态

- [x] 5.1 按 D01–D06 的实际来源逐功能接入会话/Core 准入、Works、创建/生命周期、Service 目录/入口/日志反馈；验证关键初读十秒有界收敛、空态与失败分开、未知不重放与原对象恢复，并将对应测试链接写回覆盖表。
- [x] 5.2 按 D07–D12 的实际来源逐功能接入文件浏览/预览/编辑/上传、Save/Apply、Skills/Packages 等反馈；以局部失败、部分/未知写入、旧草稿、新选择与确认结果后读回失败测试验证，不造通用 Operation 或假进度。
- [x] 5.3 按 D13–D17 的实际来源逐功能接入 Chat/history/Run/tools、模型/Thinking、图像与 Requests；验证旧历史与草稿保留、unknown 不再次提交 prompt、Model+Thinking 一组摘要/自动保存、Requests 与消息结果独立，并维护对应直接/浏览器测试与索引。
- [x] 5.4 按 D18–D23 的实际来源核对 Import/Export/log export、原 ID 恢复及 About/偏好等余项；逐项依据附件真实名称校正归组，验证 Import 完成仍 Stopped 且只显式 Start、无可见 Work 固定恢复入口与安全诊断不丢失。

## 6. Serve 与登录/首设依赖

- [x] 6.1 按 S01–S12 实际来源分别接入 Overview、Users/账号、默认 Work 配置、Skills、Packages、Models/Test、Runtime、Package Operation、About 及 hosted Quick setup，不以本任务组示例替代逐族清单；每个所有者以直接契约测试验证确认修改与关联回读失败分开、晚回调不清新 Key/草稿，并更新导航与覆盖表。
- [x] 6.2 补齐真实登录/退出/未知受理、独立表单、Desktop admission 与初始壳读取失败/恢复，保留有界安全重试和身份清理；以实际入口浏览器/契约测试验证，不继承原型未绘制的缺口。
- [x] 6.3 验证模型 Test 显式可选且不保存/启动，不以 not-run/失败/成功状态门控 Save/Enable/Choose；验证 Runtime 保存只影响未来 Work、配置保存不等于 ready、无通用 Console Operation，以实际模型管理与 Runtime 测试证明。
- [x] 6.4 验证 Package 未知受理仅按既有同 actor/source/key 幂等 Resume 协议恢复，无假取消/百分比；Quick setup 必须 status.ready、preparation.ready、六项组件 ready 且无当前读取失败，只有有效首设意图可跳转，以各所属协议测试证明。

## 7. 项目级防腐 Skill 与持续边界检查

- [x] 7.1 仅在实施授权内安装本 change 的 Skill 候选并增加最短 AGENTS 触发入口，不修改生成的 OpenSpec 工作流 Skill；覆盖代码、配置、文档与界面的每次变更触发，把拟定模块路径更新为按类别渐进读取的实际 owner/source/consumer/interface/tests/spec 导航，以 Skill 结构校验和一次局部任务读取演练验证。
- [x] 7.2 复用 Go/native 平台边界并增加本批 TS 共享→feature、feature→入口等非法依赖和循环检查，并以合成负例证明失败；结合类型/人工审查验证无完整 view/adapter、任意字段 setter 和跨所有者写入，记录自动检查不能证明的部分。
- [x] 7.3 固定 Go 的既有 gofmt 与本批 TS/JS/CSS 兼容风格检查，不压缩巨型单行、不无关全仓重排；通过触达文件检查与格式负例验证，并删除/无逻辑转发被替代旧实现以保持单一活动来源。
- [x] 7.4 用“调整通知策略”“调整导出布局”“调整配置默认值”“修正双语命令”四类范围内维护样例记录必读文件/行范围、接口/测试、依赖扇出及被迫跨功能修改；相关实际模块/配置/文档检查通过且不再依赖整个应用上下文才完成，不以文件变小或未测量 Token 百分比验收。

## 8. 跨端集成与交付核验

- [x] 8.1 按 AGENTS 运行相关 typecheck、单测、WebUI 构建、资源复制/Go 嵌入一致性与现有浏览器集成；检验 Desktop/Serve 实际服务入口、CSP/图标、双语晚响应、360px/宽屏及 reduced-motion，分别报告真实执行与未执行范围。
- [x] 8.2 逐项核对全来源覆盖表及高风险真实 Core 链证据，复查无重复写入、未知解锁、跨身份泄漏或原型覆盖免责；运行 OpenSpec strict 验证并提交变更内验收记录供审阅，主 spec 同步/归档/commit/push/release 按其授权另行处理。


## 9. 最新批准 V14 的增量实施与视觉验收

历史已勾任务记录当时完成范围，不代表以下 V14 覆盖已通过；V13 冻结附件保留，最新参考及 hash 见 design。

- [x] 9.1 按冻结 V14 同步共享 52px/88px Header、39px 次级栏及 Desktop/Administration 密度；实现四个 Admin 短 SVG 导航与 Services/Files/Chat SVG，验证双语、Account/Work scope、Quick setup/Skills/Find operation/原 Operation 可达和真实状态不变。
- [x] 9.2 对齐 Chat 83px/42px/28px 输入区与独立 Model/Thinking 入口，保留成对自动保存、展开、IME/草稿/焦点、真实图片限制及未知锁；用直接模块及浏览器回归证明无自动重放或假值。
- [x] 9.3 正式构建并同步生成/嵌入资源，运行受影响契约及浏览器测试；提供 Desktop 首页、Work 和 Administration 的 1440px/360px 六张实际截图并对照 V14，验证长错误、等待/陈旧/未知、双语与主要动作可达，分别记录视觉验收及未执行范围，不以原型或历史通过记录代替。
