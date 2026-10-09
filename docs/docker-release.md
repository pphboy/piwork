# Docker 发行维护

Docker 发行直接使用 `docker build` 和 `docker push`。Core、CLI、Agent、file-helper、snapshot-helper 从同一源码输入制作，package helper 复用 Agent。默认用户入口为 Core、CLI 各自独立的 Docker 命令；`docker-compose.yml` 只部署 Core。合并方式是 [单机部署示例](../examples/single-host/README.zh-CN.md)，使用独立数据和凭证卷，见 [Docker 手册](../deploy/docker/README.zh-CN.md)。原生 `make release` 和 CLI 发行链保持独立。

宿主需要 Git、Bash、Docker Engine 与支持多阶段构建、本地导出和命名上下文的 BuildKit/buildx；不要求宿主 Go、Node、npm 或 Make。Go 1.25.5、Node 24 在构建阶段运行。Core/CLI 运行层使用固定 Alpine digest，仅保留 CA、curl 和 CLI 所需 jq；Agent 保留 TS harness/Pi 生态。

## 本地构建

在项目根目录记录真实 Git 身份，导出不含秘密的元数据。不要把密码、模型 key、token、真实 env 或数据目录作为构建参数或额外上下文。

```bash
piwork_release_commit=$(git rev-parse --verify HEAD)
piwork_release_modified=false
if [[ -n $(git status --porcelain --untracked-files=normal) ]]; then
    piwork_release_modified=true
fi

docker build -f Dockerfile.docker-release --target metadata \
    --build-arg "PIWORK_COMMIT=$piwork_release_commit" \
    --build-arg "PIWORK_MODIFIED=$piwork_release_modified" \
    --build-arg PIWORK_RELEASE_REGISTRY=docker.io/pphboy \
    --output type=local,dest=dist/docker/inputs \
    .
```

版本来自 package.json。发行标识包含版本、commit、源码输入摘要，有工作区修改时附加 dirty。元数据还绑定 Desktop 输入摘要、平台、固定运行基础层、当前 Core 格式/schema 和客户端凭证版本；不能用旧历史记录替代当前事实。Core 内置同一发行标识的非敏感依赖引用，不要求先 push helper 再制作 Core。

将导出的真实输入传入五个 Docker 构建命令：

```bash
piwork_release_input="$PWD/dist/docker/inputs"
piwork_release_build_args=(
    --platform linux/amd64
    --build-arg "PIWORK_VERSION=$(cat "$piwork_release_input/version")"
    --build-arg "PIWORK_COMMIT=$(cat "$piwork_release_input/commit")"
    --build-arg "PIWORK_MODIFIED=$(cat "$piwork_release_input/modified")"
    --build-arg "PIWORK_DIRTY=$(cat "$piwork_release_input/modified")"
    --build-arg "PIWORK_SOURCE_INPUT_HASH=$(cat "$piwork_release_input/sourceInputHash")"
    --build-arg "PIWORK_DESKTOP_UI_HASH=$(cat "$piwork_release_input/desktopUIHash")"
    --build-arg "PIWORK_RELEASE_REGISTRY=$(cat "$piwork_release_input/registry")"
)

docker build -f Dockerfile.core "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/core")" .
docker build -f Dockerfile.cli "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/cli")" .
docker build -f Dockerfile.agentd "${piwork_release_build_args[@]}" \
    --target production --build-arg NPM_REGISTRY=https://registry.npmjs.org \
    -t "$(cat "$piwork_release_input/agent")" .
docker build -f Dockerfile.file-helper.native "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/fileHelper")" .
docker build -f Dockerfile.snapshot-helper.native "${piwork_release_build_args[@]}" \
    -t "$(cat "$piwork_release_input/snapshotHelper")" .
```

构建期间保留同一源码输入；代码改变后重新导出并制作完整候选。Go 程序来自容器编译，CLI Desktop 资源在 Node 阶段重新生成，无需宿主 dist。构建同时保留真实版本和协议标签，当前 Work history 为 schema 5。

## 核查并导出候选

使用实际 Docker inspect、镜像内版本、资源摘要、默认配置及运行工具边界生成检查记录。检查工具只在标准 Node 容器中处理记录，不增加独立发布的 Release 工具镜像。首次更新材料时，通过标准 Node 容器把同一元数据同步到 README/手册、Core-only Compose 和单机部署示例：

```bash
docker run --rm --network none \
    --user "$(id -u):$(id -g)" \
    --volume "$PWD:/source" --workdir /source \
    node:24-bookworm-slim \
    node scripts/sync-docker-quickstart.mjs

bash scripts/collect-docker-release.sh dist/docker/inputs

docker build -f Dockerfile.docker-release --target materials \
    "${piwork_release_build_args[@]}" \
    --build-context release-input=./dist/docker/inputs \
    --output type=local,dest=dist/docker/candidate \
    .

(cd dist/docker/candidate && sha256sum --check SHA256SUMS)
```

