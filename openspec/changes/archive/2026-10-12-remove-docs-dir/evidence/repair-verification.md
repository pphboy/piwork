# remove-docs-dir 修复实施与复核

本记录对应新增任务 8.1–8.7，复核 [前轮报告](spec-verification.md) 中的 C1、W1、W2。前轮实施与核验报告保留原结论，本记录不回填历史结果。对象为源 commit `8b49c2cec1c6708a601d1809a97f81491525d81d` 上的未提交工作树，modified 为 true。

## 结果

三项问题均已修复并复现验证通过。本轮未发现新的 CRITICAL、WARNING 或 SUGGESTION。37/37 项任务完成，其中原 30 项保留执行记录，新增 7 项在本轮完成。真实工作树的主规格未同步，变更仍为 active；没有提交、发布或修改既有制品身份。

| 维度 | 核验结果 |
| --- | --- |
| 完整性 | Task Completion：37/37；Spec Coverage：16 份 delta、32 条 ADDED/MODIFIED Requirement，未新增能力或遗漏规划产物，无 REMOVED/RENAMED |
| 正确性 | Requirement Implementation Mapping：原 32 项来源映射复核，52 个实现/测试路径存在；按新文本重点核对 RDOC-004/005 与 UIL-012。Scenario Coverage：69 个场景具有实现、测试或流程规则来源，新增 10 个场景纳入本轮归档、dirty 打包与计算布局验证 |
| 一致性 | Design Adherence：稳定产品资源、所属变更定位、只读检查、实际 Git 内容校验和容器布局边界均按设计落实；Code Pattern Consistency：沿用 scripts 下的 ESM、内置文件/Git 接口与 Node test，不增加全局 OpenSpec CLI 测试依赖或文档系统 |

