# Tasks

## 当前修订范围

用户已明确将目标收敛为“添加模型 → Test → 保存 → Choose model”。proposal/design 与七份 delta specs 已以模型直接配置为准，Provider 管理和能力模板前置要求不再是新版目标。

第 1–9 节的 52 项已完成记录是旧方案实施与验收历史，保留其勾选以免改写事实；其中 Provider/模板/过滤相关描述不作为当前规范，也不能证明新版已完成。第 10 节保留已完成的单模型修订记录；本次第 11 节专门跟踪 W1/S1 修复。旧验证报告按各轮事实保留，新增任务完成后重新验收，不能把旧勾选当作 W1/S1 已修复。

## 1. 管理契约与持久目录

- [x] 1.1 在 `packages/contracts/` 定义两种 api、Provider/ManagedModel、严格 patch、模型能力来源及 ModelTest DTO，扩展引用式 Runtime/default-work 输入；执行 `make generate`，通过跨语言 schema tests 验证未知字段、两种输入混用、空 Key 和非法引用被拒绝。
- [x] 1.2 在 `internal/coreapp/` 实现基于当前 `control_metadata`/`catalog_entries` 的版本化 registry、稳定管理 ID 和 immutable modelRef；用 Core 单测验证一个供应商多个模型、同 Model ID 跨供应商、head 更新及正常重启恢复，保持现有 SQLite schema 校验通过。
- [x] 1.3 实现供应商/模型 CRUD、供应商内 Model ID 唯一性、创建后协议固定及新旧 metadata 严格校验；用请求和存储测试验证原子拒绝、不同协议供应商并存、名称编辑不改执行版本和端点编辑生成新引用。
- [x] 1.4 实现只写 Key 保存/省略保留/原子轮换及引用保护；用 fault injection 验证 secret 写入与 head 提交失败、未知发布、重启恢复，公开 DTO/日志不含合成 Key 或内部路径。
- [x] 1.5 实现供应商/模型独立启停、重复动作、非级联删除及 Core 默认/Work active/desired 依赖检查；用并发单测验证删除与选择排序、仅历史引用允许退出目录、供应商重新启用不改变子模型 enabled，管理员只见安全依赖信息。
- [x] 1.6 实现当前 runtime-derived catalog 到 registry 的幂等对应，保留原 modelRef/Key/启停状态及既有非目标 provider/fixture 路径；用当前格式数据夹具验证多次启动不重复、不重新启用、不覆盖管理员目录。
- [x] 1.7 在 Core 管理路由接入 CADM-MODEL-001 的 API、方法约束和二次授权；执行 `CGO_ENABLED=0 go test -mod=readonly ./internal/coreapp ./internal/identity ./internal/contracts`，覆盖管理员/普通用户/operator 隔离、body 校验和 Docker 不可用时目录管理。
- [x] 1.8 创建用户文档 `docs/ai-models.md` 的供应商/模型、只写 Key、协议范围和启停/删除规则，更新管理 API 导航；核对文档字段与 DTO、路由一致，运行 `git diff --check`。

## 2. 独立 HTTP Test

- [x] 2.1 在 Go Core 实现草稿、保存模型和保存供应商加草稿模型的 Test 目标解析及私有 Key 取用；单测验证省略 Key 的权限边界、草稿优先级和 Test 不产生目录/默认/Operation/Work 写入。
- [x] 2.2 使用 Go HTTP 客户端分别构造 Responses 和 Messages 请求，固定短输入并验证 Base URL 拼接、认证和协议 body；用合成 HTTP fixtures 捕获实际请求，验证无重复 `/v1`、无自动重试或系统 curl/Node 依赖。
- [x] 2.3 实现超时、响应大小和在途 Test 预算、重定向控制、安全结果分类；用 fixtures 覆盖成功、2xx 协议错误、401/403、模型不存在、429、超时、超大响应及恶意错误回显，确认返回值/日志不含合成 Key。
- [x] 2.4 在 `docs/ai-models.md` 写明 Test 仅供检查、可以失败后保存/启用及不证明全部 SDK/Thinking 能力；验证 Core 测试明确覆盖失败不阻止保存/启用，文档示例只使用合成地址/Key。

## 3. 默认、Work 绑定与真实 SDK 执行

