# Docker 发行维护

Docker 发行使用 `scripts/build-docker-release.mjs`，原生链继续使用 `make build-go`、`npm run build:cli`、原有 Go/CLI 打包工具。用户只拿到 `piwork-docker` 发行包，安装步骤见 `deploy/docker/README.zh-CN.md`，不运行此维护者工具。

维护者在明确授权的发行任务中手动构建、推送镜像、打包和创建 GitHub Release。构建与打包工具本身不自动 push 或上传。本次发行目标为 `0.0.1 Preview`，镜像前缀为 `docker.io/pphboy`；历史 `0.1.0` 候选验收记录保持原样，不能作为新产物的通过收据。

## 输入和构建

Linux 构建机安装 Go 1.25.5、Node 24、项目 npm 依赖、Docker 和 Compose。首发 linux/amd64，运行基础层在 `config/docker-release.json` 固定为实际取得的 Alpine 3.22 digest；更新基础层须重新构建并复验。Core/CLI 包含 CA、curl；CLI 另含 jq，运行层没有 Go/Node/Python/Docker CLI。Agent 保留 Node/Pi SDK。版本取 package.json，所有原生程序、镜像和 Desktop hash 对应同一次构建；有工作区修改时记录 sourceModified=true，不能声称是干净提交构建。

以下直接调用现有工具。仓库前缀必须是维护者实际可发布、可供用户/Core 读取的 registry/namespace，不能包含 URL 协议或认证信息；Docker Hub 使用 `docker.io/命名空间`。不要把示例地址当作已有发布仓库。

```bash
node --version
go version
docker version
docker compose version
npm ci
PIWORK_BUILD_VERSION=0.0.1 make build
export PIWORK_RELEASE_REGISTRY=docker.io/pphboy
node scripts/build-docker-release.mjs build
```

build 自动重新编译 Desktop，调用独立原生 CLI 构建生成 Linux/Windows 客户端，调用已有 build-go 将静态 Core 编译到 dist/docker/bin，构建两入口及既有 Agent/file/snapshot 镜像；Agent 的 npm 依赖从官方 registry.npmjs.org 获取。版本、平台、协议 labels、镜像 ID、镜像内程序 --version、内嵌 Desktop hash、CLI 目录权限与 jq 都须核对成功，才写 dist/docker/build.json。同提交的 package helper 复用 Agent。缺镜像或协议不兼容不会生成可发布包。sourceInputHash 覆盖本次源码与构建输入，构建期间输入变化或打包前再次修改会明确要求重建。

## 发布镜像和打包

在有权限的实际发行仓库发布已校验的五个镜像。Docker 凭证使用维护者既有登录方式；密码不放进命令参数。普通用户/Core 默认必须可匿名读取所有发行依赖。私有仓库另行配置显式静态认证，Core 的 Go Engine 路径不调用宿主 credential helper。

```bash
node --input-type=module -e 'import { readFileSync } from "node:fs"; const b=JSON.parse(readFileSync("dist/docker/build.json","utf8")); for(const v of Object.values(b.images)) console.log(v.reference);' > dist/docker/images-to-publish.txt
while IFS= read -r PIWORK_IMAGE; do
  docker push "$PIWORK_IMAGE"
done < dist/docker/images-to-publish.txt
node scripts/build-docker-release.mjs package
cd dist/docker/piwork-docker
sha256sum -c SHA256SUMS
cd ..
sha256sum -c piwork-docker-*.tar.gz.sha256
```

package 会检查源码输入与 build.json 一致、每个镜像具有真实 registry digest、使用不带发布凭证的临时 Docker 配置读取远端 manifest、pull 后 ID 与已验证构建一致，并再检查各协议/版本；只读取本地 cache 不算验证通过。结果为 dist/docker/piwork-docker 与带版本/提交的 tar.gz，内部 SHA256SUMS 覆盖其他全部文件，压缩包 SHA256 单独发布。包内只复制模板，不包含 core.env/client.env、.env.test、模型 key 或客户端凭证。

