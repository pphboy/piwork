# work-snapshots 规格变更

## ADDED Requirements

### Requirement: SELinux 部署授权与快照升级边界

**Identifier:** WSNAP-OPS-001

Core 与 snapshot helper SHALL 配套包含 SELinux 兼容能力。仅精确名称 security.selinux 从可移植属性中排除，不读取、写入或迁移标签值；目标使用目标宿主策略，其他 xattr、ACL、capability 或枚举失败仍整体拒绝。Docker 正常挂载导致的标签规范化与树处理阶段 SHALL 分别说明，不保证私有 MCS 原值跨挂载不变。

部署 SHALL 保持 Enforcing，对明确的数据目录设置持久 container_file_t 规则，Unix owner/0700/0600 与 SELinux 分别授权；容器包源的 0644 权限不能被不合适的 umask 无意收紧。semanage/restorecon 是部署工具而非 Core 运行依赖，不对其他应用或整个 Docker 存储目录扩大规则。升级/回退 SHALL 等待快照和清理 gate，备份数据、卷及运行配置并切换配套版本；在独立 Work 中验证 stopped 导入、显式 Start 和再次往返。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```bash
export PIWORK_DATA_DIR=/var/lib/piwork/core
getenforce
sudo semanage fcontext -a -t container_file_t "${PIWORK_DATA_DIR}(/.*)?"
sudo restorecon -RFv "$PIWORK_DATA_DIR"
ls -Zd "$PIWORK_DATA_DIR"
```

### Requirement: 冷快照的操作与失败恢复入口

**Identifier:** WSNAP-USAGE-001

导出 SHALL 只接受已核验 stopped 的 Work，确认 Agent/Service/file/package 写入者退出，并保留完整包/Operation 身份；下载只在完整核验后发布为不覆盖目标的本地文件，中断从原 snapshot ID 从头重下，不自动新 Export。离线 inspect 不需要登录且不判断目标环境。

导入 SHALL 先流式验证完整有界包和目标资源，原子发布新的 stopped Work；源安装可以离线，目标配置自己的模型/Key。显式 Start 后才恢复执行，导入历史不创建请求或包候选。未知目标模型/多匹配 Session 偏好/旧 nullable reader 不兼容分别明确失败或保留 unavailable，不能把 Normal/null 改为 Off 或静默替换镜像。导出/import/package 任务保持原幂等 resource ID，未知清理保留 lease/占用并按精确 installation 身份恢复。

#### Scenario: 按现行契约操作与核对
- **WHEN** 用户或维护者使用上述现行入口，并满足对应身份、平台与运行条件
- **THEN** 操作、边界、拒绝及恢复遵循上述契约，不依赖已移除的开发手册；历史版本描述不覆盖当前有效 Spec

以下为已有操作/验证入口的示例，使用实际返回 ID 和隔离测试资源；命令存在不表示本次已执行或验收通过。源码构建使用 Go 1.25.5、Node 24，容器/浏览器专项须预备相应依赖。

```sh
piwork-cli work stop <workId> --wait
piwork-cli work export <workId>
```

```sh
piwork-cli operation show <operationId>
piwork-cli work snapshot download <snapshotId> --output demo.work
```

```sh
piwork-cli work package inspect <workId>.work
```

```sh
piwork-cli work import <workId>.work --wait
piwork-cli work start <newWorkId> --wait
```

```sh
bash scripts/build-go.sh
TMPDIR="$HOME/.cache/piwork-native-tests" \
PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance \
CGO_ENABLED=0 go test -mod=readonly -tags=integration ./internal/coreapp \
  -run 'TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations|TestNativeCoreSnapshotJobsRecoverAcrossActualProcessCrashes' \
  -count=1 -v -timeout=20m
```
