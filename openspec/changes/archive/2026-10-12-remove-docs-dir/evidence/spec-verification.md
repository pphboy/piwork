# remove-docs-dir 规格核验报告

本次执行 `openspec-verify-change remove-docs-dir`，只核对现有实现、任务、规格和设计，并生成本报告；没有修改实现、同步主规格、归档真实变更或对外发布。核验对象为当前未提交工作树，源基线是迁移清单记录的 `8b49c2cec1c6708a601d1809a97f81491525d81d`。

## 结论

发现 **1 个 CRITICAL、2 个 WARNING、0 个 SUGGESTION**。应先修复 C1，再归档。CLI 的 `all_done` 只表明任务复选框完成，不能作为规格符合或归档后可用的证明。

## 汇总

| 维度 | 核验结果 |
| --- | --- |
| 完整性 | Task Completion：30/30 勾选完成，跟踪文件可读；Spec Coverage：16 份 delta、32 条 ADDED/MODIFIED 需求均有可定位的实现、规则或材料来源；无 REMOVED/RENAMED |
| 正确性 | Requirement Implementation Mapping：32/32 建立来源映射；RDOC-004/005 的生命周期与交付导航存在 C1/W2，UIL-012 存在 W1；Scenario Coverage：59 个场景均已查阅并核对处理/测试或规则来源，UIL-012 的数值条件有明确反例 |
| 一致性 | Design Adherence 与 Code Pattern Consistency 均已检查：目录、资源、生成物边界整体符合设计；活动变更路径与普通归档生命周期耦合，旧表单数字被重新纳入当前规范，存在上述问题 |

六项核心核验均执行，没有以仅有任务状态替代实现证据。本报告的“场景覆盖”是源码、已有测试与流程规则映射，不表示重跑所有产品场景。未重新执行 Windows 实机、完整 Docker/真实模型或 SELinux Enforcing 主机验收；这些是已有明确范围外的运行证据，不作为本次新增归档前置条件。

## CRITICAL

### C1 — 活动变更路径成为永久检查和交付依赖，普通归档后失效

关联：RDOC-004、RDOC-005；设计 Decisions 1、6、7 与 Migration Plan 6。

具体位置：

- `scripts/stage-go-release-materials.mjs:9` 固定复制 `openspec/changes/remove-docs-dir/evidence/legacy-docs/images/desktop-preview.png`。
- `README.md:32`、`README.md:60` 和对应中文入口引用活动变更中的 Spec/图片。
- `openspec/changes/remove-docs-dir/evidence/migration-map.json:16` 起把活动 delta 的原路径作为目标；`scripts/check-repository-docs.mjs:54` 直接按该路径打开。
- `scripts/sync-docker-quickstart.mjs:63`、`scripts/sync-docker-website.mjs:18` 还会继续生成活动路径引用。

在一次性隔离副本中只把该变更目录移动到常规 `archive/2026-10-12-remove-docs-dir/`，稳定复现：

1. 原生材料 staging 在复制 Desktop 展示图时 ENOENT。
2. 文档检查首先报 README 的当前目标不存在。
3. 即使在副本中修正当前 Markdown 导航，检查仍报 `docs/ai-models.md` 对应的迁移目标缺失。

本机 OpenSpec 的归档实现同步 Spec 并移动变更目录，不改写上述仓库 README、脚本或 JSON 引用。因此这里不是“尚未同步主规格”的正常暂态：归档本身可能成功，但随后 `make test` 的文档检查和 `make release` 的材料打包会失败。真实工作树没有被移动或归档。

**建议：** 在归档前解除对活动目录名的永久依赖。当前规范导航应有归档后有效的主规格去向；证据/展示图和迁移清单目标采用可随归档解析的归属或路径，并同步生成模板。增加一个“变更由 active 移至 archive，随后文档检查与 staging 仍通过”的隔离回归，不只修 README 链接。

## WARNING

### W1 — UIL-012 复制了过期表单尺寸，当前实现不满足

关联：UIL-012，以及 RDOC-002 对历史说明冲突的处理。

- `openspec/changes/remove-docs-dir/specs/ui-language/spec.md:115` 要求 176px 标签列、16px 间距、最多 520px 控件列。
- `apps/console-webui/public/style.css:2098` 的实际任务页规则为 156px 标签列；`apps/console-webui/src/app.ts:550` 确实创建该 `task-content` 容器。
- 用当前完整共享/Console CSS 在 1440px 视口计算任务表单，得到 `156px 540px`。这不是只看一段已被覆盖的旧 CSS。
- 迁移清单虽把旧样式示例声明为须按现行规则适用，却又把旧数值作为新的 SHALL 固化。