- [x] 3.1 接入引用式 Runtime 和默认 modelRef patch，统一有效默认的 Settings/readiness/preparation 读取；单测验证首次配置、未 ready 保存、并发无关默认编辑保留，以及后续刷新不被旧 Runtime profile 覆盖。
- [x] 3.2 更新 Work 模型绑定，捕获 api/Model ID/端点/能力定义并保留供应商准入关系；单测验证目录端点编辑不改 active/desired、Key 轮换不产生 pendingApply、显式重选同管理模型的新 modelRef 后 Apply 才更新捕获定义。
- [x] 3.3 扩展并生成私有模型/runtime/readiness 能力契约及安全公开投影；运行 `make generate` 和契约测试，验证 api/能力/executionBindingId 不进入公开 Run/Session、当前代次 mTLS 授权保持，以及旧兼容镜像获明确受限投影。
- [x] 3.4 实现 Run 准入的固定执行绑定、凭据版本 pinning 及执行前重验，接入手动和自动路径；单测覆盖轮换/停用/编辑与受理竞态、幂等重放、旧挂载 Key 禁止回退、自动执行不继承 Chat 偏好。
- [x] 3.5 在 Agent 共用模型解析中显式注册 Responses/Messages，复用 SDK 已知能力并支持受限能力模板/自定义定义；执行 Agent/Pi adapter 单测，验证同 Model ID 不同供应商、两种协议、未知能力状态及已有精确兼容端点行为。
- [x] 3.6 保留现有 Thinking 档位和设置语义，通过共用定义贯通查询/校验/执行；用实际 SDK 加本地协议 fixtures 验证 Responses 的 effort、Messages 的 budget/adaptive、支持的 Off/非 Off 和不支持档位原子拒绝，不新增管理员默认 Thinking。
- [x] 3.7 更新模型列表及 Chat capabilities 的增量协商，默认不可用时仍返回可用覆盖模型；契约和 Agent 测试验证旧调用格式不会误读新数据、能力不匹配有升级方向、旧偏好失效保留原 Thinking/历史而不自动重绑定。
- [x] 3.8 更新 Work 启动/重启/子代理默认材料的模型绑定与准入，确保仅传递当前所需 Key；用 runtime/子代理测试验证供应商停用不能借旧材料启动新请求、Key 轮换后新执行使用新 Key、停止 Work 仍终止容器内子代理。
- [x] 3.9 在 `docs/ai-models.md` 和 `docs/operations.md` 说明默认/Chat/捕获模型的区别、旧镜像显式升级和目录编辑影响；回归原 operator/env 初始化测试，确认已有命令形式保持有效。

## 4. Serve UI 与 Work Chat

- [x] 4.1 在 `internal/consoleapp/` 接入 `/models`、供应商/模型详情 shell 路由与管理代理白名单，接入现有 session/CSRF；Go 测试验证每个允许路由、拒绝越界代理、未登录/普通用户拒绝及 Key 不写入 Cookie。
- [x] 4.2 在 Console 添加 `AI models` 可见导航、供应商列表/详情和所属模型 CRUD、启停、删除确认；浏览器测试覆盖两种协议、一供应商多模型、依赖冲突、空/失败/不可用状态及 360px 完整名称/操作。
- [x] 4.3 在添加/编辑模型表单接入独立 Test、结果过期及当前表单绑定，Key 只保留必要的内存输入；浏览器测试验证 Test 不保存、失败仍可保存/启用、草稿变化旧结果不覆盖、失效会话和未知写入先读回、不持久存 Key。
- [x] 4.4 改造 Runtime 使用 Agent image 加目录模型选择，添加默认模型选择入口及返回上下文；浏览器测试验证不重复填写 Key、添加模型不改默认、未 ready 状态真实且已有深链接可访问。
- [x] 4.5 复用 Desktop Response settings，接入新 Chat 协商/供应商标签/默认不可用/旧偏好恢复，不新增默认 Thinking 控件；执行 `npm run test:browser -w @piwork/desktop-webui`，覆盖同 Session 跨协议切换、草稿与历史保留、Thinking 有效和停用后选择其他供应商。
- [x] 4.6 执行 `npm run build -w @piwork/console-webui -w @piwork/desktop-webui`、重新构建嵌入资源的 Go 宿主并运行 `npm run test:browser -w @piwork/console-webui`；更新 `docs/serve-console.md`、`docs/product-language.md` 的当前导航和操作说明，以及中英文 README 对应入口，核对两种语言同步。

## 5. Work 包和历史边界

