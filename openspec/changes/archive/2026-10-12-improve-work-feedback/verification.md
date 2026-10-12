# improve-work-feedback 验收记录

## 范围与环境

- 在提交 `8b49c2c` 的未提交工作树验证；本记录不表示发布或归档。
- Go 1.25.5；最终构建及浏览器验证使用 Node 24.11.1。CLI 构建目标为 Linux/amd64、Windows/amd64，产物位于被忽略的 `dist/`。
- Core 仍使用原生 schema 1、原名称唯一约束和 Import 名称预留；未修改数据库、名称占用查询、后缀算法、幂等或恢复机制。
- 经用户确认，在现有离线 Inspect 摘要中补充 `sourceName` 显示字段；来自已验证包，不改变 `.work` 格式、校验或导入执行。
- Docker 验证使用隔离安装与合成凭据，资源清理只针对该次 installation ID；未操作真实用户 Work，也未推送镜像。

## 已确认结果

| 检查 | 执行入口 | 结果 |
| --- | --- | --- |
| Go 定向与完整受影响包单测 | `go test -mod=readonly ./internal/coreapp ./internal/contracts ./internal/cli ./internal/workpackage` | 四个包通过；包含可见、已删除、在途导入占名、安全字段投影及源名称摘要 |
| 真实 Core 创建与事务内并发占名 | 设置本地 acceptance Agent/file/snapshot helper 后执行 `go test -mod=readonly -tags=integration ./internal/coreapp -run '^TestNativeDefaultWorkCreateAndSession$' -count=1 -v -timeout=8m` | 通过，81.208 秒；包含预检查、捕获后并发占名、原幂等重放与无半成品断言 |
| 名称浏览器场景 | `npm run test:browser -w @piwork/desktop-webui` 中新增 Work naming 场景 | 新增场景全部通过；创建错误定位/草稿/360px、显式 Import 冲突、用户主动留空、实际后缀、显式新名称、正常同名候选、缺名称和失败/成功阶段均有请求断言 |
| CLI 构建 | `make build-cli` | Linux/amd64 与 Windows/amd64 均成功，Desktop 资源已同步 |
| Core/CLI/helper 本机构建 | `bash scripts/build-go.sh` | 通过，使用当前嵌入资源 |
| TypeScript | `npm run typecheck -w @piwork/desktop-webui` | 通过 |
| 原生源码边界 | `node scripts/check-native-boundary.mjs` | 通过 |
| OpenSpec 与空白检查 | `openspec validate improve-work-feedback --strict`、`git diff --check` | 通过 |

## 联合回归结果

- 首轮名称反馈定向回归最终 10 项通过、0 失败，包含长检查摘要时错误进入可视区、取消后清理已明确拒绝的名称提示、名称/高级草稿和既有未知保护保持。
- 真实 Core/CLI Desktop 联合入口：`TMPDIR=/home/p/.cache/pwtmp PIWORK_TEST_SCREENSHOT_DIR=/home/p/Projects/piwork__worktrees/fix-misc-2/dist/work-feedback/ui npm run test:real-core -w @piwork/desktop-webui`，退出码 0。验证创建重名 409/name 字段且仅保留一个 Work、显式 Import 重名保留输入/检查、用户主动留空后实际名称为 `Real Browser Work-2`、原名/实际名称说明及独立 stopped 副本，并完成原 Service/Run/文件/Save/Apply/Stop/Export/Start/Delete 回归。
- 联合测试 installation ID 为 `installation-813e3ac1b2e1cfec6cb223ceb09e25c3`，结束后受管 container/network/volume 均为 0；主页面额外重载次数为 0。
- 首轮最后一次 `npm run test:browser -w @piwork/desktop-webui` 退出码 0：261 项，260 通过、0 失败、1 既有跳过，102.175 秒。跳过项为需要实际等待五分钟的未使用启动 ticket 过期用例；没有新增跳过项。该次运行已包含视口定位与关闭清理的代码。

## 复验与边界

- 首次使用 Node 24.21.0 时，两个既有浏览器测试进程出现 Node 原生断言退出；改用 Node 24.11.1 后可执行完整套件。
- 完整套件曾出现既有异步场景的时序失败：游标恢复、模型偏好并发、隐藏页面观察和 Activity 设置。四项分别单独复验均通过；完整套件的最终复验结果单独记录，不以单独通过替代全量通过。
- 真实 Desktop 初次因较长 TMPDIR 导致 Chromium 启动 SIGTRAP；使用 `/home/p/.cache/pwtmp` 的短临时路径完成浏览器启动检查。临时数据依然属于独立测试安装。
- 联合测试新增一次用户主动重名尝试后，旧末尾计数仍期望一次 Create POST；已改为一次成功创建和一次被拒绝的主动尝试，共两次，不放宽自动重复提交约束。
- 本次未运行完整模型、所有 Docker 故障矩阵或 Windows 原生运行验收；Windows 结果仅为客户端构建，不能当作原生运行证据。

## 复用镜像

本次复用本机已有 acceptance 镜像，不重新发布：

