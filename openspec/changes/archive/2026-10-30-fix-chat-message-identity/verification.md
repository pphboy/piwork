# 验证记录

日期：2026-10-30。范围为本次消息身份修复及当前项目 Linux 运行集成。

## 根因与兼容分支回归

- 原 Agent 的历史能力返回 501，聊天契约为 1，私有历史 schema 为 4；旧合并把 Run/事件 ID 与 SDK entry/block ID 当成不同消息。
- 原会话只读回放：持久历史投影为 13 条，修复前合并为 15 条；修复后保持 13 条。一问一答各增加一份的合成用例先失败（实际 4、期望 2），修复后通过。
- 投影、适配器与既有历史测试共 84 项通过，包含新版分页投影回归；兼容 thinking 与 Markdown 测试共 23 项通过。
- 浏览器测试共 23 项通过：包含旧能力 501 下的实际发送/事件/SDK 补读、连续两轮同文、重复加载及刷新；恰好两次 Run POST，显示两问两答。失败和取消用例各只发送一次，补读保留一次未覆盖尾部。
- 回归覆盖多块输入、图片、工具前后同文、并行工具完成顺序、部分字节覆盖后的增量、未知或冲突来源保留、显式终态结果，以及身份切换后的晚响应丢弃。

## 构建和静态检查

- 工作台严格构建、嵌入资源和 Linux Core/CLI 构建通过。候选版本为 `0.0.16-dev.db51534-chat-identity`，源码基点 `db51534e584af2a9353a24fc7d4da54e313d625a`，`modified=true`；这是本地未发布候选。
- 输入身份核对通过：source `0b4f47d21a2627b6a982a5300b33e30f84edfe8ddb4f4348652fef1662ae76cf`；desktop `bf634b5b15a6715099be1964f32a2814667a2cad8ddd9bb242ca89a225eea092`；console `df3e3d405eaceee48a46186a1b3b3d0f48b32fea4068e3d95a9342a5e2bcf6da`。
- `node scripts/check-native-boundary.mjs`、`node scripts/check-repository-docs.mjs`、`node scripts/check-ui-language.mjs`、OpenSpec 严格校验和 `git diff --check` 通过。
- Agent/helper 实现本轮未修改；候选使用已存在的生产镜像，保留其原身份，未重新标记或发布。Agent 镜像 ID 为 `sha256:3fe25fa3e1ffbfb4da97c1ec460eee1b0d1930a06ee1f812b87f5ba32cdcfb50`。

## 原项目 Linux 集成与受管升级

- 确认无活动 Run 后正常关闭旧 Core，保留 Core 数据目录停机备份；修复版使用原项目 `.piwork/core-go`。Core/UI 的 `/healthz` 与 `/readyz` 均返回 200，运行程序与候选路径、输入身份一致。
- admin 登录成功，原密码字段未变；模型选择和其他默认配置未变。仅将默认基础镜像登记为匹配生产 Agent，并通过配置保存和受管 Apply 升级报告中的指定 Work；未批量升级其他现有 Work。
- 受管升级成功：私有历史 schema 从 4 到 7；实际聊天契约为 4、分页历史契约为 1。原 1 个 Session、4 个 Run ID 均保留，原 SDK 历史文件字节摘要未变，分页读取得到 18 个 segment。
- 迁移沿用既有备份、提交和恢复生命周期；成功提交后的迁移备份清理由既有逻辑处理，不宣称其永久保留。额外的 Core 数据目录停机备份仍保留。
- `go test ./internal/workhistory -run 'Backup|Restore|Checkpoint'` 通过，核对既有部分替换恢复、丢失回执重试及历史备份边界。本轮未向真实 Work 注入升级失败。
- 实际浏览器登录并打开原 Work，显示 4 条用户消息、5 个合法 Agent 正文块（含工具间正文）；新资源返回 200，全程新增 Run 请求为 0。

## 验证边界

真实会话仅做只读回放和页面检查，没有发送真实模型提示；新发送、取消和失败链路使用合成浏览器夹具。未开展 Windows/MicroVM、宿主重启或批量性能测试。临时日志与非交付运行产物放在忽略的 `dist/chat-message-identity/`，不记录真实凭据、模型秘密或会话正文。

## 归档核验与已知限制

归档前核验结果为 0 CRITICAL、1 WARNING、0 SUGGESTION。已有 130 项通过结果、严格规格校验和候选源码／嵌入资源身份已核对；任务清单为 11/11。

WARNING：旧协议历史只覆盖实时正文前缀时，`legacy-history-projection.ts` 将实时显示键替换为 SDK 块键及含覆盖长度的尾部键，`app.ts` 的阅读锚点恢复不能找到原键。合成浏览器定向检查在读取长正文中段后补读已保存前缀，原显示节点被替换，当前段落下移 13px；正文未重复或丢失。此项是任务 2.2 中阅读锚点保留的已知偏差，未计作通过。

本次按后续同步规格、归档及提交指令保留该警告，未修复实现，也未放宽主规格的阅读位置要求。后续修复应在来源接替时保留稳定显示身份或迁移阅读锚点，并覆盖此转换的浏览器回归。定向检查及日志保留在忽略的本机 `dist/`，不作为通过证据。
