# 验收记录

首次验收 2026-11-17，2026-11-24 续验。范围：任务 1.1–5.5。集成验收使用隔离临时数据目录。17891 的预览更新与上线检查单列。

## 已执行并通过

| 范围 | 命令 / 用例 | 结果 |
| --- | --- | --- |
| 契约 | `npm run test:unit -w @piwork/contracts`（含 `skill-content.test.ts`） | 55 通过 |
| 契约生成 | `make generate`、`node scripts/check-generated.mjs http` | 生成物与来源一致 |
| Go 契约 | `go test ./internal/contracts` | 通过 |
| 制品处理 | `go test ./internal/skillartifact` | 通过（单文件替换、非法路径、非文本、8 MiB / 32 MiB 边界、未编辑字节不变） |
| Core 内容 API | `(umask 0022; go test ./internal/coreapp)` | 通过（读取边界、冲突、目录更新竞争、权限撤销、重启持久化、上传槽释放） |
| 浏览器转发 | `go test ./internal/consoleapp` | 通过（精确路由、单一 path 查询、64 MiB envelope、其他管理 API 1 MiB、Origin/CSRF/角色、未知结果） |
| Console 单元 | `npm run test:unit -w @piwork/console-webui` | 170 通过（含 `skill-editor.test.mjs`） |
| Console 类型 | `npm run typecheck -w @piwork/console-webui` | 通过 |
| Console 浏览器 | `npm run test:browser` | 292 通过（含新增能力库、编辑、搜索、Ctrl+S、行菜单目标隔离、未保存离开/浏览器后退、默认 Packages 排序、窄屏、默认引用保护用例） |
| 内嵌资源（11-24 复核） | `node scripts/check-generated.mjs ui` | 通过 |
| 宿主构建（11-24 复核） | `make build-go` | 通过（`dist/go` 仅含 Core/CLI） |
| 仓库边界 | `check-native-boundary.mjs`、`check-webui-boundaries.mjs`、`check-ui-language.mjs`、`check-repository-docs.mjs`、`git diff --check` | 全部通过 |
| 真实 Core 浏览器（11-24） | `npm run test:real-core -w @piwork/console-webui -- -g 'real Core Skill content edit\|real browser Package directory'`（`umask 0022`） | 2 项通过。通过真实管理页上传目录、读取并保存单文件，确认非文本只读、内嵌资源和匿名权限拒绝。默认 Skill 选择和仅修改 Packages 顺序的 PATCH 均成功。Core 重启后，正文、默认 Skill、Package 顺序和页面标记回读正确。目录安装与 Operation 深链接回归通过。 |
| Work 副本隔离（11-24） | `go test -tags integration ./internal/coreapp -run '^TestNativeSkillsUseIndependentCopiesAndExplicitReselection$' -count=1 -v`（`umask 0022`、本地 `go-migration-acceptance` Agent 与 helper 镜像） | 真实 Docker 用例通过。单文件保存后，已有 Work 和重启后的旧 Work 仍读取旧字节，新 Work 读取已保存内容，显式重选取得当时的 Core 版本。 |

## 首次验收的环境问题

- Work 副本的 Docker 用例初次卡在 `defaultContext` 重试。11-24 用现有 acceptance 镜像和 `umask 0022` 重跑通过，未改 Runtime 或 Work materialization。
- 浏览器用例初次未配置 fixture Runtime，默认配置页没有编辑入口。续验复用了 `saveFixtureRuntime`，并将重启放在两类默认配置保存之后，直接断言重启读回。涉及 `apps/console-webui/test/real-core.spec.mjs` 的 Runtime 与目录安装夹具、`internal/coreapp/skill_activation_integration_test.go` 的隔离断言，以及 `internal/coreapp/default_work_patch.go` 的有序数组保存。
- `go test ./internal/coreapp` 的 `TestCustomOperatorRejectsUnsafeFilesAndParentsWithoutChangingThem/public` 在 `umask 0077` 下失败，以 `umask 0022` 运行整套通过。

## Work 设置导航对齐（11-24）

- Console 构建和 13 项定向 Playwright 测试通过。`management-flow.spec.mjs` 在 1440px、360px 实测能力库与新 Work 默认之间的导航边界一致，当前项的字体、颜色及指示样式与管理顶栏一致。截图保存在 `dist/server-ui-core-flow/management/`。
- 内嵌资源检查、`make build-go`、UI 语言及仓库边界检查通过。按用户要求将本地构建更新到 17891 预览并复用原数据目录。已核对运行二进制与构建一致，UI 健康、Core READY，三个管理入口均按现有会话规则跳转登录。

## 环境处理

- 主页存在空的 `/home/p/.git` 目录，导致所有 `-buildvcs=true` 构建把 `/home/p` 误判为仓库并失败；已删除该空目录，`make build-go` 恢复。
