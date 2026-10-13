# Proposal

## Why

原三个失败变更的六处 Requirement 已完成语义合并并归档，但规格校验通过和历史验收记录不能证明当前源码与组合交互全部一致。需要针对这六处现行契约及直接关联的 Go 存储边界复核实现、测试和实际执行结果，修复能够复现的剩余实现或测试缺口。

## What Changes

- 以当前 `desktop-webui` 的 DWUI-001、004、007、008，`work-access` 的 WACC-DESKTOP-001，以及 `core-service-startup` 的关闭要求为核对核心；纳入本次已替换旧 TS 升级要求的 CST-NATIVE-001，保留原行为及必要的邻接回归。
- 将上述契约逐项对应到当前源码、已有自动测试和本轮执行结果，区分静态已覆盖、已执行通过、已复现缺陷及仍未验证；原六块的 63 个 Scenario 是本轮起始清单，不将计数作为可替代正文语义的固定产品规则。
- 复用现有 Go、浏览器及独立 Core 集成入口，重点验证授权恢复、HTTP origin 隔离、410 历史恢复与后台执行并存、完整配置草稿、匿名 Inspect 与导入命名恢复、关闭预算和受管资源恢复。
- 对缺少判别力的测试补充确定性交错或失败断言；只有得到违约复现后才修改对应实现。已有测试能够证明约束时复用测试，不为核对数量重建重复用例。
- 将实际核验结果及必要附件保存在本变更中；临时输出继续使用 `dist/`，保留原归档及冻结证据。

### 范围边界

本变更不接续 `support-cross-platform-cli-and-default-desktop` 的九项未完成任务，也不接续 `simplify-docker-release-and-quickstart` 的公共下载交付任务。不新增 Windows 原生支持工作、不改变 Core/CLI API、凭证或包格式、默认入口、关闭预算及产品授权语义，不进行镜像推送、仓库发行或官网发布。

本轮目标是兑现既有契约，当前未确认需要修改 Requirement。使用 `skip_specs: true`，不重复生成已经同步的 delta；若复现揭示必须改变产品契约，应先由所有者明确授权并更新本变更规划，不能通过削弱主规格或改写旧归档取得通过。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。沿用上述现行主规格；本轮只做实现一致性核验、必要回归和已复现缺陷修复，因此跳过 delta specs。

## Impact

- 可能修改的实现：`apps/desktop-webui/src/adapter.ts`、`app.ts`、`configuration.ts`，`internal/cli/user_desktop*.go`，以及 `internal/coreapp/application.go`、关闭/恢复相关实现和 `internal/corestore/`。是否修改取决于复现结果，不预先宣告这些模块存在缺陷。
- 复用的测试：Desktop 的 `local-auth.test.ts`、`recovery.test.ts`、`real-core.mjs`；Go CLI 本地授权/容器模式测试；Core shutdown、Work recovery 进程集成测试及 corestore 格式拒绝测试。
- 浏览器实现如有修改，重建 `internal/desktopassets/static` 和 Go CLI；没有浏览器源码修改时不制造资源差异。涉及生命周期的复现使用独立安装及精确 installation 标签清理。
- 当前发现仅来自只读源码和测试检查；提案阶段未执行本变更的业务验收，也未修改产品代码。
