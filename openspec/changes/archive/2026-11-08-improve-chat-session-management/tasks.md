# Tasks

## 1. 确认界面与责任边界

- [x] 1.1 记录所有者选择 A 紧凑列表、保留已确认的 New 位置与行菜单；所有者明确本次不处理窄屏。
- [x] 1.2 明确会话标题、逻辑删除、命名任务和结果核对的唯一写入所有者及协议/生成链；以设计和直接消费者核对 Work、Session、Run 及身份边界。

## 2. 历史存储和兼容

- [x] 2.1 扩展 WorkStore 会话元数据、条件版本和逻辑删除事务；运行 work-store 单元测试覆盖空/长名称、并发 Rename、活跃 Run 拒绝、删除与迟到结果竞争。
- [x] 2.2 按受控流程演进 history schema 和 TS/Go 静态验证与生成物；运行迁移、旧格式、失败回滚和不兼容旧 Agent 负例。
- [x] 2.3 同步快照与 Work 导出导入，验证标题、删除标记、原提交键和 Memory/Evidence 引用跨重启与导入保留；执行对应快照和历史契约测试。

## 3. Agent、Core 和模型命名

- [x] 3.1 增加能力发现、按 Work/Session 绑定的标题/删除操作、版本冲突和未知写入查询；运行 Agent、proto wire、HTTP DTO 与跨 Work 授权正反例，并通过 `make generate` 同步生成物。
- [x] 3.2 实现首轮后的有界模型命名及显式 Auto name，绑定实际模型和原 Session/标题代次；以合成模型测试成功、失败、超时、重启、手动名称与删除竞争，验证不创建 Run 或执行工具。
- [x] 3.3 在服务端禁止删除活跃 Run 或不能安全续接的请求，并阻止对已删除会话的新提交；运行并发、幂等和原证据可读测试。

## 4. Desktop 会话交互

- [x] 4.1 修复新建及原提交核对后选择/历史读取的衔接；直接 adapter 测试覆盖空历史、读取失败重试、未知受理，浏览器测试覆盖旧响应和草稿保留。
- [x] 4.2 实现紧凑 New、行菜单、Rename、Auto name 和 Delete 确认，区分命名/运行状态及旧 Agent 不支持；运行浏览器测试覆盖非当前行、长名称、焦点、键盘和滚动，窄屏按所有者决定不纳入本次验收。
- [x] 4.3 实现写入冲突与未知结果的原目标核对，以及删除当前会话后创建新 Session；覆盖创建失败、未知结果、跨身份、并发切换、删除非当前会话和取消零修改。
- [x] 4.4 构建 Desktop 并同步 Go 内嵌资源；执行工作区 typecheck、浏览器测试和 `make check-generated-ui`，核对双语文案。

## 5. 集成验收

- [x] 5.1 使用隔离安装和合成数据运行真实 Core/Agent 集成：新建不再卡骨架、命名竞争、活跃删除拒绝、重启及导出导入后证据保留；记录实际通过、失败和未测项。
- [x] 5.2 覆盖新旧 Agent 能力协商、授权隔离、history 格式和 UI 嵌入资源；执行适用的跨语言契约检查与 `node scripts/check-native-boundary.mjs`，核对无多余运行时依赖。

## 实际验证记录

- 责任与生成来源：`apps/agentd/src/session-naming.ts`、`packages/work-store/src/session-management.ts`、`internal/workhistory/schema.sql`，消费者为 Agent RPC、Core 会话路由和 Desktop adapter；协议、HTTP DTO、Work history 与内嵌 UI 分别由现有生成入口同步。镜像扫描与 Agent 握手需共同接受 schema 8，并继续拒绝未知格式。
- 合成数据下，WorkStore 96 项及 Agent 215 项单元测试通过；追加的命名超时、系统消息分页回归通过。Go Work history、Agent client、DTO、镜像检查、Docker、Core 和 CLI 测试通过；`make generate`、UI/HTTP 生成物一致性、workspace typecheck、native boundary、Docker Quick Start 检查通过。Go 检查使用 `umask 0022` 和 `-buildvcs=false`；本环境默认权限掩码会使隔离容器无法读取合成配置，仓库标准 build-go 的 VCS stamping 在此环境失败。
- 使用隔离安装和合成模型，真实 Core/Agent 验证新建、首轮及显式命名、改名、忙碌删除拒绝、删除回执及重启；真实快照复制与 CLI 导出导入验证标题、删除回执及对话历史保留。未使用真实模型或用户数据。
- 按用户要求不使用 MCP/Playwright，改用 Chromium 原生调试协议检查 1440/360 宽度的紧凑列表、长标题、键盘焦点、滚动、重命名、自动命名、取消及确认删除、新建空会话、删除最后会话和旧 Agent 降级；客户端独立测试覆盖未知结果核对与身份隔离。通过 Chromium 原生协议连接真实 Desktop、Core 和 Agent，验证新建后退出骨架并显示空历史；随后所有者明确本次不处理窄屏。

