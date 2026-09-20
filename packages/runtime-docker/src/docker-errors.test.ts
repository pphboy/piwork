import assert from "node:assert/strict";
import test from "node:test";
import {
  DockerDependencyError,
  DockerRuntime,
  DockerRuntimeError,
  type DockerCommandRunner,
} from "./docker.js";

test("Docker daemon connection failures map to a retryable runtime dependency error", async () => {
  const runner: DockerCommandRunner = {
    async run(args) {
      throw new DockerRuntimeError(
        "docker command failed",
        args,
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
        1,
      );
    },
  };
  const runtime = new DockerRuntime("installation-fixture", runner);
  await assert.rejects(
    runtime.inspectContainer("work-0199e6d8abcd", "agent", "generation-1"),
    (error) => error instanceof DockerDependencyError
      && error.reason === "RUNTIME_UNAVAILABLE"
      && error.retryable,
  );
});
