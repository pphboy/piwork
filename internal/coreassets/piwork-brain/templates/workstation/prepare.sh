#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/python -m pip install --no-index --find-links wheels --require-hashes -r requirements.lock
