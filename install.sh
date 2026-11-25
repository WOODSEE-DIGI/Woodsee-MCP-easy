#!/bin/bash
# Woodsee MCP Easy - one-command installer for the Woodsee MCP stack.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required. Install it with: xcode-select --install" >&2
  exit 1
fi

exec python3 "$SCRIPT_DIR/lib/installer.py" "$@"
