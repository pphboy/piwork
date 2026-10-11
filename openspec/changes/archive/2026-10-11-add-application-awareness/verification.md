# Verification Report: add-application-awareness

日期：2026-10-11。Schema：`spec-driven`。核对当前未提交工作区、全部 proposal/design/specs/tasks，以及本 change 的实际测试和本地验收证据。此次 verify 未修改实现、同步主规格、归档、提交或部署。

## Summary

| Dimension | Status |
| --- | --- |
| Completeness | 21/21 tasks；7/7 ADDED/MODIFIED requirements 有实现，无 REMOVED/RENAMED；无跳过检查 |
| Correctness | 7/7 要求映射完成，30/30 场景逐项核对，见下表；认知原则以正文及真实 SDK read 验证，模板行为以实际页面验证，不泛化为任意模型遵循 |
| Coherence | 独立 Skill、短 Brain 路由、条件 Reference、既有同步/采用/权限边界符合设计；代码模式一致，无跳过检查 |

`openspec instructions apply` 的 `all_done` 仅作为任务状态输入，不作为本报告通过依据。四类规划文件均可读；任务聚合无 unavailableTrackingFiles，规格为 1 条 MODIFIED（BRN-002）与 6 条 ADDED（BRN-010 至 BRN-015），共 30 个 Scenario。

## 要求实现映射

| 要求 | 实现与主要证据 |
| --- | --- |
| BRN-002 平级路由 | `internal/coreassets/piwork-brain/brain.md:7` 独立读取入口，原四项常驻认知及 deploy-work-service 保留；`internal/coreassets/brain_test.go:52` 核对无正文重复；`apps/agentd/src/brain-resources.test.ts:175` 实际 SDK 包/认知和原工具 |
| BRN-010 完整认知与按需加载 | `internal/coreassets/piwork-brain/skills/application-awareness/SKILL.md:6` 完整五类、完成标准与任务边界，`:12` 条件 Reference；`apps/agentd/src/brain-resources.test.ts:38` 与 `:92` 验证冻结 read、非全文注入及复用，`:151` 禁用/空包/冲突；`internal/coreapp/bundled_brain_integration_test.go:26` 旧 Work 保留与新 Work 发现 |
| BRN-011 主路径 | Skill 正文末尾禁止额外设计流程/审批/Run且保留必要验证；`apps/agentd/src/brain-resources.test.ts:92` 普通业务调用与局部后台改动的文件/调用集合；`scripts/check-web-base-core.mjs:417` 最终 Run/目标/Apply 数量检查 |
| BRN-012 状态与操作保护 | 两模板 `ui.py` 的 refresh 保留确认内容/seen并提示陈旧，恢复清错后按权威版本更新；`templates/*/test_ui.py` 执行实际 refresh 函数；`scripts/check-application-awareness-page.mjs:15` 实际 Query 500/恢复，`scripts/check-web-base-core.mjs:153` Agent Action 无导航且焦点/草稿保留 |
| BRN-013 样式隔离 | 两模板 ui.py/style.css 分别使用 webapp-/workstation- 前缀与根作用范围，有意 body 主题保留；test_ui.py 校验实际类/选择器；真实 Desktop iframe 中两个模板可见且可操作 |
| BRN-014 真实入口及能力边界 | Skill `:60`、NiceGUI Reference 的实际入口与部分验证规则；`scripts/check-web-base-core.mjs:164`、`:201` 实际授权 Desktop Service 检查两模板；SDK `:59` 以实际工具列表/固定观察验证无浏览器、不可达、未授权，未调用安装或凭据工具 |
| BRN-015 证据归因 | `skills/application-awareness/references/nicegui.md` 资源、错误、连接、DOM、计算样式/尺寸、遮罩和未知原因指导；`scripts/check-application-awareness-page.mjs:51` 实际故障及原入口恢复；SDK `:59` 仅按已有事实输出有限归因，证据不足为 unknown |

上表的模板路径以 `internal/coreassets/piwork-brain/` 为根。脑包 1.2.2 通过原 skills 目录发现并随 Core 归档，没有新增生产加载器、协议、权限或依赖。原部署 Skill、固定 base 引用和发行身份没有被改写。完整五类正文不放入部署 Skill 或常驻 Brain。

