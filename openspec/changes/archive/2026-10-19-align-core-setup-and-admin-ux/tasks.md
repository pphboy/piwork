# Tasks

第 1–6 节记录首轮实现和验证，第 7 节记录等待反馈、Desktop 菜单及保存恢复告警修复的已完成工作，实际事实见 acceptance.md。当前新增的 Admin 内 Quick setup、Admin 账户菜单和 Workbench 顶栏整合由第 8 节承接；现行要求以更新后的 delta/design 为准。第 1–7 节完成标记及既有验收附件保留其历史事实，不代表第 8 节已实现或通过。第 9 节承接后续 verify 的离开导航竞态修复与入口文案统一；旧验收中的 Core setup 文案保留其当时事实。

## 1. Core 固定发行镜像与公开契约

- [x] 1.1 调整 packages/contracts 的引用式和完整模型 Runtime 输入，允许省略 agentImage、保留旧同值字段兼容，生成对应 Go DTO/schema 和契约数据；验证：make generate、TS/Go 跨语言契约测试覆盖省略、同值、异值、混合输入和非法类型，确认密码不进入 WebCredentialsInput。（CADM-002/004、ONBOARD-005）
- [x] 1.2 在 Core 的引用式与 legacy Runtime 写入边界统一解析发行 Agent 引用，覆盖 admin/control 和离线共用能力，保留原授权及原子提交；验证：go test ./internal/coreapp ./internal/distribution，覆盖目标 Core 固定值、坏元数据/异值零变更、保存与 readiness 分离、读取旧 Runtime 不迁移及已有 Work 捕获身份保持。（CADM-004、Configure a usable local runtime profile）
- [x] 1.3 调整 internal/consoleapp Runtime 适配只提交模型引用，保留必要旧字段校验/诊断，并将 internal/webapp 的快照发行失败与设置授权失败分开；验证：go test ./internal/consoleapp ./internal/webapp，直接 API、统一 Admin、独立 Console 使用同一固定值，发行错误时登录、已保存模型读取及引导框架仍可用。（SUI-CFG-002、ONBOARD-003）

## 2. operator 与受影响运维入口

- [x] 2.1 移除 config set --agent-image，将模型语法校验与固定镜像解析分离，在线取目标 Core、离线取本地服务端发行引用；验证：go test ./internal/coreoperator，覆盖帮助/旧参数在读取 secret 与连接前退出、stdin/file Key、在线不同版本、离线锁及未知在线结果不回退。（SERVE-RUNTIME-RELEASE-001、CST-OPS-001）
- [x] 2.2 更新 scripts/check-web-base-core.mjs、check-web-base-core-dependencies.mjs、native-host-acceptance.mjs、measure-work-latency.mjs 及相应 fixture 使用实际内嵌发行引用；验证：受影响驱动的参数/构建测试和合成初始化场景通过，移除的参数只出现在拒绝测试或历史材料，不增加产品镜像覆盖/env 或借默认 Work 覆盖绕过验收。（SERVE-RUNTIME-RELEASE-001）
- [x] 2.3 同步现有中英文部署手册中 config set 的参数、固定镜像及升级后显式保存说明，核对绑定的示例/模板；验证：node scripts/check-docker-quickstart.mjs、node --test scripts/check-docker-quickstart.test.mjs、node scripts/check-repository-docs.mjs 与 git diff --check；现行命令可解析，既有发布 commit/hash/digest 保持真实。（CST-OPS-001）

## 3. 共享控件与页面基础对齐

- [x] 3.1 将两端共用基础控件规则收束至 apps/ui-shared，移除覆盖冲突，明确普通/紧凑/图标/危险角色；同步两端静态复制、共享文件输入 hash、相应构建测试及生成嵌入资源；验证：两 workspace build、node --test scripts/build-cli.test.mjs scripts/build-docker-release.test.mjs，以及代表性浏览器计算样式覆盖尺寸/图标/hover/focus/disabled/loading，避免只断言 class 字符串。（UIL-SETUP-001、DUL-007）
- [x] 3.2 为 CoreSetup/统一登录补齐现有 Logo、页面标题、稳定步骤与单列内容容器，保留 Admin 页面轨道、网格与导航；验证：在桌面和 360px 通过键盘访问账号/模型表单，标签、帮助、错误及操作对齐，长内容无整页横滚，资源深链接可取得。（UIL-SETUP-001、ONBOARD-003）
- [x] 3.3 修复托管 Desktop 的 Sign in 及新增跨页面动作的样式角色，将 Admin Runtime/默认 Work 的镜像行和对比收进只读诊断；验证：扩展 Console/Desktop 对应浏览器场景，导航语义和完整按钮状态正确、默认表单无镜像配置项、诊断可读取完整值，既有 Skills/packages/AGENTS 保存行为保持。（UIL-SETUP-001、SUI-CFG-002/003）