**建议：** 按已采用的任务页布局修订 UIL-012 和相关迁移归属，或明确已有批准的适用例外。不要为文档迁移把当前 UI 改回旧尺寸。补一项针对有效选择器/计算样式的核对，避免只凭旧文档和相邻 CSS 定值。

### W2 — dirty 工作树打包会生成不属于目标 commit 的文档链接

关联：RDOC-005 的有效导航与真实身份。

- `scripts/stage-go-release-materials.mjs:23` 把未随包复制的本地文档链接无条件转换为传入 commit 的 GitHub blob URL。
- `scripts/package-go-release.sh` 的 commit 来自真实 HEAD；当前源码允许 dirty 构建。
- 已生成 staging README 中有 **10 个不同链接目标** 不存在于其绑定的 HEAD Git 树，例如本变更新增的 `specs/core-service-startup/spec.md`、`specs/control-cli/spec.md` 及 0.0.5 历史附件。用 `git cat-file -e <HEAD>:<target>` 确认，不依赖网络猜测。
- 现有 staging 测试只断言 URL 字符串包含传入 SHA，没有核对被指向的 Git 对象。

这不修改历史发行身份，但会使当前本地包的深入阅读链接指向不含这些文件的提交。

**建议：** 对外链接必须核对所绑定提交包含实际目标；dirty 内容可随包提供相应 Spec/附件，或在准备可交付材料时明确拒绝这种无有效来源的链接。不能伪造 commit 或把工作树内容写成旧 HEAD 已有。加入“新增/修改文档尚未提交”的材料回归。

## 本轮独立检查

- `openspec validate remove-docs-dir --strict`、`git diff --check`、`check-repository-docs`、`check-native-boundary`、`check-docker-quickstart` 通过。
- `node --test scripts/*.test.mjs`：74/74 通过。这证明现有门禁和夹具通过，但现有夹具缺少 C1/W2 的失败条件。
- 按源 commit 的 Git 树独立枚举 114 个原 docs 文件，每个源 SHA256 与迁移清单一致，记录的目标摘要一致。没有把目录缺失单独当作迁移完整性的证明。
- 读取全部 contextFiles，识别 32 条 ADDED/MODIFIED、59 个场景；无故意跳过的必需规划产物。
- 在临时副本复现 C1；在当前 CSS 的隔离 DOM 中复现 W1；对现有 staging 和 HEAD Git 对象检查复现 W2。没有执行真实归档。
- 已有实施记录中的 `make build`、`make test`、CLI 构建/独立 Logo、Console 75 项及 Desktop 249 通过/1 skip/1 基线失败，与保留日志相符。Desktop 的模型偏好用例在原 HEAD 也有失败记录，不冒充迁移修复通过，也不作为本次新回归重复计数。

## 需求与场景来源映射

下表记录实现、测试或可人工核对的仓库规则来源。流程约束不被宣称为独立身份审批强制机制；未重跑的跨平台/真实环境证据仍保留原范围。

