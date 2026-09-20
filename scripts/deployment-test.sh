#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${1:-"$ROOT/.env.test"}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE" >&2
  echo "copy .env.test.example to .env.test and fill in the Anthropic settings" >&2
  exit 2
fi

cd "$ROOT"
npm run build >/dev/null

env_value() {
  PIWORK_TEST_ENV_FILE="$ENV_FILE" PIWORK_TEST_ENV_KEYS="$*" node --input-type=module -e '
    import { readEnvironmentFile } from "./apps/core/dist/application/env-file.js";
    const values = readEnvironmentFile(process.env.PIWORK_TEST_ENV_FILE);
    const value = process.env.PIWORK_TEST_ENV_KEYS.split(" ").map((key) => values[key]).find((item) => item !== undefined && item !== "");
    if (value === undefined || value === "") process.exit(3);
    process.stdout.write(value);
  '
}

ADMIN_ACCOUNT=$(env_value PIWORK_ADMIN_ACCOUNT) || { echo "PIWORK_ADMIN_ACCOUNT is required" >&2; exit 2; }
ADMIN_PASSWORD=$(env_value PIWORK_ADMIN_PASSWORD) || { echo "PIWORK_ADMIN_PASSWORD is required" >&2; exit 2; }
AGENT_IMAGE=$(env_value PIWORK_AGENT_IMAGE) || { echo "PIWORK_AGENT_IMAGE is required" >&2; exit 2; }
API_KEY=$(env_value PIWORK_API_KEY PIWORK_MODEL_API_KEY) || { echo "PIWORK_API_KEY is required" >&2; exit 2; }

if [[ "$ADMIN_PASSWORD" == CHANGE_ME* || "$API_KEY" == CHANGE_ME* ]]; then
  echo "replace the CHANGE_ME values in $ENV_FILE before running this test" >&2
  exit 2
fi
unset API_KEY

if ! docker image inspect "$AGENT_IMAGE" >/dev/null 2>&1; then
  if [[ "$AGENT_IMAGE" != "piwork-agentd:local" ]]; then
    echo "agent image is unavailable: $AGENT_IMAGE" >&2
    exit 2
  fi
  npm run agent:image >/dev/null
fi

TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/piwork-deployment-test.XXXXXX")
DATA_DIR="$TEMP_ROOT/core"
CLIENT_CONFIG="$TEMP_ROOT/client.json"
CORE_LOG="$TEMP_ROOT/core.log"
TEST_PORT=$(node --input-type=module -e '
  import { createServer } from "node:net";
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") process.exit(1);
    process.stdout.write(String(address.port));
    server.close();
  });
')
CORE_URL="http://127.0.0.1:$TEST_PORT"
LISTEN_ADDRESS="127.0.0.1:$TEST_PORT"
CORE_PID=""
WORK_ID=""
INSTALLATION_ID="piwork-deployment-test-$$-$(date +%s)"

stop_core() {
  if [[ -n "$CORE_PID" ]] && kill -0 "$CORE_PID" 2>/dev/null; then
    kill -TERM "$CORE_PID" 2>/dev/null || true
    wait "$CORE_PID" 2>/dev/null || true
  fi
  CORE_PID=""
}

