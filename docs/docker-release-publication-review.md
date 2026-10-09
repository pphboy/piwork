# Docker 发行与官网发布复核

本次默认入口为独立 Core、CLI Docker 命令；Core 单独提供 Compose。两者合并的 Compose 放在 examples/single-host/，作为可选单机部署示例。

## 阅读入口

- [中文 README](../README.zh-CN.md) 与 [英文 README](../README.md)：Core、CLI 各自独立，长命令规整分行，原生 CLI 折叠。
- [单机部署示例](../examples/single-host/README.zh-CN.md)：两个独立容器、专属数据与凭证卷，CLI 重进不改变 Core 生命周期。
- [Core-only Compose](../deploy/docker/docker-compose.yml)：只定义 Core。
- [验收记录](docker-release-quickstart-acceptance.md)：本地与正式远端证据分开记录，实际镜像身份和未执行项明确。
- 官网仓库 pphboy/pphboy.github.io 的 piwork/ 子目录：双语首页、Quick Start、安装、First Work、导航和同版静态下载材料。

## 发布范围

Docker Hub 最终镜像 `0.0.1-fc409adc1a0b-808d890c6607-dirty` 已推送，匿名读取、无 mirror 冷启动与正式清单均已验证。具体身份见验收记录的最终发行段。已推送的版本标签保留，不覆盖其他身份。

本地提交按用户要求整理；合并 main、远端推送与官网发布尚待最终确认。后续动作范围：

1. 将本次 Piwork 提交合并到 main 并推送。发布分支已包含本地 main 既有的 Logo 更新 fc409ad，保留其历史。
2. 推送官网仓库 main 中已整理的 piwork/ 对应提交。本地 main 原有的文档提交 13b5343 也在待推送历史中；不提交同仓库的其他未跟踪工作。
3. 官网 main 推送会触发现有 Piwork 工作流，发布 gh-pages 的 piwork/ 子目录并验证 Pages 构建。保留博客、其他产品和现有站点控制文件。
4. 上线后核对两种语言导航及实际 Compose、发行清单、SHA256SUMS 下载内容，完成 OpenSpec 任务 8.4。

## 下载与状态

正式材料包含 Core-only docker-compose.yml、可选 single-host-compose.yml、两种语言的示例说明、实际 registry digest 清单与校验。镜像已发布与网站下载入口已上线是不同状态：本地构建和预览不能作为公开下载证据。

当前 main 合并、Git 推送和官网部署均等待用户最终确认，不自动创建 GitHub Release 或改写旧版本下载材料。
