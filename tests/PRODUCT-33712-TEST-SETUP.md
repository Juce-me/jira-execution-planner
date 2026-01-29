# PRODUCT-33712 Test Case Setup

**Branch**: `test/product-33712-active-sprint-anchor-and-deps`

**Status**: ✅ Test infrastructure created, awaiting fixture file

---

## Overview

This test case verifies the fix for PRODUCT-33712 (Active Sprint timeline placement + dependency visualization bug).

### The Bug

- **Unfocused mode**: Accepted (and other non-done) tasks render left of TODAY, even though Active Sprint must anchor them to TODAY or to the right
- **Focused mode**: Dependency edges "shoot" across the whole timeline and land on wrong bar positions

### Test Goals

1. **Backend**: Verify scheduler correctly anchors non-done tasks to TODAY
2. **Backend**: Verify all scheduled issues have valid start/end dates (no None values)
3. **Backend**: Verify dependencies are respected (dependents start after prerequisites)
4. **Frontend**: Verify focus/unfocus doesn't change bar x-positions
5. **Frontend**: Verify dependency edges only render between visible bars

---

## File Structure

```
tests/
├── README.md                                    # Test suite documentation
├── test_planning.py                             # Existing scheduler tests
├── test_date_parsing.py                         # Date parsing utilities ✅
├── test_scheduler_product_33712_active_sprint.py # PRODUCT-33712 backend test (LOCAL ONLY)
├── fixtures/
│   ├── README.md                                # Fixture security policy
│   ├── .gitignore                               # Blocks *.json (real data)
│   └── scenario-example.json                    # MISSING - needs to be copied
└── ui/
    └── scenario_product_33712_focus_positions.spec.js # Frontend test template (LOCAL ONLY)
```

---

## Setup Instructions

### Step 1: Copy the Fixture File

The test requires `scenario-example.json` with real PRODUCT-33712 epic data.

```bash
# Copy the fixture (replace /mnt/data with actual location if different)
cp /mnt/data/scenario-example.json tests/fixtures/scenario-example.json

# Verify the file exists
ls -lh tests/fixtures/scenario-example.json
```

**IMPORTANT**: This file contains real Jira data and is blocked by `.gitignore`. Never commit it.

### Step 2: Verify Fixture Structure

The fixture should have this structure:

```json
{
  "data": {
    "issues": [
      {
        "key": "PRODUCT-33713",
        "status": "Accepted",
        "sp": 3,
        "team": "...",
        "assignee": "...",
        ...
      },
      {
        "key": "PRODUCT-33715",
        "status": "Done",
        ...
      },
      {
        "key": "PRODUCT-33716",
        "status": "To Do",
        ...
      },
      {
        "key": "PRODUCT-34063",
        "status": "Blocked",
        ...
      },
      ...
    ],
    "dependencies": [
      {
        "from": "PRODUCT-33715",
        "to": "PRODUCT-33713",
        ...
      },
      ...
    ]
  }
}
```

Required issues (all part of epic PRODUCT-33712):
- `PRODUCT-33713` (Accepted)
- `PRODUCT-33715` (Done)
- `PRODUCT-33716` (To Do)
- `PRODUCT-34063` (Blocked or similar)

---

## Running the Tests

### Backend Tests (Python)

```bash
# Run just the PRODUCT-33712 test
python3 -m unittest tests.test_scheduler_product_33712_active_sprint -v

# Run all tests
python3 -m unittest discover -s tests -v

# Expected output (BEFORE fix):
# FAIL: test_product_33712_active_sprint_anchor_and_dates_not_null
# AssertionError: PRODUCT-33713 starts before TODAY: 2026-01-20 < 2026-01-29

# Expected output (AFTER fix):
# OK - All tests pass
```

### Frontend Tests (Playwright)

**Note**: Frontend test is a template. Requires Playwright setup and selector updates.

```bash
# Install Playwright (if not already installed)
npm install -D @playwright/test

# Run the test (after uncommenting and updating selectors)
npx playwright test tests/ui/scenario_product_33712_focus_positions.spec.js
```

---

## Test Details

### Backend Test: `test_scheduler_product_33712_active_sprint.py`

**What it tests**:

1. ✅ All 4 epic issues get valid `start_date` and `end_date` (not None)
2. ✅ Non-done issues (Accepted, To Do, Blocked) have `start_date >= TODAY`
3. ✅ Done issue (PRODUCT-33715) can be before TODAY (anchored at sprint start)
4. ✅ Dependencies are respected: `dependent.start_date >= prerequisite.end_date`
5. ✅ "Accepted" status is treated as TODO (not done, not in-progress)

