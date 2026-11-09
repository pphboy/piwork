# Design

## Context

动机与范围见 [proposal.md](proposal.md)。本变更跨 Desktop 创建/设置与 Console 导航，需要在实现前固定两端行为，故保留 design。

当前权威来源与本次已检查的接口：

| 位置 | 当前职责/事实 | 本次处理 |
| --- | --- | --- |
| `apps/desktop-webui/src/app.ts:2532–2577,3690–3730` | New Work 展示与草稿提交，包含镜像、JSON、摘要和查找原任务 | 删除所选入口与无消费者草稿；保留名称、其余选择及原提交保护 |
| `apps/desktop-webui/src/adapter.ts:1294,1930–1938,2908` | desired 配置读取、创建 payload、完整配置保存 | 创建不发送镜像/整份配置；设置保存仍发送完整有效配置 |
| `apps/desktop-webui/src/configuration.ts:1–35`、`models.ts:143` | 普通字段与 JSON 使用同一草稿；当前 JSON 包含镜像 | 在现有配置模块中处理可编辑投影与受保护基线，不新增全局状态 owner |
| `apps/desktop-webui/src/app.ts:2517–2530,2880–2895,4627–4648` | 原任务列表/详情、手输 Operation ID handler | 移除手输链路，保留已知任务、匹配检查与查询 API 调用 |
| `apps/console-webui/src/app.ts:387,1010,1698–1750` | Find Operation 导航、路由、表单和详情返回路径 | 移除查找页；保留详情，返回 Packages |
| `internal/coreapp/work_create.go:81–94`、`work_configuration_save.go:151–169` | 默认 Work 为创建来源；完整 PUT 可重选镜像 | 只读边界证据；不修改领域行为 |
| `internal/cli/user_desktop_control.go:282,380–391`、`internal/consoleapp/console_api.go:230` | Desktop 代理保留原协议；Console 默认 Work 已拒绝镜像修改 | 不扩大为新的代理/API 限制 |

受影响的现行契约是 DWUI-003/007/010、DUL-011/014、SUI-004、SUI-V13-STATE-001、SUI-PKG-003/004 与 UIL-006/008/V13-CHROME-001。相关 delta 覆盖原来要求镜像/JSON 创建入口及 Find Operation 的文本；CLI 与 Work 领域规格保持原状。

## Goals / Non-Goals

**Goals:** 在既有 owner 中删去入口，保留其余输入语义与真实状态。网页保存其他配置时保留已加载 desired 基线的镜像，导入 JSON 不成为新的镜像入口。用已选 A 作为局部视觉依据。

**Non-Goals:** 不增加镜像政策/API 权限、不强制所有 Work 使用当前发行镜像、不改历史镜像或导入包、不提供新的任务发现/存储。Snapshot ID 找回是独立现有流程，继续保留；本次不触及其他表单、Service/Chat 布局或根 README/部署教程。

## Decisions

### 1. 创建只提交剩余字段，默认值仍由 Core 决定

删除 `createImage`、`createJson`、对应控件/事件和仅服务它们的文案；创建 adapter 不再接收镜像参数或从高级 JSON 生成 `configuration`。保留名称与 Skills/Packages 的 defaults/choose/none、AGENTS 文本/文件。defaults 不发送对应字段，none 发送空集合；AGENTS 的既有继承和文本提交语义保持。

不在浏览器复制发行镜像常量。Core 创建本就复制持久 Default Work；这与“强制当前发行镜像”不同，后者未被授权。Core、CLI、HTTP DTO 和生成协议无需改变。

### 2. 采用紧凑 A，首次打开默认折叠

```text
+--------------------------------------+
| New Work                         [x] |
| Uses Core defaults.                  |
| Name                                 |
| [                                  ] |
| > Advanced configuration    Optional |
|               [Cancel] [Create Work] |
+--------------------------------------+
```

仅在用户点击后展开 Skills、Pi Packages、AGENTS.md。收起不丢同一未提交草稿；新的创建表单/页面刷新默认折叠。已有拒绝、未知、可靠受理后的下一次新建及迟到响应保护沿 DWUI-003 保留，不为压缩表单重置草稿或增加提交。

局部尺寸采用约 480px 最大宽度；标题 18px、输入正文 13px，输入与主要按钮约 36px 高；主体留白约 16px/18px，字段间距约 12px，AGENTS.md 初始约 76px 且可调整。按钮取消在左、创建在右，均为内容所需宽度。保留单列与标题上置；高度自适应，长选项、错误或指令使用既有主体滚动，底部动作保持可达。新建弹窗不继续命中旧 `.wide` 630px 和 `.modal-create` 590px 固定高度规则；样式仅作用于此表单，避免改写全局 footer。

