# 验收

日期：2026-10-24。环境：Linux / WSL2，Node.js v25.6.0。配套官网变更位于 pphboy.github.io 的同名 OpenSpec 变更。

## 已执行

- `node --test scripts/check-docker-quickstart.test.mjs`：30 项通过，覆盖合成候选 A/B、published 状态、编辑页面与桌面下载不变、无受管 README 标记、错误命令/参数/资源拒绝及历史身份保留。
- `node scripts/check-docker-quickstart.mjs`：通过。
- `node scripts/check-docker-quickstart.mjs --website-root /home/p/Projects/pphboy.github.io/piwork`：通过。服务端资料与当前固定发行一致，默认桌面指南不再被要求携带 Docker 命令。
- 在忽略的 dist/website-redesign/ 下复制实际官网，依次同步当前发行、合成下一候选和当前发行：71 个编辑文件逐字节保留（含新增视频元数据与封面），78 个既有历史资源的 SHA256 不变。随后同步实际官网并复核编辑文件不变。
- `node scripts/check-repository-docs.mjs`：通过。
- `openspec validate redesign-website-one-click-onboarding --strict`：通过。
- `git diff --check`：通过。

## 边界

本次仅调整官网服务端材料生成与检查，不改变 Core/CLI 运行行为或镜像制品。根 README.md/README.zh-CN.md、现有发行记录及其真实源码身份没有改写。生成输出和临时日志留在忽略的 dist/。该本地验收阶段未执行外部网站部署、镜像推送或新版本发行。

官网图文复审后的再次集成核对：当前发行/合成下一候选/当前发行同步保留 75 个编辑文件及 78 个既有历史资源，实际官网联合检查通过。

官网随后按所有者明确要求发布，Pages 提交 6568a0fd242c6eec161f5b232d5748bddda05d63，构建与线上核对通过；发布事实记录于官网仓库同名变更 acceptance.md。本仓库的镜像和 Core/CLI 制品没有重新发行。
