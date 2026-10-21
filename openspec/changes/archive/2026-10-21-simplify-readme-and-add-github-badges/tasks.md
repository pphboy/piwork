# Tasks

## 1. 解耦详细说明与 README 生成

- [x] 1.1 在 `scripts/docker-quickstart-content.mjs` 提取统一原生 Linux 说明，并由双语部署手册的稳定章节承接；保留启动、三项运行配置、默认目录/HTTP 地址、直接创建管理员与普通登录、固定 Agent、正常关闭及真实历史版本边界。验证：核对原 README 的必要内容均有去向，在现有专项测试中确认两种语言原生命令一致且 shell 语法有效。
- [x] 1.2 调整 `scripts/sync-docker-quickstart.mjs`，移除对根 README 教程标记、Architecture 排序及内容写入的依赖；保留详细手册、Compose、单机材料与记录的同步。验证：在隔离夹具中用无旧标记的简短 README 执行同步和重复同步，回归断言两种语言 README 字节不变，已发布历史记录不变。
- [x] 1.3 调整 `scripts/sync-docker-website.mjs`，直接从共享内容生成官网原生说明，不再提取根 README 折叠块。验证：更新现有官网生成测试，在精简 README 夹具下核对中英文默认/原生入口、数据与直接创建管理员/普通登录说明、相对链接和候选/已发布提示完整，无空内容或 `undefined`，历史下载未覆盖。

## 2. 精简双语首页并调整对应检查

- [x] 2.1 重写两份根 README，保留 Logo、互链、短定位、三个核心概念、现有视频与截图、文档/社区/贡献导航、至多三条 Roadmap 和许可证入口；移除所有内嵌或折叠的使用/配置/构建教程及版本长段。验证：人工审阅双语结构和含义，以约 60–80 行为编辑目标，段落最多两句，所有必要操作说明可从既有入口取得。
- [x] 2.2 添加最新 Release（含 Preview）、Apache-2.0、Stars、Linux 服务端四类徽章，配置对应仓库来源、替代文本及点击目标，并在现有检查/测试中覆盖必要语义。验证：关闭外部图片仍有可读说明和链接，去掉预发行查询、换错仓库或破坏目标的负例能够失败；不依赖实时 Stars 或徽章联网响应。
- [x] 2.3 将 `scripts/check-docker-quickstart.mjs` 的根 README 展示/导航检查与详细手册命令检查分开，官网以手册为命令基准；同步调整四文档夹具和相关负例。验证：现有专项测试保留挂载、网络、秘密、候选提示、语言命令、下载与历史身份漂移检测，精简 README 不再需要启动标记、折叠块或 Architecture 章节，详细材料漂移仍明确失败。
- [x] 2.4 同步 `AGENTS.md` 中 README 职责与 Docker 材料维护约定，保留构建/测试流程和完整部署材料的有效导航。验证：查阅相关段落已无强制将教程和默认命令写回根 README 的要求，中英文入口与现有文件/锚点一致。

## 3. 集成核对与交付审阅

- [x] 3.1 执行 `node scripts/check-docker-quickstart.mjs`、`node scripts/check-repository-docs.mjs`，以及 `node --test scripts/check-docker-quickstart.test.mjs scripts/check-repository-docs.test.mjs scripts/stage-go-release-materials.test.mjs`。验证：整体检查通过，生成的隔离官网材料通过对应一致性检查，负例保持安全诊断；不运行真实模型或 Docker 业务验收。
- [x] 3.2 使用真实当前源码 commit 将实际选用材料暂存到忽略的 `dist/`，核对显式清单选用的图片、许可证、详细手册和 Compose 的链接闭包；双语根 README 及展示图在仓库内单独核对，不重新纳入发行包。验证：本地必需资源存在，未提交内容正确随包，外链不被改成错误固定 commit；人工检查两种语言渲染后的短页面，无教程回流或图片替代文本缺失。
- [x] 3.3 核对最终范围和发行身份，执行 `git diff --check` 与 `openspec validate simplify-readme-and-add-github-badges --strict --no-interactive`，按真实执行结果更新本变更任务。验证：本变更未改写已发布 release/历史记录/镜像默认值，未创建根 `docs/`、Git tag 或新发行，未修改仓库 Topics 或推送外部网站。

## 4. 核验问题修复

- [x] 4.1 补齐 DOCKER-DELIVERY-011 的“端口或发布身份漂移”场景，将三条重叠规格与已授权的 Linux 精简变更对齐，并修正 proposal/design/tasks 中的旧平台、首次授权、CLI 容器及发行材料表述。验证：两份变更的三条重叠 Requirement 全文一致，不恢复已取消功能。
- [x] 4.2 重新执行严格规格校验、文档检查、专项测试及 diff 检查，并核对当前材料暂存和双语页面。验证：两份变更严格校验、两项文档检查、38/38 专项测试及 diff 检查通过；真实当前源码 commit 的 8 项材料暂存通过，双语 README 与已人工检查的本地渲染内容一致。临时输出位于忽略的 `dist/verify-readme-repair-*`；未执行规格同步、归档或对外发布。
