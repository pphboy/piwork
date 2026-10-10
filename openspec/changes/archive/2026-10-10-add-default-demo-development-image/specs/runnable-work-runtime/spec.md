# Spec Delta

## ADDED Requirements

### Requirement: Agent 镜像预装可由 SDK bash 使用的 sqlite3 命令

**Identifier:** RUNTIME-TOOLS-SQLITE-001

项目交付的 Agent 生产与验收镜像 SHALL 预装真正的 sqlite3 CLI，并在非 root runtime 的 PATH 中可执行。获准的 Pi SDK bash SHALL 能直接对当前 Work 授权的 workspace 数据库执行建表、写入、查询及机器可读输出，不要求用户安装工具、启动时联网、临时 root 或 Docker exec。只有 SQLite 库、Python 模块、Node API 或仅 Service/base 镜像的命令 SHALL NOT 作为此要求的完成依据。

该系统命令 SHALL 沿用现有 Work/工具策略和共享文件身份；bash 被 deny 时不得通过其他入口扩大权限。命令不会获得额外宿主挂载、Docker socket、Core 凭据或其他 Work 内容。普通业务变更仍遵守 Service Action/Query 契约，CLI 不提供绕过平台受管状态机制的授权。

sqlite3 是 Agent 镜像能力，新增命令 SHALL 构建并验证新兼容 Agent 镜像；脑包/Skill 更新不能伪称给旧固定镜像补装了命令。既有 Work SHALL 保留捕获镜像，沿原显式镜像选择及 Apply 流程采用；旧环境缺 CLI 时 SHALL 明确说明。宿主 Core/CLI/Console 不新增 sqlite3、Python 或 Node 运行依赖。

#### Scenario: 真实 SDK bash 调用 sqlite3
- **WHEN** 使用新 Agent 镜像的 Work 允许 bash，AI 执行获准的 workspace 数据检查任务
- **THEN** 真实 SDK bash 执行 sqlite3，在合成数据库建表/写入/查询并取得可核对的机器可读结果，无需额外安装

#### Scenario: 生产和验收镜像均提供命令
- **WHEN** 分别检查 Agent production 与 acceptance 镜像的非 root 运行环境
- **THEN** 两者均可执行 sqlite3 并操作共享身份拥有的合成 workspace 数据库，不只在验收 target 提供

#### Scenario: Service 有工具不能替代 Agent 验收
- **WHEN** Service 使用含 sqlite3 的 Web base，但 Agent 仍捕获不含该命令的旧镜像
- **THEN** 不能宣称 AI bash 已具备该工具，报告实际缺项并保留原镜像，采用升级需要原显式流程

#### Scenario: 工具策略保持生效
- **WHEN** 当前 Work 的策略禁止 bash
- **THEN** sqlite3 二进制存在不绕过该限制，模型不取得额外 SQL 执行入口、Docker 能力或宿主依赖