复用现有字体 Inter/system；颜色沿共享 tokens：画布 `#f5f8fc`、表面 `#ffffff`、正文 `#1b2634`、次要文字 `#526477`、边界 `#dce7f2`、主动作 `#0969da`。不增加装饰、字体依赖或开合动画。

创建错误由当前字段或表单承担，不能再以重复浮动提示遮住名称。实现使用当前仍连接在 New Work 中的原提交控件确认展示归属，不改变 ActionState 记录/锁；表单关闭后原记录继续走既有通知恢复。提交等待期间按钮几何保持，明确失败/未知结果后的表单高度按内容调整，错误和按钮保持可达。

[冻结原型](prototype/index.html) 为先前已运行原型的自包含打包，内嵌当时样式、脚本和图标，双击即可预览；默认 A、默认折叠，`?variant=A&lang=zh` 可看中文。底部原型工具保留 B/C 仅作历史比较，产品只实施已选 A，不交付工具条、模拟数据或其他布局。附件还包含 [折叠截图](prototype/a-collapsed.png)、[展开截图](prototype/a-expanded.png) 与 [窄屏截图](prototype/a-mobile.png)。

原型在 1440×900 下观察到折叠约 480×278px、展开约 480×555px；这些是空/default 字段的示例，非固定高度或内容上限。此前已检查 390×844、360×640、折叠草稿保留与模拟创建；全部使用内存合成数据，无 Core/API 调用，不代表真实创建、镜像保留或任务恢复已通过验收。

### 3. Settings 编辑投影排除镜像，完整提交保留基线

现有配置模块继续拥有跨分类草稿，adapter 拥有从 Core 读取的 desired 基线。将 `agentImage` 从可编辑 JSON 投影排除，并在已有配置对象内保留其原始 desired 值；序列化完整 PUT 时补回该基线值。不能从 active、Core 默认或当前发行推断替代值，也不修改存储模型。其余 modelRef/MCP/resources/tools 与 Skills/Packages/AGENTS 的同步仍使用现有配置入口。

对编辑/导入中显式加入的不同镜像，复用现有字段校验错误与草稿保留，阻止保存；相同镜像输入可剔除为冗余字段。错误不能通过悄悄改回基线后假装保存成功来隐藏。只读诊断若已有镜像事实可以保留，不新增镜像配置行。拒绝的是网页表单输入；手工调用 API 不属于此入口约束。

选择这个投影而非移除整个 Settings Advanced，是因为用户只删除 New Work 的 JSON，其他高级配置仍有现行职责。也不修改 Core PUT 或浏览器代理；如此无需改变 CLI/API、数据格式或建立新的并发协议。并发 CLI/API 修改继续服从现有完整保存语义，本变更不另承诺跨客户端字段合并。

### 4. 移除手动 ID 查找，保留已知任务观察

Desktop 删除 Operation 输入框、查询按钮、`operationQuery` 及无消费者的 lookup handler；注意不要误删已知 Operation 的 `checkOperation`、原对象身份匹配、任务记录、原详情和独立 `lookup-snapshot`。恢复入口若同时展示已知记录则保留记录，只去掉手输部分；空态、读取错误及可访问名称不再引导手输 ID。

Console 删除 Find Operation 页、提交事件与各入口。`/admin/operations/<id>` 保留原权限、阶段、轮询、刷新和错误；无记录详情仍提供安全不可用说明与返回 Packages。裸 `/admin/operations` 复用既有未找到呈现，不新增重定向协议。清理标题、面包屑、Overview 快捷入口、窄屏导航和失败返回链接，避免导向已移除页面。

不以删除页面为由移除持久 Operation/API 或建立全局历史。仅有原 ID、没有详情 URL/已知记录时失去网页手动找回能力，这是已确认的取舍。

## Risks / Trade-offs

- 原配置 JSON 包含镜像且完整 PUT 要求保留该字段 → 先验证投影/基线往返和导入负例；不能只删展示键后发送缺失配置。
- 部分手输查找与真实任务共用代码 → 按消费者清理，测试原已知任务失败恢复、未知写入锁和详情刷新，保留原查询服务。
- 紧凑尺寸遇到长内容 → 360px、中英文、长名称/指令及错误截图检查，主体可滚动，不固定示例高度。
- 原型未覆盖 Settings 镜像保护及真实管理任务 → 相关单元/浏览器及宿主入口验证列入 tasks，不能把合成原型当成实现通过。

