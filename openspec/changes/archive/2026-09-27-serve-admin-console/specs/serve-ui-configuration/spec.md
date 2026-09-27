# Serve UI Configuration Spec Delta

## Purpose

提供 Core 状态、全局运行时及默认 Work 配置的浏览器管理流程，明确保存与 readiness 的区别、局部配置提交以及 AGENTS 内容编辑，使管理员能够完成部署后的配置并理解这些默认值对新 Work 的作用。

## ADDED Requirements

### Requirement: 展示 Core 的真实管理状态

**Identifier:** SUI-CFG-001

状态页 SHALL 显示 Core 是否可达、健康、readiness 原因和公开 checks，提供手动刷新并在页面可见时每 15 秒刷新。初始化缺管理员 SHALL 在登录入口指向 CLI/env bootstrap；已登录但运行时缺失 SHALL 链接运行时配置。Core 返回非 ready SHALL 展示 `ADMIN_REQUIRED`、`RUNTIME_NOT_CONFIGURED` 或 `RUNTIME_UNAVAILABLE` 等实际原因，不能将健康等同于可创建 Work。查询失败 SHALL 标记旧数据及其时间，禁止把旧 ready 显示为当前 ready。

#### Scenario: 健康但未配置运行时
- **WHEN** Core 健康且 readiness 为 RUNTIME_NOT_CONFIGURED
- **THEN** 显示“Core 可达，运行时未配置”并提供配置入口，其余可用管理页仍能打开

#### Scenario: 丢失 Core 连接
- **WHEN** 曾显示 ready 的页面刷新失败
- **THEN** 显示当前不可达，旧结果标记为历史状态，恢复后可重新获取

### Requirement: 配置全局运行时并区分保存结果

**Identifier:** SUI-CFG-002

运行时页 SHALL 查看 agent image、model provider、model ID、可选 base URL、credential 是否可用和更新时间。首次配置为空表单；编辑已有配置 SHALL 预填非敏感值，credential 始终为空且每次保存必填，明确提示重新输入；不提供读取旧 key 的功能。表单 SHALL 使用 Core 的字段限制和错误进行校验；base URL 留空表示省略该自定义 endpoint。

保存成功 SHALL 以 Core 返回的 persisted 配置为准并清空 key。若配置已保存但 runtime 不可用 SHALL 显示“已保存，运行时尚不可用”及当前 readiness，不显示“保存失败”或自动重复提交。输入无效或保存前失败 SHALL 保留原配置与非敏感草稿。更新全局运行时会更新后续新 Work 的默认运行时字段，面板 SHALL 说明该作用且不暗示已有 Work 已切换。

#### Scenario: 首次配置
- **WHEN** 管理员填写完整有效配置和 key 并保存成功
- **THEN** 显示已保存配置、credential 可用性和实际 readiness，key 不出现在响应或页面回填中

#### Scenario: Docker 暂时不可用
- **WHEN** Core 已持久化有效配置，但检查 Docker 或运行时失败
- **THEN** 页面显示保存成功与未 ready 两个结果，刷新仍看到刚保存的配置，允许稍后刷新状态

#### Scenario: 缺少 credential 或提交失败
- **WHEN** 保存未填写 key，或 API 返回输入校验错误
- **THEN** 标出相应字段且不声称保存成功，旧配置不被无效输入覆盖，key 输入不被持久化

### Requirement: 按编辑字段更新默认 Work

**Identifier:** SUI-CFG-003

默认 Work 页 SHALL 查看完整公开 configuration，并为 base image、Skills、packages、AGENTS 内容提供编辑。其他公开字段可以只读展示。Skills SHALL 按名称从启用项中选择并保持用户顺序，支持调整顺序及显式清空；packages SHALL 从启用 Core catalog 中多选、最多 64 个、可显式清空。当前选择若已不可用 SHALL 显示其名称和无效原因，不静默丢弃。

保存 SHALL 只提交相对加载基线实际编辑的字段；服务端原子合并，未编辑字段及并发的无关修改 SHALL 保留，不提交 revision。请求内任一字段无效 SHALL 整体拒绝。无更改时保存禁用；成功后用返回结果重置基线。未初始化默认配置时 SHALL 引导先配置运行时并禁用保存，不猜测一份配置。页面 SHALL 说明修改只影响后续新 Work，不触发已有 Work apply。

#### Scenario: 仅修改默认 packages
- **WHEN** 管理员编辑 packages，另一管理员同时修改 AGENTS 或模型
- **THEN** 请求只含 packages，成功结果保留对方变更，Skills 等未编辑字段保持不变

#### Scenario: 清空某一默认选择
- **WHEN** 管理员显式清空 Skills 或 packages 并保存
- **THEN** 对应字段提交空数组，其他默认值保留，不禁用或移除 catalog 条目

#### Scenario: 选择在提交前被禁用
- **WHEN** 保存的某个 Skill 或 package 在 Core 已不可用
- **THEN** 显示字段错误并保留草稿，不保存部分默认配置

### Requirement: 从文件或编辑器保存 AGENTS 内容

**Identifier:** SUI-CFG-004

AGENTS 编辑区 SHALL 允许选择本地 UTF-8 文本文件或直接编辑现有内容，字段及帮助文案统一使用 `AGENTS.md`。选择文件 SHALL 只在浏览器读取并填入编辑器，不要求服务器路径、不立即保存；已有未保存内容被替换前 SHALL 确认。文件选择取消、读取失败、非法 UTF-8 或超过 256 KiB SHALL 保留原草稿。直接编辑也 SHALL 按 UTF-8 字节数执行 256 KiB 限制；空文本表示显式清空。保存 SHALL 提交文本原文，不提交文件路径或自动解析 Markdown 指令。

#### Scenario: 选择后继续编辑
- **WHEN** 管理员选择合法文件，再编辑其中一行并保存
- **THEN** Core 保存编辑器中的最终文本，后续读取一致，原文件路径不进入 Core

#### Scenario: 文件超限或无效
- **WHEN** 选中文件超过限制或无法按 UTF-8 解码
- **THEN** 显示具体错误，已有编辑内容和服务端配置不变

#### Scenario: 临界大小与清空
- **WHEN** 文本编码后恰为 256 KiB，或管理员清空内容
- **THEN** 两者可提交；大于 256 KiB 时阻止提交并提示超限
