# Tasks

## 1. 内容契约与有界制品处理

- [x] 1.1 在 `packages/contracts/src` 定义文件清单、原文读取、版本和保存 DTO/schema，注册四个新错误及原生成链；验证 contracts 单元/正反 golden 与 `go test ./internal/contracts`，执行 `make generate` 后 `node scripts/check-generated.mjs http` 无陈旧输出，原 Skill catalog JSON 不扩正文。
- [x] 1.2 在 `internal/skillartifact` 实现基于已验证快照替换一个现有文本文件的最小操作，保留其他文件与目录并复用路径、大小和完整性验证；同组加入现有文件、非法路径、非 UTF-8/NUL、恰好 8 MiB/32 MiB 与超限、未编辑字节不变的测试，以 `go test ./internal/skillartifact` 验证。

## 2. Core 管理员内容 API

- [x] 2.1 在 `internal/coreapp` 增加 SKM-005/006 的清单及原文 GET，使用当前管理员身份、已验证受管快照和现有锁；加入管理员/普通用户/失效会话、禁用 Skill、文件不存在、非文本、一次解码和路径逃逸测试，并回归原公开/catalog 元信息无正文及内部标识泄露；用定向 Skill API Go 测试验证。
- [x] 2.2 增加 SKM-007 文件 PUT，复用 `skillMu`、上传容量控制、发布事务和清理；只保存现有文件，确认版本并保留 enabled/默认引用。加入同文件过期冲突、不同文件先后保存、目录整体更新竞争、保存失败保留旧制品、发布前权限变化、持久重读和 Core 重启测试，以定向 Core Skill 测试验证。
- [x] 2.3 验证单文件保存对 Work 自有内容的隔离：在原 Skill 副本/配置测试中保留一个旧 Work-owned 副本，编辑 Core 后核对旧字节不变、新选择获得新内容；执行关联 Go 用例。若实现触及 Work materialization，复用既有 `TestNativeSkillsUseIndependentCopiesAndExplicitReselection` 的真实集成入口验证，不新增模型或安装流程。真实 Docker 集成用例已通过，见 verification.md。

## 3. 浏览器管理转发

- [x] 3.1 在 `internal/consoleapp/console_api.go` 精确放行新 GET/PUT 和合法单一 path 查询；在原 multipart 判定前区分文件 JSON PUT，只为内容路由使用有界 envelope。加入大于 1 MiB 的合法读写、转义膨胀、超限拒绝和 query 保真测试，以 `go test ./internal/consoleapp` 验证。
- [x] 3.2 同组回归 session、Origin/CSRF、普通用户拒绝、绑定 Core、上传槽释放及结果未知转发；验证原目录 PUT 仍只接 multipart、其他管理 API 的原容量不变、未知路径/方法和通配代理仍拒绝，不能通过新入口读取宿主或其他 Work 文件。

## 4. Skill 文件工作区与页面/对象操作

- [x] 4.1 为新编辑功能建立内聚的 Console 模块和窄内容端口，adapter 接入真实文件清单/读取/保存，状态按 Skill/path/身份/视图及原提交快照归属；直接导入模块测试当前文件保存、晚读取、保存时继续输入、明确失败/409、未知结果只读核对不重放、注销清理，以 Console unit/typecheck 验证。
- [x] 4.2 实现同层“能力库 / 新 Work 默认”、Skills/Packages 分类、Skill 原位文件树及默认 SKILL.md 原文编辑；保留原配色与控件，非文本只显示不可编辑，未保存时提供三种离开选择。加入浏览器用例验证按名称搜索/清空不丢当前草稿、Ctrl+S 仅保存当前文件、行号/光标位置/保存状态准确、默认标记在默认配置保存后同步、恶意正文按文本、单文件请求、草稿/焦点/滚动保留、360px/桌面布局；完成本组中英文文案后执行 Console build/typecheck 与相关 browser 测试。
- [x] 4.3 将 Skill/Package 信息、更新、启停、移除移至左侧对应行菜单，捕获显式目标；移除页头/文件区混合菜单及默认集合快捷修改。加入未选中行的 info/toggle/remove 与编辑草稿隔离、菜单键盘/Escape/窄屏定位、默认引用保护反馈的 browser 回归，确保右侧仅保存当前文件。

## 5. 既有流程与最终交付集成

- [x] 5.1 在新导航复用既有默认配置功能，保留 Skills 顺序，并补齐 Packages 多选、上移/下移及顺序保存、无效选项、AGENTS.md 文件/原文编辑、局部 PATCH 和原字段限制；更新相关双语文案和 browser/契约测试，验证 Skills/Packages 清空、仅改 Packages 顺序时只提交 packages、上下移动及首尾边界、新增追加/移除保留相对顺序、取消不生效、保存后读取/刷新/Core 重启顺序一致、未初始化及已有 Work 不被修改；回归现有 default_work_patch 的顺序保留，文件保存不提交默认配置。
- [x] 5.2 将既有完整 Skill 目录添加/更新和 Package 四来源/Operation 接入新工作区；更新 `console.spec.mjs`、`management-flow.spec.mjs`、`controlplane-compat.spec.mjs` 等相关断言，验证真实目录相对内容、同名更新与 enabled 保留、旧列表/对象/Operation 深链接、重复提交和未知响应规则保持。
- [x] 5.3 运行适用的 contracts、Core/Console 单元、Console 全部 unit/typecheck 与 browser 检查；执行 `node scripts/check-native-boundary.mjs`、`node scripts/check-webui-boundaries.mjs`、`node scripts/check-ui-language.mjs`、`node scripts/check-repository-docs.mjs` 和 `git diff --check`，将实际执行与未执行项记录到本 change，不用原型测试替代生产结果。
- [x] 5.4 重新生成并检查内嵌 UI（`node scripts/check-generated.mjs ui`），构建 `make build-go`。扩展既有 `test:real-core`，在独立安装/合成数据下通过真实 UI HTTP origin 完成管理员目录上传→读取原文→保存单文件→重新读取与重启持久性、默认选择保存和权限拒绝，确认资源已实际嵌入；不对当前 17891 安装写入或执行外部发布。真实浏览器用例及宿主构建均已通过，见 verification.md。

- [x] 5.5 对齐 Work 设置页头导航。能力库和新 Work 默认使用同一位置、行高与当前项样式。通过 360px 和桌面浏览器用例验证切换前后位置、链接与当前项，重建并检查 Core 内嵌资源。

## Workflow follow-up

- 实现及上述验收完成后，由用户明确发起 verify、主规格同步和归档；本次 propose 不开始实现。
