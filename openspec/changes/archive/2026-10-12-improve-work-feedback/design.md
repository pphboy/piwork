# Design

## Context

范围见 [proposal.md](proposal.md)。当前创建与 Import 已有命名规则，本次只修复名称相关的错误语义和界面反馈。

| 当前事实 | 源码位置 | 反馈缺口 |
| --- | --- | --- |
| 创建预检查与接受事务都检查已有 Work 和导入预留，但返回 CONFLICT 且没有字段 | `internal/coreapp/work_create.go` | 用户无法知道需要换名 |
| 已有 WORK_NAME_CONFLICT 公共错误及 field=name 投影 | `internal/contracts/errors.go`、`snapshot_import_admission.go` | 普通创建未复用；本地 CLI 丢失 field |
| Import 留空使用源名称，冲突依次尝试 -2、-3 等后缀；显式冲突拒绝 | `snapshot_import_admission.go` | 表单没有把两种选择的结果说清楚 |
| 本地 Inspect 摘要未包含源名称，已验证包的 SourceName 已可读取 | `internal/workpackage/inspect.go` | 需补充 sourceName 显示字段，用户已确认该最小调整 |
| Import 接受响应已有实际 name | `AcceptedWorkImport`、`user_desktop_transfers.go` | Desktop 的 accepted/Operation 模型未保留并展示该值 |
| Desktop 使用统一弹窗错误区域 | `apps/desktop-webui/src/app.ts`、`adapter.ts` | 名称错误未紧邻 Name，用户容易当成整项操作失败 |

同一用户的名称占用仍包含已删除记录及在途导入，当前列表不能用于准确判断名称可用性。Core 的名称选择与接受结果是事实来源。

## Goals / Non-Goals

**Goals:**

- 创建被名称冲突拒绝时，用户能立即找到 Name 字段并知道如何修正。
- Import 用户能在提交前理解留空和显式名称的区别，在受理后看见实际目标名称及适用的自动改名说明。
- 名称提示保持草稿、已检查包、当前操作身份及真实阶段，不触发额外请求。

**Non-Goals:**

- 保持现有名称唯一、占用范围、字符集/长度检查、后缀算法与事务顺序；不允许同名或新增 Rename。
- 保持 Go Core schema 1、导入名称预留、配额、幂等、恢复、运行资源和 `.work` 契约；不做存储升级或提交身份扩展。
- 不改造 Start/Stop/Retry/Delete、Save/Apply、Export/下载的错误框架，不新增业务查询、客户端状态目录或自动重试。

## Decisions

### 1. 创建只修正名称冲突的错误语义

`work_create.go` 两处名称占用判断保留原查询及检查位置，仅把确认重名的返回值统一为已有 `WORK_NAME_CONFLICT`、`field=name` 和 409。公共错误使用简短安全英文说明；推荐主体文案为 `This Work name is already in use. Choose a different name.`，必要帮助补充名称也可能被保留记录或导入占用，不指示删除可见 Work 来释放名称。

不能移除事务内检查或只依赖浏览器列表；并发请求可能在预检查之后占用名称，列表也不包含全部保留记录。既有已接受同键重放仍走原顺序，不能因本次提示修正被当作新重名拒绝。

该选择改变错误的可辨语义，不改变哪些请求被接受、何时被拒绝或如何创建。

### 2. 仅补齐名称错误需要的安全传递与定位

沿用 `client.APIError.Details` 和现有 ErrorView 的 field 能力，在本地 CLI 错误投影中保留经过验证的名称字段；不透传原始 Details。DesktopError 保留适用的字段或明确名称冲突身份，由创建/Import 表单将其显示在 Name 附近，关联 aria-invalid/aria-describedby 并保留原输入。

名称冲突说明来自已确认错误码或安全字段，不能把所有 409、CONFLICT、依赖失败或网络中断改写为重名。旧响应缺少字段但带有明确 WORK_NAME_CONFLICT 时，可以在这两个名称表单中安全定位；只有通用 CONFLICT 时继续原有反馈，不按当前列表猜测。

字段提示与现有弹窗反馈合并，避免同一错误出现两次。用户编辑名称时可清理对应字段的旧提示，其他草稿与错误保持；请求和未知结果准入继续现有规则，不扩展通用 ActionState 分类或解除其他锁。

重名反馈绑定提交时经 trim 的名称。请求期间名称仍可编辑；若响应返回时当前草稿与提交名称不同，提示须明确指向原请求的名称，不给当前输入添加 aria-invalid 或字段错误。编辑或关闭时清理这一已确认拒绝的名称反馈，保留未知结果和在途请求的原有保护。

