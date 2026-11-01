# 项目维护选择性导航

以下是 `7c23255` 的真实入口；“拟抽取”不是已存在模块。正式安装时按已实施结果更新路径，不复制源代码或另建平行产品规则。

## 先选择影响类别

只读所需行，不默认读全部路径；具体需求还需查看有效主 Spec 与未同步 delta。现有 RDOC-008 的 `simplify-linux-delivery` delta 已修正旧主规格命令，不从旧说明恢复过时平台。

| 类别 | 最小事实入口 | 关联与适用检查 |
|---|---|---|
| Go/TS 业务与边界 | 本功能 `internal/` 包或 `apps/agentd`/`packages/` 的接口及测试 | 当前 capability；native-boundary 与对应 `.test.mjs`、所属 unit/契约；真实 Engine 仅相关时 |
| 配置/缺省 | `internal/app/run.go`/`run_test.go`；按需 `internal/distribution/` 或 `internal/coreapp/work_configuration_*` | 默认/非法/旧键/兼容/生效范围；`scripts/native-server-defaults.mjs`；受影响 UI/帮助/部署，不读真实 env |
| 协议/生成 | `Makefile` generate；所改 `proto/`、contracts 定义或 `internal/workhistory/` SQL | 对应 generate 脚本、生成清单与 Go/TS wire 测试；HTTP 有冻结 schema 基座，不能猜唯一单文件源 |
| 文档/部署/示例 | 对应现有双语文件；RDOC/有效 delta；`scripts/docker-quickstart-content.mjs` | `check-repository-docs.mjs`/`check-docker-quickstart.mjs` 及 `.test.mjs`，模板→生成命令/Compose；不改冻结发布身份 |
| UI/资源/语言 | 下方对应 WebUI 行；共享 tokens/controls/catalog | `check-ui-language.mjs`/`.test.mjs`；所属 typecheck/browser、copy-static/sync 与 Go 嵌入资源 |

检查命令及条件沿 AGENTS/Makefile，存在脚本不等于已执行。完整 `make test`、`make acceptance` 依赖不同；纯文档不要求无关 Docker/付费模型。更新本索引只记录实际 owner/source/interface/tests，不复制实现或新增长期报告。

## WebUI 任务才展开

| 要改什么 | 先读 | 再按需要读 | 关键测试 |
|---|---|---|---|
| 等待图形/几何 | `apps/ui-shared/controls.css`、`tokens.css`；两端 `src/pending.ts` | `ui-language` 的 UIL-PENDING-001；本功能 ActionState 映射 | Desktop `test/pending-dots.test.ts`、`action-state.test.ts`；Console `test/feedback.spec.mjs` |
| 导出状态推进 | Desktop `src/export-flow.ts`、`export-admission.ts` | `ExportPort` 对应 adapter 实现；DUL-009 | `test/export-flow.test.ts`、`export-admission.test.ts` |
| 导出面板（拟抽取） | 当前 Desktop `src/app.ts` 中 `exportPanel` | `downloadProgressMarkup`、modal shell，避免默认读全 app | 当前 `test/export-presentation.test.ts`；迁移后改直接模块导入 |
| Work Header / Service Toolbar（拟抽取） | 当前 Desktop `src/app.ts` 的 `workHeader/services/focusControls` | `workspace-layout.ts`、DUL-002/007、所需适配器只读事实 | `workspace-hierarchy.test.ts`、`compact-work-controls.test.ts` |
| Serve 等待及修改后回读 | Console `src/action-state.ts`、`app.ts` 的具体操作 | SUI-005/006、本功能 adapter 方法；模型优先 `model-management.ts` | `test/feedback.spec.mjs`、对应 management/model/quick-setup 测试 |
| 统一通知（拟新增） | 获批后共享 notification 策略/展示模块 | UIL-NOTICE-001、所属功能发布事件/恢复端口 | 直接策略测试 + 两端通知集成 |
| 资源交付 | 两端 `scripts/copy-static.mjs` 与相关 sync 脚本 | 真实 Go 静态路由、CSP、嵌入资源 | 构建/浏览器入口检查；原型静态站不能证明通过 |

只读审查发现：当前 Desktop `export-presentation.test.ts` 仍抽取 app 源码函数，这是需要迁移的边界缺口，不是新测试的推荐模板。两端 ActionState 行为不同，不能只因名称相同就合并。
