<img src="docs/images/piwork-logo.png" alt="Piwork logo" width="160" height="160">

# Piwork

**English** | [简体中文](README.zh-CN.md)

Piwork is an AI work environment that groups conversations, files, and container services into a Work you can manage, export, and move between installations.

## Problem

An AI task often involves conversation history, project files, and running services. Piwork organizes these into a Work so you can converse, run applications, manage files, and preserve the environment across stops, restarts, and migrations.

## Piwork's Core Model: Work / Service / Harness

| Model | Meaning |
| --- | --- |
| **Work** | A unit of work with its own configuration, conversation history, files, and service definitions. It can be started, stopped, exported, and imported. |
| **Service** | An application service inside a Work. Core manages its lifecycle; it communicates over the Work's private network and can share the workspace when authorized. |
| **Harness** | The agent execution layer inside a Work. It uses the Pi Agent SDK to run conversations, models, and tools, and load Skills and Pi Packages. |

Each Work has its own Harness. The Harness executes tasks, Services provide application capabilities, and both operate within the Work. Core manages these resources, while CLI / Desktop provides the user interface.

## Demo GIF / Video

![Piwork Desktop](docs/images/desktop-preview.png)

Desktop chat interface preview, captured from a UI verification fixture.

## Quick Start

### Recommended: Try Piwork with Docker

