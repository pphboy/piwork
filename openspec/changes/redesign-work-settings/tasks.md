# Tasks

本次修订以 [v5 原型](prototype/index.html) 为界面与交互基线，并补齐用户目录直接导入。1—4 的勾选与下方记录仅表示前轮范围内已实现、已运行的检查，不代表新增路径已完成；第 5—6 组全部完成并取得新证据前，本变更不得视为完整交付。仅更新规划不勾选新增任务。

## 1. 编辑契约与 Desktop 传输

- [x] 1.1 在 `packages/contracts/src/work-settings.ts` 定义 design 中的编辑读取/增量保存 DTO，导出并接入现有 HTTP 生成链，保留原配置/重选 schema；添加省略与空值、重复/冲突目标、路径、文本及请求预算契约用例。验证：`npm run test:unit -w @piwork/contracts`、`make generate` 与 `go test ./internal/contracts`，确认生成 DTO/schema/夹具同步且无 Agent RPC 或存储格式变化。
- [x] 1.2 在 `internal/cli/user_desktop_control.go` 为 editor/read POST 与 editor PATCH 增加精确路由和字段白名单，沿用 2 MiB 受限输入、身份/CSRF 与 generation 边界；让前端把 POST 内容查询按只读动作处理，不创建 Operation。验证：扩展 `user_desktop_control_test.go` 的方法、原 Work、输入转发与非法字段用例，执行 `go test ./internal/cli ./internal/webapp`，覆盖独立和托管入口。

## 2. Core 自有文件与原子 context 发布

- [x] 2.1 实现所有者 Content 授权下的一致读取：从同一次配置记录绑定 desired 文件列表与明确请求的文本，保留 runtime 的真实观察来源；不扩大全局发现响应。验证：Core 端点用例覆盖所有者、其他普通用户、非所有者管理员、operator、路径逃逸/符号链接、非法 UTF-8、二进制/超限文件、缺失与损坏 context；执行相关 `go test ./internal/coreapp ./internal/workaccess ./internal/skillartifact`，拒绝时无私有内容或宿主路径泄露。
- [x] 2.2 在 `internal/workcontext` 增加保留已有 Skill sources、只捕获显式新增项并应用既有文本编辑的发布路径，复用完整树校验、identity 重建、包/镜像保留与不可变目录发布；不改旧 builder 的重选语义。验证：直接包测试证明同名不同内容、Core 禁用/删除、增删其他 Skill、未改二进制资源、元数据一致性与失败 candidate 清理；执行 `go test ./internal/workcontext ./internal/skillartifact`。
- [x] 2.3 实现 editor PATCH：将本次 `addSkills/removeSkills/skillFiles/agentsMd/packageFlags` 合入最新 desired，复用现有提交顺序竞争和发布前所有者/身份复核；只更新显式字段，包开关不安装或移除制品。验证：Core 端点测试覆盖两文件加 AGENTS 同时保存、任一非法目标整批失败、隐藏字段/导入镜像保留、无关并发字段保留、重复添加不刷新、旧完整 PUT/显式重选行为保持；执行相关 `go test ./internal/coreapp`。
- [x] 2.4 扩展现有 Native Skill/配置 integration 场景验证新文件 bytes 经真实 SDK 加载而非只构造 DTO：保存不影响 active；同名改文件仍待应用；原 Apply 只使用其捕获内容，后保存仍保留；无效 Skill Apply 回退及 stopped 验证保持。验证：通过 `scripts/run-core-integration.mjs --targets NAME,...` 运行对应新增/扩展场景，至少回归 `TestNativeSkillsUseIndependentCopiesAndExplicitReselection`、`TestNativeWorkConfigurationOrderingScopeAndMixedStateRecovery` 和相关 Skill 失败/恢复场景，保留该运行的真实结果与 partial 标识。

## 3. Settings 草稿、页面与反馈

