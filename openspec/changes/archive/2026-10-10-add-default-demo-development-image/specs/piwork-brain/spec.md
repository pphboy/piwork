# Spec Delta

## ADDED Requirements

### Requirement: 默认采用可复用 Web 基础环境

**Identifier:** BRN-008

全新脑包 SHALL 将 FastAPI + React + TypeScript + Vite 作为未指定技术栈的新 Web Service 的默认环境，并提供匹配 WEBBASE-001 至 WEBBASE-007 的固定基础镜像引用、模板和部署指导。包内 SHALL 保留可查环境身份，使 Agent 无需猜测镜像版本或每次自行安装基础工具链；维护指导 SHALL 指向仓库的长期镜像维护源，不能将脑包内引用或 Work 副本误当构建源。当前认知、Skill/Reference 和模板 SHALL 不再依赖或推荐 NiceGUI；历史验收事实不得被改写为新技术栈已通过的证据。

默认环境是可覆盖的开发选择，不改变 BRN-002 的语言/框架自由或第三方应用边界。用户指定其他栈、维护已有应用或采用派生镜像时，Pi SHALL 使用实际目标环境，仍完成同一业务/反馈/验证契约。基础镜像 SHALL 不包含模型凭据、私有 Memory 或脑包执行引擎。

脑包 SHALL 知道 sqlite3 CLI 分别由 Agent 和 base 镜像提供，AI bash 在 Agent 中执行，仅 Service 拥有该命令不能作为 AI 可直接使用的证据。获准的数据开发和诊断可使用实际命令；普通业务操作仍走原 Query/Action/版本契约，不直接改写平台受管状态。旧镜像缺命令或 bash 被 deny 时 SHALL 明确说明，不临时扩大权限或伪称已安装。

既有 Work SHALL 保留其已捕获脑包、业务源码、数据和镜像；采用新默认脑包仍经过现有 Package Update、显式 Apply 和实际采用验证。首次种子规则与管理员定制保持原语义，不能以本变更为由静默重新种子或转换旧应用。新 brain 引用的镜像不可用时 SHALL 报告真实部署失败，不回退到 NiceGUI 或其他可变镜像冒充默认环境已可用。

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

### Requirement: 修改应用后主动完成生效与刷新

**Identifier:** BRN-009

brain/harness 的默认开发认知 SHALL 将“让修改实际生效”视为当前任务的交付责任。修改由 Pi 开发维护的应用代码/配置后，Pi SHALL 通过现有部署 Skill 自动完成必要检查、构建、Service 更新或重启、原 Operation 结果观察、实际运行代码版本和受影响业务验证；不能仅保存文件就让用户手动刷新、重启或完成部署。具体环境/页面更新机制 SHALL 由 Skill/Reference 和模板提供，不新增 Harness 执行引擎或绕过现有工具权限。

支持的默认模板 SHALL 按 WEBBASE-007 自动更新已打开页面；Pi SHALL 区分文件已写、运行版已更新与页面是否具备自动采用路径，不把 Service Ready 或模型文字当作新版业务通过。没有实际可用的部署/刷新能力或验证失败时 SHALL 如实说明并进行原预算内有界修复，不要求用户用手动刷新掩盖未完成的工程工作，也不虚构已观察到所有浏览器。

普通业务数据操作 SHALL 继续使用已有 Query/Action，不为刷新页面修改代码、重启 Service 或触发新 Agent 目标。本规则 SHALL 不修改脑包自身软件更新、Work 配置或包的显式 Apply 边界；第三方页面仍遵循实际可观察范围。

#### Scenario: AI 修改后完整交付
- **WHEN** 用户要求修改默认应用的界面或业务逻辑
- **THEN** Pi 自动完成必要构建/部署与新运行版本验证，默认页面自动采用；回复提供实际结果而非要求用户刷新或重启

#### Scenario: 验证失败不能依赖用户刷新收尾
- **WHEN** 文件已修改但构建、部署或实际业务验证失败
- **THEN** Pi 保留真实失败与代码依据并尝试有界修复，不能报告完成或让用户手动刷新作为通过证据

#### Scenario: 自刷新不触发脑包自动 Apply
- **WHEN** 普通应用更新完成，或 Pi 正式准备了新的脑包候选
- **THEN** 应用按原 Service 流程生效；脑包候选仍等待显式 Apply，不借应用刷新改绑 context 或重放旧 Run
