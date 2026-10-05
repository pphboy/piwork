SHELL := /bin/bash
export GOTOOLCHAIN := local
export CGO_ENABLED := 0

.PHONY: help generate build build-go native-agent-images native-helper-images native-compatibility-images workstation-fixture test test-go test-integration test-integration-go test-native-host harness-fixtures webui-assets acceptance acceptance-index release

help:
	@echo 'generate             Generate fixed Go/TS protocols and native HTTP DTOs'
	@echo 'build                Build retained Pi harness, browser UI and Go programs'
	@echo 'test                 Run retained Pi harness and Go unit tests'
	@echo 'test-integration     Run Go Engine and real Go browser integration tests'
	@echo 'acceptance           Run integration tests and require every scenario to have evidence'
	@echo 'release              Build native images and a checksumed release archive'
	@echo 'build-go             Build seven native migration entry points'
	@echo 'build-cli            Build standalone Windows/Linux clients and Desktop assets'
	@echo 'native-agent-images  Build Agent targets containing Go MCP/package helpers'
	@echo 'native-helper-images Build Go file/snapshot helper images'
	@echo 'native-compatibility-images Build real SDK-version and registry fault fixtures'
	@echo 'test-go              Run Go unit and wire contract tests'
	@echo 'test-integration-go  Run isolated Engine and retained deterministic SDK tests'
	@echo 'acceptance-index     Reconcile pending scenario evidence with the matrix'
	@echo 'test-native-host     Run released programs in scratch against an independent Engine'

generate:
	node scripts/generate-work-history.mjs
	node scripts/generate-protocol.mjs
	npm run build -w @piwork/contracts
	node scripts/generate-http-contracts.mjs

build-go:
	bash scripts/build-go.sh

.PHONY: build-cli
build-cli:
	node scripts/build-cli.mjs

webui-assets:
	npm run clean -w @piwork/desktop-webui -w @piwork/console-webui
	npm run build -w @piwork/desktop-webui -w @piwork/console-webui

build: harness-fixtures webui-assets build-go

native-agent-images:
	bash scripts/build-native-agent-images.sh

native-helper-images:
	docker build -f Dockerfile.file-helper.native --build-arg PIWORK_COMMIT="$$(git rev-parse HEAD)" --build-arg PIWORK_DIRTY="$$(test -z "$$(git status --porcelain)" && echo false || echo true)" -t piwork-file-helper:go-migration-acceptance .
	docker build -f Dockerfile.snapshot-helper.native --build-arg PIWORK_COMMIT="$$(git rev-parse HEAD)" --build-arg PIWORK_DIRTY="$$(test -z "$$(git status --porcelain)" && echo false || echo true)" -t piwork-snapshot-helper:go-migration-acceptance .

native-compatibility-images: native-agent-images
	docker build -f internal/coreapp/testdata/Dockerfile.sdk-compatibility --target old-sdk -t piwork-agentd:go-migration-sdk-0860 .
	docker build -f internal/coreapp/testdata/Dockerfile.sdk-compatibility --target unavailable-registry -t piwork-agentd:go-migration-registry-unavailable .

test-go:
	go test -mod=readonly ./...

test: build test-go
	node --test scripts/check-go-acceptance.test.mjs scripts/check-native-boundary.test.mjs
	npm run test:unit -w @piwork/contracts -w @piwork/pi-package -w @piwork/work-store -w @piwork/pi-adapter -w @piwork/agentd
	npm run typecheck -w @piwork/desktop-webui -w @piwork/console-webui

harness-fixtures:
	npm run clean -w @piwork/contracts -w @piwork/pi-package -w @piwork/work-store -w @piwork/pi-adapter -w @piwork/agentd
	npm run build -w @piwork/contracts -w @piwork/pi-package -w @piwork/work-store -w @piwork/pi-adapter -w @piwork/agentd

workstation-fixture:
	node scripts/build-workstation-fixture.mjs

test-integration-go: harness-fixtures build-go native-compatibility-images native-helper-images workstation-fixture
	PIWORK_TEST_NATIVE_AGENT_IMAGE=piwork-agentd:go-migration-acceptance \
	PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE=piwork-file-helper:go-migration-acceptance \
	PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE=piwork-snapshot-helper:go-migration-acceptance \
	PIWORK_TEST_NATIVE_OLD_SDK_IMAGE=piwork-agentd:go-migration-sdk-0860 \
	PIWORK_TEST_NATIVE_UNAVAILABLE_REGISTRY_IMAGE=piwork-agentd:go-migration-registry-unavailable \
	go test -mod=readonly -tags=integration -v -timeout=120m ./internal/testsupport ./internal/dockerengine ./internal/coreapp ./internal/workruntime ./internal/packageprepare

test-integration: build test-integration-go
	npm run test:browser -w @piwork/desktop-webui
	npm run test:real-core -w @piwork/desktop-webui
	npm run test:browser -w @piwork/console-webui

acceptance-index:
	node scripts/update-go-acceptance-index.mjs

test-native-host: release workstation-fixture
	PIWORK_TEST_RELEASE_BIN="dist/release/piwork-linux-amd64-$$(git rev-parse --short=12 HEAD)/bin" node scripts/native-host-acceptance.mjs

acceptance: test-integration test-native-host acceptance-index
	node scripts/check-native-boundary.mjs
	node scripts/check-native-image-boundary.mjs
	node scripts/check-go-acceptance.mjs

release: build native-agent-images native-helper-images
	bash scripts/package-go-release.sh
