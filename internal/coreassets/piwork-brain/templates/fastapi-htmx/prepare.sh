#!/bin/sh
set -eu
exec /usr/local/bin/piwork-fastapi prepare --app "$(dirname "$0")"
