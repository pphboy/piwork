# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: README 提供最短的终端试用入口`
- TO: `### Requirement: README 提供精简项目介绍与文档入口`

## MODIFIED Requirements

### Requirement: README 提供精简项目介绍与文档入口

**Identifier:** DOCKER-DELIVERY-010

README.md/README.zh-CN.md SHALL 保持顶部互链、章节、产品含义、平台边界与文档导航对应，保留居中 Logo 及 160×160 尺寸。根 README SHALL 展示简短定位、Work / Service / Harness 各一句说明、现有演示视频和 Desktop 截图；每个说明段落最多两句，若保留 Roadmap 则至多三条。版本变更细节 SHALL 由 Releases 承接，不在介绍中累积多段发行说明。

根 README SHALL 提供官网文档、双语部署手册、Releases、Issues、Discussions 和贡献/开发约定入口。安装、启动、首次设置、模型/runtime 配置、CLI、导入导出、构建与验证步骤及详细网络/兼容性限制 SHALL 放在对应既有材料，不在根 README 内嵌命令、配置示例或折叠教程；根 README 不再要求 Architecture 图、Problem 章节或两者排序。

根 README 顶部 SHALL 包含最新 GitHub Release（包括 Preview）、Apache-2.0、Stars 和 Linux 服务端四类徽章，使用真实仓库信息、准确替代文本及有效点击目标。版本徽章 SHALL 能展示仅有预发行版本的项目，不能以只查正式版的入口错误显示无版本；Linux 徽章 SHALL 清楚表示服务端部署平台，不将浏览器或实验性客户端能力表述为 Windows Core 支持。徽章图片不可用时，产品说明与导航 SHALL 仍可阅读和使用。本要求不创建 Git tag、不修改仓库 Topics，也不展示没有实际来源的 CI 状态或支持承诺。

根 README 链接的详细 Quick Start SHALL 默认展示统一服务端的一条完整逻辑 Docker run 命令，随后打开服务器网页、取得首次设置授权、创建管理员、配置模型/runtime 并进入工作台。Agent 镜像是随版本交付的默认值，教程和页面不包含手填、选择或高级覆盖步骤。默认不要求任何业务 env、CLI 容器、Console、客户端代理、安装压缩包、源码构建或域名配置；主站及有界 Service 入口需要的网络放行在同一入口说明。首次授权链接只在实际启动端生成，静态例子不含有效秘密。

详细使用材料 SHALL 明确 IP 模式首版依赖脚本读写 Cookie 的应用可能不兼容，脚本自行写入 Cookie 不保证跨 Service 隔离；响应 Cookie 在服务端分区。该限制不新增 DNS/客户端代理步骤，也不阻塞默认网页初始化，不以“完整工作台”宣称所有网页应用透明兼容。

详细入口命令 SHALL 使用实际已发布固定镜像、Linux host 网络、同机 socket、同绝对路径持久数据及 60 秒关闭窗口。Compose 作为可选统一服务端方式，单机示例为可选高级入口；不得由初始化期间 /readyz 失败阻止网页打开。原生 Linux 应用、CLI/终端及 Windows 客户端说明 SHALL 继续在部署手册或官网的相应高级入口可取得。

详细材料的代码块 SHALL 标注 shell、完整可复制并说明执行位置、地址/ID 来源、正常停止和重进方式；已有安装复用数据、未知 Operation/Run 恢复不得靠重提创建或消息实现。

#### Scenario: 浏览双语项目首页
- **WHEN** 用户打开任一语言根 README
- **THEN** 看到对应的简短项目介绍、四类真实徽章、三个核心概念及演示资源，通过文档入口取得操作说明，页面没有安装、配置、使用或构建教程

#### Scenario: 只有 Preview 版本
- **WHEN** 仓库最近版本为 Preview，尚无正式 GitHub Release
- **THEN** 版本徽章包含预发行版本，点击后进入可查看 Preview 的 Releases 页面，而不是只接受正式版的地址

#### Scenario: 徽章图片不可用
- **WHEN** 徽章图片服务无法加载
- **THEN** 准确替代文本、项目说明及文档链接仍可用，不影响取得安装入口

#### Scenario: 首次使用者完成一次对话
- **WHEN** 用户从任一语言 README 进入详细 Quick Start 并使用受支持 Linux Docker
- **THEN** 仅启动一个入口并在浏览器完成配置和对话，执行前无需 export 管理员或模型变量

#### Scenario: 查看原生 CLI 替代路径
- **WHEN** 用户从项目文档导航选择原生 Linux 应用、高级原生/容器 CLI、Windows 客户端或可选 Compose
- **THEN** 各自入口和身份边界清楚，不重新成为默认网页安装前置条件，统一原生 Linux 说明不因根 README 精简而丢失

#### Scenario: Work 等待中断或消息流中断
- **WHEN** 用户按详细 Quick Start 使用 Piwork，镜像尚在准备或原创建/Run 观察中断
- **THEN** 网页显示实际进度/恢复，说明按原 ID 核对，不复制终端就绪循环或自动重提 mutation