## 场景逐项核对

| 要求 | Scenario | 依据与结论 |
| --- | --- | --- |
| BRN-002 | 从模板开发工作站 | 原部署契约、实际 SDK/MCP 部署与真实用户/Agent业务回归覆盖 |
| BRN-002 | 部署第三方应用 | 原部署正文的 external 观察/不改造规则保留，新 Skill 明确排除；真实 SDK 可读资源，不声称本轮跑遍第三方软件 |
| BRN-002 | 使用另一技术栈 | 原部署正文保留 explicit stack/any language，新 Skill 无框架限制，后台非 NiceGUI 样本不读专项 Reference |
| BRN-002 | 操作已有 Service | SDK Query/Action 对照仅调用业务工具，真实 Agent Action 使用原状态且不改部署 |
| BRN-002 | Skill 与固定原则各自加载 | 原常驻 cognition 与两个可发现 Skill、真实 read 分开验证 |
| BRN-002 | 产品与体验认知独立于部署入口 | 独立冻结正文 read 前无部署工具调用 |
| BRN-010 | 完整五类认知在独立正文中可读 | read 返回与冻结正文逐字相同，五类与完成标准随 Core 归档 |
| BRN-010 | 元数据发现不等于正文注入 | SDK systemPrompt 不含全文，后续真实 read 取得正文 |
| BRN-010 | 小范围后台功能修改 | 固定 SDK 样本仅写原 Spec/logic，运行实际模块核对结果，无新增 UI |
| BRN-010 | 未启用或尚未采用新版脑包 | 禁用/空包负向、旧 1.2.1 冻结 Work 及源码/数据保持的升级回归 |
| BRN-010 | NiceGUI 任务按需读取专项指导 | SDK 实际依次 read Skill 和当前冻结 Reference，未 Apply 副本不替代 |
| BRN-010 | 非 NiceGUI 任务不加载专项资料 | 业务和后台样本调用集合无 Reference read，正文明确其他栈不要求读取 |
| BRN-011 | 小改动直接完成交付 | 局部后台样本仅维护原 Spec/源码，无设计报告或额外确认；范围原则完整可读 |
| BRN-011 | 普通业务操作不进入认知开发流程 | Query/Action 固定样本没有 read/write/部署阶段，原 Action 页面回归保持 |
| BRN-011 | 基本操作或状态存在错误 | 正文明示优先修复；实际 Ready/200+隐藏/遮罩对照被检测，Query失败显示观察限制 |
| BRN-011 | 用户明确要求视觉工作 | 完整可读正文保留明确视觉目标按用户范围实施的规则；本 change 无自主视觉重构或模型效果保证 |
| BRN-012 | Agent 修改业务数据时页面保持打开 | 实际 Agent Action 后 UI 可见新增数据，原 Query 结果核对，无导航/重部署/被动目标 |
| BRN-012 | 用户操作后更新当前视图 | 两模板实际 Add Todo 操作和页面结果覆盖，独立模板入口还覆盖 Complete |
| BRN-012 | 同步时用户正在编辑 | 实际 Agent Action/Query恢复前后 draft及focus保持，路径保留 |
| BRN-012 | 同步失败与代码更新分别判断 | 代码已采用后 Query 500、health200、codeVersion不变；显示陈旧提示，无原页面导航/服务修订变化 |
| BRN-012 | 业务查询恢复后保留草稿并更新状态 | 两模板故障期间 Action 成功，Query恢复后自动新状态/清错，草稿和焦点保留 |
| BRN-013 | 自定义卡片与框架布局共存 | 前缀/作用域检查及真实框架根容器可见、操作可用；对照可复现框架类误覆盖 |
| BRN-013 | 默认模板示例遵循自身指导 | 两模板源码/检查成组修改，真实 Desktop 用户入口及既有代码采用回归通过 |
| BRN-014 | Ready 和 HTTP 200 但页面不可用 | 实际 display:none/零尺寸和遮罩试点击失败，与Ready/health200分别记录 |
| BRN-014 | 通过实际 Desktop Service 完成基本交互 | CLI授权Desktop、Service选择、iframe页面、实际操作和状态变化覆盖两个模板 |
| BRN-014 | Work 没有浏览器能力 | SDK实际active工具不含浏览器，固定报告backendVerified=true/pageVerified=false，无安装/扩权调用 |
| BRN-014 | 实际入口不可达或未获授权 | SDK入口固定观察及调用参数为desktop-service，报告partial/原因，不改为直连/读取凭据 |
| BRN-015 | DOM 存在但样式或遮罩导致白屏 | 真实DOM/计算样式/尺寸/命中遮罩证据，移除注入后原入口恢复可操作；固定SDK仅按style事实归因 |
| BRN-015 | 资源或连接故障导致页面异常 | 实际bootstrap503/浏览器错误/业务DOM缺失，修复后同授权网关页面与NiceGUI WS可用；固定SDK资源归因引用503 |
| BRN-015 | 证据不足时诚实收尾 | SDK insufficient_evidence返回unknown；验收记录保留一次首次加载超时原因未知，不宣称已修复或框架不兼容 |