- [x] 3.1 将 Settings 的草稿改为允许编辑字段与按 Skill/相对路径定位的文件编辑，移除其对 `advanced` JSON 的可写依赖；保存只提交明确增量，响应只确认捕获内容，不覆盖更晚输入。验证：更新 `configuration.test.ts` 并直接测试新增窄模块，覆盖跨分类/多文件、显式空 AGENTS、撤回、更晚编辑、原 Work 镜像及隐藏字段保持；执行 Desktop typecheck 与对应 browser/unit 测试，不以入口源码正则代替行为验证。
- [x] 3.2 接入添加 Skill 的独立提交：只发送新增名称，确认后并入已保存基线并立即打开 Work 文件；原未保存 AGENTS、其他文件、包开关与未提交移除保留，添加失败/未知按原目标只读检查。验证：adapter/浏览器回归覆盖添加时存在草稿、添加等待中保留原草稿（弹窗行为以 7.1 为准）、重复名称、Core 部分失败、同名自有副本保持及身份/Work 切换晚响应。
- [x] 3.3 将 Settings 收敛为三分类、分类内对象列表和编辑区文件选择器，AGENTS 直接编辑；Skill 菜单显式绑定 Work/Skill，仅保留详情及移除，提供当前未保存移除的局部撤销。删除 Work Settings Advanced、JSON 导入及 Core 副本替换的渲染、动作和无消费者文案；不改 New Work Advanced。验证：浏览器从真实 Settings 路由完成分类/对象/文件切换、草稿保留、详情/移除/撤销、AGENTS 导入、鼠标及 Arrow/Home/End/Enter/Tab/Esc、返回与脏表单保护。
- [x] 3.4 使用当前文件确认基线、共享草稿、Core `pendingApply`、原 Operation 和已验证 runtime 分别投影状态，复用现有 ActionState/Settings 读取/notice 模块；等待留在原控件，已确认解决的旧失败仅退休呈现，未知锁及运行恢复失败保持。验证：直接状态模块及浏览器回归覆盖未保存+待应用、当前文件已保存但配套文件未保存、内容相等而后端仍 pending、`active=null`、stopped/不可达、已知失败撤回、未知响应/关联读取失败、检查状态不重发与不覆盖后续编辑；执行 `action-state`、`read-feedback`、`final-acceptance` 相关测试。
- [x] 3.5 将既有 Pi Package 的 Core/npm/Git/本地目录/ZIP 安装、来源更新、启停/移除及 Operation 反馈接入新布局，保留脑包候选/checks、真实 loaded/modelVisible、日志和 Files 源码跳转；不把这些操作改为原型内存安装队列。验证：回归原 Package 来源/失败/未知、Apply 与后编辑交错、候选晚返回及取消脏表单离开，确认原接口与原任务 ID 保持。
- [x] 3.6 在实际双语源与现有样式中落地 v5 文案和密度；无真实元数据时省略说明/版本，正常一致状态轻量，必要错误持续可达，单任务主动作与统一三点保持。验证：中英文的正常/等待/失败/未知及菜单长文案，在 1440px、360px 和低高度窗口可读、无横向溢出；状态切换不推动正文，焦点与 reduced-motion 行为沿组件约定；执行 `node scripts/check-ui-language.mjs`、`node scripts/check-webui-boundaries.mjs` 及相关浏览器入口。

## 4. 跨层验证与资源交付

- [x] 4.1 使用真实 Core 与当前浏览器入口完成“已有草稿 → 添加 Skill（仅新增保存）→ 编辑 SKILL.md/配套文件 → 保存全部 → Apply → 停止/重启”的闭环，核对当前 runtime 实际内容及 Core/其他 Work 隔离；复用现有 `.work` 导出/导入路径验证编辑后 context 原样保留。验证：扩展既有 real-core/Native 场景，经统一 integration runner 留存真实输出；清理只针对本次精确 installation/scope，不使用全局 prune，不把原型计时结果当证据。
- [x] 4.2 从 source 构建并同步 WebUI 内嵌资源，重建宿主 Core/CLI，验证独立与托管路由、CSP、模块导入和新 DTO 接口可用；只使用原生成链，不手改 embedded/generated 或冻结原型。验证：`npm run typecheck -w @piwork/desktop-webui`、`npm run test:browser -w @piwork/desktop-webui`、`make check-generated`、`make check-generated-ui`、`make build-go`、`node scripts/check-native-boundary.mjs`。
- [x] 4.3 完成所属变更的范围与集成收尾：核对移除动作无残留消费者、原型差异未被误当产品要求、现有 CLI/API/包来源与 Work 权限未退化，并在本变更记录实际检查及未测范围。验证：适用的源风格/边界与 `node scripts/check-repository-docs.mjs`、`git diff --check`、严格 OpenSpec 校验；所有任务以实际证据完成，不把选择性 integration 结果称为全量通过，不自动归档、提交或发布。

## 5. 按原型补齐 Skill 添加

