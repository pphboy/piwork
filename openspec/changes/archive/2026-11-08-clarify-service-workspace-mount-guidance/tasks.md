# Tasks

## 1. 默认认知、操作指导与脑包交付

- [x] 1.1 在 `brain.md` 增加主动处理所需 workspace 挂载的简短默认原则，并在部署 Skill 的创建/更新步骤说明字段配对与参数拒绝时先核对定义；同步现有脑包内容测试。验证：从实际脑包 ZIP 可读到默认原则及操作位置的指导，用户无需单独提醒挂载；保持原四项原则、两个 Skill 和授权边界。（BRN-018、ADEP-006）
- [x] 1.2 在现有 Reference 增加 `mounts` / `workingDirectory` 两类 JSON 字段片段及读写说明，并在 coreassets 测试中读取随包片段，补齐合成必要字段后复用现有 Service 定义校验。验证：workspace 与镜像原生组合通过，workspace 工作目录缺少挂载的组合仍被拒绝，示例明确是字段片段而非完整请求。（ADEP-006）
- [x] 1.3 递增脑包补丁版本并同步 coreassets / bundled brain 的相关版本期望。验证：`go test ./internal/coreassets` 及 `go test ./internal/coreapp -run TestBundledBrain -count=1` 通过，原包更新、旧版本保留及管理员定制保护保持。（BRN-018）

## 2. 本地集成与范围复核

- [x] 2.1 执行 `make build-go`，以及 repository-docs、native-boundary、docker-quickstart、source-style、`git diff --check` 和本变更 OpenSpec 严格校验；核对脑包版本及镜像引用，记录必要检查结论。验证：本地 Core/CLI 完成嵌入，三个认知/指导文件与示例检查一致；没有 Core/MCP 生产实现、自动挂载、镜像发布或在线 Work Apply 改动，明确实际已测范围。

## 实施验证

- 脑包版本 1.3.4；常驻原则、部署步骤与 Reference 字段片段均从实际脑包 ZIP 验证。两类示例通过现有 Service 校验，缺少 workspace 挂载的负例仍被拒绝。
- coreassets 归档测试及其 workspace / image-native 子用例、10 项 bundled brain 单元测试通过；`make build-go` 完成本地 Core/CLI 重建。
- repository-docs、native-boundary、docker-quickstart、source-style、空白检查和本变更 OpenSpec 严格校验通过；FastAPI 基础镜像输入 hash 与已发布记录、固定引用一致。
- 实现仅涉及三个脑包认知/指导文件、包版本和三个相关测试文件。临时日志位于 `dist/clarify-service-workspace-mount-guidance/`；本轮未运行真实模型/SDK/Docker/浏览器验收，未操作在线安装或既有 Work。

## 后续获准部署

用户随后明确要求部署到 17891，已完成内置脑包 1.3.4 更新，完整就绪检查及已安装默认挂载认知内容核对通过，原有 Work/Service 恢复运行，既有 Work 的采用上下文保持原样。部署使用保留该实例既有功能的基线 `9419b71e64cb43c350a496d3c728f9a045313847`，modified 为 true，脑包增量 patch SHA256 为 `a35cb89c1b2af42cdba4ac4fbbc6a5b7eb1f2cdb7a5b655596f81f6fc2e5c8eb`；该已部署构建身份不改写为后续归档提交。原程序和 Core 数据的私有备份保持在安装侧，临时构建与测试日志位于 `dist/deploy-17891-1.3.4/`。
