# Proposal

## Why

双语 README 目前各有 213 行，项目介绍与安装、配置、操作教程及多段版本说明混在一起，首次浏览很难快速理解 Piwork。需要将 README 收敛为简短项目首页，并调整仍强制向 README 写入教程的发布工具，避免下一次同步恢复长内容。

## What Changes

- 同步精简 `README.md` 与 `README.zh-CN.md`，以约 60–80 行为编辑目标；保留居中 Logo、语言切换、简短定位、三个核心概念、演示视频和截图。
- 从根 README 移除安装、启动、首次配置、CLI、导入导出、构建与验证命令，以及版本更新长段和详细运行限制；使用官网、部署手册、Releases 和开发约定链接承接说明，Roadmap 至多保留三条。
- 在顶部加入最新 GitHub Release（包含 Preview）、Apache-2.0、Stars、Linux 服务端四类徽章，链接指向真实项目资源；本变更中的“GitHub tag”指 README 徽章，不修改仓库 Topics 或创建 Git tag。
- 将根 README 中仍有必要保留的统一原生 Linux 启动说明放入既有双语部署手册，通过共享内容渲染供官网同步使用；官网生成不再读取根 README 的折叠教程。
- 调整生成与一致性检查：根 README 校验精简展示和文档导航，部署手册、Compose、单机示例及官网材料继续校验完整启动命令、固定镜像身份和运行边界。
- 同步开发约定中 README 的职责，保留详细使用材料、历史下载、发布记录及现有发行真实性约束。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `repository-documentation-governance`：将根 README 的职责从内嵌使用/构建说明调整为双语简短介绍与有效导航，保留产品资源及发行材料链接完整性。
- `docker-delivery`：调整 README 默认入口及材料同步契约，明确顶部徽章、使用说明的承接位置和生成工具的边界，继续保证详细安装材料与官网一致。

## Impact

- 展示与约定：`README.md`、`README.zh-CN.md`、`AGENTS.md`。
- 详细说明与生成：`deploy/docker/README.md`、`deploy/docker/README.zh-CN.md`、`scripts/docker-quickstart-content.mjs`、`scripts/sync-docker-quickstart.mjs`、`scripts/sync-docker-website.mjs`。
- 一致性检查与回归：`scripts/check-docker-quickstart.mjs` 及对应测试；复用仓库文档检查和发行材料链接检查。
- 本次只调整文档、文档生成和相应契约，不更改服务端/客户端行为、镜像默认值或已发布制品身份；官网仅在隔离夹具中验证生成，不推送网站、镜像或 Release。
