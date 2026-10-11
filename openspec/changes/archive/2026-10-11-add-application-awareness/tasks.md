# Tasks

第 1–4 组的 14 项保留首次实现与验证的完成事实。第 5 组为确认后实施的 NiceGUI 认知扩展；新增样式、实际页面、查询故障恢复与能力边界已分别执行验证，证据追加在 `docs/application-awareness-acceptance.md`，不改写首次完成事实。

## 1. 独立认知资源与默认路由

- [x] 1.1 新增 `internal/coreassets/piwork-brain/skills/application-awareness/SKILL.md`，完整保留用户提供的五类认知、完成标准、适用/排除范围及交付成本边界；在 `internal/coreassets/brain_test.go` 验证真实脑包归档包含独立正文和完整五类内容，原部署 Skill 与 NiceGUI 引用/模板仍交付，执行 `go test -mod=readonly ./internal/coreassets`。
- [x] 1.2 在 `brain.md` 增加简短的 application-awareness 平级阅读路由，保留原四项认知与 Service 交付规则；同组资源测试验证应用认知入口不依赖部署工具或部署 Skill 转入、常驻文本不复制完整五类正文，普通 Query/Action 与仅启停任务保持直接路径。
- [x] 1.3 将脑包从实际 1.2.1 基线递增为计划 1.2.2（若已占用则选下一个未占用版本），保持 `pi.skills` 目录发现和无新依赖；同步 `brain-resources.test.ts` 的两个明确 Skill 名称/资源计数断言以及当前版本期望，执行 agentd 对应测试与 Core 归档测试，保留原四个工具和历史 fixture 版本。
- [x] 1.4 更新 `docs/piwork-brain.md` 与 README 中英文对应说明，说明完整认知存放位置、两个平级 Skill、Brain/SDK 发现/read 正文的区别和主路径边界；同步纠正文档中与正式 base 固定引用不一致的候选描述，核对链接、真实清单和 `git diff --check`，不修改已发布身份。

## 2. 真实 SDK 正文读取与任务边界

- [x] 2.1 在 `apps/agentd/src/brain-resources.test.ts` 及必要 `packages/pi-adapter/` 合成夹具中，按名称定位新 Skill 并通过实际 Pi SDK read 工具读取冻结包正文；断言五类内容进入工具结果、未先调用部署工具、正文没有预先全文注入系统上下文，保留 SDK 工具历史作为证据并执行对应 agentd/pi-adapter 测试。
- [x] 2.2 补充同一有效上下文可复用正文、工作区同名编辑尚未 Apply 不影响冻结内容、禁用与 packages=[] 不补入新 Skill、两个包资源同名冲突仍拒绝的加载回归；用现有资源/Session 测试验证，不改生产加载器或添加新的强制门禁。
- [x] 2.3 在现有 SDK 场景增加小范围应用任务和普通业务 Query/Action 对照，检查后者没有产品设计文件、额外部署工具调用/Agent 目标，前者不生成独立设计报告、五项检查表或无关 UI；保留原必要 Spec/业务验证，测试报告明确合成模型只证明执行链路和固定夹具行为。
- [x] 2.4 在 `docs/testing.md` 记录新增资源/read/负向回归的实际命令、证明范围与模型遵循限制；执行文档中对应的定向命令并核对测试结果，不把文件存在、元数据或最终模型文字写成行为通过。

## 3. 内置包更新与真实默认应用兼容

- [x] 3.1 在 `internal/coreapp/bundled_brain_test.go` 增加真实旧 1.2.1 包制品到新版的升级回归，覆盖新 head、重复启动幂等、旧制品和管理员替换/禁用/移除/默认集合保留；执行相关 bundled brain 单元测试，不能只替换已有版本字符串。
- [x] 3.2 扩展 `bundled_brain_integration_test.go` 的独立安装回归，确认新默认 Work 的实际 SDK 加载两个 Skill，已有 Work 捕获的包/context/源码保持，显式空包仍通过原协议；使用兼容预备 Agent/helper 镜像和唯一 installation ID 执行定向 integration，保存原 Operation/实际加载结果，不发布镜像。
- [x] 3.3 复用 `scripts/check-web-base-core.mjs` 的真实用户操作、Agent Action 自动呈现和草稿保留场景，核对业务 Query 与页面结果一致、没有手动 reload、数据 Action 不重部署且不创建被动模型请求；必要时在既有夹具补充受影响断言，明确同步失败指导与既有模板实际覆盖范围，不新增视觉评分或重做界面。
- [x] 3.4 将本组实际包版本、安装/加载/业务验证、失败和未验证项记录到对应认知变更验收记录，并在测试手册链接；记录只含安全构建事实与合成数据，核对旧 Work Adopt/Update/Apply 操作说明及代码/数据保留事实，不把历史 NiceGUI 验收当作本轮执行。