## 6. 验证后修正

- [x] 6.1 可靠删除当前 Session 后只创建一次新 Session 并读取空历史，保留身份与选择防护；删除结果未知不得创建，创建失败或结果未知不得重放，覆盖并发切换和最后会话。
- [x] 6.2 已确认的手动或自动标题不得被默认标题占位规则替换；清理无消费者的英文内部状态文字，通过界面语言检查。
- [x] 6.3 修复 Request 详情两项现存测试的依赖问题，保留原验证并通过无 Playwright 的相关测试。
- [x] 6.4 执行适用的 Desktop typecheck、非 Playwright 浏览器测试、界面语言与生成资源一致性检查，记录结果。

- 验证后按所有者决定改为删除当前 Session 后新建：桌面 Chromium 原生协议覆盖删除当前/非当前、最后会话、新建失败和显式重试、创建及删除结果未知的原键核对、会话切换和离开 Work 的迟到结果；无窄屏扩项。新增 adapter 回归覆盖旧创建响应不清除新提交。
- 当前轮 Desktop 117 项非 Playwright 测试通过，原先 Request 详情两项失败已通过；`check-ui-language`、WebUI 边界、workspace typecheck、`make check-generated-ui` 通过，真实隔离 Desktop → Core → Agent 删除当前会话后新建通过。既有 `make check-style` 对本变更存量代码仍报单行多语句/声明，本轮未扩为格式整理。

## 7. 主路径简化与回退标题

- [x] 7.1 Desktop 将 Session 创建和 Run 消息提交的状态与恢复入口分开；新建不检查其他消息提交状态，覆盖并发、失败、未知核对、迟到响应及身份清理。
- [x] 7.2 标题显示优先使用已确认持久标题，否则使用已加载首条用户消息摘要或实际 Session ID，不以列表位置命名、不新增历史请求；直接测试稳定名称和标题优先级（此编号规则已由 8.1 替代）。
- [x] 7.3 执行相关直接单元、桌面 Chromium 原生协议、typecheck、界面语言/依赖边界、内嵌资源与真实隔离 Core/Agent 检查，记录通过及未测范围。

- 两项 WARN 修复：Desktop adapter 的 `modelReady/modelSettingsReady`、`newSession` 和 `recoverOriginalSubmission`（约 1510–1535、2174–2269 行）将创建与 Run 原提交分别保存在独立 slot，按明确类型查询；app 的创建、删除后替换和核对入口只消费各自状态。新增 `session-label.ts` 只读取持久标题、已加载首条用户消息或实际 ID，无额外历史请求；移除列表编号的失效文案。历史/协议及其生成链本轮不变。
- 对应直接回归验证 Session 创建与消息提交互不阻塞/覆盖，创建与 Run 分别核对、旧响应/身份清理/后续模型编辑保护；相关 169 项直接测试及桌面 Chromium 原生协议通过，真实隔离 Desktop → Core → Agent 的删除后新建通过。workspace typecheck、界面语言、WebUI/native 边界、文档路径、生成 UI 一致性与 OpenSpec 严格校验通过；既有 style 检查仍报 156 项，未扩项整理。测试未使用 MCP/Playwright 工具；本轮无窄屏设计处理。

## 8. 空 Session 显示编号

