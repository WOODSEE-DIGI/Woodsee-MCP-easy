#!/bin/bash
# One command before a public push: PII/secret scrub + full safety gate + AV.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== 1/3 PII / secret scrub (working tree)"
python3 "$ROOT/lib/safety.py" scrub || true

echo "== 2/3 full safety gate (staged files, licence, vendored scans, hooks)"
python3 "$ROOT/lib/safety.py" check

echo "== 3/3 ClamAV deep scan (required)"
python3 "$ROOT/lib/scanner.py" deep "$ROOT" --clamav

echo "FINAL SCRUB PASSED"
