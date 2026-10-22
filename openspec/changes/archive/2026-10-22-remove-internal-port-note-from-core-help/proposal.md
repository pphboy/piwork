# Proposal

## Why

`piwork-core --help` 目前包含 "Internal Agent mTLS uses port 7172" 一句。它描述的是内部实现机制，不是用户可配置项，对多数用户没有信息量，且 "mTLS" 的措辞容易让人误以为需要配置证书。帮助文本应只保留用户可用的入口与配置项。

## What Changes

- 从 `piwork-core --help` 删除内部 Agent RPC/mTLS 与 7172 的说明句；保留两个 HTTP 端口可本地/远程连接、网页配置、ADMIN 初始化和 `piwork-cli` 入口说明。
- 不改变三项运行配置、7172 保留规则、内部 mTLS 监听与身份校验；不新增参数或环境变量。
- 端口取值 7172 的拒绝、监听冲突的报错文本、退出码与部分启动清理语义保持现状，本次不新增诊断信息。
- 更新受影响的 CLI 文本测试；部署手册和 OpenSpec 主规格中关于 7172 的部署说明保持不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本次只调整帮助文本，不改变 Spec 规定的启动、端口保留、失败退出或 mTLS 行为；`.openspec.yaml` 以 `skip_specs: true` 声明无 spec delta。

## Impact

- `internal/app/run.go`：帮助文本。
- `internal/app/run_test.go`：帮助文本测试覆盖。
- 不影响 HTTP/Core/gRPC 监听行为、启动错误文本、Docker 部署材料、CLI 客户端或 Work 数据。