对已复现的创建 A/B 逆序响应，只在创建错误回调增加局部提交归属判断：同一表单先提交 A、再显式提交 B，B 先返回重名错误时，迟到的 A 响应不得覆盖或清除 B 的表单错误、Name 字段错误及可访问关联。以最新已发出的创建请求为准，保留当前名称和高级草稿；旧请求仍按现有 ActionState 记录处理。该增量只补此已知错误反馈问题，其他并发组合、成功回调改造和通用框架调整暂不纳入，现有提交准入保持。

### 3. Import 提交前说明规则，提交后显示实际名称

| 场景 | 名称区域反馈 |
| --- | --- |
| 名称留空 | `Leave blank to use the package name. Core adds a suffix if that name is unavailable.` |
| 显式名称冲突 | `This Work name is already in use. Choose a different name, or leave it blank to let Core choose one.` |
| 受理且发生自动改名 | 显示已确认源名称与实际 name，例如“笔记”→“笔记-3”，并使用 Import accepted/Preparing 语义 |
| 显式选择另一个可用名称 | 显示用户选择的目标名，不标成自动避让重名 |
| Operation 成功 | 显示实际导入名称、新 Work 身份及 stopped，沿用 Open Work/Start Work |
| 未知或失败 | 沿用原查询/错误路径，不猜测目标名称、不把名称已选定当成导入完成 |

客户端不增加可用性查询或后缀预测；提交前只能说明规则，最终值由 Core 现有选择算法及名称预留决定。Core 不可达、其他依赖失败等情况也不能被描述为名称冲突。

先在现有本地 Inspect 摘要补充已验证包的 `sourceName`；它仅是显示元数据，不改变包格式、校验或导入 DTO。

在 adapter 接受 Import 结果时，将既有 `name` 及当前已知源名称、是否显式指定的显示上下文保留到本页 Operation 模型；轮询没有 name 字段时不清空已确认名称。自动改名说明仅用于“请求省略名称、源名称已确认、实际名称不同”的情形。

本次不向 CLI Operation 记录写入名称或额外状态。重载后可用既有接受/transfer 信息及 Work 读取显示实际名称；若原名称或改名原因已不可确认，就只展示当前可确认名称，不补造自动改名历史，也不新增读取接口。

### 4. Import 名称冲突保留现有检查与提交保护

明确名称冲突时保留已检查包及用户填写名称，提示用户自行修改或主动留空。不得自动清空字段、自动使用源名称、重新上传或再次 POST。现有 `checkInspectionImport`/transfer 状态核对、同 Core/账号校验和未知结果保护继续决定何时可再次提交；字段错误的显示本身不能绕过这些准入。

原接受响应已有最终名称，无需改变 Import 命名算法、接受 DTO 或存储。接受阶段只表明“本次导入选定该名称”；失败后不将其展示成已发布 Work，成功后才使用 Imported 表述。

### 5. 定向验证与交付

Go/HTTP 测试覆盖两处名称冲突返回、并发占用及既有同键重放顺序；CLI 契约测试验证安全名称字段传递。浏览器覆盖创建重名、Import 留空且返回非预测后缀、显式冲突、显式新名称、受理/成功/失败及恢复缺少名称时的表现，并断言字段可访问、草稿/检查包保持、用户文本按纯文本显示、无额外创建或 Import 请求。

浏览器修改后构建 workspace、同步 Go embed 并重建 CLI，核对 `docs/webui-integration.md` 和 `docs/work-snapshot.md` 的对应文字。无需修改部署材料、持久格式、镜像引用或历史发布事实。

## Risks / Trade-offs

- 名称在列表中不可见仍可能被占用 → 使用“已使用或保留”的安全说明，不提供错误的删除释放建议。
- 客户端预测后缀与并发事实不一致 → 只展示 Core 现有接受响应或已读取 Work 的真实名称。
- 自动改名被误写成用户主动命名 → 保留本页是否显式指定的显示上下文，分别测试两种情况。
- 接受响应名称被后续缺字段轮询覆盖 → 保留已确认值；未知名称明确保持未确认，不生成假值。
- 字段反馈遮蔽既有恢复保护 → 只改呈现与名称错误语义，验证 transfer 状态、原 Operation 和 POST 次数保持。
- 修改共享错误投影影响其他入口 → 只增补经过验证的安全名称字段，运行既有 CLI 错误回归，不扩大为通用错误框架。

## Migration Plan

无数据迁移。实施后生成并同步 Desktop 静态资源，重建 Go Core/CLI，使两处创建错误与实际交付 UI 一致；回退仅涉及对应代码和嵌入资源。现有 Work、命名、导入及恢复数据保持原结构。实施与验证范围及实际结果见 [verification.md](verification.md)。