- [x] 8.1 按所有者选择将无可用标题或首消息摘要的 Session 显示为当前列表位置的 `Session 1`、`Session 2` 等；保留已确认标题优先级、真实 ID 和自动命名，不新增历史读取或存储字段。
- [x] 8.2 以直接单元与桌面 Chromium 原生协议检查空会话编号、列表重排、手动/自动标题及已有删除新建流程；同步内嵌资源并检查类型、界面语言和 OpenSpec。

- 所有者选择最简单的当前列表位置编号，并确认删除后可重排。`session-label.ts` 负责标题优先级与数字回退，`app.ts` 传入当前 Work 的 Session 列表位置；实际 Session ID、命名状态和存储格式保持原有归属，不引入历史读取或新外部依赖。
- 本轮直接单元 21 项、桌面 Chromium 原生协议和真实隔离 Desktop → Core → Agent 回归通过；后者核对新建及删除后的编号。workspace typecheck、界面语言、WebUI/native 边界、文档路径、嵌入 UI 生成一致性及 OpenSpec 严格校验通过；按所有者要求不处理窄屏、不使用 MCP/Playwright 测试。既有 style 建议未扩项整理。

## 9. 规格 WARN 与格式建议收口

- [x] 9.1 补齐 agent-conversation、portable-work、work-memory 及直接引用版本的 runnable-work-runtime、native-runtime-distribution 的 MODIFIED Requirements，使当前 history schema 8、已知旧格式 4–7、Memory schema 1、静态导入、显式升级、备份恢复和 readiness 一致；保留原 Requirement/Scenario 并通过 OpenSpec 严格校验及合并后版本条款核对。
- [x] 9.2 仅修正本变更新增的 TS/JS 多语句行与 CSS 多声明行；保持业务与测试语义，使用词法/编译产物核对及 `make check-style` 验证，不修改既有检查规则。
- [x] 9.3 执行受影响 workspace typecheck、WorkStore/Agent/Session 直接测试、非 Playwright Chromium 会话检查及内嵌 UI 同步/一致性检查，记录实际结果与未测范围。

- 本轮责任与来源：版本条款分别由上述五个 capability 的 delta 维护；格式按各既有源码模块和 `scripts/check-source-style.mjs` 的增量报告定位，不增加运行时依赖或行为。Desktop 源码构建同步内嵌资源；history/RPC 源、部署材料和冻结原型无需修改。
- 规格收口：新增/补齐五个 capability 的 9 条 MODIFIED Requirement，严格校验通过。使用 OpenSpec 自身 `findSpecUpdates/buildUpdatedSpec` 在内存中合并全部七份 delta，无合并警告且 915 个主规格原有 Scenario 标题均保留；当前版本条款为 8，schema 7 的历史说明保留。合并预览仅写入忽略的 dist，主规格未提前同步。
- 格式收口：按增量报告修正 23 个文件的 156 条违规；TS/JS 修改前后的完整解析树（含字面量和模板内容）一致，CSS 仅调整空白。`make check-style` 通过（检查 84 个触达文件），未修改检查器、依赖或 formatter 配置。workspace typecheck、界面语言、WebUI/native 边界、文档路径及 `git diff --check` 通过。
- 本轮回归：Desktop 169 项直接测试、WorkStore 96 项和 Agent 217 项单元测试全部通过，无跳过；Go workhistory、agentclient、contracts、imagestatic、dockerengine 检查通过（缓存）。1440 宽度的原生 Chromium CDP 覆盖列表、名称、删除后新建、失败、未知结果和切换竞争；首次与生成检查的 clean/build 并发时返回静态页面 404，构建完成后串行重跑通过。真实隔离 Desktop → Core → Agent 回归通过（11.57 秒），核对新建退出骨架和删除当前会话后选择新会话。
- Desktop 构建与内嵌资源同步、`make check-generated-ui` 和 `make build-go` 通过；宿主构建显式提供本工作区 GIT_DIR/GIT_WORK_TREE，保留 VCS stamping。临时日志和合并预览位于忽略的 `dist/session-warn-style/`。本轮使用合成模型及已有 schema 8 验收镜像，不测试真实外部生产模型；未运行 MCP/Playwright 测试、不纳入窄屏，也未提前同步主规格、归档或重启既有预览。
