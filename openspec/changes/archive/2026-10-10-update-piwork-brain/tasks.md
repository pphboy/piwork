# Tasks

## 1. 更新 Core 内置 piwork-brain package

- [x] 1.1 将内嵌脑包 package version 更新为 `1.1.0`，移除当前交付中 NiceGUI 的认知、代码、依赖、模板、入口及使用指导，核对 Skill、模板和固定 Web base 均使用 FastAPI + React + TypeScript + Vite；通过检索、依赖锁文件/交付清单核对及现有资源/包校验确认无 NiceGUI 依赖或回退，历史归档/验收事实保留，迁移旧输入仅作测试夹具。
- [x] 1.2 修改 `bundled_brain.go` 的已 seed 分支，沿现有准备流程更新原内置旧包并原子切换 catalog head，保留旧制品及默认配置；单测覆盖旧包升级、相同版本重复启动、准备/发布失败。
- [x] 1.3 保留管理员替换、禁用、移除及空默认，发布时复核 head/generation 并遵守原 Core package 门禁；测试证明不覆盖已提交选择，必要的启动恢复次序调整不造成等待循环。
- [x] 1.4 简短更新 `docs/piwork-brain.md` 中一次性默认选择与 Core 内置包更新的说明；核对与实现一致，已有 Work 仍走原 Update/显式 Apply，不引入新操作入口。

## 2. 验证更新结果

- [x] 2.1 使用独立合成安装验证“旧内置 NiceGUI 包 + 已 seed → 更新并启动 Core → 新建 Work 捕获 FastAPI 脑包”，通过真实包加载检查确认新版资源；对照证明原 Work 的包、镜像和数据保持不变，无需实际 Fedora 部署。
- [x] 2.2 执行受影响的 `internal/coreassets` / `internal/coreapp` 测试、相关包准备 integration 检查及 `git diff --check`，检查引用制品和本次 fixture 清理；确认没有 UI、公共契约、数据库 schema、独立升级机制或对外发布改动。