- [x] 5.1 按 WCFG-EDIT-009 实现 Work 所有者目录导入与原子新增：复用既有 multipart/Skill 树校验和 Content 授权，将上传树直接合入最新 Work desired，不创建 Core catalog；保留已有内容、隐藏字段、active 和旧接口。验证：相关 Core/workcontext 单元及端点测试覆盖普通所有者、非所有者管理员/operator、发布前身份失效、同名拒绝、非法路径/超限/中断清理、并发无关字段保留及全局目录不变，执行相应 `go test ./internal/coreapp ./internal/workcontext ./internal/skillartifact ./internal/workaccess`。
- [x] 5.2 在现有 Desktop 传输中增加设计定义的精确 Work 目录导入 multipart 路由与确认响应，复用已有上传、CSRF、身份/generation 和限额；JSON 编辑仍受 2 MiB 预算约束，不放宽为全局通配代理。验证：CLI/webapp 契约覆盖路径、方法、目标 Work、multipart 内容转发、未授权与超限、身份切换晚响应；执行 `go test ./internal/cli ./internal/webapp`，必要协议生成物沿原链同步。
- [x] 5.3 按原型对齐 Settings：保留三分类、Work 对象列表与搜索、标题旁添加按钮、紧凑工具栏、编辑区文件选择、对象菜单及手机对象选择；空态有可点击添加动作，Core 候选移入勾选弹窗；原 Package 与 AGENTS 功能继续可达。验证：浏览器实际点击按钮、搜索/选择对象、打开/关闭弹窗及选择文件，核对焦点/键盘与 1440px、360px 布局；只使用真实元数据，缺字段不造示例信息，不以源码存在字符串或静态截图替代交互验证。
- [x] 5.4 在同一添加弹窗接入 Core 多项勾选和本机单目录导入，显示所选目录名称/文件数/大小并预检查，确认后才提交；成功选中新副本并打开 SKILL.md，保留其他草稿。修正空目录、全部已添加、搜索无匹配及读取失败文案；Core 为空/失败仍可导入本地目录。验证：定向浏览器覆盖两种来源、取消无请求、同名/非法目录、原位上传等待、明确拒绝与结果未确认不重传、未保存 AGENTS/包开关保留、身份/Work 切换；执行 Desktop typecheck、相关 browser/unit 测试和 UI 语言检查。

## 6. 修订后的跨层验收

- [x] 6.1 在独立合成安装，以 Core Skill 目录为空、普通所有者 Work 无独立 Skill 为起点，从真实浏览器完成“添加按钮 → 本机目录 → 确认 → 自动打开 SKILL.md → 编辑正文/配套文件 → 保存 → 显式 Apply → SDK 实际读取 → 停止/重启后再次读取”。验证：通过既有 integration runner 保留本次真实结果；证明 Core catalog、其他 Work 和原 active 在采用前不变，其他本地草稿不被保存；另覆盖有 Core 候选时的弹窗勾选，不能预先灌入 Core 示例来替代空目录场景，不对用户现有安装注入验收数据。
- [x] 6.2 从 source 同步 WebUI 内嵌资源并重建 Core/CLI，核对托管与独立 Desktop 的实际路由及原型关键操作；仅当 5.1—6.1 完成后更新本轮验收事实。验证：执行 `make check-generated`、`make check-generated-ui`、`make build-go`、Desktop browser 入口及适用 native/UI/boundary 检查，运行仓库文档、diff 和严格 OpenSpec 校验；记录实际通过/失败/跳过范围，不沿用前轮全部完成或零问题结论，不自动切换现有服务、归档或发行。

## 7. Settings 弹层与交互回归

- [x] 7.1 Add Skill 复用原生 Modal，提交中保持同一弹窗，关闭时归还焦点；Skill Details 从菜单切换到独立锚定浮层，Package Details 窄屏使用全屏模态。验证：桌面和窄屏打开、滚动、Tab/Esc、关闭及延迟提交。
- [x] 7.2 精简 Add Skill 来源文案、错误与等待；安装或更新包按来源输入启用提交，复用原上传和确认逻辑。验证：浏览器回归两种 Skill 来源、上传拒绝和结果未确认，以及包来源切换和提交准入。
- [x] 7.3 使 Skill 工作列表与无匹配提示由同一次过滤渲染，复用现有响应式控件；同步 Desktop 内嵌资源。验证：浏览器覆盖匹配、无匹配、清空搜索和窄屏选择，运行适用 UI、生成物与 OpenSpec 检查。

第 7 组验证：`app.ts` 的 Settings 列表、弹窗渲染、动作与焦点恢复、`public/style.css` 和双语文案为本轮变更边界。浏览器 28 项定向回归和 54 项弹窗/控件/草稿检查均通过，覆盖 1440×680、360×580、延迟提交、目录失败/未知与包来源准入。Desktop TypeScript 构建和测试编译、样式、语言、WebUI 依赖、文档、`check-generated-ui`、`build-go`、资源字节核对通过。浏览器复现及回归使用合成数据，本轮未运行全量浏览器或真实 Core 导入集成。

## 8. Skill 添加结果核验回归

- [x] 8.1 修正 Desktop 添加成功后的文件选择和目录导入结果核对。直接选中 SKILL.md；只读发现同名副本时更新当前事实并保留原目录导入未知结果和写入保护。验证：浏览器覆盖 README.md 排在前面、丢回执且已存在同名副本、关闭弹窗后核对 Core 名称添加，核对不重传且草稿保留；同步双语与内嵌资源。
- [x] 8.2 将空 Core 目录的本机导入真实浏览器集成改用普通 Work 所有者。验证：执行原目录导入、编辑、Apply、SDK 读取、重启及归档往返，核对 Core 目录为空和另一 Work 保持不变。

