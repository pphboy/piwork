<p align="center">
  <img src="apps/ui-shared/assets/piwork-logo.png" alt="Piwork logo" width="160" height="160">
</p>

# Piwork

**English** | [简体中文](README.zh-CN.md)

[![Latest release, including previews](https://img.shields.io/github/v/release/pphboy/piwork?include_prereleases)](https://github.com/pphboy/piwork/releases)
[![License: Apache-2.0](https://img.shields.io/github/license/pphboy/piwork)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/pphboy/piwork)](https://github.com/pphboy/piwork/stargazers)
[![Server: Linux](https://img.shields.io/badge/server-Linux-blue)](deploy/docker/README.md)

**Create. Evolve. Take it anywhere.**

Piwork is a portable AI workspace that brings conversations, files, and running applications together.

Each Work keeps its own environment and can move between Piwork installations as a `.work` file.

## Core concepts

- **Work** — A workspace with its own conversations, files, configuration, and services.
- **Service** — An application running inside a Work, managed by Core.
- **Harness** — The agent runtime built on Pi Agent SDK, with Skills and Pi Packages.

## Demo

[![Watch the Piwork product demo](https://i.ytimg.com/vi/ll1MS091gPU/maxresdefault.jpg)](https://www.youtube.com/watch?v=ll1MS091gPU)

[Watch the 70-second demo](https://www.youtube.com/watch?v=ll1MS091gPU): create a content studio, evolve it, and move the whole Work to another installation.

[Watch the English demo: Piwork: One AI Workspace, Five Real Demos](https://www.youtube.com/watch?v=GiSqWeTWNUc).

![Piwork Desktop workbench](apps/ui-shared/assets/desktop-preview.png)

Conversations, Services, and files in one workbench.

## Documentation

- [Website and guides](https://pphboy.github.io/piwork/)
- [Quick Start](https://pphboy.github.io/piwork/guide/quick-start.html)
- [Deployment guide](deploy/docker/README.md)
- [Releases](https://github.com/pphboy/piwork/releases)

Piwork is currently a preview. Core and the native CLI support Linux only; Windows and Linux browsers can access Core remotely.

## Roadmap

- Make the Work lifecycle and portability more reliable.
- Refine onboarding, model configuration, and Desktop UX.
- Expand reusable Works and application examples.

## Contributing

See [AGENTS.md](AGENTS.md) for development conventions, source builds, and verification.

- [Report an issue](https://github.com/pphboy/piwork/issues)
- [Join the discussion](https://github.com/pphboy/piwork/discussions)

## License

[Apache License 2.0](LICENSE)