manifestVersion=1 记录实际镜像 reference/digest/imageId/platform/protocolLabels、源码及 dirty 标识、sourceInputHash、Desktop 输入 hash、固定基础层、Core 格式/schema 和客户端凭证版本。第一版的 compatiblePreviousReleaseVersions/directlyRollbackablePreviousVersions 都为空，没有之前 Docker 发行的验证证据。后续增加前版声明必须先取得数据格式、协议和实际回退证据，不能从版本号推断。

## 本机候选材料更新与安装校验

保存旧候选包与证据，再以本次版本和干净提交重新构建镜像及发行材料。维护者构建/打包工具没有自动上传或创建 Release 的步骤。

用户手册 6.1 提供 Bash/PowerShell 的完整已有本地包入口，输入本地路径及可信 SHA256 后先比较压缩包 hash，成功才解压并核对内部 SHA256SUMS。Preview 的下载入口指向 GitHub Release。取得安装材料不代表镜像离线可用，镜像仍按既有 Docker 拉取条件取得。

只有文档变化且源码输入未变时，使用已验证的镜像重新执行 package，不必重新构建或推送同一批镜像；若工具报告源码输入已变，必须先按既有 build 流程重新构建，不能改 build.json 绕过检查。重新打包前将之前的候选包、checksum 和 D09 收据保留在以旧压缩包 SHA256 标识的历史目录，新包用新的 checksum 核对，不能沿用旧收据宣称新包通过。

仅准备本机候选文件（在源码根目录，已有验证过的 `dist/docker/build.json`）：

```bash
export PIWORK_RELEASE_REGISTRY=docker.io/pphboy
node scripts/build-docker-release.mjs package
PIWORK_DOCKER_ARCHIVE_NAME=$(node --input-type=module -e 'import { readFileSync } from "node:fs"; const m=JSON.parse(readFileSync("dist/docker/piwork-docker/release-manifest.json","utf8")); process.stdout.write(`piwork-docker-${m.releaseVersion}-${m.sourceCommit.slice(0,12)}.tar.gz`);')
(cd dist/docker/piwork-docker && sha256sum --check SHA256SUMS)
(cd dist/docker && sha256sum --check "$PIWORK_DOCKER_ARCHIVE_NAME.sha256")
```

上述 package 只读取镜像 manifest/pull 并生成本机文件，不执行 push、包上传或创建 Release。对外发布由维护者显式执行；本地构建通过不能代替公开下载与镜像可读性检查。

对外附件使用 `piwork-docker-0.0.1.tar.gz` 固定名称：复制同提交的工具生成包后，针对该公开文件名重新生成 `.sha256`。二进制 Preview 包附带 LICENSE、使用说明、构建元数据和校验文件；Windows 原生 CLI 为实验性附件，保留正式打包的完整原生验收门禁。所有附件与镜像必须对应同一个干净提交。

Core 正常关闭成功前必须确认本安装全部受管 Work 的 Agent/Service 已停，并收尾受管任务；某 Work 失败仍尝试其他 Work。保留数据、历史、desiredState 和 Service 启用意图，重启恢复原期望 running 的 Work。无法确认关闭或预算耗尽按既有非零退出及未完成诊断处理；SIGKILL/崩溃/断电不能作为关闭成功证据。CLI 退出不停止 Work。

## 发布验收

在公开发行前完成 `docs/docker-delivery-acceptance.md` 的 D01–D09，以真实候选包及镜像验收 Linux Core、Linux Desktop 和 Windows Docker Desktop。完整 Run 使用真实支持模型；Windows 不能由 Linux 或原生 CLI 代替。无 Desktop Docker 只核查文档和共用逻辑，不新增独立端到端门禁。

与原生链同时核对 `make build-go`、`npm run build:cli` 及原有 `scripts/package-go-release.sh` / `scripts/package-cli-release.go` 的产物。Docker 通过不代表另一变更中原生 Windows 未完成项通过。发布页面列出实际 OS/Engine/Compose/浏览器版本、支持范围、包 checksum、镜像 digest 和当前验收结果。

历史修复结果见既有验收记录；Preview 使用本次候选重新记录实际执行结果和环境。原生 Windows 的验收缺项必须在 Release 中明示。发布前先创建草稿并核对附件，再设为 prerelease；发布后验证公开下载和校验链。