## Migration Plan

实现后通过两端既有 workspace 构建更新 `internal/desktopassets`、`internal/consoleassets`，随后 `make build-go` 重建宿主程序。无存储迁移、镜像重选或自动 Apply；已有 Work 不因升级 UI 变化。回退只需恢复对应前端及其同版嵌入资源，不修改数据。本变更不执行外部发布。

## Scope review

保留：现有 owner、草稿、权限、已知任务状态和必要恢复。简化：创建字段、冗余摘要、弹窗密度和手输 ID 页面。排除：Core/CLI/API 政策、全局任务中心、持久化/并发新协议与全仓重构。隐藏镜像基线只为满足原完整 PUT 的当前契约，不引入新的持久状态；其余无新增机制。

## Implementation and verification

2026-11-09 已实现本变更。实际修改限于 Desktop 的创建/配置投影/任务入口、Console 查找页面与导航、两端双语文案/所属样式、对应测试及通过既有生成器同步的内嵌资源。`configuration.ts` 保留跨分类草稿 owner，adapter 仅补回已读取 desired 镜像；创建提示的归属判断仅影响本地展示。未修改 Core/CLI/API、代理协议、存储或发行镜像来源。

| 检查 | 实际结果 |
| --- | --- |
| 两端 workspace typecheck/build | 通过；现有生成链更新 `internal/desktopassets` 和 `internal/consoleassets` |
| Desktop `feedback.test` + `recovery.test` 完整浏览器回归 | 498/498 通过；随后截图发现的局部创建错误遮挡修正，又完成 42/42 创建相关回归，包含未知结果关闭后的通知恢复 |
| Console 既有 Playwright 入口 | 281 个用例均完成验证；最终整轮 280 通过，1 项因同时重建 dist 导致引导资源缺失，分离执行后该项复测通过 |
| Desktop 配置/草稿/浮层单元 | 18/18 通过；生命周期 adapter 55/55 通过；最终浮层和导航单元 92/92 通过 |
| Console 现有单元 | 163/163 通过 |
| UI 依赖、双语、增量源码风格 | `check-webui-boundaries`、`check-ui-language`、`check-source-style` 通过 |
| 生成资源 | 最终 `node scripts/check-generated.mjs ui` 通过，产物与原生成器一致；该命令会清理并重建 workspace dist，与浏览器测试顺序执行 |
| Go 宿主 | `make build-go` 通过；两个 assets 包编译、`go test ./internal/webapp` 通过 |
| 真实 Go/CLI 入口 | 独立临时安装的统一 Go 入口两项浏览器检查通过；本机 CLI 浏览器六项检查通过，最终资源重建后又完成登录/创建相关入口复测 |

桌面、360px、中英文、折叠/展开、长包名、长指令、名称字段错误、长拒绝原因和未知结果的实际截图位于临时 `dist/new-work-screens/`。已检查名称可直接点击、不被通知覆盖，等待时按钮位置稳定，结果未知时不允许重复创建，关闭后保留恢复提示。对应原型附件未被生成链改写。

当前机器的 Go VCS 检测会从 worktree 的 `.git` 文件继续找到上层空 `.git` 目录；构建与原生 fixture 检查使用临时命令环境 `GIT_DIR=$(git rev-parse --absolute-git-dir)`、`GIT_WORK_TREE=$PWD` 指定本仓库，保留版本信息，未修改全局 Git 或构建脚本。Node 24.2.0 曾在原生浏览器测试中触发内部断言，最终 Node 测试使用本机已安装的 Node 24.20.0；不修改项目依赖或运行时要求。

真实 Docker Work 准备、真实模型执行及生产安装操作未执行；相应业务逻辑未改动。没有重启用户现有 Core、创建镜像发行、提交 Git、同步主规格或归档变更。

## Final verification and archive assessment

最终验证为 0 CRITICAL、0 WARNING、0 SUGGESTION，9/9 任务完成。先前缓存校验提示的语言切换项按 FALSE_POSITIVE 排除：其复现直接调用内部语言函数；当前 Settings 无语言入口，正常返回 Works 会先经过无效草稿保护，放弃后切换语言再返回时错误已清除。未据此扩大实现或修改镜像校验。

归档前已核对五项主规格：11 条修改、1 条移除全部同步，未涉及的需求与场景保留。移除 SUI-PKG-004 后，文档迁移索引使用原 serve-admin-console 变更内的规格定位该历史需求，源摘要、场景索引和冻结附件不变；当前文档检查通过。