- [x] 5.1 更新 snapshot model binding/metadata，使供应商本地身份与可移植协议身份分开，并保持现有包结构、明确能力描述验证；Core/history 单测验证同 Model ID 协议错配拒绝、目标绑定停用/轮换发布前重验和不导出源 Key。
- [x] 5.2 更新私有 Run descriptor 的严格历史验证和目标 Session 偏好重绑，源 executionBindingId 不恢复 live 权限；执行 Go workhistory 及 `@piwork/work-store` 单测，覆盖唯一匹配、多个供应商歧义、旧当前格式读取、Thinking/终态保留和未知字段拒绝。
- [x] 5.3 增加两种协议的导出/导入/再导出集成夹具，固定镜像和合成凭据分别属于两个安装；验证不复制供应商目录、无模型历史重放、导入 stopped 和显式 Start，以及目标可继续的 Session 保留选择/Thinking。
- [x] 5.4 更新现有 Work 包操作文档和 `docs/ai-models.md` 的目标供应商配置/歧义恢复说明；检查无需用户 bindings 文件，文档与导入错误、权限和包格式保持一致。

## 6. 联合验收

- [x] 6.1 运行干净构建流程对应的 `make generate`、`make build`、`make test` 和 `node scripts/check-native-boundary.mjs`；保存实际通过/失败事实，验证 Go Core HTTP Test 不引入解释器或系统 curl 运行依赖。
- [x] 6.2 用独立安装及受控协议服务器运行真实 Go Core/Console/Desktop/Agent 联合流程：创建两供应商及多个模型、HTTP Test、保存默认、同 Session 切换两种协议/Thinking；执行两 WebUI 的 `test:real-core` 入口和相关 Go integration tests，断言实际 HTTP 请求与用户选择相符。
- [x] 6.3 联合验证生命周期：名称/端点/模型编辑、Key 轮换、独立启停、默认失效后覆盖选择、受依赖删除、在途 Run 与幂等重放、Core/Agent 重启；运行相关 `make test-integration-go` 范围，确认 context/history 保留且无错误供应商 fallback。
- [x] 6.4 在本变更下记录联合验收事实与未完成项，执行 `openspec validate manage-multi-provider-model-lifecycle --strict` 和 `git diff --check`；仅清理本次精确 installation ID/标签资源，不自动部署、推送或发行。

## 7. 验证问题修复

- [x] 7.1 修复 W1：模型详情 Test 使用当前保存连接，读回使旧及在途 Test 结果过期；浏览器覆盖跨会话地址/Key 修改、草稿保留和旧结果晚到。
- [x] 7.2 修复 W2：默认不可用且候选为空时返回真实空目录；Core、Agent、Desktop 回归全部停用及重新启用，保留偏好/Thinking/草稿，读取故障仍单独表达。
- [x] 7.3 修复 S1：通过严格安全契约展示不可执行模型的能力/SDK 原因与恢复方向，旧环境显示镜像升级及 Apply 指引；补齐契约、Agent 与 Desktop 测试。
- [x] 7.4 生成契约、重建浏览器嵌入资源及 Go 宿主，运行相关测试与 OpenSpec/边界校验；在验证报告中保留原发现并记录修复与复验事实。

## 8. 消息 Test、结果 Modal 与页面操作布局

本节为用户手动测试后确认的新范围，单独跟踪实施与复验。1–7 节的完成状态及既有验收事实保留，不将先前验证结论当作本节已通过。

- [x] 8.1 扩展 `ModelTestResult`，增加 Core 固定 testMessage、成功时非空 replyText 与 replyTruncated，失败不带回复；执行 `make generate` 并通过 TS/Go 跨语言契约测试，继续拒绝未知字段及私有材料投影。
- [x] 8.2 在 Go Core 向指定 Model ID 发送固定 `Reply with OK.`，分别提取 Responses assistant output_text 和 Messages assistant text 正文；HTTP fixtures 验证真实请求与回复、2xx 空/仅推理/仅工具失败、8 KiB UTF-8 截断、已知 Key 屏蔽及现有超时/64 KiB/权限/无写入边界。
- [x] 8.3 将 Test 完整结果接入 Console 现有 Modal，展示目标、发送消息、进行中、实际回复或安全失败、时间/耗时和截断/过期；保留摘要与查看入口、原草稿及独立保存语义，浏览器验证关闭/导航/身份变化与晚到结果不会重新打开或覆盖其他目标，查看不重发。
- [x] 8.4 将 Read current data 与 Configure runtime 移入 AI models 列表及两级详情的 PageHeader/header-actions，将 All providers 设为返回导航；保持读回、未知写入核对及导航语义，浏览器核对与现有页面对齐、360px 可访问且不误提交表单。
- [x] 8.5 执行 Core HTTP Test/管理契约及 Console 浏览器测试，用真实 Go Core/Console 和两协议受控服务器验证消息发送到指定模型且 Modal 显示实际回复；覆盖 Test 失败后保存、保存连接/草稿连接、读回后的过期及空 Key 省略保留，确认不影响模型目录、默认或 Session Thinking。
- [x] 8.6 更新用户操作文档并重建 Console 嵌入资源及 Go 宿主，记录本节实际验收与仍未完成项，重新运行 `openspec validate manage-multi-provider-model-lifecycle --strict`、`git diff --check` 和变更验证。