## 4. Create admin 密码二次确认

- [x] 4.1 在创建表单加入 Confirm password，处理失焦/提交校验、修改后重新核对、首错定位、原文一致性、密码管理器及敏感清理；验证：扩展实际统一程序的 onboarding 浏览器测试，覆盖空值、11/12 字符、不一致、先一致后改密码和修正，非法输入创建请求数为零，普通登录仍只有一个密码字段。（ONBOARD-005）
- [x] 4.2 补齐合法创建、连续点击/Enter、请求失败与未知创建恢复的浏览器用例；验证：一次创建仅发送 account/password，确认密码不外传或进入 Web Storage，失败/成功后两项按规则清理，原首次授权/来源/CSRF/并发创建 Go 测试继续通过。（ONBOARD-001/005）

## 5. 顺序引导、模型表单与恢复

- [x] 5.1 从 model-management.ts 抽取轻量模型字段、长度/地址校验、错误和 Test 结果复用模块，CoreSetup 使用单列呈现，Admin 保留目录管理及现有 Test 容器；验证：Console 模型浏览器回归覆盖 256 字符、协议地址帮助、字段定位、Test 失败仍可保存、改草稿后结果过期、关闭/晚响应及 Key 不回填，两个入口行为一致。（ONBOARD-002、SUI-CFG-002、SUI-MODEL-001）
- [x] 5.2 按授权、登录、模型、准备和结果分离 CoreSetup 状态，空目录直接新增、有模型可选择或切换新增，支持真实普通用户待配置视图与已初始化安装继续；验证：onboarding 浏览器场景覆盖空/已有/不可用目录、失效授权与普通网络失败区分、创建后普通登录、刷新与重启继续，后台状态更新保留输入/焦点/选区。（ONBOARD-002/003/004）
- [x] 5.3 实现 Save and continue 的模型保存/Runtime 绑定连续意图及各步确认，维护身份/视图/目标代次与写锁；验证：浏览器注入明确失败、已提交后丢响应、读回失败、双击和离开再返回，证明模型已保存时恢复只绑定、未知先读回、无重复 POST/PUT、无隐式 Test 或 Work 创建，旧回调不清理新输入或释放新锁。（ONBOARD-002/003、SUI-005/006）
- [x] 5.4 完成首轮准备页真实组件状态、手动刷新互斥、基础 ready/helper 降级展示、Open workbench 出口及 CoreSetup/Admin/工作台往返；同步现有中英文 README/部署说明中确受按钮与步骤变化影响的操作文字；验证：浏览器覆盖等待、失败/重试、实际就绪、离开后恢复、未保存保护与只读诊断，命令/链接和双语步骤一致。本轮完成出口策略及反馈由 7.1 修订。（ONBOARD-003/004、UIL-SETUP-001）

## 6. 构建制品与跨组件验收

- [x] 6.1 从已完成的实现与生成资源执行 make build、make test 及两端浏览器入口，并核对源码/嵌入资源/hash；验证：生成无遗漏，node scripts/check-native-boundary.mjs、node scripts/check-repository-docs.mjs 和受影响 quickstart 检查通过，统一二进制与可选 CLI/独立 Console 均取得本版控件资源。（UIL-SETUP-001、CADM-004）
- [x] 6.2 用隔离安装及当前实际构建二进制监听 0.0.0.0，通过实际非回环 IP 完成授权创建、登录、单次继续、Admin 和工作台路径；验证：保留缺失 Docker 时可配置的场景，并用可用真实 Engine 完成固定发行依赖准备、打开工作台及显式创建 Work；记录实际 Engine/平台，合成配置不触发付费模型请求，无公网/DNS或宿主升级前置，清理只针对本次安装。（ONBOARD-002/003/004、SERVE-RUNTIME-RELEASE-001）
- [x] 6.3 对实际构建的 CoreSetup、Admin 和代表性 Desktop 入口做桌面/360px、键盘/焦点、同角色控件各状态、长名称与错误的视觉核对；验证：修正可见错位/裁切/状态遗漏，必要截图及执行事实归本 change 附件，临时日志放 dist/，不含真实密码/Key/证明；openspec validate align-core-setup-and-admin-ux --strict 和 git diff --check 通过，明确未测范围后才勾选完成。

