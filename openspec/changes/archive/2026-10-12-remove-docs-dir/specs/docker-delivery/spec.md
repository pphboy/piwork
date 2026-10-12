# docker-delivery 规格变更

## ADDED Requirements

### Requirement: 发行维护的本地候选和真实发布身份

**Identifier:** DOCKER-MAINT-001

发行维护 SHALL 以同一真实版本/commit/dirty/源码输入/Desktop 摘要制作 Core、CLI、Agent、file/snapshot helper，package helper 复用 Agent；Docker 多阶段构建内运行 Go1.25.5/Node24，维护宿主无需这些解释器。metadata/materials 构建目标不独立发布工具镜像，构建上下文不包含真实秘密/数据。

候选 SHALL 在本地完成静态/运行/协议/资源检查和 SHA256SUMS，manifestVersion2 标 candidate，不填虚构 registry digest。五角色本地 image ID、标签/协议/资源及实时远端身份在首次 push 前全部核对，任一冲突/认证/网络/无法确认均零推送。登录 registry 不代表授权；明确授权后同一入口执行 push，不能绕过预检。匿名拉取/manifest digest/publishedImageId 确认后单独生成 published 材料，保留原 candidate。

README/手册/Core-only Compose/单机示例与官网下载材料 SHALL 按同版记录核对，候选不得宣称可下载，旧发行记录不为后续源码回填身份。正式更新日志按实际版本维护，未发行内容为 Unreleased；结构检查与正式 require-current 分离。所有写外部官网、push/上传/Release 仍须用户明确请求，本次迁移不执行。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

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

```sh
sh dist/docker/candidate/push-commands.sh --check
```

```sh
sh dist/docker/candidate/push-commands.sh --push
```

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

```sh
node scripts/check-docker-quickstart.mjs
node --test scripts/check-docker-quickstart.test.mjs
node --test scripts/build-docker-release.test.mjs scripts/docker-cli-entrypoint.test.mjs scripts/docker-publish-preflight.test.mjs
```
