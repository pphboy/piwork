# Core 0.0.4 发行记录

日期：2026-10-11。本次沿现有五角色 Docker 发行链发布 Core、CLI、Agent、file-helper、snapshot-helper；package-helper 复用 Agent。NiceGUI base 独立发布。

后续 `fix-create-slow` 合并加入镜像检查/包环境探测缓存与默认 Work 预热；这些源码优化不属于本次 0.0.4 固定镜像。分支性能结果见 [Work 创建与启动延迟验收](../../../archive/2026-10-11-reduce-work-create-and-start-latency/evidence/legacy-docs/work-create-start-latency-acceptance.md)，不能据此改写本次发行的验证范围或身份。

后续 `fix-misc-1` 合并的 Chat 图片、创建按钮布局修复和 About / 内置日志同样不属于本次固定镜像；采用这些功能需对应的新源码构建。操作与限制见 [Desktop 使用说明](../../specs/desktop-webui/spec.md#requirement-本机-desktop-的启动授权和使用边界)。

## 固定身份

- 发行标识：`0.0.4-079f92ce3b33-96bc1d1ff3d6`。
- 构建源码：`079f92ce3b334995cfbba78c49371a4768a6d316`，dirty=false。
- 源码输入 SHA256：`96bc1d1ff3d658a444dcba83fe295d0794ef778d32fe4ab004865150d647b32e`。
- 平台：`linux/amd64`；Go 1.25.5；Core 格式/schema 与客户端凭证版本保持原契约。
- 内置脑包：`piwork-brain@1.2.1`。
- 默认 NiceGUI base：`docker.io/pphboy/piwork-web-base:0.2.0-5818e1de7bb5-6b6f6f8bbf62-dirty@sha256:c85c9928549f5b6a58dd519bbf1840fe83e52b9da22eaae556f7aca64b448098`。
- Base 的实际构建身份仍是 `5818e1de7bb5af9bd6305777fc88b40505a708b3`、dirty=true，input hash `6b6f6f8bbf625e2b36502349e5ba13992060aeab4b5239436c3288919ae7d44e`；后续提交没有改写这份已验证镜像的来源。

Core 可按固定 tag 与 digest 拉取：

```sh
docker pull docker.io/pphboy/piwork-core:0.0.4-079f92ce3b33-96bc1d1ff3d6@sha256:0da60f76ba83eca9f5d1372115a50453050918cb59a920f0397bf80224137199
```

| 角色 | 已匿名验证的 registry digest |
| --- | --- |
| core | `sha256:0da60f76ba83eca9f5d1372115a50453050918cb59a920f0397bf80224137199` |
| cli | `sha256:66c0d63831bd8a6136a3319b5edaca4c8a1b6a44552016bf989621680e617c8c` |
| agent | `sha256:3c11877deb6afe825e4c9d6cef7578c4b905d8210d73f39fcf2a7be15112adb5` |
| fileHelper | `sha256:38b4b40131dcd44e8df3faabab9499ea02d37e368a459ca36609cfa4e8374761` |
| snapshotHelper | `sha256:7b80123a472494e79e3d9fded1e026c97909943f939fe7543f6fdaac58c1c4ef` |

完整镜像 ID、协议标签、固定引用与源码身份见 [正式清单](../../../../../deploy/docker/releases/0.0.4-079f92ce3b33-96bc1d1ff3d6.json)。旧 0.0.3 的原记录保留在同目录，旧已发布 tag/digest 继续保持原身份。当前 [Core-only Compose](../../../../../deploy/docker/docker-compose.yml) 与 [单机示例](../../../../../examples/single-host/README.zh-CN.md) 使用本次固定发行引用；运行命令见 [Docker 手册](../../../../../deploy/docker/README.zh-CN.md)。

## 脑包采用与升级

1.2.1 补丁版采用已发布 NiceGUI 固定引用，并使已经安装 1.2.0 的 Core catalog 也能触发内置包更新。启动仅更新仍由 Core 原内置来源管理且启用的包；管理员替换、禁用、移除及显式默认选择保持。新 Work 使用更新后的默认指导；已有 Work 保留捕获包、代码、数据和镜像，通过 Package Update 与显式 Apply 采用新指导，既有应用不自动转换技术栈。

升级时正常停止 Core，保留同一数据目录和 Work 存储，随后启动新版。Core 正常退出会停止本安装受管 Work 运行容器，持久意图和数据供启动恢复。没有重置生产安装或覆盖真实用户配置。

## 实际验证与范围

- 提交后的完整 `make test` 通过，包含构建、Go/TS 单元和浏览器资源类型检查；脑包补丁与正式引用随后执行对应 Go 交付/更新/保护回归。
- 实际 SDK 默认部署正式 NiceGUI digest：61.61 s 通过，验证真实 Service、业务操作和固定引用，`published-default-brain-integration.log`。
- Core 重启更新内置 catalog、旧 Work 保留和新 Work 加载当前脑包：140.48 s 通过，`core-brain-upgrade-integration.log`；1.2.0 → 1.2.1 的版本升级、旧包保留和重复启动幂等有单元回归。
- 五角色实际镜像的版本、commit/dirty、源码 hash、平台、协议与 Core/CLI 运行工具边界检查通过，`collect-records.log`。
- 实际 Core Docker 镜像以合成初始化配置启动，健康和 docker-delivery 就绪通过；实际 catalog 加载 1.2.1，提取的脑包引用为正式 base digest；同版 CLI 连接通过。耗时 33441 ms，`core-smoke-validation.json`。
- 首次启动检查的隔离目录由宿主普通用户创建，与默认 root Core 的数据目录所有权要求不匹配而被拒绝。修正新建夹具目录所有权后重跑通过，保留 `core-smoke-first-attempt.log` 和 `core-smoke.log`；没有放宽产品校验。
- 推送前全部固定 tag 的本地/远端身份预检通过；推送后通过空 Docker 配置匿名拉取各 digest，再运行实际程序并核对 image ID、版本和来源。`anonymous-validation.json`、各角色匿名日志及 `publication.log` 保存真实结果。
- 本轮未执行真实外部模型 Run，使用合成初始化配置和真实 SDK 的确定性验收；没有把健康/就绪当作外部模型凭据有效或模型真实回复的证明。前述默认环境完整回路和分享证据见 [NiceGUI 验收记录](../../../archive/2026-10-11-restore-nicegui-default-environment/evidence/legacy-docs/nicegui-default-environment-acceptance.md)。

本轮日志和候选/正式材料位于被忽略的 `dist/docker/core-0.0.4/`，正式材料在 `published/`，含 manifest、两份 Compose、双语单机说明、烟测/匿名验证和 SHA256SUMS。只清理各测试的精确 installation ID/fixture 资源；真实 env、密码、token、Core 数据和私钥未进入 Git 或公开记录。Git 提交与 Docker Hub 发行已分别记录，官网发布不在本次范围。
