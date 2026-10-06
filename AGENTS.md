# 仓库开发约定

本文件供开发代理和维护者使用。用户安装、操作和故障处理说明放在 README 与 docs/。

## 语言与文档

- OpenSpec 规格使用中文，保留已有 Requirement、Scenario 和标识符约定。
- README.md 是默认英文入口，README.zh-CN.md 提供中文版本；两份文档顶部互链，章节、命令、架构图及当前限制保持同步。缺少材料的章节继续留空。
- README 面向首次使用者，保留项目介绍、使用入口、构建命令和文档导航。
- 开发约定与实现边界放在本文件；用户操作放在 docs/；设计与原型放在 docs/design/；验收事实放在对应验收记录中。
- 历史设计和验收记录不能作为当前实现的依据，核对现行源码、规格和实际执行结果。

## 当前架构

- Go Core 负责用户与权限、Work 生命周期、Docker 编排、Service、文件、包和快照。入口为 cmd/piwork-serve/，operator 命令由 internal/coreoperator/ 实现；piwork 是该程序的别名。
- Go CLI 负责用户命令、本机代理和 Desktop；Go Console 提供独立的管理员 HTTPS 界面。入口分别为 cmd/piwork-cli/ 和 cmd/piwork-console/。
- Service MCP、package-helper、file-helper、snapshot-helper 均由 cmd/ 中对应的 Go 程序实现，随 Agent 或 helper 镜像交付。
- apps/agentd/ 是容器内完整的 TypeScript Pi Agent SDK harness，包含 RPC、Session/Run、历史、模型/工具执行与资源加载。
- packages/contracts/、pi-adapter/、pi-package/、work-store/ 保留 Agent 所需的契约、SDK 适配、包加载和私有历史依赖，不能按“Core 已改 Go”整体删除。
- apps/desktop-webui/、console-webui/ 保留浏览器 TypeScript；构建后的资源嵌入 Go 程序。
- Core、CLI、Console 和 Go helper 关闭 CGo。宿主平台运行时不依赖 Node、npm、Python、Go 工具链、Docker CLI 或 OpenSSL；镜像内 harness/Pi 生态及用户 Service 的语言依赖按各自职责保留。
- Core 使用本机 Docker Engine Unix API。当前 Core 部署在 Linux；客户端覆盖 Windows 和 Linux。构建工具依赖与用户运行依赖分开描述。
- 当前生产入口使用 Go 平台。旧 TS Core 分支和提交历史保持现状，除非用户另有明确要求，不改写历史或继续处理旧分支。

## 目录约定

| 路径 | 用途 |
| --- | --- |
| cmd/、internal/ | Go 入口与内部实现，包目录使用 Go 小写命名 |
| apps/、packages/ | TypeScript 应用与共享包，工作区目录使用小写连字符命名 |
| apps/*-webui/test/ | 浏览器测试；包内单元测试可与源码并置 |
| scripts/ | 构建、生成、验证与打包入口 |
| deploy/docker/ | 双 Docker 安装材料与手册 |
| fixtures/、internal/*/testdata/ | 必要的合成夹具与协议 golden 数据 |
| docs/、docs/design/ | 用户/开发文档与设计材料 |
| openspec/ | 主规格、变更规划和归档 |
| dist/ | 被忽略的构建产物与本机验证输出 |

## 运行与数据边界

- operator 身份与用户 CLI 身份分离；用户 CLI 不读取 operator 凭证，管理员控制权限不等于读取他人 Work 内容的权限。
- CLI 与 Desktop 共用用户凭证，但 Desktop 的默认 Core 偏好独立于业务 CLI 的地址选择。调整入口时核对 docs/cli-platforms.md 中的优先级和恢复规则。
- Core 正常退出会停止本安装全部受管 Work 运行容器，保留持久意图、配置、历史和数据，供重启恢复。CLI 或 Console 退出不停止 Work。
- Work workspace 是受管共享卷。导出前须确认 Work stopped；导入得到 stopped Work，随后由用户显式 Start。
- 为开发或测试使用独立安装和数据目录。Docker 清理只针对本次创建的精确 installation ID/标签，不执行全局 prune 或删除其他安装资源。
- 真实 env、密码、API key、token、Core 数据、凭证、快照及私钥不提交到 Git，也不输出到公开文档或验收报告。必要的合成测试数据继续保留，忽略规则维护在 .gitignore 与 .dockerignore。

## 构建与验证

基础环境为 Go 1.25.5、Node 24（.nvmrc）、npm、Git、Make 和 Bash。干净 clone 的基础流程：

```sh
npm ci
make build
make test
```

按改动范围选择验证：

- Go 或保留 TS 业务代码：执行对应单元/契约测试；涉及工作区或构建入口时核对基础构建流程。
- CLI 平台适配：使用 make build-cli 和 docs/cli-platforms.md 的平台检查入口。
- 浏览器资源：通过各 workspace 的构建与 Playwright 入口核对；资源嵌入 Go 程序，修改后需重新构建宿主程序。
- Docker、Work 生命周期及真实 Core 交互：执行相关 integration 测试；完整入口和额外依赖见 docs/testing.md。
- 平台源码边界：node scripts/check-native-boundary.mjs；镜像边界使用对应 image 检查入口。
- 纯文档整理：检查链接、命令与源码的一致性以及 git diff --check，无需为此重跑完整模型或 Docker 验收。

proto、HTTP DTO 和 Work history 的生成入口为 make generate；变更契约时同步生成产物和相关跨语言测试。历史场景索引和跳过项不能替代实际测试通过。

make release 是本机构建与打包入口。对外推送、发布或发行仅在用户明确要求时执行；不要把本地整理或验收自动扩展为发行。
