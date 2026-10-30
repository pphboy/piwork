# 验证记录

日期：2026-10-30。范围为分页历史缺少实时来源坐标时的消息身份修复、当前 Linux 构建、Windows MicroVM 制品身份及原 Work 只读回放。

## 定向回归

- 新增 `paged-message-identity.test.ts`：合成的分页协议 1、聊天契约 3、无 `streamId/streamOffset`、SDK 块 ID 与实时 ID 不同。未确认冻结 Run 范围时保持两份（一问两答）；确认范围后为一问一答且重复投影不增加副本。
- 覆盖缺少 Run 起点、范围字节缺口、关闭区间长度冲突、开放前缀尾部、前缀补读后继续增量、工具前后合法同文、并行工具边界、SDK 分块、混合显式坐标优先级、不同 Run 同文、结果引用不吸收正文。
- 新增 `live-message-sources.test.ts`：同事件序号多偏移、多字节字符、重放、冲突分片、断线继续追加、Run 起点缺失、真实工具起点与身份清理。
- 新增 `paged-message-adapter.test.ts`：实际事件流分片经来源记录后在终态分页补读中接替为一份正文；Run 状态保留；跨身份晚响应丢弃；无实时观察时保存历史保持不变。
- 相关单元与契约测试共 103 项通过（`history`、`legacy-history-projection`、`legacy-history-adapter`、`chat-projection`、`live-message-sources`、`paged-message-identity`、`paged-message-adapter`）。

## 浏览器回归

- `feedback.test.ts` 新增：
  - 旧分页无坐标的实际发送／事件／补读链路：一次 Send 恰好一次 Run POST，一问一答；重复加载与刷新不增副本。
  - 失败终态只保留一次未覆盖尾部，已保存前缀与实时尾部合起来等于原始正文。
  - 阅读位置：保存前缀扩大、SDK 分块、最终完整接替三个阶段的可见正文不变；草稿、输入框选择范围、Activity 与原始工具展开保留。
- 沿用既有回归：有来源坐标的分页连续发送、旧完整历史 501 路径、部分输出失败／取消、连续轮次同文。
- 定向身份回归 7 项全部通过（新增 4 项、旧完整历史 2 项、有坐标分页连续发送 1 项）。
- 完整浏览器套件出现两项失败：Service iframe／独立标签页与 `D07 cancel`。已用未修改的 HEAD 源码重建浏览器资源后单独复跑，两项仍以相同断言失败，确认与本次改动无关；作为既有基线问题不计入本变更通过范围，日志保留在 `dist/paged-identity-browser.log`。

## 构建与静态检查

- `make build`、最终 `make build-go` 与 `make build-cli`（Node 24）通过，工作台资源已同步到 `internal/desktopassets/static/browser/`。
- 候选：`dist/desktop-paged-identity-777aaf8/candidate.json`，版本 `0.0.16-dev.777aaf8`，commit `777aaf8627377d1012a10b33aa8fa8406b074497`，`dirty=true`，`sourceInputHash=02c940b1fc03ca52b1f4213495335dc7e51e3ef280ff9c7c485aaebe0f94c4ce`，`desktopUIHash=a9b014f0060a86e705500c0caaa00838fe7ed2c640115fb2a2d99178ecd2d0e0`；Core SHA256 `0fbb8b78ce29b7b73ded46d34d158138711d7213d5eec2bb33e5753db46a4118`，CLI SHA256 `6c90ecb1874f230bbfca491d0349b385844eab40dde4b0caa9dc1accb1a02eb4`。
- `node scripts/check-native-boundary.mjs`、`node scripts/check-ui-language.mjs`、`node scripts/check-repository-docs.mjs`、`git diff --check`、`npm run typecheck` 与 `openspec validate fix-paged-chat-message-identity --strict` 通过。
- Agent/helper 实现未修改，沿用已存在的生产镜像身份：Agent `sha256:3fe25fa3e1ffbfb4da97c1ec460eee1b0d1930a06ee1f812b87f5ba32cdcfb50`，fileHelper `sha256:c71420ecb7cbe32cf3b056a4015911534ec1de05160abf8a6eeae3e095484e32`，snapshotHelper `sha256:0f8f633bc12e8563b6fa637e1f59002b10b48f195f3ab0b0cfe794d6895a9138`。

## Windows MicroVM 制品

- 通过既有 MicroVM 打包入口生成 `dist/desktop-paged-identity-microvm-777aaf8/piwork-microvm-gui-paged-identity.exe`，并复制到 `C:\Users\p\Desktop\piwork-microvm-gui-paged-identity.exe`；旧桌面文件未删除。
- 制品 SHA256 `7448b0add2295359da54c098c239c3bf95c284e4786d92e48dc4c02392623840`，payload SHA256 `7650ec7279960dc4c27489d503290d8a89617b410ec90178478da84d20bd0294`，launcher SHA256 `b20b9c50db787fa812a6d3a59765f4080aa3442c823991a15dc12daa6775330d`，Guest rootfs SHA256 `efc0992b07250fc6736f5054056f65ee07aae7e9146fafdcc3e533ef64d50eac`。
- 桌面副本与构建制品 SHA256 一致，PE 头为 `MZ`；bundle manifest 中 rootfs 记录与构建 rootfs 一致；从 EXE 对应 Guest 镜像提取的 Core/CLI 分别与候选 SHA256 一致，运行 `--version` 得到上述版本、commit 与 `desktopUIHash`。
- MicroVM 基础输入保持原身份：MicroVM commit `9de0591761aeb4b8010c3e1c594babfe285af1f6`，`dirty=true`，source fingerprint `2fad40194ef18d8cd013b8bb894c53423f085f1bebaf87e15b9ae0ceba105caf`；Guest/QEMU 依赖与许可证沿用并重新核对，未修改 MicroVM 运行机制，未发布镜像。

## 验证边界

- 原 Work 只读回放：切换前旧 GUI 已正常退出、QEMU 停止；新 GUI 以原安装数据盘正常启动，打开原 Work「视频策划」与 Session 1；保留原固定 Agent、账号和模型选择，未发送提示、未切换 Agent。页面中此前已受理的活动 Run 由 Core 恢复并完成回放，显示一问一答；刷新后同一末轮回复正文一致，未观察到新增 Run。未做字节级独立比对，也不以该结果替代定向浏览器回归。
- 未重启 Windows 整机，未执行批量性能采样、镜像推送或发行。
- 未执行真实模型提示、整机重启、批量性能采样、镜像推送或发行。
- 临时构建、日志与身份核对输出位于忽略的 `dist/`；本记录不含凭据或会话正文。
