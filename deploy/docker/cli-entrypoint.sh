#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
    exec piwork-cli "$@"
fi

# The timeout applies to readiness only, never to the user's terminal session.
timeout -s TERM 600 /usr/local/libexec/piwork/wait-core &
piwork_wait_pid=$!
trap 'kill -TERM "$piwork_wait_pid" 2>/dev/null || :; wait "$piwork_wait_pid" 2>/dev/null || :; exit 143' TERM
trap 'kill -TERM "$piwork_wait_pid" 2>/dev/null || :; wait "$piwork_wait_pid" 2>/dev/null || :; exit 130' INT
if wait "$piwork_wait_pid"; then
    trap - TERM INT
    printf '%s\n' 'Core is ready. Run piwork-cli login, then create a Work and chat.'
    exec /bin/sh -i
fi
printf '%s\n' 'Core is not ready. Check the Core container status and logs, then retry.' >&2
exit 1
