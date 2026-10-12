# Proposal

## Why

创建 Work 遇到重名时，Core 返回通用状态冲突，Desktop 未能将原因定位到 Name 字段；Import 虽已支持自动添加后缀和显式名称冲突校验，界面没有清楚说明该规则或显示 Core 最终选择的名称。本变更保留现有命名和业务逻辑，只完善这两条流程的名称反馈。

## What Changes

- 保留同一用户下 Work 名称唯一及现有名称占用判定；普通创建的预检查和接受事务检查统一使用已有 `WORK_NAME_CONFLICT`，指向 `name`，给出换名提示。
- 将安全名称字段信息经本地 CLI 传到 Desktop，在创建/导入 Name 字段附近显示可修正的重名错误，保留名称及其他草稿，避免只显示通用 CONFLICT 或重复错误条。
- Import 名称留空时，在提交前说明使用源名称、冲突时 Core 自动添加后缀；受理后显示现有响应中的实际目标名称，若发生自动改名则清楚显示原名称与实际名称，并区分已受理、导入中和导入完成。
- Import 显式名称冲突时，保留输入及已检查包，提示选择其他名称或主动留空以使用自动命名；不自动清空、改名、重提或绕过现有准入和未知结果保护。
- 补齐名称反馈的 Go/CLI/浏览器定向回归，更新相关使用说明并同步 Desktop 嵌入资源。

## Capabilities

### New Capabilities

无。沿用现有 Work 创建和 Desktop 导入能力。

### Modified Capabilities

- `work-lifecycle`：明确普通创建名称冲突的安全错误码、字段及可修正说明，保持原拒绝规则。
- `desktop-webui`：完善创建重名、Import 自动命名及显式名称冲突的字段提示和实际名称显示。

## Impact

- 主要影响 `internal/coreapp/work_create.go`、必要的 `internal/contracts/errors.go` 公共提示、`internal/workpackage/inspect.go` 摘要显示字段、`internal/cli/user_desktop_control.go` 的安全字段投影，以及 `apps/desktop-webui/src/{adapter,app,models}.ts` 与对应测试、`internal/desktopassets/static`。
- 复用既有错误字段、`AcceptedWorkImport.name` 和 Work 读取；在现有本地 Inspect 摘要补充来自已验证包的 `sourceName`，仅供改名前后名称显示，不新增业务 API、数据库表或客户端状态文件。
- 保留现有数据库/唯一约束、创建检查顺序、Import 后缀算法和名称预留、幂等与恢复、配额、权限、Work ID、运行资源及 `.work` 格式。名称字符集和长度上限继续按当前实现，不新增 Rename 或允许同名。
- 范围仅为创建及 Import 的名称反馈；移出此前的同名支持、存储升级、幂等恢复扩展和整条 Work 操作链错误改造。
- 使用说明主要核对 `docs/webui-integration.md` 与 `docs/work-snapshot.md` 中对应流程；不引入部署、镜像、数据目录或运行依赖变化，不执行发布或归档。
