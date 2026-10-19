# Proposal

## Why

统一 Linux 应用已经提供首次设置与远程工作台，需要将首次配置整理为可恢复的用户路径，并补齐创建管理员的密码二次确认、真实等待反馈及 Desktop 控件语言。后续使用反馈进一步要求：把登录后的 CoreSetup 收进 Admin 作为 Quick setup，让快速配置和日常管理共用导航，同时对齐 Admin 账户菜单与 Workbench 入口。

## What Changes

- 保留 CoreSetup 的快速配置职责和 Admin 管理区，沿用 Desktop 现有 Logo、浅色语义令牌、按钮角色、图标、字阶及交互状态；修正托管工作台 Sign in 的样式。首次授权、创建管理员和登录保留独立入口；登录后的配置使用 Admin 内的 Quick setup，外层沿用管理页轨道，内部保留单列任务表单。
- 以用户目标组织首次路径：设置授权 → 创建管理员 → 登录 → Admin / Quick setup → 配置模型 → 准备 Core → 打开工作台；读取持久状态继续缺失步骤，提供明确的返回、等待、失败与恢复。Quick setup 从 Overview 进入，支持首次配置和后续显式更换模型，不新增平级顶层工作区；旧 /setup 链接按身份兼容进入对应入口。
- Create admin 增加 `Password`、`Confirm password`，保留至少 12 字符要求；确认框失焦或提交时校验一致，错误贴字段并阻止创建。确认密码只用于浏览器校验，不扩展 bootstrap API 或普通登录。
- 模型阶段按目录状态展示添加或选择，提供一个主动作 `Save and continue`，顺序保存模型与绑定 Runtime；分别保留两步已确认事实，后一步失败只恢复后一步，未知结果先读回。模型 Test 保持显式、可选，失败不阻止合法保存。
- 准备阶段显示实际 Docker、Agent/上下文及 helper 状态，等待期间使用 `Preparing Piwork…` 和当前准备项，明确提示请稍候及页面自动更新；重试、明确失败和读取中断分别给出原因与恢复方向。只有基础 Work readiness 与完整交付状态均 Ready 才显示 `Piwork is ready` 并启用完成区的 `Open workbench`，基础 Ready 而 helper 未完成时继续等待。Admin 内的流程只呈现模型和准备两步，不要求重走账号创建；准备页底部不恢复 `Change model`、`Review Runtime in Admin`，管理导航、状态读取和只读诊断保留。
- Desktop 账户下拉保留账号、Role 与 Core 信息；`Administration`、`Quick setup` 与 `About Piwork`、`Known operations` 使用相同菜单行样式、前置图标及键盘规则，导航继续使用链接语义，权限边界保持。
- Admin 中包含 About Piwork 的账户下拉采用 Desktop 的锚定命令菜单 UX：身份分层、图标和菜单行对齐、危险 Sign out、方向键/激活/Tab/Escape 及外侧关闭行为一致。托管 Admin 的 Workbench 使用带图标的轻量链接，固定在头像左侧，遵守草稿离开保护；准备区完成按钮与顶栏导航保持各自职责。
- CoreSetup、Admin Runtime 和默认 Work 表单不再突出展示长镜像地址及新旧镜像对比，镜像仅作为按需只读诊断；CoreRuntime 的 Agent 引用固定来自服务端同版内嵌发行信息。
- **BREAKING**：移除 operator `config set --agent-image`，在线、离线和管理员 Runtime API 不再允许选择全局 Runtime 镜像。Runtime 写入支持省略镜像；旧 HTTP 字段仅允许与服务端内嵌引用相同，不同值原子拒绝。已有持久 Runtime 不因启动或读取自动迁移，已有 Work 保留独立配置。

## Capabilities

### New Capabilities

无；复用现有能力与组件规范。

### Modified Capabilities

- `web-onboarding`：密码二次确认、Admin 内 Quick setup、旧入口兼容、顺序保存与恢复，以及全部依赖 Ready 后的完成出口和明确等待反馈。
- `ui-language`：CoreSetup、Admin 与 Desktop 采用同类控件的完整视觉及状态规则；Admin 账户菜单和 Workbench 导航对齐，Quick setup 保留管理外层轨道与内部单列任务布局。
- `serve-ui-configuration`：Quick setup 与完整 Runtime/AI models 管理共享配置事实、校验及恢复；Runtime 和默认 Work 镜像信息仅按需诊断，不成为用户配置项。
- `core-admin-api`：Runtime 写入由 Core 解析固定发行镜像，支持无镜像参数输入，收紧旧镜像字段兼容规则。
- `serve-control-plane`：operator 在线/离线 Runtime 设置使用固定发行镜像，移除旧镜像覆盖参数并保持凭证与未知结果边界。
- `core-service-startup`：全局 Runtime 配置及运维示例与固定发行镜像契约一致，保留持久配置读取、恢复和已有 Work 隔离。

## Impact

- 浏览器：`apps/console-webui/src/onboarding.ts`、`app.ts`、`model-management.ts`、`components.ts`，两端 `public/style.css`、首次设置 HTML、Desktop 托管登录和账户菜单入口及 `apps/ui-shared/`。将登录后配置流程与独立身份入口解耦，接入 Admin 路由和壳；状态、表单与菜单规则复用，不新增进度 API、UI 框架或 Agent CoreFlow 调度。
- 服务端及契约：`internal/webapp/`、`internal/consoleapp/`、`internal/coreapp/`、`internal/coreoperator/`、`internal/distribution/`、`packages/contracts/` 与对应 Go 生成契约。
- 构建：WebUI 静态资源复制、Go 嵌入资源及输入 hash；若新增共享控件文件，同步构建输入覆盖，保持原生与 Docker 制品可核查。
- 验证：浏览器状态/操作测试、Core/operator 契约及持久化测试、真实统一入口的通配监听与实际 IP 访问、桌面/360px 视觉和键盘核对。使用隔离安装及合成凭据，不要求公网测试或真实付费模型调用。
- 文档：实施时同步受移除参数、Quick setup 路径和引导操作影响的现有双语 README/部署说明及示例；旧验收附件保留其实际路径和制品身份，后续实施追加证据，不发布或推送镜像。
- 固定范围是全局 CoreRuntime；现有 Work 高级配置、operator 默认 Work 独立配置、helper 高级参数、Service 访问隔离及 Linux 部署边界沿用现行契约。
- 全部 Ready 的完成条件只约束 CoreSetup 准备页的完成出口，不改变 Core 的基础 Work 准入、各 helper 能力判定或已有安装工作台的降级访问规则。
- Quick setup 整合针对统一应用的托管 Admin；高级独立 Console 保留原有管理入口并复用菜单视觉与行为，不展示无对应工作台目标的 Workbench 链接。