#### Scenario: Core 正在准备依赖
- **WHEN** 网页可用而依赖 preparation 尚未完成
- **THEN** 网页显示真实准备/恢复，详细教程不以完整 readiness 阻止引导或要求额外 CLI 等待循环

#### Scenario: 阅读和复制代码
- **WHEN** 用户从 README 进入任一语言详细安装材料并复制命令
- **THEN** 根 README 保留居中 Logo 与短导航，命令在详细材料中规整分行、两种语言对应一致，默认试用不含旧下载及配置步骤

#### Scenario: 只使用已有 Core
- **WHEN** 用户已有可达且已配置的 Core，按高级入口只执行 CLI 独立启动命令
- **THEN** 无需下载 Core Compose、启动本地 Core 或提供管理员/模型初始化变量，即可按用户身份登录和使用；CLI 退出不影响 Core 或 Work

### Requirement: 可选 Core Compose Demo 与默认材料同步维护

**Identifier:** DOCKER-DELIVERY-011

统一服务端 Compose SHALL 单独启动同一程序，默认无需业务 env，保持 Docker socket、数据路径、host 网络、主站/Service 入口条件、应用 liveness 和 60 秒关闭规则。examples/single-host 的 CLI SHALL 成为显式可选高级组件，不默认拉起、阻塞统一网页或取得 Core 初始化秘密；CLI 启退不创建/重建/停止 Core。

双语根 README SHALL 同步维护项目展示和有效文档导航，不携带当前镜像命令或重复详细教程。双语部署手册、Compose/模板、单机说明、发行默认值/清单及官网的 Quick Start、首页、安装、First Work、源码导航和当前下载材料 SHALL 继续同步维护完整运行说明，并提供可执行的一致性检查。检查使用合成值，不输出真实秘密；连续同步候选时不得残留前一个当前引用。历史发行下载保留原版本身份，不覆盖为未公开的新候选。

材料同步 SHALL 在没有根 README 安装块、原生启动块和 Architecture 章节的情况下正常完成，并保持根 README 内容不变；官网使用说明生成 SHALL 不将根 README 当作教程来源。统一原生 Linux 入口 SHALL 同时在既有双语部署手册和生成的官网材料中有效，不能生成空内容或字面量 undefined。

不同启动方式切换 SHALL 先正常停止原实例并复用所属安装路径；单机示例继续使用独立数据路径，不能自动停止冲突安装或扫描接管其他数据。材料检查失败 SHALL 阻止候选通过。

#### Scenario: 材料产生漂移
- **WHEN** 任一详细教程语言、Compose 或官网仍要求模型 env、第二默认 CLI 容器，引用与当前候选不同，或根 README 导航无效
- **THEN** 检查非零退出并定位文件/字段，修复前不能通过候选检查

#### Scenario: CLI 重进不改变 Core
- **WHEN** 用户显式启动、退出或重新进入高级 CLI
- **THEN** 只连接已运行服务器，Core 身份/启动时间和运行 Work 不变，CLI 不取得初始化秘密

#### Scenario: 连续同步两个候选版本
- **WHEN** 当前材料依次更新为候选 A/B
- **THEN** 所有详细当前入口统一指向 B，根 README 保持简短介绍和导航，历史版本下载及真实发布身份不被回填或覆盖

#### Scenario: 同步后 README 保持精简
- **WHEN** 在根 README 没有旧安装标记、原生启动标记及 Architecture 章节的隔离副本中同步材料，并重复同步相同输入
- **THEN** 同步成功且两次均不修改根 README，不追加命令、折叠教程或发行长段，详细材料仍通过一致性检查

#### Scenario: 官网不再读取根 README 教程
- **WHEN** 根 README 已精简，维护者在隔离目录生成两种语言的官网材料
- **THEN** 官网仍包含完整默认安装和原生 Linux 入口，未丢失启动/数据/授权/关闭说明，没有 undefined，命令与部署手册一致

#### Scenario: 用户选择 Compose Demo
- **WHEN** 用户选择当前统一服务端 Compose 或单机示例
- **THEN** 说明独立安装数据和端口条件，零必填 env 启动，CLI 为显式可选

#### Scenario: 新模板进入候选包
- **WHEN** 服务端 Compose、单机模板或材料被渲染分发
- **THEN** 文件与版本、摘要、清单匹配，缺失或变化使检查失败，旧发行不被覆盖

#### Scenario: 新 Compose 文件独立运行
- **WHEN** 只下载当前服务端 Compose 且已有受支持 Linux Docker
- **THEN** 无需 env 或第二 YAML 启动完整网页，仅显式选择时运行高级 CLI

#### Scenario: 切换默认启动方式
- **WHEN** 用户先停止 Core Docker run，再用 Core-only Compose 重新创建 Core，或反向切换
- **THEN** 同一 Core 数据目录保留原安装，独立 CLI 的状态卷和凭证不变；不会自动迁移到单机部署示例的数据目录

#### Scenario: 高级 Demo 与旧下载保留
- **WHEN** 用户查阅已有高级 Core-only Demo、Desktop 或旧版本下载
- **THEN** 入口明确标注其用途和版本，旧地址不被覆写为未验证的新候选，也不要求默认用户使用它们
