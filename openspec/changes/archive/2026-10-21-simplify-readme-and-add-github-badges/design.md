# Design

## Context

动机与范围见 [proposal.md](proposal.md)。本变更包含 README、详细部署材料、官网生成和发行一致性检查之间的调整，因此保留设计说明。

变更提出时的依赖如下，后文决策将其解耦：

- `scripts/sync-docker-quickstart.mjs` 要求根 README 包含 `docker-quickstart` 标记，重新写入教程，并强制移动 Architecture 到 Problem 之前。
- `scripts/check-docker-quickstart.mjs` 将根 README 和部署手册四份文件当作同类教程，检查三条完整启动/授权命令，并要求根 README 存在折叠原生启动块。
- `scripts/sync-docker-website.mjs` 从根 README 提取 `native-quickstart` 折叠内容；直接删除该块会令官网失去说明，并可能输出字面量 `undefined`。
- `scripts/check-docker-quickstart.test.mjs` 的夹具、命令比较和故障注入依赖上述四份教程。现有仓库文档检查与发行材料测试另行保护链接、图片和未提交文档。
- 仓库 GitHub Release 目前均标为预发行版本；许可证为 Apache-2.0。当前详细材料仍要求固定镜像身份、候选/已发布状态区分与历史记录不可改写。

现行 RDOC-005 要求 README 保留构建命令，DOCKER-DELIVERY-010 要求内嵌 Docker 教程和固定章节排序。本变更显式调整这两项要求，并修改 DOCKER-DELIVERY-011 的材料同步边界，不通过放宽其他安装或发行检查绕过冲突。

本次修复将与 `simplify-linux-delivery` 重叠的 DOCKER-DELIVERY-010、DOCKER-DELIVERY-011 和 RDOC-005 全文对齐为同一契约，保留主规格已有的“端口或发布身份漂移”场景。平台与初始化行为由该已授权变更确定：只交付 Linux amd64 的 piwork-core/piwork-cli；通过普通 HTTP 地址创建管理员并正常登录；Compose 仅含 Core，CLI 独立连接。本文不再要求旧授权链接、独立 Console、Windows 原生 CLI 或 CLI 容器，也不以保留历史发布记录为由继续提供旧功能。

## Goals / Non-Goals

**Goals:**

- 将根 README 变成稳定、手工维护的双语项目首页，完整操作说明继续可发现。
- 让详细材料生成独立于 README 布局，重复同步不再改变根 README。
- 维持详细命令、官网生成、安装材料和发布身份之间的现有一致性约束。

**Non-Goals:**

- 不改变 Piwork 运行行为、模型/runtime 设置、Docker 参数或支持平台，不重建或发布镜像。
- 不修改 GitHub Topics、不创建 Git tag、不引入 CI 徽章或额外文档站点。
- 不编辑外部官网仓库或发布网站；通过本仓库生成器和隔离官网夹具验证兼容。

## Decisions

### 1. README 只保留简短展示和链接

两种语言使用对应结构：顶部 Logo、标题/语言切换、徽章、一句话定位、Work / Service / Harness 三条说明、现有演示视频和截图、文档/社区入口、至多三条 Roadmap，以及简短贡献与许可证链接。以约 60–80 行为编辑目标，不为凑行数压成长段；段落最多两句，核心概念各一句。

删除根 README 的 Quick Start、原生折叠教程、导入导出命令、模型管理流程、构建命令、详细限制与连续发行说明。Architecture 图及 Problem 解释由简短概念说明替代；Linux 服务端、远程浏览器和 Preview 状态只保留必要的短提示，完整边界通过详细材料查询。

官网文档采用对应语言入口；本地部署材料链接分别指向 `deploy/docker/README.md` 与 `README.zh-CN.md`。Releases、Issues、Discussions 分别链接真实仓库页面，贡献入口链接既有 `AGENTS.md`；不增加空栏目或新的文档目录。同步调整 `AGENTS.md` 中 README 内嵌命令及材料同步的相关约定，使其描述新的职责。

备选是继续折叠教程；这仍增加页面负担和重复维护，不符合移除使用内容的目标。

### 2. 四类徽章使用准确来源和可用链接

采用普通 Markdown 徽章，不引入脚本、组件或运行依赖：

| 徽章 | 图片来源 | 点击目标 |
| --- | --- | --- |
| 最新版本 | Shields GitHub Release，启用 `include_prereleases` | `https://github.com/pphboy/piwork/releases` |
| 许可证 | Shields GitHub license | 本地 `LICENSE` |
| Stars | Shields GitHub stars | `https://github.com/pphboy/piwork/stargazers` |
| 服务端平台 | Shields 静态 `server: Linux` | 对应语言的部署手册 |

