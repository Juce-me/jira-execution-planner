#!/usr/bin/env bash
# Seeded-defect controls. Each seeded defect must make the gate fail with the expected finding;
# a control the gate passes means the gate cannot be trusted. Works on copies under tmp/.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=tmp/negative-controls
LINT_DIR=tmp/lint
rm -rf "$OUT"
mkdir -p "$OUT"
failures=0

seed() {   # seed <dir> <python that edits `s` (dashboard.jsx text) or writes files under `src`>
    python3 - "$1/src" <<PY
import pathlib, re, sys
src = pathlib.Path(sys.argv[1])
dash = src / "dashboard.jsx"
s = dash.read_text()
original = s
before_files = {p.name for p in src.iterdir()}
$2
if s == original and {p.name for p in src.iterdir()} == before_files:
    sys.exit(3)
dash.write_text(s)
PY
}

control() {   # control <name> <expected finding> <python seed>
    local dir="$OUT/$1"
    mkdir -p "$dir"
    cp -R frontend/src "$dir/src"
    if ! seed "$dir" "$3"; then
        echo "ANCHOR $1: the seed changed nothing; re-anchor the control (its anchor text moved)"; failures=$((failures + 1)); return
    fi
    if bash scripts/extraction_lint/run.sh "$dir/src" >"$dir/gate.log" 2>&1; then
        echo "FAIL  $1: the gate passed a seeded defect"; failures=$((failures + 1))
    elif grep -q -- "$2" "$dir/gate.log"; then
        echo "ok    $1"
    else
        echo "FAIL  $1: the gate failed without the expected finding ($2)"; failures=$((failures + 1))
    fi
}

control missing-jsx-import 'react/jsx-no-undef' \
's = re.sub(r"^import SettingsModal[^\n]*\n", "", s, count=1, flags=re.M)'
control use-before-define 'no-use-before-define' \
'm = "const [scenarioLoading, setScenarioLoading] = useState(false);"
s = s.replace(m, m + "\n            const __probe = engWorkspaceConfigured;", 1)'
control undefined-name 'no-undef' \
's = s.replace("const registerScenarioIssueRef =", "const registerScenarioIssueRefMoved =", 1)'
control react-not-in-scope 'react-in-jsx-scope' \
'(src / "ProbeView.jsx").write_text("export default function ProbeView() { return <div />; }\n")'
control destructured-name-not-returned 'destructured but not returned' \
's = s.replace("            } = useGroupVisibilityPreferences({", "                bogusName,\n            } = useGroupVisibilityPreferences({", 1)'
control required-input-not-passed 'required input not passed' \
'i = s.index("= useGroupVisibilityPreferences({")
j = s.index("});", i)
s = s[:i] + s[i:j].replace("                groupsLoading,\n", "", 1) + s[j:]'

# The conservation script is not part of the gate; its control proves it reports an edited statement.
dir="$OUT/edited-statement"
mkdir -p "$dir"
cp -R frontend/src "$dir/src"
seed "$dir" 's = s.replace("window.setInterval(poll, 5000)", "window.setInterval(poll, 5001)", 1)' \
    || { echo "ANCHOR edited-statement: the seed changed nothing; re-anchor the control"; failures=$((failures + 1)); }
cp scripts/extraction_lint/check_move_conservation.mjs "$LINT_DIR/check_move_conservation.mjs"
node "$LINT_DIR/check_move_conservation.mjs" --base-file frontend/src/dashboard.jsx --dashboard "$dir/src/dashboard.jsx" >"$dir/conservation.log" 2>&1
if grep -q 'removed and not found in a hook: 1; new statements: 1' "$dir/conservation.log"; then
    echo "ok    edited-statement (conservation)"
else
    echo "FAIL  edited-statement: the conservation check did not report the edit"; failures=$((failures + 1))
fi

EXTRACTION_TOOL_DIR="$LINT_DIR" node scripts/extraction_lint/tooling_controls.mjs \
    || failures=$((failures + 1))

echo "negative controls failed: $failures"
exit "$failures"
