# Offline Pi package fixtures

`tools-v1` and `tools-v2` are two versions of the same package. Each declares an extension, Skill, prompt, theme, and a pure JavaScript runtime dependency stored under `vendor/`. Its `postinstall` script writes `prepared.txt`, making preparation observable without any public registry or model secret.

Install a directory with `piwork-serve packages install ./fixtures/pi-packages/tools-v1 --default --wait` or package it as a ZIP with the local `packPiPackageDirectory` helper. The source can be deleted after installation; Work contexts and `.work` exports retain prepared package bytes.

`scripts/pi-package-sources.mjs` serves these same versioned bytes through a local npm registry and dumb-HTTP Git repository. It builds a disposable agent image with test-only registry and Git URL settings so isolated Docker prepare networks can reach the fixture through the Docker bridge gateway. `npm run acceptance` runs the four-source Core/Work matrix; `apps/package-helper/src/main.test.ts` also tests source resolution without Docker. No public tag or model secret is required.

The source harness adds a small marker file to npm and Git packages. The snapshot acceptance adds separate local and ZIP markers, so identical runtime behavior still produces four distinct artifact digests and verifies that all four source kinds survive `.work` export/import.
