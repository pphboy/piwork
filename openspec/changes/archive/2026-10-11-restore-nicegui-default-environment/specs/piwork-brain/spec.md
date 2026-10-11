# Spec Delta

## MODIFIED Requirements

### Requirement: 默认采用可复用 Web 基础环境

**Identifier:** BRN-008

全新脑包 SHALL 将 Python + NiceGUI + SQLite 作为未指定技术栈的新 Web Service 的默认环境，提供匹配 WEBBASE-001 至 WEBBASE-009 的基础镜像身份、模板和部署指导。正式默认引用 SHALL 是已发布且验证可用的固定 tag@digest；本地验收 SHALL 显式选择已验证预备镜像，不把候选标记为远端已发布。包内 SHALL 保留可查环境契约，使 Agent 无需猜测镜像版本、重复安装标准 NiceGUI 依赖或准备独立前端构建；维护指导 SHALL 指向仓库长期镜像维护源，不能将脑包引用或 Work 副本误当构建源。

当前默认模板与指导 SHALL 使用 NiceGUI，移除新默认路径对独立 FastAPI + React + TypeScript + Vite 应用工程、node_modules 和前端构建产物的依赖，不将框架切换扩展为删除 NiceGUI 的 FastAPI/JavaScript 传递依赖、Agent 的 Pi SDK 或 Desktop/Console 自身构建。历史归档、已发布固定镜像及真实验收记录 SHALL 保留原事实；既有 Work 已捕获的包、应用与用户数据 SHALL 不被清理。

默认环境是可覆盖的开发选择，不改变 BRN-002 的语言/框架自由或第三方应用边界。用户指定其他栈、维护已有应用或采用派生镜像时，Pi SHALL 使用实际目标环境，仍完成同一业务/反馈/验证契约。基础镜像 SHALL 不包含模型凭据、私有 Memory 或脑包执行引擎。

脑包 SHALL 指导 Pi 直接复用标准环境，并在需要额外 Python 包时遵循 WEBBASE-008，通过现有 Service 命令和应用依赖声明在 workspace 准备独立可写环境，确认实际安装及应用使用，不要求运行中的 Pi 构建镜像、Docker exec 或修改只读根。脑包 SHALL 知道 AI bash 在 Agent 中执行；Service 拥有 Python/pip/sqlite3 不能作为 AI bash 可直接调用这些工具的证据。sqlite3 CLI 分别由 Agent 和 base 提供；获准数据开发和诊断可使用实际命令，普通业务操作仍走原 Query/Action/版本契约。缺工具或 bash 被 deny 时 SHALL 说明实际限制，不扩大权限。

既有 Work SHALL 保留其已捕获脑包、业务源码、数据和镜像；采用新默认脑包仍经过现有 Package Update、显式 Apply 和实际采用验证。首次默认选择保持一次性初始化；Core 自身原内置旧脑包 SHALL 随 Core 启动更新，管理员定制保持原样，不能重新添加默认选择或转换旧应用。新 brain 引用的镜像不可用、环境契约不匹配或仍为未发布候选时 SHALL 报告真实部署限制，不回退到旧 FastAPI/React 或其他可变镜像冒充 NiceGUI 环境已可用。

#### Scenario: 新 Work 无需选择环境
- **WHEN** 使用新默认脑包的 Work 接到未指定技术栈的 Web 开发任务
- **THEN** Pi 从匹配 NiceGUI base 的模板开始，完成 Service 部署及业务验证，不要求用户重复解决标准依赖或前端构建

#### Scenario: 既有 Work 保留原内容
- **WHEN** Core 更新后加载一个仍捕获旧脑包的 Work
- **THEN** 不静默替换包、镜像或业务代码；用户通过既有更新和显式 Apply 才采用新默认指导

#### Scenario: 显式其他栈和派生镜像
- **WHEN** 用户指定另一技术栈或从 base 派生的镜像
- **THEN** Pi 沿用该选择及现有业务契约，不强制重写成 NiceGUI 模板

#### Scenario: 默认镜像不可获得
- **WHEN** 固定镜像不可拉取且本地不可用，或引用的环境仍是未验证候选
- **THEN** 原 Service Operation 或部署准备报告实际失败，Pi 不宣称环境或应用已就绪，不替换成旧默认镜像

#### Scenario: 更新 Core 后的新建 Work
- **WHEN** Core 已将原内置旧脑包更新为随当前 Core 提供的新版，用户创建默认 Work
- **THEN** 新 Work 实际加载 NiceGUI 指导、匹配模板与环境身份，既有 Work 仍保留原包和业务

#### Scenario: 新包采用 NiceGUI 默认路径
- **WHEN** 构建并检查当前 Core 内嵌脑包、模板和运行入口
- **THEN** 默认应用不依赖独立 React/Vite 工程，NiceGUI 必要依赖及 Agent/Desktop 自身职责完整，历史记录和旧 Work 保持原样

#### Scenario: 新包不再交付 NiceGUI
- **WHEN** 新版脑包候选遗漏 NiceGUI 默认指导或匹配模板，仍只提供原 FastAPI/React 默认路径
- **THEN** 当前交付检查明确失败，不能将该候选报告为已恢复 NiceGUI 默认环境；既有 Work 的包和数据保留

#### Scenario: 应用需要额外 Python 包
- **WHEN** 用户目标需要一个 base 未预装的兼容 Python 包
- **THEN** Pi 通过实际 Service 环境完成明确的依赖准备并验证应用使用和锁定身份，不把 Agent 中不存在的 pip 或容器只读目录当作安装入口
