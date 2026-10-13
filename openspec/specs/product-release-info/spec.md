# product-release-info Specification

## Purpose

为 Piwork 用户和管理员提供可发现、可核对的 Core 与 Desktop 运行版本及应用内更新日志，区分本机客户端与远端 Core 的真实身份，使离线阅读、跨版本连接和发行材料都能准确说明当前安装的变化。

## Requirements

### Requirement: 产品信息来自各组件真实运行身份

**Identifier:** PREL-001

Core SHALL 提供已认证用户可读的产品信息，包含信息接口版本、程序身份、运行版本、commit、修改状态、操作系统及架构，并与该 Core 可执行程序的版本命令保持一致。此读取 SHALL 独立于 Work runtime 就绪状态，不取得任何 Work 内容或 operator 权限。

Desktop SHALL 从本机承载 Desktop 的 CLI 获取本机版本，并分别查询当前连接的 Core 身份；Console 展示的 Core 版本 SHALL 来自其连接的 Core。界面不得以浏览器资源版本、Console 版本、发行标签或另一组件的版本推断 Core/Desktop 版本。版本、commit 未提供或处于开发状态时 SHALL 如实显示。

#### Scenario: 两端版本不同
- **WHEN** Desktop 与所连接的 Core 来自不同版本
- **THEN** 界面分别展示两端实际运行版本，不合成一个版本或默认二者相同

#### Scenario: Core 运行依赖尚未就绪
- **WHEN** 已认证用户连接 Core，但 Agent/helper 依赖尚未就绪
- **THEN** 仍可读取 Core 版本和自带更新日志，读取不触发依赖准备、Work 创建或运行

#### Scenario: 身份与版本命令一致
- **WHEN** 用户分别查看 Core/Desktop 的版本命令与 About 信息
- **THEN** 对应组件的版本、commit、修改状态、平台与架构一致，开发构建不被表达成未经确认的正式发行

### Requirement: About 入口在对应应用内可发现且保持读取边界

**Identifier:** PREL-002

Desktop SHALL 在本地浏览器已授权后的登录页和工作区提供英文 `About Piwork` 入口，未登录 Core 或 Core 不可达时仍可读取本机 Desktop 版本和内置日志。本地浏览器未授权时 SHALL 继续遵守既有本地授权恢复规则，不借 About 展示保存的 Core 身份。

Console SHALL 在管理员会话内提供 `About Piwork`，显示其连接的 Core 信息；该入口 SHALL 遵循既有管理员会话、失效和恢复规则，不读取 Core 数据目录或 operator 凭证。两端 About SHALL 支持键盘打开、关闭/返回、可见焦点和 360px 窄屏；打开 About 不提交业务修改、不取消 Run/Operation，不清空草稿或重载当前 Service iframe。

#### Scenario: 本机 About 离线可读
- **WHEN** 本地浏览器已授权而用户未登录 Core，或 Core 暂时不可达
- **THEN** 本机 Desktop 版本与自带日志可立即阅读，远端 Core 区域单独表示未登录、加载中或不可达

#### Scenario: Console 权限保持
- **WHEN** 未登录、普通用户或失效管理员会话访问 Console About
- **THEN** 按既有管理会话规则拒绝或进入登录恢复，不借此取得管理会话或他人 Work 内容

#### Scenario: 查看后返回原工作区
- **WHEN** 用户有未发送 Chat 草稿及 Service 内未保存输入，用键盘打开 About 后返回
- **THEN** 草稿、Session、Service iframe 和执行观察保持，焦点返回合理入口，没有新增 Run 或生命周期请求

### Requirement: 内置更新日志匹配当前组件版本

**Identifier:** PREL-003

Core 与 Desktop SHALL 随程序携带更新日志，并在 `About Piwork` 内通过英文 `Release notes` 查看。日志 SHALL 标明对应版本及其适用组件，按功能变化、修复和必要的兼容说明面向用户表达，正文安全按文本或受限结构呈现，不执行 HTML/脚本或自动加载外部资源。

当前版本日志 SHALL 按精确运行版本匹配；开发版本、未知版本或没有匹配条目时 SHALL 明确显示当前版本未提供日志，不使用最近条目或最新版替代，不编造日期和变更。Desktop 与 Core 版本不同 SHALL 分别阅读各自日志。

界面 SHALL 提供完整 GitHub Releases 的固定 HTTPS 链接 `https://github.com/pphboy/piwork/releases`，只有用户明确点击才打开外部页面。阅读内置日志 SHALL 不依赖互联网，不进行后台更新检查、联网拉取最新日志或自动升级；Core 自带内容的取得仍需要与 Core 的正常授权连接。

#### Scenario: 无互联网阅读
- **WHEN** 用户无法访问互联网，但本机 Desktop 可用且 Core 可连接
- **THEN** 可以阅读两端随各自程序交付的日志；完整 Releases 链接保留且不阻塞应用内阅读

#### Scenario: 没有精确版本日志
- **WHEN** 运行版本为开发版本或内置目录没有该精确版本
- **THEN** 显示该版本日志未提供，运行版本仍可核对，不自动选取相近版本或生成虚构内容

#### Scenario: 不同组件与恶意正文
- **WHEN** 两端运行不同版本，或内置正文包含 HTML、脚本标记及长文本
- **THEN** 各自显示匹配日志，正文不执行标记、不发起资源请求，窄屏可完整阅读

### Requirement: 版本读取降级与日志交付保持真实可追溯

**Identifier:** PREL-004

远端产品信息不支持、网络失败、读取中、已确认及最后已知缓存 SHALL 分开表示；旧 Core 缺少产品信息接口不得被解释为注销或破坏现有聊天、Work、Service 和 Files。慢远端读取 SHALL 不阻塞本机版本/日志展示。

切换 Core 或账号 SHALL 清除原归属的远端信息；晚返回不得覆盖当前连接，最后已知内容只有在同一 Core/账号下才能显示且须标明取得时间。版本查询 SHALL 仅只读重试，不更换 Core、镜像或组件。

内置日志 SHALL 纳入实际构建和发行输入身份。正式候选检查 SHALL 核对当前版本日志存在、版本/组件键唯一、正文非空及 Releases 链接与上述固定地址一致；缺失或非法时给出明确失败，不通过联网探测判断链接有效性。普通构建和本地开发打包 SHALL 不自动视为正式候选，允许明确显示未提供；严格候选检查采用显式入口。后续日志维护 SHALL 不改写已发布制品的 commit、dirty 状态、输入 hash 或 digest。

#### Scenario: 新 Desktop 连接旧 Core
- **WHEN** Core 不支持产品信息接口
- **THEN** 本机信息继续可用，Core 区域显示不支持版本查询，已有已授权业务功能保持其原能力

#### Scenario: 远端慢查询与切换
- **WHEN** Core A 的 About 请求被延迟，用户改连 Core B，A 随后返回
- **THEN** 本机信息始终可读，A 的版本/日志不显示为 B 的信息，无跨账号旧缓存

#### Scenario: 发行日志输入与候选核验
- **WHEN** 日志正文被修改，或正式候选缺少其精确版本日志
- **THEN** 前者影响相关构建输入身份，后者不能通过日志交付检查；既有已发布制品记录保持原始事实
