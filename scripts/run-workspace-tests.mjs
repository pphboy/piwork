import { spawn } from "node:child_process";

const secretName = /(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|CLIENT_SECRET|MODEL_SECRET)$/i;
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !secretName.test(name)),
);

await runNpm(["run", "test:unit", "--workspaces", "--if-present"], cleanEnvironment);

function runNpm(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) reject(new Error(`npm tests terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`npm tests exited with ${code}`));
      else resolve();
    });
  });
}