认知约束类场景的覆盖以正文、SDK实际返回与相关固定样本为依据；没有将其标为任意真实模型自主决策通过。实际页面类场景由浏览器断言支持，非截图文件或最终模型文字。

## 测试与证据核对

本次 verify 新执行：

- `npm run build -w @piwork/pi-adapter -w @piwork/agentd`：通过。
- `node --test apps/agentd/dist/brain-resources.test.js packages/pi-adapter/dist/sdk-smoke.test.js`：16/16 通过。
- `go test -mod=readonly ./internal/coreassets ./internal/coreapp -run 'Brain|Bundled' -count=1`：通过，coreassets 0.008 s、coreapp 5.745 s。
- `openspec validate add-application-awareness --type change --strict`、`git diff --check`：通过。
- 对本轮 provenance 的 Skill/Reference/两个模板 ui.py/style.css 共 6 项摘要逐一重算，全部一致。

本次复核 apply 时的完整实测记录，无新变化不重复长 Docker 回归：TS 18/111 通过、完整 Go coreassets/coreapp 通过、两个模板独立浏览器通过、Core `--main-only` 主回路及清理通过（checkedAt `2026-10-11T06:13:51.992Z`，17 类原检查、6 个显式 Run）与 8 类新增页面故障检查通过；旧 1.2.1 升级 45.31 s、新默认/空包和旧 1.1 升级均有首次实测记录。宿主构建、原生边界和 Quick Start/29 项测试通过。

浏览器实际Core构建与最终Core构建不同：最终仅增加 NiceGUI Reference 实际框架类名说明，模板摘要一致，最新归档/read复验通过；验收记录与 provenance 分别记录两个二进制，不混写身份。本次不声称已经在最终二进制重跑长浏览器回归，也不把该文字变更解释成模板行为变化。

本次复验第一条命令误用了仓库未配置的 `tsx` loader，启动失败；按项目文档使用构建后的 JS 入口重跑通过，没有添加依赖或更改测试标准。两次日志均保留在忽略目录 `dist/application-awareness/nicegui/verify-*.log`。

## Issues by Priority

### CRITICAL

无。

### WARNING

无。

### SUGGESTION（1）

- **首次页面加载超时保留为后续排查线索。** `docs/application-awareness-acceptance.md:76` 记录一次实际Desktop首次加载超时且根因未明，后续同代码独立回归通过。若再次出现，在 `scripts/check-web-base-core.mjs:425` 的失败诊断入口关联导航时点、资源返回、浏览器错误和连接状态，比较成功/失败证据，定位后再决定是否修复。当前没有已证实的规格偏离，不把猜测归因为 NiceGUI/iframe不兼容，也不以通过重跑宣称历史根因已解决。

## Final Assessment

无 critical 或 warning，1 项建议。完整性、实现/场景映射、设计遵循与代码一致性检查均已执行，无跳过检查。可归档（保留上述建议与模型证明范围）。镜像发行、远程部署及任意模型遵循保证不在本 change 范围。
