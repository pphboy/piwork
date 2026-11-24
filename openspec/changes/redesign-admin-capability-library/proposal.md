# Proposal

## Why

当前 Skills、Packages 与默认 Work 的入口分散，Skill 详情主要展示文件数量和时间，管理员无法阅读和直接修改已上传目录中的指令。已选定的方案 3 将操作按页面、Skill/Package、文件分层：能力库负责内容与对象管理，独立的“新 Work 默认”视图负责默认选择。

## What Changes

- 将 Work 设置收敛为“能力库 / 新 Work 默认”两个视图；能力库内保留 Skills / Packages 分类、原有蓝白配色和精简 Header，兼容既有管理深链接。
- Skills 使用双栏：左侧先选 Skill，仅展开当前 Skill 的文件；右侧默认打开 `SKILL.md` 原文，支持编辑并只保存当前文件。有未保存修改时提供保存后切换、放弃修改、继续编辑。
- 增加仅面向已启用管理员的 Skill 文件清单、UTF-8 正文读取和单文件保存接口；保存复用完整不可变 Skill 制品发布，保留其余文件、目录身份、启用状态、默认引用及已有 Work 副本。对同一文件的过期保存明确拒绝。
- Skill / Package 的信息、目录或来源更新、启停和移除集中到左侧对应行菜单，显式携带目标；删除页头和文件编辑区的混合菜单，文件工具栏仅保留文件保存。
- “新 Work 默认”复用现有配置读写、Skills 顺序、Packages 多选及顺序调整、AGENTS.md 编辑及局部 PATCH 规则；默认选择不由文件保存或行菜单隐式修改。
- 保持已有单个 Skill 完整目录上传、Package 四种来源、后台 Operation 与默认引用保护。原型是交互依据，不替代这些现有契约。

## Capabilities

### New Capabilities

无；复用现有能力边界。

### Modified Capabilities

- `serve-ui`：Work 设置导航收敛、既有深链接兼容以及页面/对象/文件操作层级。
- `serve-ui-skills`：从元信息详情改为 Skill 文件树与原文编辑，保留目录上传、对象管理和既有状态反馈。
- `skill-management`：在原目录更新之外增加管理员内容读取与单文件原子保存；普通用户发现和原 catalog 元信息响应保持不变。
- `serve-ui-packages`：在能力库中呈现 Packages，更新、启停与移除归属明确的 Package 行菜单；补齐默认 Packages 的上移/下移与保存顺序，安装协议和 Operation 不变。

## Impact

- 浏览器：`apps/console-webui/src/{app,adapter,models}.ts`、所属新功能模块、`src/i18n/app.js`、`public/style.css`；复用 `apps/ui-shared` 配色和控件，不重做全局导航、模型或用户管理。
- 服务端：`internal/coreapp/{http,skill_read,skill_manage,skill_upload}.go`、`internal/skillartifact`、`internal/consoleapp/console_api.go`。内容接口使用精确代理白名单及独立容量限制，不扩大通用代理权限。
- 契约：在 `packages/contracts/src` 增加 Skill 内容 schemas，接入现有 HTTP 生成链，同步 Go DTO/schema/golden、相关错误和中英文文案；保留旧接口响应兼容。
- 交付：更新 Console 内嵌资源并构建同版宿主程序；验收使用隔离数据目录和合成 Skill，不包含外部发布或对现有用户安装的写入。
- 设计依据：冻结本次已确认的 v6 原型为本变更附件。实现只取已确认的方案 3；不交付方案切换器、原型数据、额外预览端口或后台原型服务。

边界：本次只编辑现有独立 Skill 的 UTF-8 文本文件；不增加文件新建/重命名/删除、Markdown 阅读模式、Package 内文件编辑、自动保存、跨设备草稿或新的 Work Apply 流程。