**Key assertions**:

```python
# Active Sprint: anchor_date clamps TODO-like statuses to TODAY
for key in ["PRODUCT-33713", "PRODUCT-33716", "PRODUCT-34063"]:
    issue = by_key[key]
    self.assertGreaterEqual(
        issue.start_date, TODAY,
        f"{key} starts before TODAY"
    )
```

### Frontend Test: `scenario_product_33712_focus_positions.spec.js`

**What it tests**:

1. Bar x-positions remain stable when toggling focus mode
2. Dependency edges are only drawn between visible bars
3. No edges "shoot to the end" (use domain max as fallback)

**Key assertions**:

```javascript
// Positions must be unchanged (within 1px)
expect(Math.abs(focusedPositions[key].x - unfocusedPositions[key].x)).toBeLessThan(1);

// Edge endpoints must reference visible bars
expect(visibleKeys).toContain(fromKey);
expect(visibleKeys).toContain(toKey);
```

---

## Acceptance Criteria

### Before Fix (Expected Test Failures)

- ❌ Backend test fails: Non-done issues have `start_date < TODAY` or `start_date = None`
- ❌ Frontend test fails: Focus mode changes bar x-positions
- ❌ Frontend test fails: Edges point to far-right "void" position

### After Fix (Expected Test Passes)

- ✅ Backend test passes: All non-done issues have `start_date >= TODAY`
- ✅ Backend test passes: All scheduled issues have valid dates (no None)
- ✅ Backend test passes: Dependencies are respected
- ✅ Frontend test passes: Focus doesn't change positions
- ✅ Frontend test passes: Edges only render between visible bars

---

## Security Policy

**CRITICAL**: This test uses real Jira data and must be kept LOCAL ONLY.

### Rules

1. ❌ **Never commit** `tests/fixtures/scenario-example.json`
2. ❌ **Never commit** test files with real issue keys, team names, or API data
3. ❌ **Never push** this branch to public repository
4. ✅ **Always** keep fixture files in `.gitignore`
5. ✅ **Always** mark tests with "LOCAL ONLY" comments

### What's Protected by .gitignore

- `tests/fixtures/*.json` (all fixture files)
- `tests/fixtures/*.csv`
- `tests/fixtures/*.xml`

### Safe to Commit

- Test code structure (this file, test_*.py files)
- Documentation (README.md, security policies)
- Sanitized fixtures with suffix `-sanitized.json` (if needed)

---

## Troubleshooting

### "Fixture not found" Error

```
FileNotFoundError: Fixture not found: /path/to/tests/fixtures/scenario-example.json
Please copy /mnt/data/scenario-example.json to tests/fixtures/scenario-example.json
```

**Solution**: Copy the fixture file as described in Step 1.

### Test Fails: "Issue PRODUCT-XXXXX not in scheduled results"

**Cause**: Fixture doesn't contain the expected issues.

**Solution**: Verify fixture structure matches the expected format (see Step 2).

### Test Fails: "starts before TODAY"

**Good!** This means the test is working and detected the bug. This failure is expected BEFORE the fix.

---

## Next Steps

1. ✅ **Copy fixture**: `cp /mnt/data/scenario-example.json tests/fixtures/`
2. ✅ **Run test**: `python3 -m unittest tests.test_scheduler_product_33712_active_sprint -v`
3. ✅ **Expect failure**: Test should fail with "starts before TODAY" (this confirms the bug)
4. 🔧 **Implement fix**: Fix scheduler.py to handle Accepted status and anchor to TODAY
5. ✅ **Verify fix**: Re-run test, should pass
6. ✅ **Frontend test**: Set up Playwright and run UI test
7. 📸 **Screenshots**: Capture before/after for PR

---

## Related Files

- `planning/scheduler.py:235` - `min_start_week` logic for non-done statuses
- `planning/scheduler.py:34-36` - `DONE_STATUSES` and `IN_PROGRESS_STATUSES` definitions
- `AGENTS.md` - Security policy for test data
- `tests/fixtures/README.md` - Fixture security guidelines

---

## Questions?

See:
- `tests/README.md` - Test suite documentation
- `tests/fixtures/README.md` - Fixture security policy
- `AGENTS.md` - Project guidelines

