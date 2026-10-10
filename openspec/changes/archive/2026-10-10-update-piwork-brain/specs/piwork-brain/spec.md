# Spec Delta

## MODIFIED Requirements

### Requirement: 安装并实际加载 Work 自有的大脑包

**Identifier:** BRN-001

系统 SHALL 将 `piwork-brain` 作为本地 Pi extension package 管理，Work 内安装源及可编辑副本 SHALL 位于 `.pi/packages/piwork-brain/`，包内 SHALL 包含 extension、默认认知、Skills、Tools 和支持文件；不得将其交付为用户需通过 npm 安装的 Node module。实际执行 SHALL 使用当前 active context 已捕获且验证的包资源，编辑工作区副本不得直接热更新正在运行的包。

全新安装完成默认能力准备后，省略 package 选择的新 Work SHALL 独立拥有并启用脑包，ready 前 SHALL 验证真实资源及工具加载。包目录存在、catalog 安装成功或同名独立 Skill 加载均不得替代该验证。显式 packages=[] SHALL 保持空集合；独立 skills=[] 不得移除已选择脑包提供的 Skills。既有 Work SHALL 通过显式包安装/选择及 Apply 采用脑包，不能静默改写原 active、desired 或镜像。默认选择 SHALL 有一次性完成记录，保留管理员对默认集合和包内容的后续修改。Core 启动 SHALL 更新仍为原内置来源且启用的旧 piwork-brain package，使新建 Work 可捕获随当前 Core 提供的新包；一次性标记不得阻止该内置包更新。更新 SHALL 沿用现有准备与发布校验，保留默认集合，不覆盖管理员替换、禁用或移除的包，不修改既有 Work。重复启动不得重复发布相同内置版本，失败 SHALL 保留旧包。

#### Scenario: 默认 Work 获得可执行的大脑
- **WHEN** 默认能力准备已完成，用户省略 package 选择创建 Work
- **THEN** Work 拥有本地脑包副本，运行状态确认其 extension、认知、Skills 和允许的 Tools 实际加载

#### Scenario: 尊重显式空选择
- **WHEN** 用户分别指定 packages=[] 或仅指定 skills=[]
- **THEN** 前者不安装默认脑包，后者仍可加载所选择脑包内 Skills，均不通过隐式发现补回资源

#### Scenario: 工作区编辑尚未应用
- **WHEN** Pi 修改脑包工作区副本但没有完成 Package Update 和 Apply
- **THEN** 当前及普通重启后的执行继续使用原 active 包，新内容显示未生效

#### Scenario: 默认准备失败或已被定制
- **WHEN** 首次默认脑包准备失败，或管理员在成功种子后清空默认包并重启 Core
- **THEN** 前者不得伪造默认 Work 创建成功并提供准备失败原因，后者保持管理员选择且不重新添加默认脑包

#### Scenario: 更新 Core 的旧内置包
- **WHEN** 已完成 seed 的安装仍保留原内置旧脑包，用户更新并启动 Core
- **THEN** Core 完整准备并发布新版内置 package，新建 Work 捕获新版，原默认集合及既有 Work 副本保持不变

#### Scenario: 重复启动或更新失败
- **WHEN** 相同内置版本再次启动，或新版内置包准备/发布失败
- **THEN** 前者沿用已发布包且不增长 generation，后者保留旧 head 并使用现有准备诊断，不发布部分包


### Requirement: 默认采用可复用 Web 基础环境

**Identifier:** BRN-008

全新脑包 SHALL 将 FastAPI + React + TypeScript + Vite 作为未指定技术栈的新 Web Service 的默认环境，并提供匹配 WEBBASE-001 至 WEBBASE-007 的固定基础镜像引用、模板和部署指导。包内 SHALL 保留可查环境身份，使 Agent 无需猜测镜像版本或每次自行安装基础工具链；维护指导 SHALL 指向仓库的长期镜像维护源，不能将脑包内引用或 Work 副本误当构建源。当前认知、Skill/Reference 和模板 SHALL 不再依赖或推荐 NiceGUI；历史验收事实不得被改写为新技术栈已通过的证据。

当前交付 SHALL 移除 NiceGUI 相关认知、实现、依赖、模板、运行入口及使用指导，不保留 NiceGUI 兼容层或默认环境回退。历史归档与真实验收记录 SHALL 保留原事实；必要旧包迁移输入 SHALL 仅作为测试夹具，不进入新版脑包。清理 SHALL NOT 删除既有 Work 已捕获的包、应用或用户数据。

默认环境是可覆盖的开发选择，不改变 BRN-002 的语言/框架自由或第三方应用边界。用户指定其他栈、维护已有应用或采用派生镜像时，Pi SHALL 使用实际目标环境，仍完成同一业务/反馈/验证契约。基础镜像 SHALL 不包含模型凭据、私有 Memory 或脑包执行引擎。

脑包 SHALL 知道 sqlite3 CLI 分别由 Agent 和 base 镜像提供，AI bash 在 Agent 中执行，仅 Service 拥有该命令不能作为 AI 可直接使用的证据。获准的数据开发和诊断可使用实际命令；普通业务操作仍走原 Query/Action/版本契约，不直接改写平台受管状态。旧镜像缺命令或 bash 被 deny 时 SHALL 明确说明，不临时扩大权限或伪称已安装。

既有 Work SHALL 保留其已捕获脑包、业务源码、数据和镜像；采用新默认脑包仍经过现有 Package Update、显式 Apply 和实际采用验证。首次默认选择保持一次性初始化；Core 自身的原内置旧脑包 SHALL 随 Core 启动更新，管理员定制保持原样，不能重新添加默认选择或转换旧应用。新 brain 引用的镜像不可用时 SHALL 报告真实部署失败，不回退到 NiceGUI 或其他可变镜像冒充默认环境已可用。

#### Scenario: 新 Work 无需选择环境
- **WHEN** 使用新默认脑包的 Work 接到未指定技术栈的 Web 开发任务
- **THEN** Pi 从固定基础环境和匹配模板开始，完成 Service 部署及业务验证，不要求用户重复解决 Python/Node/前后端工具链

#### Scenario: 既有 Work 保留原内容
- **WHEN** Core 更新后加载一个仍捕获旧脑包的 Work
- **THEN** 不静默替换包、镜像或业务代码；用户通过既有更新和显式 Apply 才采用新默认指导

#### Scenario: 显式其他栈和派生镜像
- **WHEN** 用户指定另一技术栈或从 Web base 派生的镜像
- **THEN** Pi 沿用该选择及现有业务契约，不强制重写成默认模板

#### Scenario: 默认镜像不可获得
- **WHEN** 固定镜像不可拉取且本地不可用
- **THEN** 原 Service Operation 报告实际镜像失败，Pi 不宣称开发环境或应用已就绪，不替换成 NiceGUI

#### Scenario: 更新 Core 后的新建 Work
- **WHEN** Core 已将原内置 NiceGUI 脑包更新为随当前 Core 提供的脑包，用户创建默认 Work
- **THEN** 新 Work 使用 FastAPI + React + TypeScript + Vite 指导、匹配模板和固定 Web base 引用，不再取得旧 NiceGUI 默认指导

#### Scenario: 新包不再交付 NiceGUI
- **WHEN** 构建并检查当前 Core 内嵌脑包及有效运行依赖、模板和入口
- **THEN** 不包含 NiceGUI 依赖、实现、使用指导或回退；历史记录和隔离的迁移测试输入不作为当前交付内容，既有 Work 数据保持原样
