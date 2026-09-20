import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const installationId = process.env.PIWORK_TEST_INSTALLATION_ID ?? `piwork-test-${randomUUID()}`;
if (!/^piwork-test-[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(installationId)) {
  throw new Error(`invalid PIWORK_TEST_INSTALLATION_ID: ${installationId}`);
}

const env = {
  ...process.env,
  PIWORK_TEST_INSTALLATION_ID: installationId,
  PIWORK_TEST_DOCKER_FILTER: `label=piwork.installation_id=${installationId}`,
};

process.stdout.write(`integration installation_id: ${installationId}\n`);
await runNpm(["run", "test:integration", "--workspaces", "--if-present"], env);

function runNpm(args, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { stdio: "inherit", env: childEnv });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) reject(new Error(`integration tests terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`integration tests exited with ${code}`));
      else resolve();
    });
  });
}