## 4. 集成一致性核对

- [x] 4.1 执行受影响 Go/TS 测试、构建脑包内嵌资源的宿主程序，运行 `node scripts/check-native-boundary.mjs`、`node scripts/check-docker-quickstart.mjs`、`node --test scripts/check-docker-quickstart.test.mjs`；确认没有协议/schema、权限、依赖或已发布镜像身份漂移，不因源码 hash 演进重写历史发行材料。
- [x] 4.2 执行 `openspec validate add-application-awareness --type change --strict` 与 `git diff --check`，逐项核对 BRN-002、BRN-010 至 BRN-012 和实际证据；确认本轮只增加一个独立 Skill，未新增审批/执行引擎、自动 Apply、镜像发行或远程部署。

## 5. NiceGUI 样式、真实页面验收与问题归因

- [x] 5.1 在 application-awareness 的通用正文补充样式隔离、真实用户入口验证和证据归因，新增同 Skill 下按需读取的 `references/nicegui.md`，保留原五类正文及两个平级 Skill；扩展 Core 归档与真实 SDK read 测试，验证 NiceGUI 样本读取当前冻结 Reference、其他栈/普通业务不增加该读取，执行对应 coreassets/agentd 测试，不新增常驻全文注入或加载器。
- [x] 5.2 成组调整 web-app/workstation 两个默认模板 `ui.py`、`style.css` 的自定义类为业务前缀并限定范围，保留框架布局类、业务操作和原视觉结构；同步模板 README/SPEC 的相关坐标，检查类名与选择器一致及无全局通用类误覆盖，分别运行模板相关检查并核对实际框架容器/业务内容可见，不新增 CSS lint 平台门禁。
- [x] 5.3 复用 `scripts/check-web-base-core.mjs --main-only` 的真实 CLI 授权与 Desktop Service iframe 验收受影响模板页面，确认内容可见、主要操作可用、用户/Agent 状态自动变化且草稿/焦点保留；增加 Ready/HTTP 200 但内容隐藏或操作被遮挡不能通过的对照，保留原 Operation/业务证据、不导航、不重部署及无被动新 Run/Apply 断言，不以 Service 直接地址替代真实用户入口。
- [x] 5.4 为两个默认模板补充最小的业务 Query 失败/陈旧反馈及成功恢复，沿原定时查询和权威状态机制实现；在实际页面已采用新版代码后注入可控查询失败，验证旧内容被标明非最新、草稿/当前操作保留，恢复后清除错误并自动显示新状态，不刷新页面、重部署或创建额外 Agent 目标，直接覆盖 BRN-012 原故障场景。
- [x] 5.5 在既有浏览器/SDK 夹具加入样式隐藏或遮罩、资源或连接异常的受控样本，核对资源结果、浏览器错误、连接和 DOM/计算样式/尺寸证据可取得；验证 NiceGUI Reference 的实际读取、诊断仅引用已有事实、证据不足明确未知且不自动换栈，原入口可复验。日志不含 ticket/token 或无关用户内容，并注明合成模型不能证明任意模型的自主归因能力。
- [x] 5.6 补充当前 Work 无获准浏览器能力以及浏览器存在但实际入口不可达/未授权的 SDK 对照，核对真实工具/访问范围与报告中的后端已验证、页面未验证及原因，不能宣称完整 UI 交付；确认没有浏览器安装、额外权限/凭据读取或绕过用户入口的工具调用，不将平台 Playwright 能力当作 Work 授权。
- [x] 5.7 更新 `docs/piwork-brain.md`、`docs/testing.md`、中英文 README 对应说明和认知验收记录，保留首次 14 项的真实结果并追加本轮 Reference/样式/页面/故障/能力边界证据与未验证项；执行相关构建/定向 Go/TS/真实页面回归、原生及 Quick Start 一致性检查、`openspec validate add-application-awareness --type change --strict` 和 `git diff --check`，逐项核对 BRN-002、BRN-010 至 BRN-015，未实施项保持未完成，不发布或部署镜像。