第 8 组验证：22 项定向浏览器回归及 16 项草稿测试通过；Core 来源与普通所有者本机导入的真实浏览器/SDK 往返 2/2 通过。通过 Desktop 构建、测试编译、双语和依赖边界检查、源码风格、文档、严格 OpenSpec 校验与嵌入资源同步和 Go 构建。仅运行与本轮相关的测试，未重跑全量浏览器或 Native 场景。

## 前轮验证记录（不覆盖本次修订）

- 2026-11-15：`npm run test:browser -w @piwork/desktop-webui` 全量 1700 项，1684 pass、2 skipped、14 fail；14 项均因本机 `/usr/bin/chromium` 不存在而无法启动浏览器（2 个用例 + `pending-dots` 的 12 个子测试），非代码失败。Settings 相关套件（feedback、recovery、final-acceptance、compact-work-controls、navigation-review-regressions）全部通过。
- 2026-11-15：真实 Core integration `scripts/run-core-integration.mjs --prepared --targets ...` 5/5 PASS，覆盖 editor 保存、待应用、Apply 后 SDK 实际读取、停止/重启与原有重选/失败恢复场景；为 partial 选中运行，不代表全量 integration。
- 2026-11-15：`make build-go` 在本 worktree 因 `-buildvcs=true` 与 worktree VCS 状态冲突；临时改为 `-buildvcs=false` 后构建成功，脚本已恢复，未提交该临时修改。
- 2026-11-15：`openspec validate redesign-work-settings --strict` 通过；`check-generated`、`check-generated-ui`、`check-ui-language`、`check-source-style`、`check-native-boundary`、`check-repository-docs`、`git diff --check` 通过。
- 2026-11-15：real-core 场景已补充 `添加 Skill → 编辑 SKILL.md → 保存 → Apply → 停止/重启 → .work 导入后读取`，但本机运行在 Core readiness 前失败：`defaultContext` 持续 `CONTEXT_PREPARATION_FAILED`（RUNTIME_UNAVAILABLE），与 Settings 代码路径无关；未取得 4.1 真实通过证据。
- 2026-11-15 当时未测：4.1 的真实 Core 浏览器 `添加 Skill → 文件编辑 → 保存 → Apply → 停止/重启` 闭环及 `.work` 导出/导入还原；现有 real-core 场景仅覆盖既有配置保存/Apply。
- 2026-11-16 继续 apply 复查：重新打开 3.3/3.4/3.6；当前 Settings 仍用单一优先级覆盖组合状态，未单独呈现当前文件保存事实，菜单可见标签/紧凑等待还需回归。剩余真实 Core 用例的准备失败已复现为测试子进程继承 umask 077，使合成 helper 输入权限不符；仅在隔离 fixture 子进程恢复预期 022，不改产品权限或生产启动。

- 2026-11-16：复查后补齐独立保存/应用状态、逐文件确认状态、未知提交的原字段/bytes 核对及读取后的缓存基线；已知失败撤回只退休呈现，原未知锁与运行恢复失败保留。Skill 文件按需读取，编辑框按 Work/Skill/路径定位，文件切换不复用上一文件的 DOM 值。菜单显式绑定 Work/Skill，去除普通保存成功通知。
- 2026-11-16：最终针对性浏览器/状态回归 18/18 PASS；另一次 Settings/Skill 针对性运行 39/40，其中发现的文件切换 DOM 值问题已修复并由最终回归复核。1440px/360px、中英文、600px 低高度与 reduced-motion 检查通过，截图在被忽略的 `dist/work-settings-browser-evidence/`。
- 2026-11-16：`go test ./internal/coreapp ./internal/workcontext ./internal/workaccess ./internal/skillartifact ./internal/contracts ./internal/cli ./internal/webapp` 全部通过；使用标准 umask 022 与本 worktree 的 GIT_DIR/GIT_WORK_TREE，未关闭 VCS stamping。补齐已移除 configuration.js 的嵌入测试消费者、完整树 identity 校验、9 个 Skill 的同批读取与重复目标拒绝；读取缓存只保留明确请求的文本，沿用总量预算。Contracts 单元 58/58 PASS。
- 2026-11-16：真实 Core 浏览器闭环已接入 Native integration runner。默认 npm 镜像源 DNS 无法解析，本机使用被忽略的临时 Docker wrapper 仅向现有 Dockerfile 传入 `NPM_REGISTRY=https://registry.npmjs.org`；不修改产品或构建默认。首次准备期间仍有源码修正，runner 正确拒绝 source identity 变化，结果为 0/0 未执行；重新以冻结源码准备与运行。全量浏览器需在资源重建完成后执行，4.2 暂重新打开，旧的部分通过记录不代替最终结果。