## 7. 首次使用反馈：准备完成出口与账户菜单

- [x] 7.1 调整 CoreSetup 第 4 步：等待时显示 Preparing Piwork…、可见等待指示、当前准备项及请稍候/自动更新说明；只有同一有效快照的 status.ready 和 preparation.ready 均为 true 才显示 Piwork is ready、完成该步并启用 Open workbench；移除底部 Change model、Review Runtime in Admin，保留顶部 Admin、手动读取和只读诊断。区分 pending/preparing、基础 ready 但 helper 未完成、retrying、failed 和读取中断，不伪造下载百分比/预计时间，不强制导航或改变 Core 准入。验证：更新 apps/desktop-webui/test/onboarding.test.ts 中旧基础 ready 即突出出口的用例，覆盖上述各状态、缺少准备数据、自动轮询到全部 Ready、就绪后回退、不可激活出口的鼠标/键盘行为、明确点击后进入、导航返回和底部两项不存在；保存后不产生额外模型/Runtime 写入、模型调用或 Work 创建。（ONBOARD-003/004、UIL-SETUP-001）
- [x] 7.2 对齐托管 Desktop 账户下拉的 Administration、Core setup：复用原菜单行外观、前置图标、文字起点、padding 和 hover/focus；保留账号标题、Role/Core 次级信息、真实 href、管理员可见条件及 Sign out 危险角色，并让链接参与菜单项键盘遍历/激活。验证：对应浏览器场景核对四个命令的计算样式、图标与基线；方向键/Home/End 可到达两个链接并正确导航，Tab/Escape 和外侧关闭保持既有焦点规则；普通用户无管理入口，独立 CLI Desktop 的切换 Core/浏览器授权动作保持，360px 长身份信息不横滚。（UIL-SETUP-001、DUL-007、DUL-OVERLAY-ROLE-001）
- [x] 7.3 对本轮改动重新构建两端 WebUI 与统一二进制并核对嵌入资源/UI 输入 hash，执行受影响的 onboarding/Desktop 菜单浏览器回归；用隔离安装、通配监听和实际非回环 IP 核对完整准备后显式进入 Piwork、顶部 Admin 往返与账户菜单，真实 Engine 路径确认基础及完整交付 ready。验证：保留准备中/全部 Ready 与账户菜单的 1440px/360px 代表截图，必要执行事实归本 change 的验收附件，未测范围如实标明；仅在现有双语说明确受入口条件影响时成对同步，运行仓库文档检查、受影响 quickstart 检查、openspec validate align-core-setup-and-admin-ux --strict 和 git diff --check。使用合成凭据与模型、无公网/DNS/付费模型调用或宿主升级前置，清理只针对本次 installation ID，不改写已发布制品身份。（ONBOARD-003/004、UIL-SETUP-001）
- [x] 7.4 修复 verify 发现的保存恢复告警：Runtime 绑定明确失败后切换新增模型，新模型的保存失败或未知结果不得复用上一链的 Runtime 目标；按当前链的实际阶段归类错误，未知模型先读回，确认后仅显式继续绑定。验证：真实统一程序通过通配监听与实际 IP 的浏览器回归覆盖新模型明确拒绝、已保存后响应丢失和读回暂时失败，确认字段反馈、读回解锁、绑定新引用及无重复 POST/PUT、隐式 Test/Work；重建嵌入资源和宿主程序，核对本地制品身份及相关一致性检查，验收事实追加记录并保留历史附件。（ONBOARD-002/003、任务 5.3）

## 8. Admin 内快速配置与顶栏 UX

