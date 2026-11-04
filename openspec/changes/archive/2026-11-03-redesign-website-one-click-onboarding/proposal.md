# Proposal

## Why

官网首页缺少真实 Work 的视觉叙事，默认上手教程混入服务端部署细节；发布同步还会截断首页、重写入门页面，使独立维护的内容退化。所有者已确认「创造、演进，随处带走」及唯一的一键启动路径，并授权实施完整方案。

## What Changes

- 官网默认上手由桌面一键启动指南承接；Linux Docker 服务端教程继续归属部署手册与官网安装页。
- 官网同步仅维护服务端安装、源码安装及固定版本资源，不再改写首页、下载、Quick Start、第一个 Work、指南概览或规格导航。
- 更新检查器及连续 A/B 同步回归，验证编辑内容保持不变、服务端材料仍与发行身份一致。
- 官网页面实现由 pphboy.github.io 仓库的同名配套变更承载。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `docker-delivery`: 区分官网一键启动入口和 Linux 服务端部署资料，明确材料同步的所有权。

## Impact

影响 scripts/sync-docker-website.mjs、scripts/check-docker-quickstart.mjs 及相关测试；无运行时 API、存储迁移、制品重发或外部发布。