## 9. URL 兼容与可恢复错误反馈

本节为用户确认后的新增范围：Messages 根地址与 `/v1` Base URL 自动兼容，不把常见 URL 表示或 Test 失败作为保存门槛；完整错误反馈另行实施与验收。此前调查中的部分字段提示修复不能代替本节完成，旧验收结论不覆盖本节。

- [x] 9.1 实现共享、幂等的协议 URL 规范化，Messages 的服务根地址、`/v1` 和尾斜杠表示均生成单个 `/v1/messages`，保留非版本路径前缀及 Responses API base；覆盖供应商创建/编辑、目标协议 Runtime 初始化、Test 草稿/保存项和新执行定义。同一有效地址不产生无意义的新 modelRef，不原地改写既有捕获 Work/Run；用单元/绑定测试验证。
- [x] 9.2 为失败 Test 定义严格 reason/message/recovery 契约与长度限制，保留 category 及已知字段错误的 field/code/correlationId；执行 `make generate` 和 Go/TS 契约测试，未知字段、失败伪造回复及私有材料仍被拒绝。
- [x] 9.3 在 Core 依据实际 HTTP/标准协议错误码与类型化网络事实生成安全原因，区分供应商认证/模型/限流/错误、DNS/TLS/连接/网络、超时、协议不匹配、空回复和响应过大；保留正常本地校验/授权错误及可确认字段，不透传原始 error.message/body/Key。fixtures 验证分类真实、无自动重试、Test 不阻止保存或启用。
- [x] 9.4 在 Console 接入统一字段与 Test 失败说明，Modal 区分发送前拒绝、请求失败、收到回复；提供字段定位/返回修改与恢复建议，协议示例兼容 Messages 两种 URL 写法，修正或新检查清除旧错误。保持草稿/写入未知读回规则，供应商认证失败不注销管理员，真正会话失效才清理敏感内存。
- [x] 9.5 浏览器覆盖缺少必需值、不可解析地址、Messages `/v1` 直接 Test/保存、各安全错误分类、网络失败后保存、供应商认证与会话失效区分、错误修正及晚到结果；断言状态不混淆、无 Key 回显或自动重发，360px 可访问。
- [x] 9.6 以真实 Core/Console 和两协议受控服务器联合验证根地址与 `/v1` 输入的保存/Test/实际 SDK 执行端点一致，保留路径前缀且无重复 `/v1`；验证远端 404/认证/不可达时仍可保存有效配置，既有 context/Session Thinking 不被 URL 表示调整隐式更新。
- [x] 9.7 同步用户文档与 Base URL 示例、构建嵌入资源/Go 宿主，运行相关测试、OpenSpec strict validation、`git diff --check` 与变更复验，记录当前新范围的实际完成与未完成事实。

## 10. 模型直接配置与添加后可选