- [x] 8.1 接入托管 Admin 的 /admin/setup，将 Quick setup 作为 Overview 下的可见任务入口，更新 Desktop 的 Core setup 快捷链接；保留 /setup 的首次授权/创建管理员及已初始化身份兼容分流、/login 和原 Runtime/AI models 等管理深链接，不新增平级工作区。验证：更新 internal/webapp 及 onboarding 浏览器路由/授权用例，覆盖首次创建后普通登录继续、已登录管理员旧 /setup、直接深链接、刷新/前进后退、普通用户拒绝与真实待配置方向；服务端仍校验管理员，未发生隐式写入或重开 bootstrap。（ONBOARD-002/004、UIL-SETUP-001）
- [x] 8.2 将登录后模型/准备内容从独立身份页面解耦为 Admin 可挂载的快速配置流程，复用现有字段、Test、顺序保存与读回状态；显示模型/准备两步，外层沿用 Admin 1100px 轨道、内部约 640px 单列，不嵌套顶栏。验证：扩展真实程序浏览器用例，覆盖空/已有/不可用模型、已配置安装显式换模型、未改变模型及发行值只读继续、部分成功、未知写入/暂时读回失败、任务 7.4 的换模型恢复、离开/返回/身份失效的晚回调与锁；确认无额外 Test/Work/重复 POST/PUT，准备等待、完整 Ready 门槛及移除底部两项保持。（ONBOARD-002/003/004、SUI-CFG-002、UIL-SETUP-001）
- [x] 8.3 将 Admin 中含 About Piwork 的账户下拉对齐 Desktop 锚定命令菜单，统一头像触发、身份层级、实际 Core 信息、菜单行/图标/字阶及危险 Sign out；复用轻量样式和行为，保留托管/独立 Console 各自会话及现有 About 内容。验证：Console/Desktop 对应浏览器用例核对计算样式和图标/文字基线、长身份/360px、方向键/Home/End/Enter/Space、Tab/Escape、外侧关闭保留原目标与焦点、跨界拖选、路由/身份变化关闭、注销等待/失败；确认无遮罩、焦点陷阱、动画或 Desktop 专属动作泄漏。（UIL-SETUP-001、DUL-007、DUL-OVERLAY-ROLE-001）
- [x] 8.4 将托管 Workbench 从追加普通按钮改为头像左侧带图标的紧凑轻量导航链接，保留真实工作台 href、修饰键/新标签语义和未保存离开保护；顶栏导航与准备结果区全部 Ready 后的主动作分开。验证：浏览器覆盖各 Admin 页、Quick setup 模型/准备状态、鼠标及键盘导航、草稿 Save/Discard/Keep editing、1440px/360px 的位置/尺寸/focus 与无横滚；未全部 Ready 时完成区出口仍不可激活，顶栏沿原全局访问规则，独立 Console 不出现错误工作台目标。（UIL-SETUP-001、ONBOARD-003/004）
- [x] 8.5 集成构建与验收：按第 8 节路由和操作实际变更成对同步现有双语安装说明/示例，重新构建两端 WebUI、嵌入资源与宿主程序并核对 UI 输入 hash 和同组本地制品身份。验证：执行受影响 Go、onboarding、Console 及 Desktop 菜单浏览器检查和构建脚本测试；使用隔离安装监听 0.0.0.0、实际非回环 IP 和真实 Engine 完成身份入口到 Admin Quick setup、完整 Ready 后显式进入工作台、Admin/Workbench 往返；保留桌面/360px 代表截图并在 acceptance.md 追加实际事实及未测范围，旧证据/发布身份不覆盖。运行 native-boundary、repository-docs、受影响 quickstart 检查及其测试、OpenSpec 严格校验与 diff 空白检查；仅用合成凭据和模型，无公网/DNS/付费模型请求或宿主升级，清理仅针对本次 installation ID。（ONBOARD-002/003/004、SUI-CFG-002、UIL-SETUP-001）


## 9. verify 导航竞态与配置入口文案

- [x] 9.1 修复 Save and continue 后准备读取的迟到回调：离开意图绑定本次挂载、身份和导航代次，销毁或新意图使旧回调失效；保留正常保存后离开和未知结果只读恢复。验证：浏览器延迟保存后 onboarding 读取，先切换其他管理页或返回新的 Quick setup 草稿，释放旧响应后保持新路线、输入及锁，模型/Runtime 各保存一次，无隐式 Test/Work；正常保存后离开继续有效。（ONBOARD-003/004、任务 8.2/8.4）
- [x] 9.2 将托管 Desktop 账户菜单与 Admin 的同一配置入口统一为 Quick setup，均指向 /admin/setup，完整 Runtime 的独立操作明确命名 Review runtime；保留 CoreSetup 品牌与原管理深链接。同步当前 delta/design、相关测试与必要双语材料，重建两端嵌入资源和宿主程序，校验同组本地候选身份，追加实际验收证据且保留历史记录。验证：菜单文案/链接及键盘、受影响浏览器与 Go/脚本检查、通配监听/实际 IP、必要真实 Engine 验收和 OpenSpec 严格校验通过；不发布镜像或重启用户安装。（UIL-SETUP-001、ONBOARD-002/004、任务 8.5）