例如版本图片使用 `https://img.shields.io/github/v/release/pphboy/piwork?include_prereleases`，不把点击目标写成排除 Preview 的 `/releases/latest`。每个图片提供明确替代文本，两种语言使用同类来源和含义；Linux 标签明确表示服务端，区分 Windows 浏览器远程访问与仅支持 Linux 的 Core/原生 CLI。

备选是写死版本和 Stars 数量；它们会过期。仅选择正式版本的动态徽章也不适合目前只有 Preview 的发行状态。检查验证 URL 语义和点击目标，不依赖外部徽章实时响应或当前 Stars 数字。

### 3. 详细内容由共享生成入口承接

`scripts/docker-quickstart-content.mjs` 继续提供默认 Docker、终端和单机说明，并新增统一原生 Linux 说明的共享渲染入口。原生说明按已授权的 Linux 精简契约提供构建/启动入口、--ui-port/--core-port/--data-dir 三项运行配置、默认数据目录、实际 HTTP 地址、直接创建管理员与普通登录、固定 Agent 默认值、进程退出对 Work 的影响，以及独立 Linux 原生 CLI/Desktop 的连接方式。operator 身份和受保护管理 API 保留，用户 CLI 不控制 Core 进程。

双语部署手册增加稳定的原生 Linux 章节和 `native-quickstart` 标记；官网 Quick Start 的可选原生说明直接使用共享内容，按输出位置提供正确链接，不再从根 README 提取 HTML 或内容块。

`scripts/sync-docker-quickstart.mjs` 移除对根 README 的读取/改写循环，仅维护详细手册、Compose、单机材料和相应当前记录。根 README 无需留下兼容空标记。当前材料删除已取消功能的操作说明；历史下载继续指向其真实版本及对应版本手册，不将旧教程重新并入当前安装流程。不为文档精简改写任何已发布记录的 commit、dirty、输入 hash 或 digest。

内容流调整为：

```text
Root README EN/ZH --> Website / Deployment manuals / Releases

Shared usage content + Release metadata
    --> Deployment manuals EN/ZH
    --> Generated website EN/ZH
    --> Compose / single-host materials
```

备选是把原生说明留在 README、只供程序读取，或让官网继续解析另一份手写手册；前者仍保留教程负担，后者继续依赖文档布局。共享渲染同时解决唯一内容来源和正确相对链接。

### 4. 检查按材料职责分开，保留故障检测

保留 `scripts/check-docker-quickstart.mjs` 作为统一入口：根 README 检查语言互链、Logo/演示资源、有效导航、徽章语义和没有教程；完整命令基准改为双语部署手册。官网命令与该基准比较，原生说明与共享内容核对。删除对根 README 的 Architecture 排序和折叠启动要求。

调整 `scripts/check-docker-quickstart.test.mjs` 的四文档夹具和负例：详细语言命令漂移改为破坏部署手册，保留网络/挂载/秘密/候选状态/下载检查；增加精简 README 下重复同步不回写、官网不出现 `undefined`、原生入口未丢失、版本徽章缺少 Preview 查询或导航破坏能够被发现的回归。

本地材料暂存遵循 Linux 精简方案的显式清单，核对部署手册、Compose、许可证和必要图片的链接闭包；根 README 及其展示图在仓库入口单独核对，不为本次修复重新加入发行包。

只对跨材料生成和语义漂移增加必要回归，不为纯措辞、空行或视觉样式建立快照。复用 `check-repository-docs`、`stage-go-release-materials` 及其现有测试，核对本地图片、许可证、详细手册和 dirty 文档的打包链接。候选夹具使用合成身份并按原机制重算输入摘要，不能为使检查通过而改写当前已发布身份。

## Risks / Trade-offs

- README 增加一次进入教程的点击：保留官网与本地部署手册两类清晰入口，并同步中英文导航。
- 移除唯一原生说明或误删详细边界：先补齐共享内容与双语手册，再删除根教程；检查官网生成结果及命令一致性。
- 仅取消旧断言可能掩盖材料漂移：保留原负例，把详细命令基准转到手册，并验证破坏导航和详细命令会明确失败。
- 外部徽章可能缓存或不可用：使用动态官方仓库数据、替代文本与直接链接，正文不依赖徽章才能理解项目。
- 文档工具变化影响新构建输入：只计算新的真实输入，不回填旧发布记录；本次不触发制品重发。

## Migration Plan

先完成共享原生说明、手册与官网生成解耦，再同步调整检查、精简双语 README 与开发约定。执行专项脚本、隔离官网生成、仓库文档与材料链接检查，并人工审阅两种语言的短页面。

同一变更内一并交付文档与必要生成规则，避免只删教程导致发布入口失败。回退时恢复这组文档、生成与检查修改；现有服务、数据、镜像、历史发行及外部官网均无需迁移。