| 标签 | 本机 image ID |
| --- | --- |
| `piwork-agentd:go-migration-acceptance` | `sha256:0582dd0ffe4762d1988813828377ff24752383b8c92571e2d9e8150e5b477763` |
| `piwork-file-helper:go-migration-acceptance` | `sha256:a9483f153a618096c42ac74ecc455bf59d9260d2eaabf75f5ed3ad85571dd9d5` |
| `piwork-snapshot-helper:go-migration-acceptance` | `sha256:a6956cdec4446cc7435ed77f982019151d8934c2fc905fde90bc31f0e21bd4b6` |

联合验收截图在 `dist/work-feedback/ui/`；该轮之后补齐的名称错误视口定位和关闭清理由首轮最终 10 项定向及完整浏览器回归确认。原始测试输出和截图均位于被忽略的 `dist/work-feedback/`，不提交运行目录、凭据、包字节或私钥。

## 核验 WARNING 修复与增量验证（2026-10-12）

核验复现：创建提交名称 A 后改为 B，或 Import 提交显式名称后清空，A 的迟到重名响应仍把当前字段标为无效。新增延迟响应测试在修复前分别捕获这两处错误；首尾空白的两个对照用例原本通过。

修复在 Desktop 点击提交时保存实际提交的 trim 名称，将已确认重名错误绑定该名称。当前草稿一致时保留字段提示；草稿已改变时只说明原请求使用的名称被拒绝，不标记当前字段，不覆盖草稿或检查包。后续编辑/关闭清理该已知失败反馈，既有在途和未知结果保护保持。源代码及嵌入资源已同步，规划增加两个相应场景和任务 4.1—4.2。

| 检查 | 执行入口 | 结果 |
| --- | --- | --- |
| 修复前复现 | 编译浏览器测试后 `node --test --test-name-pattern='Work naming: delayed' apps/desktop-webui/dist/test/recovery.test.js` | 5 项，3 通过、2 失败；两处失败均对应核验问题 |
| 名称反馈定向回归 | 编译浏览器测试后 `node --test --test-name-pattern='Work naming:' apps/desktop-webui/dist/test/recovery.test.js` | 15/15 通过，8.867 秒；包含延迟改名/留空、trim 一致性、原名称纯文本、草稿/检查包保留和无自动重提 |
| 完整浏览器回归 | `npm run test:browser -w @piwork/desktop-webui` | 266 项，265 通过、0 失败、1 既有跳过，103.039 秒；未增加跳过项 |
| Workspace 构建与类型检查 | `npm run build -w @piwork/desktop-webui`、`npm run typecheck -w @piwork/desktop-webui` | 通过 |
| CLI 与宿主重建 | `make build-cli`、`bash scripts/build-go.sh` | Linux/amd64、Windows/amd64 CLI 及本机 Go 入口构建通过；浏览器 app/adapter/CSS 与对应嵌入资源逐一 hash 相同 |
| CLI/资源包检查 | `go test -mod=readonly ./internal/desktopassets ./internal/cli` | CLI 通过，25.050 秒；资源包无测试文件，由构建及资源一致性检查覆盖 |
| 源码边界、规格及空白检查 | `node scripts/check-native-boundary.mjs`、`openspec validate improve-work-feedback --strict`、`git diff --check` | 通过 |

增量日志位于 `dist/work-feedback/`：`browser-name-delay-before.log`、`browser-name-delay.log`、`browser-after-name-delay.log`、`build-name-delay.log`、`typecheck-name-delay.log`、`build-cli-name-delay.log`、`build-go-name-delay.log` 与 `go-name-delay.log`。本轮只修复浏览器名称反馈，未重新执行 Docker/真实 Core 联合验收，前述隔离联合结果保留为首轮证据；未发布或归档。

## 创建 A/B 逆序错误覆盖的最小修复（任务 4.3，2026-10-12）

- 仅在发出创建请求时记录现有 ActionRecord token；创建错误返回时仍先按原 ActionState 保存失败，较旧请求随后结束表单回调，避免覆盖或清除较新提交的名称错误及可访问关联。实际增量涉及 `app.ts`、一个浏览器回归及对应嵌入 `app.js`。
- 新增 `Work naming: older creation rejection cannot clear the newer name conflict`：显式提交 A/B，先返回 B 的 409，再返回 A 的 409；断言 B 的名称、高级 JSON、字段错误及 aria 关联保持，只有两次用户主动 POST。该用例在修复前失败，修复后通过。
- 编译浏览器测试后执行 `node --test --test-name-pattern='Work naming:' apps/desktop-webui/dist/test/recovery.test.js`：16/16 通过、0 失败、0 跳过，9.426 秒。
- `npm run build -w @piwork/desktop-webui`、`npm run typecheck -w @piwork/desktop-webui` 与 `make build-cli` 均通过；Linux/amd64 和 Windows/amd64 CLI 已重建，app/adapter/CSS 产物与对应 Go 嵌入资源逐一字节相同。
- `openspec validate improve-work-feedback --strict` 和 `git diff --check` 通过。其余已有受版本控制的改动在本轮前后保持相同 diff hash。
- 本轮按最小范围运行名称定向验证，未重跑完整浏览器套件或 Go/Docker 联合验收；前述完整回归和联合结果属于此前轮次。其他并发组合、成功回调和通用框架调整继续按设计暂不纳入。

本轮日志位于 `dist/work-feedback/`：`browser-create-order-before.log`、`browser-create-order.log`、`build-create-order.log`、`typecheck-create-order.log` 和 `build-cli-create-order.log`。
