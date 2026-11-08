# 基础镜像发布事实

用户在本地实现验收后明确要求“推送”。本次仅发布 FastAPI + htmx Service 基础镜像，并同步其 brain 引用；不包含 Core/MicroVM 正式发行或官网部署。

## 远端制品

- 发布时间与匿名验证时间：2026-11-08T08:54:12.233Z
- 固定引用：`docker.io/pphboy/piwork-fastapi-htmx-base:0.1.0-08fc54adda53-44102ae552dd-dirty@sha256:a6deae4184ddd1261ea93bad8eeccb8b51e0aea91065e24cac3833ef8a3f9fb1`
- Registry digest：`sha256:a6deae4184ddd1261ea93bad8eeccb8b51e0aea91065e24cac3833ef8a3f9fb1`
- Image ID：`sha256:d23d4cea03a546bf2dd55506989af323ab91cd8ea679f523fd5db2944594945f`
- 输入 hash：`44102ae552dd9b9fc8f608277cb3db99a416739fb78cbb33615afa5bb054eaea`
- 构建源码 commit：`08fc54adda53a0c9ee71f66d3ec237050adf9be0`
- 构建 dirty：`true`
- 平台：`linux/amd64`

构建身份沿用本地已验收候选，没有为后续引用或 Git 修改重写 commit、dirty、输入 hash 或镜像身份。权威发布记录为仓库 deploy/images/fastapi-htmx-base/release.json；本机操作日志为 dist/fastapi-htmx-base/publish.log。

## 已执行验证

1. 当前候选与浏览器、依赖、真实 Core 入口及 SDK 目标子集结果匹配；固定 tag 冲突负例和缺失验收负例通过。推送前确认远端无该 tag。
2. 使用 Docker 现有授权推送精确候选。推送后读取远端 manifest，确认 config digest 与原 image ID 一致。
3. 使用临时空 Docker 配置、清除 DOCKER_AUTH_CONFIG，以完整 tag@digest 匿名拉取，确认 image ID 一致。
4. 从匿名取得的固定 digest 运行非 root、只读根、network none 容器；验证本地 htmx/Bootstrap 资源 SHA256、sqlite3、piwork-fastapi 启动器，以及真实 Uvicorn/FastAPI HTTP 健康响应。全部通过。
5. 正式 brain Reference 已为 published，指向同一 tag@digest，并标记 anonymousReadable。脑包从 1.3.0 升至 1.3.1，使采用该软件更新的路径能够区分引用变更。
6. 更新双语镜像说明和引用绑定测试；四项构建/发布工具测试、相关 coreassets/bundled brain 测试、文档、风格及空白检查通过。末版本地 Core/CLI 已重建，产品构建保留 VCS stamping。

## 重建的本地宿主

- Core SHA256：`8947b9fb5fad23da4341732a7a26ff2aa2f21f360dfbe61cb46fc53ef7c22dbd`
- CLI SHA256：`ecbcf20c8887d771ac05c1d21653745bb572deccad5e078f69e5bde1b5dd18f1`

本轮没有替换其他安装正在运行的宿主程序。既有 Work 采用 brain 1.3.1 仍遵循现有包更新及显式 Apply。

## 验证范围

原 Service 运行内容和镜像输入未因本轮发布改变，完整本地业务验收事实继续保留在 [本地验收记录](local-validation.md)。本轮新增远端发布、匿名拉取/运行和 brain 固定引用绑定验证，没有将之前的 partial SDK 子集改写为全仓集成通过。