- 2026-11-16：真实 Core 完整闭环 `dist/work-settings-editor-roundtrip-complete/result.json` 为 partial 选中运行，1/1 PASS（74s）。经真实浏览器添加 Skill、只提交新增名称、保留 AGENTS 草稿、修改 SKILL.md 与配套文件、保存全部、Apply、首次及重启后新 Run SDK 内容哈希核对、UI 导出 PIWORK2 归档（153634091 bytes）、UI 导入为 stopped Work、启动后新 Run SDK 内容核对；父场景确认其他 Work 的旧副本与 Core 当前副本保持。另一次 `dist/work-settings-editor-integration-browser/result.json` 中既有三个 Native 回归均 PASS；当次第四项是验收脚本的旧链接角色/旧格式/本机文案假设，修正后由完整闭环复核。均不代表全部 514 个 Native integration 场景通过。
- 2026-11-16：统一 runner 在 worktree 编译测试二进制时缺少 Git 目录环境；本机忽略目录中的临时 Go wrapper 仅传入实际 GIT_DIR/GIT_WORK_TREE，保留 VCS stamping。未修改 runner、构建默认或生产启动。最后针对性回归另 8/8 PASS，覆盖未知 Apply 不被普通配置 GET 解锁、未知新增、stopped 运行观察及 UTF-8/编码请求预算。

- 2026-11-16：最终状态收尾发现并修复“移除含文件草稿的 Skill 后保存仍为 dirty/仍有 Undo”问题：全局文件脏状态只覆盖当前选择，Undo 绑定当前 Work、仅针对仍在已保存基线中的本地移除，原移除请求等待/未知期间禁用。相关移除、未知保存、文件组合状态与双语密度回归 12/12 PASS。此前全量浏览器运行中断后重新从生成资源构建与宿主构建开始，未把中断结果算作全量通过。

- 2026-11-16：文件缓存补充合法特殊键的自身属性检查（如 Skill `constructor` 与文件 `__proto__`），避免继承属性被当成已读取文件或修改全局对象。当前目标读取、文件文本与基线分别通过窄 helper 查询，写入使用自身计算属性。包含特殊名称编辑保存、移除保存及未知保存的回归 9/9 PASS。为核对最终源版本，重新执行 4.1 与 4.2；不复用旧测试结果冒充当前源版本验证。

- 维护边界：主要读取 `app.ts` 的动作分派（600–750）、Settings（2390–2480）、草稿读写（3196–3350）、设置动作（4418–4555）、反馈/输入与 DOM reconcile（4890–5445、6049–6110，行号为调查时范围），以及 `adapter.ts` 的编辑端口（2905–3000）、`settings-draft.ts`、`settings-read-feedback.ts` 与相关测试；Core 读取/保存 coordinator、`workcontext/editor.go` 与 Native fixture/Work package 当前格式沿直接消费者核对。允许编辑字段/本地文件基线归 Settings 草稿，确认事实与缓存归 adapter，未知锁归 ActionState，pendingApply/内容发布/runtime 归 Core；未新增持久前端状态或替代任务系统。
- 同步范围：DTO/schema/oracle 沿 `make generate`，WebUI 沿既有 build/copy-static/sync-desktop-assets 嵌入 Core/CLI。无部署或运行默认变化，因此不修改双语部署手册。必要的测试环境修复为 Node 24 子测试 fixture 清理时机、已移除模块的嵌入引用，以及既有 real-core 用例的当前按钮/Applied/PIWORK2 断言；未扩展为生产运行方式或协议迁移。

- 2026-11-16：最终源码对应的完整 Native 浏览器闭环 `dist/work-settings-editor-current-source/result.json` partial 1/1 PASS（172s，包含准备与执行），重新覆盖添加/原草稿/两个文件/保存/Apply/重启后的新 SDK Run/PIWORK2 导出导入/导入 stopped/启动后 SDK/其他 Work 与 Core 副本。最终 `make check-generated check-generated-ui` PASS；runner 的当前源宿主构建保留 VCS stamping 并成功。最终全量浏览器回归正在运行，未提前勾选 4.2。

- 2026-11-16：全量浏览器发现 6 个旧 Settings VM/正则截取入口函数用例缺少新依赖。按维护约定移除这些 Settings 片段执行，原断言迁到既有真实 Settings 页面 fixture：普通状态/单工具栏/窄屏对齐、原 Apply ID 与旧失败隔离、两种恢复 kind、未知 Apply 不借用旧 Operation；其余 Files/Works 旧用例不扩项。迁移后的 10 项针对性浏览器检查 PASS。这里只改测试，Native 所测产品代码与嵌入资源保持同一版本；全量浏览器重新执行，不把中断的 6 项测试错误计为最终通过。

