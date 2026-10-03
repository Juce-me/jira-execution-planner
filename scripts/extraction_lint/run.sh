#!/usr/bin/env bash
# Extraction safety gate. Installs its tools into gitignored tmp/lint (no repo dependency).
# Usage: scripts/extraction_lint/run.sh [source-root]    (default: frontend/src)
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC="${1:-frontend/src}"
LINT_DIR=tmp/lint
MAX_WARNINGS="${EXTRACTION_LINT_MAX_WARNINGS:-115}"   # ratchet: lower it whenever a commit removes warnings
BASELINE=scripts/extraction_lint/hook_interface_baseline.txt   # optional; absent means empty
mkdir -p "$LINT_DIR"
# Verify every pinned package: a cached ESLint binary alone is insufficient.
if ! node - "$LINT_DIR" <<'NODE'
const path = require('node:path');
const dir = process.argv[2];
const pins = { eslint: '9.39.5', globals: '14.0.0', 'eslint-plugin-react': '7.37.5', 'eslint-plugin-react-hooks': '7.1.1', espree: '10.4.0' };
for (const [name, version] of Object.entries(pins)) {
    try { if (require(path.resolve(dir, 'node_modules', name, 'package.json')).version !== version) process.exit(1); }
    catch { process.exit(1); }
}
NODE
then
    npm install --prefix "$LINT_DIR" --no-audit --no-fund \
        eslint@9.39.5 globals@14.0.0 eslint-plugin-react@7.37.5 eslint-plugin-react-hooks@7.1.1 espree@10.4.0
fi
cp scripts/extraction_lint/eslint.config.mjs "$LINT_DIR/eslint.config.mjs"
cp scripts/extraction_lint/check_hook_interfaces.mjs "$LINT_DIR/check_hook_interfaces.mjs"
cp scripts/extraction_lint/check_move_conservation.mjs "$LINT_DIR/check_move_conservation.mjs"
status=0
"$LINT_DIR/node_modules/.bin/eslint" --no-config-lookup -c "$LINT_DIR/eslint.config.mjs" \
    --max-warnings "$MAX_WARNINGS" "$SRC" || status=1
if [ "$SRC" = "frontend/src" ]; then
    "${JEP_TEST_PYTHON:-.venv/bin/python}" tests/test_codebase_structure_budgets.py \
        --manifest scripts/extraction_lint/owner_budgets.json || status=1
    node "$LINT_DIR/check_hook_interfaces.mjs" --baseline "$BASELINE" \
        --manifest scripts/extraction_lint/owner_budgets.json "$SRC/dashboard.jsx" || status=1
else
    node "$LINT_DIR/check_hook_interfaces.mjs" --baseline "$BASELINE" "$SRC/dashboard.jsx" || status=1
fi
exit "$status"