- [x] 10.1 定义平铺模型创建/编辑/读取 DTO 与直接 POST /models，输入只有 model/api/baseUrl/credential/name?；Test 改为完整模型草稿或 modelId 加编辑覆盖，移除新流程的 providerId/能力 JSON 依赖。同步 Thinking unknown/null 的增量 Chat/私有/历史契约，运行 make generate、Go/TS oracle 与未知字段/Key 投影测试。
- [x] 10.2 实现单次原子创建完整模型、独立编辑/Key 轮换/启停/删除依赖，复用不可变 modelRef、URL 规范化、默认与在途绑定。单测验证同 ID 多配置、等价 URL 无新引用、Test 失败不拦保存、自定义 ID 不因 SDK 收录被拒绝，并同步模型管理 API 用户说明。
- [x] 10.3 为当前 Provider→Model registry 做幂等兼容映射：保留各子模型 ID/ref/Key/有效状态、旧默认和 Work 捕获；后续改连接或轮换只影响该条模型。用多子模型/无子模型/停用/旧显式定义/重启/失败回退夹具验证，不按 Provider 名猜模型、不清空数据或提前删秘密，记录回退边界。
- [x] 10.4 在 Agent 共用解析中自动复用已知 SDK 定义、按明确协议注册未知 ID 普通执行定义；贯通选择/能力查询/默认初始化/手动与自动执行及子代理。真实 SDK fixtures 验证两协议原 ID/端点/Key、普通请求无未经确认的 Thinking 参数、已知 Off/非 Off 映射不变，兼容性错误不静默回退；更新普通模式说明。
- [x] 10.5 将 Serve UI 改为平铺模型列表和一个新增/编辑表单，显示名可选、无 Provider/能力 JSON 控件，保留 Test Modal/错误恢复/标题栏。Runtime 与 Desktop Choose model 不过滤未收录或 Thinking unknown；浏览器验证未知 ID 保存即出现、相同 ID 条目区分、失败仍可保存、360px、读回/焦点/晚到结果及身份边界，同步 Console 操作说明。
- [x] 10.6 接入 unknown/null 普通模式的原子 Session/Run 设置、公开事实与历史/snapshot/helper 验证。测试旧缺省 Off/已知档位/新 null 严格区分、非空旧偏好不静默清除、旧客户端明确不兼容、默认/自动路径与手动偏好隔离，以及两个安装的未知模型包往返不复制 Key 或重放历史；同步历史/包文档。
- [x] 10.7 用真实 Go Core/Console/Desktop/兼容 Agent 和两协议受控服务执行完整用户路径：只填四项字段，草稿 Test、单次保存、Choose model、创建/继续 Session、实际 SDK 回复；必须包含固定 SDK 未收录的合成 ID、默认初始化和两个同 ID 不同连接配置。断言全程没有 Provider/模板步骤，Key/协议不混用，Thinking 未确认不阻断普通消息；保留旧数据迁移与已知 Thinking 回归。
- [x] 10.8 重建支持新协议能力的 harness 镜像、两 WebUI 嵌入资源和 Go 宿主；执行相关业务/浏览器/契约/历史测试、native boundary、OpenSpec strict validation、git diff --check 和新版变更复验。核对中英文 README 导航/操作文档与实际一致，记录当前范围与未完成项，独立测试资源仅按精确安装标签清理，不自动推送/发行/归档。


## 11. 复验 W1/S1：名称边界与 Work 默认实际型号

本节对应用户确认的两项修复，六项任务均已实施并完成复验，W1/S1 已消除；既有 60 项完成记录保留，当前共 66 项完成。SDK 升级、额外协议、Provider 管理和管理员默认 Thinking 不属于本节。

- [x] 11.1 为新平铺模型创建、编辑、读取 DTO 统一 256 字符名称上限，保证省略/清空名称时完整 Model ID 能作为合法默认名称；保留旧 Provider/ManagedModel 输入的既有 128 限制。执行 make generate 和 Go/TS oracle，覆盖 129/256 接受、257 拒绝及 Unicode 边界，不截断新模型值。
- [x] 11.2 在 Core 验证新模型默认/显式/编辑名称全路径及合法读取；对旧兼容 DTO 使用不回写原数据的有界有效 UTF-8 显示投影，稳定 id/modelRef/Key/原始名称保持。单测覆盖长 Model ID 省略名称、长名称编辑/清空、重启与新旧读取，确认拒绝输入原子且不影响兄弟模型。
- [x] 11.3 将 Console 新模型名称输入、预填和字段反馈同步到 256 字符；浏览器验证长默认名称、显式名称可保存/回读/继续编辑，超限拒绝、360px 操作及 Key 不回显；同步模型管理用户说明。
- [x] 11.4 在 Desktop Work default 菜单、Response settings 与聊天输入区域显式展示公共描述实际 Model ID，可保留友好 label；用 old-id 捕获/new-id head 与改名夹具验证真实型号可区分，长型号窄屏可访问，不自动重绑或修改 Work/Session/Thinking/Run，不新增秘密投影。
- [x] 11.5 运行相关 Core/契约/Console/Desktop 回归，重建受影响的契约、两 WebUI 嵌入资源、Go 宿主及 Windows CLI，核对生成物、文档与实际行为一致；本机更新沿用已授权目录与单 window 分屏约束，Core 重启须先确认没有 active Run，不能为展示修复打断任务，不扩展为对外发行。
- [x] 11.6 重新执行 openspec-verify-change，逐项复现并核对 W1/S1 是否消除；更新验收报告时保留旧发现与实际失败/通过事实，运行 OpenSpec strict validation、native boundary 与 git diff --check，不自动归档或宣称未执行的检查通过。
