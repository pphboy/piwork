# remove-docs-dir 实施验收

本记录只说明本次文档迁移、资源与工具验证。历史附件、970 条 Go 迁移场景及未完成平台验收保留各自原身份，不被本次结果重新签收。

## 实施结果与身份

- 源基线 commit：`8b49c2cec1c6708a601d1809a97f81491525d81d`；采集时 modified：`true`。本次工作树仍未提交；未创建 Tag、Release、push 或对外发布。
- 原根目录的 114 个文件全部列于 [迁移清单](migration-map.json)：51 Markdown、48 PNG、11 Excalidraw、2 JSON、1 HTML、1 SVG。根 `docs/` 已不存在。
- 现行说明按能力提炼到本变更的 16 份 delta Spec，共 32 个 Requirement，并映射已有主规格。混合文档同时保留历史附件和当前 Spec 归属，主规格没有提前同步。
- 历史材料和原型保留为 91 个附件；二进制及两个 JSON 字节身份保持。18 个 Markdown 附件仅修复链接目标，正文和链接文字经原快照逐项比较一致。已有归档事实及发布 commit/dirty/hash/digest 未改写。
- 共享 Logo 位于 `apps/ui-shared/assets/piwork-logo.png`，SHA256：`bed999510609e8e24b96a4f4f0aaa7c3572384248fd2bc37cce943190abd95ab`；两端静态 URL、嵌入字节和 Host 边界保留。
- 原始 CLI 平台进度、未完成 Windows 实机验收、旧格式与新格式范围分别保留；本次不运行真实模型、完整 Docker 产品验收或外部官网同步。

## 实际验证

环境：Go 1.25.5、Node 24.21.0；Node 24 通过本机 npm 工具缓存选择，未改 .nvmrc / 锁文件。日志和可重建输出均在被忽略的 `dist/remove-docs-dir/` / `dist/verification/`。

| 命令或检查 | 实际结果与范围 |
| --- | --- |
| `npm ci`、`make build` | 通过；保留 harness、两端 WebUI 和七个 Go 程序构建 |
| 无根 docs 状态下 `make test` | 通过；Go、脚本、保留 TS 单元/契约及两端类型检查。两处 Go Logo 测试的分段旧路径修复后复验通过 |
| 无根 docs 状态下 `make build-cli` | 通过；Linux/Windows 客户端交叉构建，不代表 Windows 原生实机验收 |
| 独立 Linux CLI 运行 | 在临时非源码 cwd、PATH=/nonexistent、独立凭证位置启动，读取原 PNG 和 MIME；准确 desktop.localhost Host 通过，其他 Host 拒绝。启动票据未输出到本记录 |
| Go Desktop / Console 原生静态入口定向测试 | 通过；`TestNativeDesktopEmbeddedBrowserAndLocalIdentity`、`TestNativeConsoleBrowserAndAdministratorSession` |
| Console `test:browser` | 75/75 通过 |
| Desktop 串行 `test:browser` | 251 项：249 通过、1 原有 skip、1 基线失败，详见下节；本次资源/授权/深链接相关用例通过 |
| 共享资源与发行材料脚本检查 | 全部 `scripts/*.test.mjs` 74 项通过（其中相关构建/CLI 平台/Quick Start 检查曾单独执行 42 项）；本地 staging 的真实双语材料、图片与本地链接核对通过，未运行完整镜像发行 |
| 生成器和治理检查 | 默认 dist 输出、无根 docs 隔离副本、冻结附件不变、970 项原身份/状态、错误证据/矩阵/重复项拒绝、根目录/悬空链接/锚点/未知目标拒绝均验证 |
| `make acceptance-index`、`check-go-acceptance` | 通过；重新生成历史索引，保留其原 970 项通过记录。这是证据完整性检查，不是重跑 970 项产品场景 |
| `check-native-boundary`、`check-repository-docs`、`check-docker-quickstart` | 通过；当前文档 50 份与本次迁移清单有效；源码和部署材料边界保持 |
| `openspec validate remove-docs-dir --strict`、`git diff --check` | 通过 |

## 浏览器基线问题与复验

`Brain saving preference survives a concurrent Session refresh and does not alter accepted Run metadata` 返回 `DesktopError: Choose an available model.`。以原 HEAD 的 Desktop 源码、测试和公共资源在独立目录编译并运行同一用例，复现完全相同失败；对应授权恢复四项在该隔离基线均通过。本次未修改 adapter/app 等产品浏览器逻辑，也未降低断言或跳过该失败。

首轮静态目录构建与浏览器执行并行，使部分页面/图片读取遇到临时缺失。停止并行重建后串行完整复验，授权恢复与图片用例通过，仅剩上述可独立复现的模型夹具失败。此项不被报告为迁移回归通过，也不被本次资源迁移擅自扩展为模型功能修复。资源行为另外由原生两端静态入口和独立 CLI 字节检查验证。

## 提交范围与后续

当前未执行 Git commit。拟按依赖顺序组织：先让能力 delta 和对应历史附件可供引用；产品资源、路径消费、生成/打包工具与其测试同组；中英文使用入口对应修改同组；开发约定与项目工作流配置单独组织。根目录删除及新检查接入须与已切换的依赖形成完整迁移，同文件的不同目的按 diff 分段暂存，完整序列后再核对本记录列出的集成与发布身份。

本次只实施 `remove-docs-dir`。主规格同步、本变更归档及其他变更归档均等待所有者另行请求；没有重写 Git 历史或用户运行数据。
