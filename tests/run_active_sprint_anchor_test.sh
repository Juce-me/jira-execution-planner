#!/bin/bash
# Helper script to run PRODUCT-33712 test case
# This script checks for the fixture and runs the test

set -e

FIXTURE_PATH="tests/fixtures/scenario-example.json"
TEST_MODULE="tests.test_scheduler_product_33712_active_sprint"

echo "=========================================="
echo "PRODUCT-33712 Active Sprint Test Runner"
echo "=========================================="
echo ""

# Check if fixture exists
if [ ! -f "$FIXTURE_PATH" ]; then
    echo "❌ ERROR: Fixture not found"
    echo ""
    echo "The test requires scenario-example.json with real PRODUCT-33712 data."
    echo ""
    echo "To fix:"
    echo "  cp /mnt/data/scenario-example.json tests/fixtures/scenario-example.json"
    echo ""
    echo "Or, if the fixture is in a different location:"
    echo "  cp /path/to/your/scenario-example.json tests/fixtures/scenario-example.json"
    echo ""
    exit 1
fi

echo "✅ Fixture found: $FIXTURE_PATH"
echo ""

# Validate JSON
if ! python3 -c "import json; json.load(open('$FIXTURE_PATH'))" 2>/dev/null; then
    echo "❌ ERROR: Fixture is not valid JSON"
    exit 1
fi

echo "✅ Valid JSON format"
echo ""

# Check for required issue keys (use sanitized keys or real ones)
echo "Checking for required issues..."
REQUIRED_KEYS=("TEST-101" "TEST-102" "TEST-103" "TEST-104")
ALL_FOUND=true

for key in "${REQUIRED_KEYS[@]}"; do
    if grep -q "\"$key\"" "$FIXTURE_PATH"; then
        echo "  ✅ $key"
    else
        echo "  ⚠️  $key (not found, may be using real data)"
        # Don't fail - real fixture may have different keys
    fi
done

# Check if fixture has any issues at all
if ! grep -q "\"issues\"" "$FIXTURE_PATH"; then
    echo ""
    echo "❌ ERROR: Fixture doesn't contain 'issues' array"
    exit 1
fi

echo ""

echo "=========================================="
echo "Running Test"
echo "=========================================="
echo ""

# Run the test
python3 -m unittest "$TEST_MODULE" -v

# Capture exit code
TEST_EXIT_CODE=$?

echo ""
echo "=========================================="

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ ALL TESTS PASSED"
    echo "=========================================="
    echo ""
    echo "The scheduler correctly:"
    echo "  ✅ Anchors non-done tasks (Accepted, To Do, Blocked) to TODAY or later"
    echo "  ✅ Keeps Done tasks at sprint start (before TODAY)"
    echo "  ✅ Assigns valid start/end dates to all scheduled issues"
    echo "  ✅ Respects dependency ordering"
    echo ""
else
    echo "❌ TEST FAILED"
    echo "=========================================="
    echo ""
    echo "This is EXPECTED if you haven't implemented the fix yet."
    echo ""
    echo "Common failure reasons:"
    echo "  • Non-done tasks start before TODAY (anchor not applied)"
    echo "  • Scheduled issues have None start/end dates"
    echo "  • Dependencies violated (dependent starts before prerequisite ends)"
    echo ""
    echo "Next steps:"
    echo "  1. Review test output above to see which assertions failed"
    echo "  2. Implement the fix in planning/scheduler.py"
    echo "  3. Re-run this script to verify the fix"
    echo ""
fi

echo "Security reminder:"
echo "  ⚠️  This test uses real Jira data - keep it LOCAL ONLY"
echo "  ⚠️  Never commit tests/fixtures/scenario-example.json"
echo ""

exit $TEST_EXIT_CODE