| 需求 | 实现/规则来源 | 场景与测试依据 |
| --- | --- | --- |
| `CONV-ADAPTER-001` | internal/agentclient/client.go:121; apps/agentd/src/application.ts:463 | internal/agentclient/client_test.go；现有 SDK/session/history 测试 |
| `AIM-API-001` | internal/coreapp/model_test_http.go:27; internal/coreapp/settings.go:145 | internal/coreapp/model_management_test.go; model_message_test.go |
| `CLI-USAGE-001` | internal/cli/user.go:97; internal/client/credentials.go:26 | internal/cli/user_logout_test.go；CLI 命令/包/快照测试 |
| `CLI-PLATFORM-001` | internal/clientfs/; internal/cli/user_desktop.go:101; scripts/build-cli.mjs | Windows/Linux 源码与既有平台测试；不重签 Windows 实机验收 |
| `CST-OPS-001` | internal/corestore/store.go:25; internal/coreapp/serve.go; internal/dockerengine/ | 存储、启动、恢复及 Engine 既有单元测试 |
| `CST-IMAGE-001` | internal/dockerengine/image_capabilities.go; internal/imagestatic/; Dockerfile.agentd | internal/dockerengine/image_capabilities_test.go |
| `DWEB-USAGE-001` | internal/cli/user_desktop.go:209; apps/desktop-webui/src/ | internal/cli/user_desktop_test.go:80；浏览器资源/服务/授权用例 |
| `DOCKER-MAINT-001` | scripts/build-docker-release.mjs; scripts/docker-publish-preflight.mjs | 发行元数据、预检、Quick Start 合成夹具 |
| `PKG-NATIVE-001` | internal/packagehelper/helper.go:73; internal/packageprepare/prepare.go:129 | internal/packagehelper/helper_test.go:236; brain_source_test.go |
| `BRN-007` | 本变更 piwork-brain delta；原变更 evidence/legacy-docs/piwork-brain/BASELINE.md | 八项不变量及版本/来源逐项对照；不宣称身份审批隔离 |
| `PWORK-WIRE-001` | internal/workpackage/codec.go; manifest.go; internal/workhistory/ | internal/workpackage/codec_test.go:36；schema/Memory 冷历史测试 |
| `RDOC-001` | AGENTS.md:11; openspec/config.yaml | 授权、proposal/apply 边界的人工规则核对 |
| `RDOC-002` | evidence/migration-map.json; 16 份 delta; scripts/check-repository-docs.mjs:45 | 114 项 Git 树独立比对；清单/需求/章节结构检查 |
| `RDOC-003` | 对应变更 evidence/legacy-docs/；迁移清单摘要 | 114 项源摘要和目标摘要独立核对；原 JSON/图片一致 |
| `RDOC-004` | scripts/check-repository-docs.mjs:22; Makefile:62 | 根 docs/链接/生成入口反向夹具；归档投影暴露 C1 |
| `RDOC-005` | 两端 copy-static.mjs:5; scripts/stage-go-release-materials.mjs:5; README.md:32 | 原生 Logo/摘要/打包测试；归档和 dirty 链接暴露 C1、W2 |
| `RDOC-006` | scripts/update-go-acceptance-index.mjs:46; collect-go-migration-boundary.mjs | update-go-acceptance-index.test.mjs；冻结输入及 dist 输出检查 |
| `RDOC-007` | AGENTS.md:13; openspec/config.yaml | Work/docs 与产品 Markdown 正向夹具；未改产品审批流程 |
| `RDOC-008` | Makefile; 对应 delta 内已有命令示例；scripts/ | 74 项脚本测试复跑；既有 make test/浏览器证据分开核对 |
| `SCTRL-OPS-001` | internal/consoleapp/console.go:31; console_api.go | internal/consoleapp/console_test.go:198; entry_test.go |
| `SNET-OPS-001` | internal/coreapp/service_gateway.go:24; internal/workaccess/ | internal/coreapp/service_gateway_test.go:177 |
| `UIL-001` | 本变更 ui-language delta；当前 serve-ui / ai-model-management；AGENTS.md | 当前导航与规范入口人工核对，实际代码未恢复旧七项导航 |
| `UIL-005` | serve-control-plane delta 命令示例；internal/consoleapp/console.go:31 | Console 构建/HTTPS/静态资源既有测试及附属截图 |
| `UIL-008` | apps/console-webui/src/app.ts; 现有英文反馈/表单组件 | Console 浏览器测试、模型路由/错误恢复测试 |
| `UIL-009` | apps/console-webui/src/app.ts:550; public/style.css | 现有容器/窄屏/草稿与未知结果浏览器测试 |
| `UIL-011` | apps/ui-shared/tokens.css; 两端 copy-static.mjs | 共享语义颜色逐值核对；资源构建及原生静态测试 |
| `UIL-012` | apps/console-webui/public/style.css:2098; ui-language delta:115 | 1440px 计算样式复核：156px 标签列，存在 W1 偏差 |
| `WF-NATIVE-001` | internal/dockerengine/file_helper.go:38; internal/filehelper/; internal/fileprotocol/ | 文件 helper 隔离/提交与协议既有测试 |
| `WF-DAV-001` | internal/workfiles/path.go:17; errors.go:35; xml.go; CLI proxy | DAV 方法/路径/限额及本地文件入口既有测试 |
| `WSRV-MCP-001` | internal/servicemcp/server.go:115,199; tools.json | internal/servicemcp/server_test.go:67 |
| `WSNAP-OPS-001` | internal/snapshottree/capture_linux.go:65; 原 SELinux 附件 | internal/snapshottree/tree_test.go:164；不重签真实 Enforcing 主机验收 |
| `WSNAP-USAGE-001` | internal/coreapp/ 的 snapshot 实现；internal/workpackage/；CLI 快照入口 | 冷包、stopped/显式 Start、原 ID 恢复既有测试 |

## 后续

此报告不更改任务复选框或替实现修复。C1 是归档前需修的问题；W1/W2 应一并修正并复核。修复后重新运行文档/材料夹具、严格规格校验及本报告列出的失败条件，再判断是否归档。