- 2026-11-16：全量回归另定位 3 个文件/会话反馈用例：通用反馈入口无条件调用 Settings 的失败退休判断。将该投影判断限定到 `kind=configuration`，保持其他动作各自所有者及原未知锁；未修改 Core、DTO、保存/Apply 业务分支。原 Overlay/控件/读取反馈/草稿/ActionState 五组针对性测试全部通过（见 `dist/redesign-work-settings-feedback-boundary-final.log`），随后重新构建资源和宿主并执行全量浏览器。

- 2026-11-16 继续 apply：已有全量浏览器为 1721 项，1719 PASS、2 个环境相关 SKIP、0 FAIL。交付核对确认延迟选择读取时需先同步编辑器对象；相关读取缓存也不能在确认保存后回填旧文本。重新打开 3.1/3.2，沿 app 的选择/焦点与 adapter 已保存缓存边界修复，新增延迟读取回归；不增加存储、重试或新业务状态。

- 2026-11-16：新增三个延迟读取反例在修复前 0/3 PASS，分别复现旧编辑框/选择未同步、旧读取覆盖新保存缓存、添加后文件读取失败混入写入失败。修复后相关 Settings 34/34 PASS：同步选择与编辑器 DOM，Skill 标识进入焦点/节点身份；adapter 只给原已保存配置对象回填读取缓存；添加确认后的文件读取使用既有 `ActionState.refresh`。业务接口与提交时点不变，旧草稿不被读取覆盖。重新核对最终 4.1/4.2。

- 2026-11-16：三个延迟读取修复后 34/34 PASS，并覆盖读取恢复后只退休该新增 Skill 的关联读取失败通知，不重发添加、不解除未知写入。普通缓存读取不冒充新读取证明。真实 Core 再次执行 `dist/work-settings-editor-final-runtime/result.json` partial 1/1 PASS（75s）。Docker Hub 浮动标签元数据 EOF 期间，本机临时 wrapper 使用上次通过的相同 Dockerfile frontend/Go builder digest；NPM registry 同前。使用 GNU Make `-o native-compatibility-images` 复用源码未改、未选中兼容 SDK 场景的已验证镜像，实际 SDK/Core 闭环没有跳过，也未复用测试结果。记录实际 digest，未改产品默认与仓库构建脚本。

- 2026-11-16：最终源码再次通过真实 Native 闭环，`dist/work-settings-final-native/result.json` 为 partial 1/1 PASS（72s）。为与全量浏览器并行且避免清理正在使用的 JS 测试输出，GNU Make 复用刚刚通过 `check-generated-ui`、宿主构建的 UI，以及未改动的 harness/兼容镜像构建输出（`-o webui-assets -o harness-fixtures -o native-compatibility-images`）；runner 仍核验源身份/制品、重新编译 Go 场景并执行真实浏览器/SDK，未使用旧测试结果。源码和包锁未再改动。

- 最终验收（2026-11-16）：`dist/work-settings-final-browser.log` 全量 1724 项，1722 PASS、2 SKIP、0 FAIL（745s）。跳过项为显式外部 Engine 环境用例与需要隔离 X11/文件管理器的原生拖拽用例；本变更的真实 Core 保存/Apply/SDK/重启/导出导入闭环另由 `dist/work-settings-final-native/result.json` partial 1/1 PASS 验证。原有三个 Native Skill/配置回归已分别通过，未声称全部 Native 场景通过。
- 最终交付检查：`make check-generated check-generated-ui`、`make build-go`（保留 VCS stamping）、Desktop typecheck、嵌入资源 HTTP 用例、源风格/UI 文案/WebUI 依赖/native 边界/仓库文档/`git diff --check` 与严格 OpenSpec 校验均通过。Go 七个相关包及 Contracts 58 项单元验证通过。仅检查本次 10 个 installation 的容器/网络/卷，全部无残留。记录见忽略目录下 `settings-final-*`、`settings-delivery-*`；未自动提交、归档或发布。

- 2026-11-17 修复范围：仅处理 scope-guard 确认的 C1/C2/W1/W2。替换文本使用既有 editableText 校验；active 复用既有公开事实投影；真正新增 Skill 由既有构建路径校验目录；本地草稿记录自己的字段基线，刷新/确认按明确修改合并。复用原纯草稿模块，不增持久状态、公开 revision、重试或恢复 UI。W3 已撤回。重开对应任务并补定向回归、同步嵌入资源后重新验证。

