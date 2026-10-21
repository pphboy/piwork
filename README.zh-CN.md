<p align="center">
  <img src="apps/ui-shared/assets/piwork-logo.png" alt="Piwork 标志" width="160" height="160">
</p>

# Piwork

[English](README.md) | **简体中文**

[![最新版本，包含预览版](https://img.shields.io/github/v/release/pphboy/piwork?include_prereleases)](https://github.com/pphboy/piwork/releases)
[![许可证：Apache-2.0](https://img.shields.io/github/license/pphboy/piwork)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/pphboy/piwork)](https://github.com/pphboy/piwork/stargazers)
[![服务端：Linux](https://img.shields.io/badge/server-Linux-blue)](deploy/docker/README.zh-CN.md)

**创造、演进，随处带走。**

Piwork 是一个可迁移的 AI 工作空间，将对话、文件和运行中的应用放在一起。

每个 Work 保留自己的工作环境，并可通过 `.work` 文件在不同 Piwork 安装之间迁移。

## 核心概念

- **Work** — 拥有独立对话、文件、配置和服务的工作空间。
- **Service** — 在 Work 内运行、由 Core 管理的应用。
- **Harness** — 基于 Pi Agent SDK 的 Agent 运行时，支持 Skills 与 Pi Packages。

## 演示

[![观看 Piwork 产品演示](https://i.ytimg.com/vi/ll1MS091gPU/maxresdefault.jpg)](https://www.youtube.com/watch?v=ll1MS091gPU)

[观看 70 秒演示](https://www.youtube.com/watch?v=ll1MS091gPU)：创建内容工作室，持续改进，再将整个 Work 迁移到另一套安装。

![Piwork Desktop 工作台](apps/ui-shared/assets/desktop-preview.png)

在同一个工作台中处理对话、Service 和文件。

## 文档

- [官网与指南](https://pphboy.github.io/piwork/zh/)
- [快速开始](https://pphboy.github.io/piwork/zh/guide/quick-start.html)
- [部署手册](deploy/docker/README.zh-CN.md)
- [发布版本](https://github.com/pphboy/piwork/releases)

Piwork 目前处于预览阶段。Core 与原生 CLI 仅支持 Linux；Windows 与 Linux 浏览器均可远程访问 Core。

## 路线图

- 提升 Work 生命周期与迁移的可靠性。
- 改进首次引导、模型配置与 Desktop 体验。
- 丰富可复用 Work 和应用示例。

## 参与贡献

开发约定、源码构建与验证入口见 [AGENTS.md](AGENTS.md)。

- [反馈问题](https://github.com/pphboy/piwork/issues)
- [参与讨论](https://github.com/pphboy/piwork/discussions)

## 许可证

[Apache License 2.0](LICENSE)