材料门禁在导出前检查中英文 README、镜像 defaults、Compose、Demo 和手册。源码、镜像、协议、CLI 资源、生成引用或校验不一致会失败；不能手改清单使陈旧镜像通过。生成的 manifestVersion=2 清单将未发布结果标为 candidate，不填造假的 registry digest。

本地验收按 [镜像发行与终端 Quick Start 验收](docker-release-quickstart-acceptance.md) 使用独立安装，分别验证默认独立 Docker run、Core-only Compose 配合独立 CLI 和单机部署示例、真实模型回复、CLI 凭证保持和 Core 正常关闭/恢复。尚未公开的标签可用本次专属本地 registry/mirror 验证冷启动，明确记录本地来源；这不代表 Docker Hub 匿名拉取通过。清理只处理本次资源，保留原有平台验收边界。

## 用户判断与正式发行

先提供 `dist/docker/candidate/release-manifest.json`、`SHA256SUMS`、实际验证结果及 `push-commands.sh` 供用户审阅。已登录 pphboy 不构成推送授权；上述构建、同步和导出都不会 push。

生成的 `push-commands.sh` 默认只做预检，不推送。它绑定已审阅清单的 SHA256，在首次 push 前重新核对全部五个角色的本地 image ID、平台、源码、协议、CLI 资源标签以及实时远端 manifest/config 身份。任一标签被重指向、远端身份冲突、认证/网络失败或结果无法确认都会退出，全部角色零推送。只有明确确认不存在或身份匹配才通过。远端 JSON 通过标准 `node:24-bookworm-slim` 容器解析，宿主不需要 Node；提前取得该标准工具镜像或允许 Docker 拉取。

```sh
sh dist/docker/candidate/push-commands.sh --check
```

仅在用户明确审核允许本次候选之后，执行同一发布入口：

```sh
sh dist/docker/candidate/push-commands.sh --push
```

不要绕过预检单独推送可变标签。预检不消除外部并发改写风险，推送后仍须核对真实远端身份；不使用 latest。

发布后用不带认证信息的临时 Docker 配置读取全部镜像，核对实际 manifest digest、pull 后 image ID、源码/协议和 CLI 资源。记录 `registryDigest`、`anonymousReadable`、`publishedImageId` 及匹配 RepoDigests 后，使用 `published-materials` 导出目标生成正式材料；镜像 config ID 不等于 registry manifest digest。本地候选不能代替这一步。

远端核查记录齐全后，用同一源码及构建输入导出正式材料，再同步文档。候选清单保留原样；正式清单单独保存：

```bash
docker build -f Dockerfile.docker-release --target published-materials \
    "${piwork_release_build_args[@]}" \
    --build-context release-input=./dist/docker/inputs \
    --output type=local,dest=dist/docker/published \
    .

docker run --rm --network none \
    --user "$(id -u):$(id -g)" \
    --volume "$PWD:/source" --workdir /source \
    node:24-bookworm-slim \
    node scripts/sync-docker-quickstart.mjs dist/docker/published/release-manifest.json

(cd dist/docker/published && sha256sum --check SHA256SUMS)
```

官网同步时将同版 `release-manifest.json` 与两份 Compose 一并纳入静态目录和 SHA256SUMS，核对构建后的下载字节与正式材料一致。镜像已发布不表示官网已经部署：尚未发布时明确下载入口待启用，不能把本地预览当作公开下载证据。发布状态变更后执行 Docker Quick Start 的脚本测试，候选负向夹具须显式指定候选状态，不能依赖当前仓库恰好尚未发行。

正式 Core-only Compose 与单机部署示例下载材料与官网位于独立 `install/<release-id>/`；旧 0.0.1/0.1.0 材料保留归属。仓库和官网发布按用户明确指令执行，核对实际下载文件后才宣称入口可取得。升级保留 Core、CLI 与 Work 数据以及旧引用、Compose 和清单，回退先检查格式兼容；首次新版候选不凭历史包推断安全回退版本。

## 一致性检查

开发环境或标准 Node 24 容器内运行：

```sh
node scripts/check-docker-quickstart.mjs
node --test scripts/check-docker-quickstart.test.mjs
node --test scripts/build-docker-release.test.mjs scripts/docker-cli-entrypoint.test.mjs scripts/docker-publish-preflight.test.mjs
```

同步本地官网时另外执行 `node scripts/check-docker-quickstart.mjs --website-root /home/p/Projects/pphboy.github.io/piwork`，在官网目录运行 `pnpm build`。测试使用合成初始化值，不打印真实秘密或真实 Compose 展开配置。未来修改网络、数据目录、状态卷、初始化输入、等待或关闭预算时同步所有材料并执行门禁。