- 2026-11-17：C1/W1/W2 的原 Go overlay 三个反例均转为 PASS，正式 Core/Workcontext 回归已覆盖 NUL/非法 UTF-8/超限替换的原子拒绝、非空 active 的实际响应契约、Core 禁用/删除后的重复添加及不可用新增仍拒绝。C2 的字段基线/确认/刷新及真实页面并发刷新回归通过；最新 Settings 定向运行 48/48 PASS。字段基线仅属于本地表单，根配置事实仍归 adapter/Core；变更未引入服务端 revision、同步服务或重试。

- 2026-11-17：修复后的现有反馈/状态/草稿/控件套件 136 项通过；当前三个原 Go 反例、原真实页面并发刷新反例及 W3 放弃保留 unknown 的控制流程均通过。Go 七个相关包全部通过。`check-generated`/`check-generated-ui` 与保留 VCS stamping 的 Core/CLI 构建通过。真实 Native 编辑/保存/Apply/SDK/重启/导出导入闭环 `dist/settings-fix-native/result.json` partial 1/1 PASS（74s），构建复用的未改动 harness/兼容夹具与上一轮相同，非缓存测试结果。等待最终浏览器全量后关闭 4.2/4.3。

- 2026-11-17：全量浏览器仅有一条旧 Settings 导航 VM 用例因截取入口缺少草稿构造依赖而失败；将该 Settings 用例迁至真实页面键盘/延迟加载/编辑焦点回归，验证通过，原导航其余 51 项通过。产品实现未变。重跑完整浏览器入口并再次核对源版本对应的 Native 结果，不将该旧夹具失败计为最终通过。

- 修复最终验收（2026-11-17）：`dist/settings-fixed-browser-final.log` 1730 项，1728 PASS、2 个环境 SKIP、0 FAIL（746s）。跳过项仍为外部 Engine 初始化与隔离 X11 原生文件管理器拖拽；真实 Core 另由 `dist/settings-fixed-native-final/result.json` partial 1/1 PASS（67s）完成。Go 七包、3 个原 Core 反例、原页面反例、正式基线/字段确认回归、构建/生成物/类型/边界/文案/文档与严格规格检查通过。
- C1/C2/W1/W2 均已修复并经原条件复测；W3 仍为已撤回误报，未知锁与现有放弃流程保持；S1 全局职责整理继续作为后续独立建议。本次 hygiene 只涉及既有 editor 校验/投影、实际新增名称校验、本地草稿字段基线和直接测试消费者。无新增运行配置、依赖、数据库状态、公开 revision 或恢复机制；未自动提交、归档或发布。

- 2026-11-17 W4 修复：scope-guard 判定为 DEFECT，原因是旧包数组选择动作与仅支持已安装包开关的 editor PATCH 不兼容。沿用现有 Core 安装弹窗/确认/Operation，目录项只为未安装包提供显式安装；删除旧清空/选择/取消选择动作及其无消费者文案。已安装包仍从原列表启停、更新和移除，不新增 API、队列、持久状态或批量动作。影响限定 Desktop UI、直接测试消费者与内嵌生成物；不修改 Core/代理契约，因此不扩展为新的 Engine 或 SDK 场景。

- 2026-11-17：W4 最小实现完成。Core 目录仅列未安装项，按钮明确为安装并预选已有弹窗的 Core/name；弹窗绑定原 Work，确认后仍使用原安装 Operation。已安装项使用原启停/更新/移除，删除 clear/select/unselect 包数组动作及两条双语无消费者文案。包相关定向浏览器 19/19 PASS，覆盖五来源安装/更新、确认前无写、安装请求目标与原 ID、其他 AGENTS 草稿保持；控件回归 32/32 PASS。无 Core/SDK/存储行为变更，旧 editor 对未安装包旗标的拒绝继续保持。

- W4 最终验收（2026-11-17）：`dist/w4-browser-final.log` 1732 项，1730 PASS、2 环境 SKIP、0 FAIL（746s）。定向包流程 19/19、控件 32/32、代理/嵌入资源及编辑接口拒绝未安装包旗标的回归通过；生成物、宿主、类型/风格/文案/依赖/平台/文档和严格规格检查通过。Go 校验最初与 UI 资源清理并发导致临时 embed 文件缺失，改为构建完成后顺序执行即通过，未改产品消除此工具时序问题。
- W4 复核结论：DEFECT 已修复；KEEP 原五种来源安装/更新和已安装包启停/移除的 Operation/准入/脏表单保护；SIMPLIFY Core 目录项复用原安装确认弹窗；REMOVE 无法提交的旧包数组选择/清空/取消选择及无消费者文案；DEFER S1 全局结构整理。此次仅浏览器包入口改动，未改 Core/SDK/代理协议，因此复用此前真实 Core 闭环证据，不重跑 Docker/SDK 全量。未自动归档、提交或发布。

## 本轮 apply 记录（2026-11-17，5.1—5.4）

