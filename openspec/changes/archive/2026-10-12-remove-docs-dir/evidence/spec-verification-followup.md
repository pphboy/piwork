# remove-docs-dir 修复后独立规格核验

本次响应 `openspec-verify-change remove-docs-dir`，核验当前未提交工作树。源基线为 `8b49c2cec1c6708a601d1809a97f81491525d81d`，schema 为 spec-driven。重新读取全部 19 个 contextFiles，并检查实现、测试及历史材料，不以 CLI 的 all_done 代替符合性结论。

## 结论与汇总

本变更范围内全部适用核验通过，可进入归档流程。发现 **0 CRITICAL、0 WARNING、0 SUGGESTION**。六项核心检查均执行，无缺失或无法核验的必需产物。

| 维度 | 结果 |
| --- | --- |
| 完整性 | Task Completion：37/37，任务跟踪启用，任务描述全部可读，无不可用跟踪文件。Spec Coverage：16 份 delta、32 条需求（27 ADDED、5 MODIFIED），全部有实现、规则或材料来源；无 REMOVED/RENAMED |
| 正确性 | Requirement Implementation Mapping：32/32 来源映射复核；Scenario Coverage：69 个场景的处理与测试/流程规则来源已检查，C1/W1/W2 的具体失败条件经本轮回归和独立审计通过 |
| 一致性 | Design Adherence：8 项设计决策及迁移边界符合实现。Code Pattern Consistency：新脚本沿用仓库 ESM、Node test、显式材料与本地 Git 接口，无另建文档系统或产品审批阶段 |

需求映射参见[原核验的来源表](spec-verification.md#需求与场景来源映射)，本轮复核全部 32 个标识符及 52 个实现/测试路径；新增修复证据见下表与[修复实施记录](repair-verification.md)。场景核验为源码、测试与规则的符合性检查，不等同于重跑全部产品验收。

| 场景归属 | 数量 | 核验依据 |
| --- | --- | --- |
| 已迁入的产品操作、协议与交付契约 | 17 | Go Core/operator/CLI/helper、保留 TS Agent/SDK、发行脚本与既有测试来源；命令入口抽查对应当前参数解析 |
| BRN-007 | 3 | 八项不变量、原 Baseline 来源与身份保留，治理规则不扩张为产品审批机制 |
| RDOC-001–008 | 28 | AGENTS/config 授权规则、逐文件/段落迁移清单、冻结身份、目录与链接门禁、归档夹具、dirty 打包及生成入口测试 |
| UIL-001/005/008/009/011/012 | 21 | 当前导航与反馈/容器源码、共享颜色、既有浏览器证据和本轮 9 个视口计算布局；未改 UI 迎合旧文档 |

## 前轮问题复核

| 问题 | 实现与本轮证据 | 结果 |
| --- | --- | --- |
| C1：归档使永久路径失效 | `scripts/resolve-change-artifact.mjs:17` 按所属变更定位，`check-repository-docs.mjs:54` 解析 v2 目标；稳定产品图片与当前导航不依赖 active 目录。`documentation-archive.test.mjs:14` 实际移动两个所属目录后，清单、冻结输入、生成和 staging 均通过；缺失/歧义/越界等负向夹具通过 | 已解决 |
| W2：dirty 材料外链不属于实际 commit | `stage-go-release-materials.mjs:46` 同时校验 Git 对象存在与内容字节一致；新建/修改文档及必要本地依赖随包。`stage-go-release-materials.test.mjs:23` 起的 clean/new/modified/closure/error 场景通过；当前实际 staging 独立审计通过 | 已解决 |
| W1：旧尺寸成为错误的当前约束 | UIL-012 以现行任务容器为准，迁移清单保留旧描述的冲突解释。当前完整 tokens/Console CSS 的 9 个视口计算结果符合规格，CSS 摘要未改变 | 已解决 |

实施阶段实际 OpenSpec 规格同步与归档的副本结果已核对，原日志显示归档后 81 项脚本测试通过。本轮再次运行现有的物理目录移动回归；没有在真实工作树执行规格同步或归档，也没有把历史实施结果冒充本轮新执行的 CLI 归档。

## 本轮执行证据

- Node 24.21.0 `node --test scripts/*.test.mjs`：81/81 通过，0 skip、0 fail，包含归档生命周期、冻结输入、无根 docs、dirty 文档和 Git 对象回归。
- `openspec validate remove-docs-dir --strict`、`git diff --check`、文档、原生边界和 Docker Quick Start 门禁：通过；50 份当前文档与 v2 迁移清单有效。
- 按原 commit 独立枚举全部 114 个 docs 源文件，集合、SHA256 和字节数与迁移清单一致；102 份原冻结材料摘要保持，产品展示副本与冻结原件字节相同。
- 当前实际 staging：15 个文件，54 个包内链接及其可检查锚点有效；32 个固定 commit 链接逐项核对 Git 对象与选用文件内容一致。
- 实际 CSS 计算布局：1440px 为 156px / 16px / 540px，内部网格 712px；1101/1100/960/851/850/761/760/360px 保留各断点规则。360px 为单列，无横向溢出；帮助/动作/notice 对齐。其他管理容器在参考宽屏仍为 176px / 520px，登录最大 420px。

临时日志及 JSON 位于被忽略的 `dist/remove-docs-dir-verify/`。本轮仅新增本报告，代码、任务、规划、既有证据和真实主规格保持原状。

## 核验边界

未重新运行 Windows 实机、完整 Docker、真实模型或 SELinux Enforcing 产品验收；未重复先前已有记录的完整构建、Go/TS 单元与两端浏览器套件。这些未重跑范围与六项已执行的源码/规格符合性检查区分记录，不被算作本轮通过，也不新增归档前置要求。

原 Desktop 模型偏好用例的 `DesktopError: Choose an available model.` 基线失败仍按原实施报告保留，本轮未重签或修复该无关产品问题。970 项历史索引只作为冻结证据完整性与生成器输入，不代表本轮重跑 970 项场景。

## 问题分级与后续

- CRITICAL：无。
- WARNING：无。
- SUGGESTION：无。

可按所有者后续请求执行 `openspec-archive-change remove-docs-dir`；归档仍遵循其自身检查和确认流程。本次核验不执行提交、归档或对外发布。
