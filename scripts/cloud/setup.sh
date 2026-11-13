#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 24 is required. Install it before running this setup script.' >&2
  exit 1
fi
exec node "$script_dir/setup.mjs" "$@"
