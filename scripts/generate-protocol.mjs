import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolDir = resolve(root, ".piwork-tools");
const env = { ...process.env, GOTOOLCHAIN: "local", CGO_ENABLED: "0" };
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})${capture ? `: ${result.stderr}` : ""}`);
  return result.stdout?.trim();
}

if (run("go", ["env", "GOVERSION"], true) !== "go1.25.5") throw new Error("Protocol generation requires Go 1.25.5.");
const protoc = [resolve(root, "node_modules/@protobuf-ts/protoc/protoc.js")];
const configured = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).config.protocVersion;
if (configured !== "36.2") throw new Error("Protocol generation requires protoc 36.2.");
if (!run(process.execPath, [...protoc, "--version"], true).endsWith("libprotoc 36.2")) throw new Error("Wrong protoc version.");
const tsVersion = JSON.parse(readFileSync(resolve(root, "node_modules/ts-proto/package.json"), "utf8")).version;
if (tsVersion !== "2.12.4") throw new Error("Protocol generation requires ts-proto 2.12.4.");
mkdirSync(toolDir, { recursive: true });
mkdirSync(resolve(root, "packages/contracts/src/generated"), { recursive: true });
mkdirSync(resolve(root, "internal/rpc/testdata"), { recursive: true });
for (const [name, source] of [
  ["protoc-gen-go", "google.golang.org/protobuf/cmd/protoc-gen-go"],
  ["protoc-gen-go-grpc", "google.golang.org/grpc/cmd/protoc-gen-go-grpc"],
]) run("go", ["build", "-mod=readonly", "-trimpath", "-o", resolve(toolDir, name), source]);

const mappings = ["Magent.proto=piwork/internal/rpc/agentv1", "Mwork-services.proto=piwork/internal/rpc/servicesv1"];
run(process.execPath, [...protoc,
  "--proto_path=proto", "proto/agent.proto", "proto/work-services.proto",
  "--descriptor_set_out=internal/rpc/testdata/wire-descriptor.pb",
  `--plugin=protoc-gen-go=${resolve(toolDir, "protoc-gen-go")}`,
  `--plugin=protoc-gen-go-grpc=${resolve(toolDir, "protoc-gen-go-grpc")}`,
  `--plugin=protoc-gen-ts_proto=${resolve(root, "node_modules/.bin/protoc-gen-ts_proto")}`,
  "--go_out=.", "--go_opt=module=piwork", ...mappings.map(value => `--go_opt=${value}`),
  "--go-grpc_out=.", "--go-grpc_opt=module=piwork", ...mappings.map(value => `--go-grpc_opt=${value}`),
  "--ts_proto_out=packages/contracts/src/generated",
  "--ts_proto_opt=outputServices=grpc-js,esModuleInterop=true,importSuffix=.js,env=node,useOptionals=messages,useExactTypes=false,forceLong=bigint,oneof=unions",
]);
