#!/usr/bin/env bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
verify_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$verify_root"
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))'; then
    echo 'Verification requires Python 3.9+.' >&2
    exit 1
fi
node_bin="$(python3 scripts/sublime/runtime.py)"
for file in scripts/*.sh; do bash -n "$file"; done
python3 -m unittest discover -s tests -p 'test_*.py' -v
verify_tmp="$(mktemp -d)"
trap 'rm -rf -- "$verify_tmp"' EXIT
python3 - "$verify_tmp/package.json" <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, 'scripts/sublime')
from package import package
Path(sys.argv[1]).write_text(json.dumps(package()))
PY
"$node_bin" --check sublime/controller.js
"$node_bin" --check tests/controller.test.cjs
"$node_bin" tests/controller.test.cjs "$verify_tmp/package.json"
scripts/thg-sublime.sh apply --fixture
git diff --check
echo 'THG Sublime Phase 1 local verification passed; live/browser acceptance remains pending.'
