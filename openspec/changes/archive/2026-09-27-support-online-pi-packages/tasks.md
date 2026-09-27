# Tasks

## 1. SDK 与镜像身份

- [x] 1.1 将直接依赖的 Pi SDK 与锁文件精确固定到 0.86.1（OPKG-002、OPKG-004）；通过 `npm ci`、四个宿主 Pi 模块的解析版本及现有 Pi adapter SDK 测试验证。
- [x] 1.2 从同一源码重建 `production` 和 `acceptance` agent 镜像，并添加共用 helper 契约标签（OPKG-003）；验证两种镜像均报告 Pi 0.86.1、包含编译后的 package helper，且以 UID 10001 启动。
- [x] 1.3 向子代理执行器暴露镜像内 Pi 包根目录、CLI 路径和 tmpfs Pi 子代理配置目录（RUNTIME-PI-PKG-001）；验证镜像中的非 root 进程能解析正确包和 Pi CLI 版本。

## 2. 已发布包的验证

- [x] 2.1 仅从两个产物验证器的宿主专用依赖集合中移除 `typebox`（OPKG-001）；增加异步/同步测试，证明私有 TypeBox 被冻结并纳入摘要，而缺失或逸出的依赖及四个宿主 Pi 运行时依赖仍被拒绝。
- [x] 2.2 在 `packages/pi-package/src/source.ts` 解析并验证 `peerDependencies`，覆盖缺失、格式错误、空值和有效范围（OPKG-002）；通过来源解析器测试验证，并直接依赖 semver，而不依赖传递安装。
- [x] 2.3 为 npm、Git、本地和 ZIP 来源共用一个 helper 检查，在 npm 安装依赖前将 Pi 宿主 peer 范围与所选准备镜像比较（OPKG-002）；用精确匹配、版本过旧、范围错误和标签移动测试验证，并确认失败不发布包。
- [x] 2.4 通过 helper、Docker 运行时和 Core Operation 映射传递 `PI_PACKAGE_SDK_VERSION_UNSUPPORTED`（OPKG-002）；验证公开错误码和消息稳定，且不含子进程输出、路径或凭据。

## 3. 预检与重放

- [x] 3.1 增加针对不可变镜像的 helper 契约检查，使用有时限、只读、非 root、无网络的探针（OPKG-003）；验证缺少标签/文件、有效镜像和 Docker 不可用等测试可区分不兼容与运行时故障。
- [x] 3.2 在幂等重放之后、新 Core 或 Work 包 Operation 被接受之前，检查准备镜像和可信镜像（OPKG-003）；验证两个旧镜像均不会创建 Operation，且镜像删除后，已接受的失败请求仍以 `reused=true` 返回原 ID。
- [x] 3.3 将 `PI_PACKAGE_HELPER_INCOMPATIBLE` 映射为安全的 HTTP 409 和 CLI 诊断，不附带原始镜像输出（OPKG-003）；通过 Core 与 Work 请求测试验证精确错误码及敏感信息缺失。

## 4. 真实包验收与兼容性

- [x] 4.1 检查已发布的 `pi-subagents@0.71.0` 压缩包，将其工具参数和结果结构固定为验收常量（OPKG-004）；验证 fixture 测试使用这些精确结构，且不解析会移动的 `latest` 版本。
- [x] 4.2 在包工具运行前，将 Work 配置的模型和凭据写为现有 `/tmp` tmpfs 内权限为 0600 的 Pi 配置文件（RUNTIME-PI-PKG-001）；验证分离子代理可认证、文件在 Work 停止时消失，且 key 不进入持久 Work 数据或诊断。
- [x] 4.3 为在线驱动脚本增加可随测试销毁、位于 Work 网络内的 OpenAI 兼容模型 fixture（OPKG-004、RUNTIME-PI-PKG-001）；验证前台和分离的后台子代理都通过同一生产凭据路径访问它。
- [x] 4.4 增加真实 registry 驱动脚本，覆盖 Core 安装、冻结的 Core-to-Work 复制、配置应用、`loaded=true`、实际 `subagent` 注册及前台 SDK 工具完成（OPKG-001、OPKG-002、OPKG-004）；验证 registry 故障使脚本失败，固定公开压缩包可通过。
- [x] 4.5 扩展在线驱动脚本：启动并观察或取消后台子代理，然后停止 Work，断言子代理不继续存活，也看不到 Core 或其他 Work 的路径（OPKG-004、RUNTIME-PI-PKG-001）；以进程和工具事件断言验证，不只检查 assistant 文本。
- [x] 4.6 更新操作文档，说明新的 helper/SDK 不兼容错误码、镜像重建要求，以及显式 Work 升级与回滚规则（OPKG-002、OPKG-003、OPKG-004）；验证文档命令与包来源和验收驱动脚本一致。
- [x] 4.7 运行构建/类型检查、包/Core/agentd 相关测试、离线产品验收和真实在线包验收；逐项核对 OPKG-001 至 OPKG-004 及 RUNTIME-PI-PKG-001 的场景证据，包括旧 0.86.0 Work 保留与跨镜像环境不匹配，再将变更标记为已实施。