六项核心检查均执行。来源映射沿用并复核[前轮需求表](spec-verification.md#需求与场景来源映射)，未改动的产品行为继续使用其源码、既有测试与先前实际执行证据；场景覆盖不表示重跑所有产品场景，也不表示文件规则实现了独立 Agent 身份审批隔离。

## C1：归档后仍能定位、检查与打包

- `scripts/resolve-change-artifact.mjs:17` 按 ownerChange / artifactPath 定位 active 或唯一 archive；原已归档附件可带精确 archivePath 约束。缺失、歧义、目录越界及逃逸符号链接明确失败。`check-repository-docs.mjs:46` 校验 v2 清单，不直接打开旧 active 目标。
- [迁移清单](migration-map.json) 保留全部 114 项 source SHA256、字节数、采集 commit / dirty、段落与 Requirement 归属；按源 commit 的 Git 对象逐项独立核对。102 份原冻结材料（含旧报告、矩阵及 legacy-docs）的摘要不变。
- README 展示图位于 `apps/ui-shared/assets/desktop-preview.png`，与冻结原件字节相同。双语 README、部署入口和官网合成模板采用稳定资源、已有主规格、AGENTS 或固定发行元数据，当前导航不再引用本次变更的 active 路径。
- `update-go-acceptance-index.mjs:9` 与 `check-go-acceptance.mjs` 的冻结回退采用所属变更定位，默认输出仍在 dist；970 条原记录保持原身份、状态和证据完整性门槛。
- `documentation-archive.test.mjs:14` 在独立副本实际移动目录，核对文档检查、冻结读取、生成、staging 及输入只读。该测试在已经归档的 checkout 中也可运行。

额外在一次性 checkout 执行真实 `openspec archive remove-docs-dir --yes`，同步 16 份 delta 到副本的主规格并移入 `archive/2026-10-12-remove-docs-dir`；确认原 active 目录缺失后，再移动副本的 Go 迁移证据所属目录。归档前后的文档、原生边界、Quick Start、冻结输入、索引生成和 staging 全部通过；归档后全部 81 个脚本用例通过，102 份冻结材料摘要保持。Go 迁移目录仅在副本物理移动以验证输入定位，没有执行其规格同步或重新签收其产品验收。

首次把 checkout 放在 dist 下时，旧 Quick Start 测试夹具的绝对路径过滤器排除了整个来源目录，造成合成材料缺失。改用独立 /tmp checkout 后，81 项全部通过；无需修改生产实现或放宽断言。真实工作树的主规格和两个 active 变更目录均核对保持。

## W2：固定外链对应实际内容，dirty 材料随包

`stage-go-release-materials.mjs:32` 验证真实 commit 存在。未随包的深入阅读目标只有在 `git cat-file blob <commit>:<path>` 返回内容与选用文件字节完全一致时才转为固定外链。新建/修改文档及其必要文档、图片闭包随包保留；循环引用去重，片段、查询、标题和外部 URL 保留，缺失或范围外目标明确失败。安装配置仅开放已选用的明确材料，不批量复制历史或验收 JSON。

`stage-go-release-materials.test.mjs:23` 起覆盖 clean 精确对象、新增未提交文档、已存在但修改的文档、文档/图片循环依赖、缺失目标、范围越界和符号链接逃逸；不仅检查 URL 中出现 SHA。

| 实际 staging | 文件数 | 包内链接逐项可达 | 固定 commit 链接对象存在且字节一致 |
| --- | --- | --- | --- |
| 当前 active、dirty 工作树 | 15 | 54 | 32 |
| 已同步主规格并归档的 dirty 副本 | 23 | 76 | 10 |

归档副本新增/修改的主规格按实际内容随包，因此材料数量变化符合 dirty 处理规则。两种布局均无根 docs、全量历史附件或 970 条验收 JSON 打包。commit 保持真实源身份，没有以提交或发布作为打包前提。

## W1：规格与现行容器布局一致

UIL-012 已在经确认的规划更新中校正；本轮补充迁移清单的 supersededDescriptions，明确旧 176/520 不是全局任务表单限制。浏览器加载当前完整共享 tokens 与 Console CSS，在隔离 DOM 中核对任务、其他管理容器和登录表单：

| 视口 | 任务表单列 | 列间距 | 结果 |
| --- | --- | --- | --- |
| 1440px | 156px / 540px，网格 712px | 16px | 输入、帮助、动作和 notice 对齐；其他管理网格仍为 176px / 520px |
| 1101px | 156px / 540px | 16px | 保留宽屏规则 |
| 1100px | 140px / 556px | 16px | 保留断点覆盖 |
| 960px / 851px | 140px / 516px、407px | 16px | 控件随可用空间变化 |
| 850px / 761px | 156px / 540px、495px | 16px | 保留任务轨道折叠后的覆盖 |
| 760px / 360px | 单列 686px、306px | 6px | 输入、动作和 notice 同列，无页面横向溢出 |

登录字段仍为 block，容器最大 420px。Console CSS 摘要与本轮开始时完全一致；未修改 app、adapter 或样式来迎合旧文档。此项是实际 CSS 的计算布局核对，不冒充真实 Core 浏览器全流程验收。

## 执行记录与范围

| 检查 | 结果 |
| --- | --- |
| Node 24.21.0 `node --test scripts/*.test.mjs` | 81/81 通过，0 skip、0 fail；Node 25.6.0 亦通过同组测试 |
| 最后双语导航修订后的 archive / Quick Start 定向检查 | 30/30 通过 |
| 实际 OpenSpec 同步与归档的独立副本 | 前后检查及 81 项脚本用例通过 |
| `make acceptance-index`、冻结回退和证据校验 | 970 项原记录完整，生成输出在 dist；不是重跑 970 项产品场景 |
| 文档、原生边界、Docker Quick Start 门禁 | 通过；当前 50 份文档与 v2 清单有效 |
| 实际 staging 及文件链接/Git 对象审计 | 上表两种布局通过，必要双语说明和图片有效 |
| `bash -n scripts/package-go-release.sh` | 通过 |
| `openspec validate remove-docs-dir --strict`、`git diff --check` | 通过 |
| 源身份与历史保护 | 114 项源 Git 字节核对，102 份冻结材料及 CSS 不变，真实主规格未同步 |

临时日志、布局 JSON、材料审计和隔离归档结果位于被忽略的 `dist/remove-docs-dir-repair/`。本轮只修改文档导航、产品展示副本与脚本材料/输入处理，未改 Go 业务或浏览器实现；按范围执行脚本与实际 staging，不重复先前已记录的全量宿主程序构建和产品闭环。

原 Desktop 用例 `Brain saving preference survives a concurrent Session refresh and does not alter accepted Run metadata` 的 `DesktopError: Choose an available model.` 仍保留原基线失败记录，本轮未重跑、未跳过或修复该产品问题。Windows 实机、真实模型、完整 Docker、SELinux Enforcing 和真实官网写入均未执行，不将既有历史证据当成本轮重新通过。

本轮适用核验未发现关键问题或警告，修复已具备独立归档后的检查证据；实际主规格同步与归档仍按所有者后续请求执行。
