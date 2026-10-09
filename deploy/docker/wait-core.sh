#!/bin/sh
set -eu

piwork_wait_url=${PIWORK_CORE_URL:-}
if ! printf '%s' "$piwork_wait_url" | jq --exit-status --raw-input '
    capture("^https?://(?<host>\\[[0-9a-fA-F:]+\\]|[a-zA-Z0-9_.-]+)(:(?<port>[0-9]+))?/?$")
    | (.port == null or ((.port | tonumber) > 0 and (.port | tonumber) <= 65535))
    ' >/dev/null 2>&1; then
    printf '%s\n' 'Set PIWORK_CORE_URL to a valid HTTP(S) Core origin.' >&2
    exit 2
fi
piwork_wait_url=${piwork_wait_url%/}
piwork_wait_deadline=$(( $(date +%s) + 600 ))
while :; do
    piwork_wait_remaining=$(( piwork_wait_deadline - $(date +%s) ))
    [ "$piwork_wait_remaining" -gt 0 ] || exit 1
    piwork_wait_request=3
    [ "$piwork_wait_remaining" -ge 3 ] || piwork_wait_request=$piwork_wait_remaining
    if piwork_wait_status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
        --proto '=http,https' --connect-timeout 2 --max-time "$piwork_wait_request" \
        --url "$piwork_wait_url/readyz?profile=docker-delivery" 2>/dev/null); then
        [ "$piwork_wait_status" = 200 ] && exit 0
    else
        piwork_wait_result=$?
        if [ "$piwork_wait_result" -eq 3 ]; then
            printf '%s\n' 'Set PIWORK_CORE_URL to a valid HTTP(S) Core origin.' >&2
            exit 2
        fi
    fi
    piwork_wait_remaining=$(( piwork_wait_deadline - $(date +%s) ))
    [ "$piwork_wait_remaining" -gt 0 ] || exit 1
    piwork_wait_delay=5
    [ "$piwork_wait_remaining" -ge 5 ] || piwork_wait_delay=$piwork_wait_remaining
    sleep "$piwork_wait_delay"
done
