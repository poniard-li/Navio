# Cloud source checks

This workflow checks and compiles the desktop source. It does not start Electron,
download Mihomo or other runtime resources, build installers, publish releases, or
connect to the account service. No production credentials are required.

Use Node.js 24. CI fixes the version to 24.22.1 and pnpm to 11.8.0.
The setup script uses the installed pnpm only when its version matches. Otherwise,
it obtains pnpm 11.8.0 through `npm exec --yes`, without changing the global
installation. npm registry access is required for a fresh dependency cache.

From a checkout, run:

```sh
node scripts/cloud/setup.mjs
node scripts/cloud/check.mjs
```

On Linux, `bash scripts/cloud/setup.sh` is an equivalent setup entry point.
The scripts resolve the project directory themselves and accept `--help`.
Unknown arguments fail before installation or checks begin.

To split checks from compilation:

```sh
node scripts/cloud/check.mjs --checks-only
node scripts/cloud/check.mjs --build-only
```

The setup uses `pnpm install --ignore-scripts --frozen-lockfile`; it does not
change the lockfile or execute installation lifecycle scripts. Checks run format,
lint, both TypeScript projects, Vitest, and the Node.js installer policy and QA entry-point tests.
Windows excludes the POSIX-only `src/main/utils/app-info/linux.test.ts`, matching
the existing CI. Linux runs the full Vitest suite; Windows-only installer tests
remain skipped by their own platform guards. Compilation uses the existing
`scripts/build-native.mjs` and writes `out/`.

The workflow listens only to pushes on `codex/cloud-handoff-*` and manual
dispatches. It has read-only repository permissions and runs Ubuntu 24.04 and
Windows Server 2025 jobs. A passing job is evidence for source checks and
compilation only. It is not a Linux desktop, Windows service, TUN, system proxy,
installer, or end-to-end account test.

Linux needs separately prepared platform-specific native resources and a desktop
environment to run Navio; this setup does not provide them. Windows release
packaging remains the separate pinned-resource process documented in
`DEX-BUILD.txt`. Do not use a cloud check result as permission to publish or deploy.
