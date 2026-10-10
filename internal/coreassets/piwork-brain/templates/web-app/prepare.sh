#!/bin/sh
set -eu
exec /usr/local/bin/piwork-web prepare --app "$(dirname "$0")"
