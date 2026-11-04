# Design

## Context

现有同步器整页写入 Quick Start、First Work、导航，并从「开始使用」截断首页。检查器要求首页包含 Compose，直接与已确认的单一桌面入口冲突。配套官网变更在 pphboy.github.io 同名目录。

## Goals / Non-Goals

目标是服务端资料同步准确且官网编辑内容不受影响。无产品运行时、镜像、发布记录或根 README 改动。

## Decisions

- 同步器仅写双语 installation、source-installation 和 install/<releaseId>/ 的服务端资源。完整 Docker 试用块移入 installation，原生说明保留在 source-installation；默认桌面页面不再作为生成目标。
- README 只更新显式 server-release 标记块，保留其余人工维护文字；无标记不触碰 README。避免以标题切片造成相同截断问题。
- 检查器只核验所属服务端页面与资源，官网自身检查桌面下载、截图及流程。
- 合成 A/B/published 测试比较所有编辑文件的原始字节和历史文件，保留坏命令、错误下载、无效原生配置等失败断言。

## Risks / Trade-offs

服务端与桌面版版本独立 → 两套元数据分别维护，不把 Core 发行号注入桌面首页。新同步契约不改写已有发布包；既有下载按原身份保留。