cleanup() {
  stop_core
  if command -v docker >/dev/null 2>&1; then
    mapfile -t containers < <(docker ps -aq --filter "label=piwork.installation_id=$INSTALLATION_ID")
    ((${#containers[@]} == 0)) || docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
    mapfile -t networks < <(docker network ls -q --filter "label=piwork.installation_id=$INSTALLATION_ID")
    ((${#networks[@]} == 0)) || docker network rm "${networks[@]}" >/dev/null 2>&1 || true
    mapfile -t volumes < <(docker volume ls -q --filter "label=piwork.installation_id=$INSTALLATION_ID")
    ((${#volumes[@]} == 0)) || docker volume rm "${volumes[@]}" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

start_core() {
  : >"$CORE_LOG"
  PIWORK_INSTALLATION_ID="$INSTALLATION_ID" \
    env -u PIWORK_DATA_DIR -u PIWORK_LISTEN -u PIWORK_ADMIN_ACCOUNT -u PIWORK_ADMIN_PASSWORD \
        -u PIWORK_AGENT_IMAGE -u PIWORK_MODEL_PROVIDER -u PIWORK_MODEL -u PIWORK_MODEL_ID -u PIWORK_MODEL_BASE_URL \
        -u PIWORK_API_KEY -u PIWORK_MODEL_API_KEY \
    node apps/core/dist/cli.js --env-file "$ENV_FILE" --data-dir "$DATA_DIR" serve --listen "$LISTEN_ADDRESS" >"$CORE_LOG" 2>&1 &
  CORE_PID=$!
  for _ in $(seq 1 120); do
    if curl --fail --silent "$CORE_URL/healthz" >/dev/null 2>&1; then
      return
    fi
    if ! kill -0 "$CORE_PID" 2>/dev/null; then
      sed -E 's/[A-Za-z0-9_-]{24,}/[redacted]/g' "$CORE_LOG" >&2
      echo "Core exited during startup" >&2
      exit 1
    fi
    sleep 0.25
  done
  echo "timed out waiting for Core health" >&2
  exit 1
}

serve_cli() {
  node apps/core/dist/cli.js --core "$CORE_URL" --data-dir "$DATA_DIR" --json "$@"
}

user_cli() {
  PIWORK_CONFIG_PATH="$CLIENT_CONFIG" node apps/cli/dist/main.js --core "$CORE_URL" --json "$@"
}

echo "[deployment-test] starting Core"
start_core
echo "[deployment-test] checking operator status"
serve_cli status >/dev/null

for _ in $(seq 1 120); do
  if curl --fail --silent "$CORE_URL/readyz" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
curl --fail --silent "$CORE_URL/readyz" >/dev/null

echo "[deployment-test] logging in"
printf '%s\n' "$ADMIN_PASSWORD" | user_cli login --account "$ADMIN_ACCOUNT" --password-stdin >/dev/null
user_cli whoami >/dev/null

echo "[deployment-test] checking empty Work list"
WORK_LIST="$TEMP_ROOT/works.json"
user_cli work list >"$WORK_LIST"
node -e 'const v=require(process.argv[1]); if (!Array.isArray(v.works) || v.works.length !== 0) throw new Error("startup created an unexpected default Work")' "$WORK_LIST"

CREATE_OUTPUT="$TEMP_ROOT/create.ndjson"
echo "[deployment-test] creating Work"
user_cli work create --name deployment-test --wait >"$CREATE_OUTPUT"
WORK_ID=$(node -e 'const fs=require("node:fs"); const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse); if(rows.at(-1)?.state!=="succeeded") process.exit(1); process.stdout.write(rows[0].workId)' "$CREATE_OUTPUT")

CHAT_OUTPUT="$TEMP_ROOT/chat.ndjson"
echo "[deployment-test] sending initial chat"
user_cli chat "$WORK_ID" --message "Reply with a short confirmation that the deployment test is connected." >"$CHAT_OUTPUT"
node -e 'const fs=require("node:fs"); const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse); if(!rows.some(v=>v.type==="run")) throw new Error("chat did not create a Run")' "$CHAT_OUTPUT"

CONFIG_VIEW="$TEMP_ROOT/work-config.json"
CONFIG_INPUT="$TEMP_ROOT/work-config-input.json"
echo "[deployment-test] updating Work configuration"
user_cli work config show "$WORK_ID" >"$CONFIG_VIEW"
REVISION=$(node -e 'const v=require(process.argv[1]); process.stdout.write(String(v.desiredRevision))' "$CONFIG_VIEW")
node -e 'const fs=require("node:fs"); const v=require(process.argv[1]); fs.writeFileSync(process.argv[2], JSON.stringify(v.desired,null,2)+"\n", {mode:0o600})' "$CONFIG_VIEW" "$CONFIG_INPUT"
user_cli work config set "$WORK_ID" --config "$CONFIG_INPUT" --expected-revision "$REVISION" >"$CONFIG_VIEW"
NEXT_REVISION=$(node -e 'const v=require(process.argv[1]); if(!v.pendingRestart) process.exit(1); process.stdout.write(String(v.desiredRevision))' "$CONFIG_VIEW")
user_cli work config apply "$WORK_ID" --expected-revision "$NEXT_REVISION" >"$CONFIG_VIEW"
node -e 'const v=require(process.argv[1]); if(v.pendingRestart || v.activeRevision!==v.desiredRevision) process.exit(1)' "$CONFIG_VIEW"

echo "[deployment-test] restarting Core"
stop_core
start_core
PIWORK_CONFIG_PATH="$CLIENT_CONFIG" node apps/cli/dist/main.js --core "$CORE_URL" --json whoami >/dev/null
serve_cli config show >/dev/null
user_cli work config show "$WORK_ID" >"$CONFIG_VIEW"
node -e 'const v=require(process.argv[1]); if(v.pendingRestart || v.activeRevision!==v.desiredRevision) process.exit(1)' "$CONFIG_VIEW"
echo "[deployment-test] sending post-restart chat"
PIWORK_CONFIG_PATH="$CLIENT_CONFIG" node apps/cli/dist/main.js --core "$CORE_URL" --json chat "$WORK_ID" --message "Confirm that the restarted Core retained this Work." >/dev/null

echo "[deployment-test] cleaning Work and login"
user_cli work delete "$WORK_ID" --wait >/dev/null
WORK_ID=""
user_cli logout >/dev/null

echo "deployment test passed: bootstrap, login, Work config, chat, and restart persistence"