Download the two-container installer from [0.0.1 Preview](https://github.com/pphboy/piwork/releases/tag/v0.0.1). You start Core and CLI; Core prepares the Agent and helpers and manages Work containers.

Core runs on Linux. The CLI container runs on Linux or in Linux-container mode on Windows Docker Desktop. The supported target is `linux/amd64`, with Docker Engine 28+ and Compose 2.24+. Windows clients connect to a reachable Linux Core.

On Linux, download, verify, and unpack the installer in a new directory:

```sh
(
    set -eu
    mkdir piwork-preview-0.0.1
    cd piwork-preview-0.0.1
    PIWORK_RELEASE_URL=https://github.com/pphboy/piwork/releases/download/v0.0.1
    curl --fail --location --output piwork-docker-0.0.1.tar.gz "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz"
    curl --fail --location --output piwork-docker-0.0.1.tar.gz.sha256 "$PIWORK_RELEASE_URL/piwork-docker-0.0.1.tar.gz.sha256"
    sha256sum --check piwork-docker-0.0.1.tar.gz.sha256
    tar -xzf piwork-docker-0.0.1.tar.gz
    cd piwork-docker
    sha256sum --check SHA256SUMS
) && cd piwork-preview-0.0.1/piwork-docker
```

Continue with the [Docker setup guide](deploy/docker/README.md): configure the administrator and model, start Core and CLI, then run `desktop open --no-open`. Paste its link into a browser on the same client computer. In Desktop, enter the Core URL, account, and password, then create and start a Work. The guide also includes Windows PowerShell download and startup commands.

### Connect to an Existing Core

Native clients remain available: [Linux Core / Console / CLI bundle](https://github.com/pphboy/piwork/releases/download/v0.0.1/piwork-linux-amd64-0.0.1.tar.gz) and [experimental Windows CLI bundle](https://github.com/pphboy/piwork/releases/download/v0.0.1/piwork-cli-windows-amd64-0.0.1.zip). Verify the SHA256 from the release before extracting; the Linux CLI is in `bin/`.

Obtain the CLI executable for your platform and make sure Core has an administrator, model, and runtime configured. Start Desktop from the directory containing the executable.

Linux:

```sh
./piwork-cli desktop
```

Windows PowerShell:

```powershell
.\piwork-cli.exe desktop
```

When the browser opens, enter your Core URL, account, and password. Create and start a Work, then open Chat, Service, or Files. Desktop uses local port `17891` by default; use `desktop --no-open` to open the browser manually.

For command-line usage, see the [CLI guide](docs/user-cli.md). Platform and installation details are in [CLI delivery](docs/cli-platforms.md).

### Deploy Your Own Core

- **Core and CLI containers**: Follow the [Docker setup guide](deploy/docker/README.md) to configure and start both containers. It includes complete commands for Linux and Windows Docker Desktop clients. The native CLI remains available.
- **Run from source**: Follow [Core startup and initialization](docs/operations.md#从源码启动) to build the programs and images, configure the administrator and model, then start Desktop.
- **Administrator UI**: See the [Console guide](docs/serve-console.md) for startup, TLS configuration, and login.

## .work Import / Export

A `.work` file is a complete offline copy of a Work, including files in its managed volumes, private conversation history, configuration, service definitions, Skills, Pi Packages, and fixed container images.

The following commands use the native Linux CLI. Log in to the appropriate Core first. Replace `WORK_ID` with the source Work ID and `IMPORTED_WORK_ID` with the new ID returned by import. The export destination must not already exist.

```sh
./piwork-cli work stop WORK_ID --wait
./piwork-cli work export WORK_ID --output ./saved.work
./piwork-cli work package inspect ./saved.work
./piwork-cli work import ./saved.work --name 'Restored Work' --wait
./piwork-cli work start IMPORTED_WORK_ID --wait
```

Stop the Work before exporting. Import creates an independent Work and leaves it stopped; start it explicitly afterward. To migrate to another Core, log in to the target Core before importing and starting it. Offline inspect verifies package integrity, not whether the target installation can use it.

Configure matching model credentials on the target Core separately. Platform-managed model keys and installation credentials are excluded from the package, but secrets saved in your files or history travel with it. See [Work snapshots](docs/work-snapshot.md) and the [package format](docs/work-package-format.md) for the complete workflow and data boundaries.

## Architecture

```mermaid
flowchart LR
    Browser[Browser] --> CLI[CLI / Desktop]
    Console[Console] --> Core[Core]
    CLI --> Core
    Core --> Engine[Docker Engine]
    Core <--> Harness
    Engine --> Harness
    Engine --> Service
    subgraph Work
        Harness[Harness / Pi Agent SDK]
        Service[Service]
        Files[Workspace / Files]
        Harness --> Files
        Service --> Files
    end
    Harness --> Model[Model Provider]
```

Core manages resources and control operations. The Harness runs models and tools, Services provide applications, and work files live in the Work's shared volume. See [Core operations](docs/operations.md) for runtime and data boundaries, and [AGENTS.md](AGENTS.md) for implementation and directory conventions.

## Current Status / Limitations

- **0.0.1 Preview**: Intended for evaluation and feedback. The native Windows CLI is experimental and has not completed all formal acceptance checks.
- **Core**: A single Linux installation using the local Docker Engine Unix socket.
- **Clients**: The native CLI targets Windows and Linux, with command-line and Desktop interfaces. Outstanding native Windows acceptance checks are documented in [CLI delivery](docs/cli-platforms.md).
- **Docker delivery**: The verified scope is `linux/amd64`, Linux Core, and Linux CLI containers on Linux or Windows Docker Desktop. Docker Engine 28+ and Compose 2.24+ are required. See [delivery acceptance](docs/docker-delivery-acceptance.md).
- **Runtime requirements**: Running a Work requires an available Docker Engine, model configuration, and credentials. A normal Core shutdown stops managed Work containers and preserves persistent data. Exiting the CLI does not stop Works.
- **Verification**: Installation, build, and unit tests have passed from a clean clone. Coverage, skipped checks, and platform boundaries are recorded in the [open-source readiness review](docs/open-source-readiness.md) and [testing guide](docs/testing.md).

## Roadmap

Piwork is still early. The current focus is to make the Work lifecycle reliable, portable, and easy to understand.

### Near term

- Improve the first-run experience and installation flow
- Strengthen `.work` import / export reliability
- Improve Windows client compatibility
- Improve Desktop UX and model configuration
- Publish more example Works and end-to-end demos

### Next

- Make Works easier to share and reuse
- Improve Service lifecycle management
- Expand Harness capabilities and tool integration
- Improve cross-machine and multi-environment portability
- Introduce better Work packaging and distribution

### Longer term

- Evolve Piwork into a portable AI-native workspace runtime
- Let Harnesses adapt and evolve with the Work
- Enable AI to operate and modify Services directly
- Explore layered Work packaging and richer distribution models

The roadmap will evolve based on real usage and feedback.

## Contributing

Read [AGENTS.md](AGENTS.md) for development conventions and the [testing guide](docs/testing.md) for test entry points. The basic build requires Go 1.25.5, Node 24 (see `.nvmrc`)/npm, Git, Make, and Bash. Run these commands from the repository root:

```sh
npm ci
make build
make test
```

`make build` writes native programs to `dist/go/` and builds the Agent and browser assets. Building and running unit tests does not require real model keys, local runtime data, or `.env.test`. To build only the client, run `npm run build:cli`; artifacts are written to `dist/cli/<target>/`.

## License

[Apache License 2.0](LICENSE)

## Discussion / Issue