- Core：新增 `POST /api/v1/works/{id}/configuration/skills/import`。在读取 body 前与发布事务内复用 Content 授权、身份校验和既有提交顺序；SKM-004 有界 multipart 解析提取为共享读取函数，上传树经 `skillartifact.FromFiles` 校验后仅作为该新增名称的来源合入最新 desired，已有 Work 副本优先，不触碰 Core catalog。同名返回 `SKILL_ALREADY_EXISTS`，失败清理 candidate 并保留原 desired/active。
- workcontext：`BuildWithPackagesAndEdits` 增加显式 `imports`；仅对 prior context 中不存在、且本次提供已验证快照的名称使用上传内容，已有副本和未编辑文件保持 Work 自有 bytes。
- Desktop 传输：`/_desktop/api/works/{id}/configuration/skills/import` 精确 multipart 转发，复用原有 CSRF、身份 generation、2 并发与 64 MiB body 限额；文件内容不解析，Core 独立校验。
- Desktop：Skills 标题旁常驻添加按钮、Work 对象搜索、手机对象选择器与空态添加动作；Core 候选移入添加弹窗。弹窗支持 Core 多项勾选或一个本机目录（二者互斥），显示目录名称/文件数/大小并做浏览器预检查；确认等待留在弹窗，成功后关闭并打开 `SKILL.md`，失败保留弹窗与选择，结果未确认不重试。移除常驻 Core 候选区和旧 `add-skill` 动作。
- 验证：
  - `go test ./internal/coreapp ./internal/workcontext ./internal/skillartifact ./internal/workaccess ./internal/contracts ./internal/webapp` 通过；`go test ./internal/cli` 的进程子测试受 worktree VCS stamping 影响，设置 `GIT_DIR`/`GIT_WORK_TREE` 后通过；新增导入与传输测试 `-race` 通过。
  - Desktop typecheck、UI 语言、WebUI 依赖边界、源码风格、native 边界、仓库文档、`git diff --check` 与严格 OpenSpec 校验通过。
  - `make check-generated check-generated-ui`、`make build-go` 通过；内嵌资源由源重新生成并同步。
  - 全量浏览器 `dist/work-settings-add-skill-browser.log`：1740 项，1738 PASS、2 个既有环境 SKIP、0 FAIL（exit 0）。运行使用本机 Playwright chromium；`/usr/bin/chromium` 缺失导致的两个用例已随该设置通过。
  - 定向新增用例覆盖：Core 多选、菜单/搜索/手机选择器、空态添加、目录导入、取消无请求、缺 `SKILL.md` 预检查、同名拒绝、上传等待、未知不重试、其他草稿保留与 Esc/焦点。
- 6.1 阻塞解除并完成：Docker 网络故障来自 Clash `rule` 出站节点 TLS 失败；本机临时切换 `direct`、用已有 `docker/dockerfile:1.10.0` 标记 `docker/dockerfile:1`，并以忽略目录中的临时 wrapper 传入 `NPM_REGISTRY=https://registry.npmjs.org` 与 worktree 的 `GIT_DIR`/`GIT_WORK_TREE`，未修改仓库构建默认。新增 `TestNativeWorkSettingsLocalSkillImportRoundTrip` 与浏览器脚本 `source=local`：Core Skill 目录为空、目标 Work 无独立 Skill，经真实浏览器导入本机目录 → 自动打开 `SKILL.md` → 编辑正文/配套文件 → 保存 → Apply → 新 Run SDK 读取 → 停止/重启 → SDK 再读 → PIWORK2 导出/导入 stopped → 启动后 SDK 读取；Core catalog 保持 0，另一 Work 的 desired 不变。`dist/work-settings-local-import-integration/result.json` partial 1/1 PASS（74s）。
- `dist/work-settings-final-integration/result.json` partial 2/2 PASS（123s），同时复跑原 Core 勾选添加/编辑闭环；runner 重新核验 source identity 并执行真实浏览器/SDK，未复用旧测试结果。该 partial 结果不代表全部 521 个 Native 场景通过。
- 6.2 完成：最终源码上 `make check-generated check-generated-ui`、`make build-go` 通过；`go test ./internal/coreapp ./internal/workcontext ./internal/skillartifact ./internal/workaccess ./internal/contracts ./internal/webapp ./internal/cli` 全部通过。全量浏览器 `dist/work-settings-add-skill-browser.log` 为 1740 项、1738 PASS、2 个既有环境 SKIP、0 FAIL；其后仅新增 integration 测试脚本/文件，产品与 WebUI 源未变化。集成经 webapp 托管入口，独立 Desktop 的精确 multipart 路由由 CLI 测试覆盖。本次 integration scope 的容器/网络/卷无残留；Clash 模式与临时 wrapper 已恢复/保留在忽略目录，未归档、提交或发布。
