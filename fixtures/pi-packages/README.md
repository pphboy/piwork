# Offline Pi package fixtures

`tools-v1` and `tools-v2` are two versions of the same package. Each declares an extension, Skill, prompt, theme, and a pure JavaScript runtime dependency stored under `vendor/`. Its `postinstall` script writes `prepared.txt`, making preparation observable without any public registry or model secret.

Install a directory with `piwork-serve packages install ./fixtures/pi-packages/tools-v1 --default --wait` or package it as a ZIP with the Go CLI. The source can be deleted after installation; Work contexts and `.work` exports retain prepared package bytes.

Go integration tests use these directories for local and ZIP source coverage. npm/Git sources are covered by the native package helper's registry and URL fixtures, including a separate real public npm acceptance. No model secret is required for the deterministic suite.

The snapshot integration tests keep source kind and content digest distinct across export/import, even when runtime behavior is similar.
