# remove-internal-port-note-from-core-help 验收事实

执行日期：2026-10-21。实现未提交、未推送、未发行；本附件只记录本次执行。

## 变更范围

只删除 `piwork-core --help` 中的内部 Agent RPC 说明句，并补充对应文本断言。不改变启动参数解析、7172 保留规则、监听失败诊断、退出码或部分启动清理语义。

## 实际执行

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 帮助文本断言 | `go test ./internal/app/ -run TestUnifiedHelpVersionAndWrongUserCommandsHaveNoStartupEffects` | 通过。断言 `--help` 输出不含 `7172` 与 `mTLS`，仍含 `--ui-port`、`--core-port`、`--data-dir` |
| 构建 | `make build` | 成功 |
| 真实入口输出 | `XDG_CONFIG_HOME=<tmp> ./dist/go/piwork-core --help` | 退出码 0，stderr 为空，隔离目录内条目数为 0（未创建数据目录） |
| 残留引用 | `grep -rn "Internal Agent mTLS" --include='*.go' --include='*.md' .` | 只命中本变更的 `proposal.md`、`tasks.md`；代码与部署手册无残留 |
| 包测试 | `go test ./internal/app/...` | 通过 |
| 静态检查 | `go vet ./internal/app/...` | 无输出 |
| Docker Quick Start | `node scripts/check-docker-quickstart.mjs` | 不属本变更验证范围。实测：失败，`deploy/docker/release.json: source inputs changed; regenerate candidate` |

## 实际帮助输出

```
Usage: piwork-core [OPTIONS]
Start Core, the browser workbench, administration, and first-time setup.

  --ui-port PORT    HTTP UI port, default 17891
  --core-port PORT  HTTP Core API port, default 17871
  --data-dir DIR    default user config directory/piwork/server
  --help, -h        show help
  --version         show build identity

Both HTTP services accept local and remote connections. Configure users, models
and runtime in the browser. Optional PIWORK_ADMIN_ACCOUNT and
PIWORK_ADMIN_PASSWORD initialize only the first administrator. User commands
and Desktop: piwork-cli.
```

## Docker Quick Start 检查说明

本变更只改帮助文案，不触及镜像、初始化 env、网络、数据目录、CLI 状态存储、就绪等待或关闭预算，按仓库约定不要求执行该检查。为确认部署材料未受影响仍实测了一次：该检查比较当前源码输入 hash 与 `deploy/docker/release.json` 记录的候选输入，把本次两处改动临时移出工作区后退出码为 0，说明失败仅由源码输入变化触发，与文案内容无关。重新生成候选属于发布动作，本次未执行，也未改写 `deploy/docker/release.json` 与历史发行记录。

## 未执行

- `make test` 全量、浏览器与镜像验收：与本次文案改动无关，未重跑。

## 2026-10-22 收尾复核

- 实现提交：`2bb77961a049c466a71051f48a524c77d687624f`。仅包含帮助文案及对应断言，没有修改参数解析、监听或内部认证行为。
- 当前代码执行 `go test -mod=readonly ./internal/app/... -count=1` 通过（2.385s）；`go vet -mod=readonly ./internal/app/...` 通过且无输出。临时输出在被忽略的 `dist/finalize-core-help-20261022/`。
- `openspec validate remove-internal-port-note-from-core-help --strict` 通过；`skip_specs: true` 被接受，无主规格同步内容。
- 完整性：4/4 任务及既有构建验收记录已核对。正确性：当前包测试确认帮助不含内部端口说明、保留三项配置及帮助调用无启动副作用。连贯性：差异限定于既有帮助常量与测试，运行契约不变。未发现需修复的问题。
- 已读取当前 design 指引。其创建条件为跨模块、新依赖或数据模型、安全/性能/迁移复杂性或技术歧义；本次纯帮助文案均不满足，故按条件省略 design.md。CLI 状态仍将该可选产物显示为 ready，不把它当作未完成的实现任务，也不为归档补写无关设计。
- 本轮未重跑 `make build`、全量测试、浏览器或镜像验收；上方 2026-10-21 的实际构建与输出事实保留当时范围，不改写成当前提交的新制品。未推送、发布或变更已冻结的 microVM 上游输入。
